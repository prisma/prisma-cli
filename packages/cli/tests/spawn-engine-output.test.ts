/**
 * The engine and the SHIPPED spawn adapter together, with a real child,
 * when the command transforms the child's output.
 */
import {
  type ChildStreamName,
  defineCommand,
  exitWithChildStatus,
  type SpawnOptions,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";
import { makeSpawnChild } from "../src/spawn";

const NODE = process.execPath;
const TICKS = /^(tick\n)+$/;

function redacting(secret: string) {
  return (_stream: ChildStreamName) => {
    let held = "";
    return new TransformStream<string, string>({
      transform: (chunk, controller) => {
        const text = (held + chunk).replaceAll(secret, "[redacted]");
        const keep = Math.min(text.length, secret.length - 1);
        held = text.slice(text.length - keep);
        if (text.length > keep) {
          controller.enqueue(text.slice(0, text.length - keep));
        }
      },
      flush: (controller) => {
        if (held !== "") {
          controller.enqueue(held);
        }
      },
    });
  };
}

function nodeCommand(
  script: string,
  transformOutput: SpawnOptions["transformOutput"],
  onError?: (cause: unknown) => void,
) {
  return defineCommand({
    help: { summary: "Runs a node child and transforms its output" },
    maySpawn: true,
    handler: async (_args, ctx) => {
      try {
        await ctx.spawn({
          command: NODE,
          args: ["-e", script],
          transformOutput,
        });
      } catch (cause) {
        onError?.(cause);
      }
      return ok(exitWithChildStatus());
    },
  });
}

function cliFor(command: ReturnType<typeof nodeCommand>) {
  return createTestCli({
    commands: { converge: command },
    spawn: makeSpawnChild({ write: () => {} }, { drainGraceMs: 200 }),
  });
}

const CHATTER = `
const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
(async () => {
  process.stdout.write("out-1 hunt");
  await pause();
  process.stderr.write("err-1\\n");
  await pause();
  process.stdout.write("er2\\nout-2\\n");
  await pause();
  process.exitCode = 4;
})();
`;

describe.skipIf(process.platform === "win32")(
  "transformed output through the shipped spawn adapter",
  () => {
    test("each stream is transformed in order and written where the child would have written it", async () => {
      const cli = cliFor(nodeCommand(CHATTER, redacting("hunter2")));

      const result = await cli.run(["converge", "--format", "human"]);

      expect(result.spawns[0]?.output).toBe("engine");
      expect(result.exitCode).toBe(4);
      expect(result.stdout).toBe("out-1 [redacted]\nout-2\n");
      expect(result.stderr).toBe("err-1\n");
    });

    test("json mode writes both streams to stderr", async () => {
      const cli = cliFor(nodeCommand(CHATTER, redacting("hunter2")));

      const result = await cli.run(["converge", "--json"]);

      expect(result.json).toHaveLength(1);
      expect(result.stderr.replace("err-1\n", "")).toBe(
        "out-1 [redacted]\nout-2\n",
      );
      expect(result.stderr).toContain("err-1\n");
    });

    test("an abort ends the child, and its output written so far still arrives", async () => {
      const controller = new AbortController();
      const command = defineCommand({
        help: { summary: "Aborts, then runs a child" },
        maySpawn: true,
        handler: async (_args, ctx) => {
          ctx.report({ kind: "status", subject: "run", status: "ready" });
          await new Promise((resolve) => setTimeout(resolve, 0));
          await ctx.spawn({
            command: NODE,
            args: [
              "-e",
              "setInterval(() => process.stdout.write('tick\\n'), 10)",
            ],
            transformOutput: redacting("hunter2"),
          });
          return ok(exitWithChildStatus());
        },
      });
      const cli = createTestCli({
        commands: { converge: command },
        spawn: makeSpawnChild({ write: () => {} }, { drainGraceMs: 200 }),
      });

      const result = await cli.run(["converge"], {
        abort: controller.signal,
        onEvent: (event) => {
          if (event.kind === "status") {
            controller.abort();
          }
        },
      });

      expect(result.spawns[0]?.kills[0]).toBe("SIGTERM");
      expect(result.exitCode).toBe(143);
      expect(result.stdout === "" || TICKS.test(result.stdout)).toBe(true);
    });

    test("a throwing transform ends a child that ignores SIGTERM, and ctx.spawn rejects with its error", async () => {
      let caught: unknown;
      const script = `
process.on("SIGTERM", () => {});
process.stdout.write("ready\\n");
setInterval(() => process.stdout.write("tick\\n"), 10);
`;
      const cli = cliFor(
        nodeCommand(
          script,
          () =>
            new TransformStream<string, string>({
              transform: (chunk, controller) => {
                if (chunk.includes("tick")) {
                  throw new Error("redaction failed");
                }
                controller.enqueue(chunk);
              },
            }),
          (cause) => {
            caught = cause;
          },
        ),
      );

      const result = await cli.run(["converge", "--format", "human"]);

      expect((caught as Error).message).toBe("redaction failed");
      expect(result.spawns[0]?.kills).toEqual(["SIGTERM", "SIGKILL"]);
      expect(result.stdout).toBe("ready\n");
      expect(result.exitCode).toBe(137);
    });

    test("output dropped at the drain grace leaves a debug line", async () => {
      const script = `require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { detached: true, stdio: ["ignore", "inherit", "ignore"] }).unref(); process.stdout.write("done\\n");`;
      const cli = cliFor(nodeCommand(script, redacting("hunter2")));

      const result = await cli.run(["converge", "--format", "human"], {
        env: { PRISMA_DEBUG: "1" },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("done\n");
      expect(result.stderr).toContain(
        "spawn: the child's stdout failed, so its later output was dropped: the pipe was still open 200ms after the child exited, so it was closed",
      );
    });
  },
  20_000,
);
