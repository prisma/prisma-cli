/**
 * The SHIPPED spawn adapter (src/spawn.ts), driven directly: the
 * engine's real-child suite proves the terminal-handoff properties
 * about test-local copies, so this is the test that pins the adapter
 * production actually wires — exit passthrough, ENOENT rejection, kill
 * delivery, and the spawn options the whole design rests on (inherited
 * human stdio, piped structured output, no `detached`, no new console). Runs on the Windows CI leg
 * too, which is where the options assertion earns its keep.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

const spawnOptionsSeen = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (
      command: string,
      args: readonly string[],
      options: Record<string, unknown>,
    ) => {
      spawnOptionsSeen.push(options);
      return actual.spawn(command, [...args], options as never);
    },
  };
});

import { makeSpawnChild } from "../src/spawn";

const NODE = process.execPath;
let diagnosticText = "";
const spawnChild = makeSpawnChild({
  write: (text) => {
    diagnosticText += text;
  },
});

beforeEach(() => {
  diagnosticText = "";
});

async function waitForFile(path: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${path}`);
    }
    // biome-ignore lint/performance/noAwaitInLoops: this waits for another process to create the file, so the loop has to pause between checks rather than issue them all at once.
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

describe("the shipped spawn adapter", () => {
  test("passes the spawn options the design rests on: inherited stdio, no detached, no new console", async () => {
    const child = spawnChild({
      command: NODE,
      args: ["-e", "process.exit(0)"],
      cwd: process.cwd(),
      env: process.env,
      output: "inherit",
    });
    await child.ended;

    const options = spawnOptionsSeen.at(-1);
    expect(options).toBeDefined();
    expect(options?.stdio).toBe("inherit");
    expect(options).not.toHaveProperty("detached");
    expect(options).not.toHaveProperty("shell");
    expect(options).not.toHaveProperty("windowsHide");
  });

  test("the child's exit code passes through", async () => {
    const child = spawnChild({
      command: NODE,
      args: ["-e", "process.exit(3)"],
      cwd: process.cwd(),
      env: process.env,
      output: "inherit",
    });

    await expect(child.ended).resolves.toEqual({ exitCode: 3, signal: null });
  });

  test("a missing program rejects the ended promise", async () => {
    const child = spawnChild({
      command: join(process.cwd(), "definitely-not-a-real-binary-s3"),
      args: [],
      cwd: process.cwd(),
      env: process.env,
      output: "inherit",
    });

    await expect(child.ended).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.skipIf(process.platform === "win32")(
    "kill delivers the signal to the live child",
    async () => {
      const ready = join(mkdtempSync(join(tmpdir(), "cli-spawn-")), "ready");
      const child = spawnChild({
        command: NODE,
        args: [
          "-e",
          // The handler is installed before the ready marker is written,
          // so a kill that lands the instant the test sees the marker
          // cannot hit the default SIGTERM disposition instead.
          "process.on('SIGTERM', () => process.exit(42)); require('node:fs').writeFileSync(process.argv[1], 'r'); setInterval(() => {}, 60_000);",
          ready,
        ],
        cwd: process.cwd(),
        env: process.env,
        output: "inherit",
      });
      await waitForFile(ready);

      child.kill("SIGTERM");

      // 42 is the child's SIGTERM-trap exit: only reachable if the
      // adapter's kill actually arrived.
      await expect(child.ended).resolves.toEqual({
        exitCode: 42,
        signal: null,
      });
    },
    20_000,
  );

  test("routes both child streams to diagnostics in structured mode", async () => {
    const child = spawnChild({
      command: NODE,
      args: [
        "-e",
        "process.stdout.write('child-out'); process.stderr.write('child-err')",
      ],
      cwd: process.cwd(),
      env: process.env,
      output: "diagnostic",
    });

    await expect(child.ended).resolves.toEqual({ exitCode: 0, signal: null });
    expect(spawnOptionsSeen.at(-1)?.stdio).toEqual(["inherit", "pipe", "pipe"]);
    expect(diagnosticText).toContain("child-out");
    expect(diagnosticText).toContain("child-err");
  });
});
