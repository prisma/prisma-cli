/**
 * ctx.spawn against a REAL child process, through an adapter identical
 * to the bin's node:child_process one: exit passthrough, ENOENT, group
 * membership, SIGTERM forwarding, record-and-replay, the abort ladder,
 * and — via a subprocess engine host — true inherited stdio and native
 * process-group Ctrl-C delivery. POSIX-only: group semantics do not
 * exist on Windows, where the fake-spawn suite is the assertion level.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defineCommand,
  exitWithChildStatus,
  type SpawnChild,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

const NODE = process.execPath;
const CHILD = fileURLToPath(new URL("./fixtures/child.mjs", import.meta.url));
const HOST = fileURLToPath(
  new URL("./fixtures/spawn-host.mjs", import.meta.url),
);

/** The bin adapter's shape, with child output discarded instead of
 *  inherited so it cannot interleave with the test reporter (the host
 *  subprocess tests cover true inheritance). */
const realSpawn: SpawnChild = (request) => {
  const child = spawn(request.command, [...request.args], {
    cwd: request.cwd,
    env: request.env,
    stdio: "ignore",
  });
  return {
    ended: new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
    }),
    kill: (signal) => {
      child.kill(signal);
    },
  };
};

function childCommand(...childArgs: string[]) {
  return defineCommand({
    help: { summary: "Runs the fixture child" },
    maySpawn: true,
    handler: async (_args, ctx) => {
      await ctx.spawn({
        command: NODE,
        args: [CHILD, ...childArgs],
      });
      return ok(exitWithChildStatus());
    },
  });
}

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

/** Wraps an adapter so SIGTERM is not delivered until the fixture has
 *  installed its trap — the engine's ladder fires the instant an
 *  already-aborted command spawns, which would otherwise race the
 *  child's startup and kill it before its SIGTERM handler exists. */
function termAfterReady(adapter: SpawnChild, ready: string): SpawnChild {
  return (request) => {
    const child = adapter(request);
    return {
      ended: child.ended,
      kill: (signal) => {
        if (signal === "SIGTERM") {
          waitForFile(ready, 2_000)
            .then(() => child.kill("SIGTERM"))
            .catch(() => {});
          return;
        }
        child.kill(signal);
      },
    };
  };
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "spawn-real-"));
}

/** Whether a pid is still a live process. Signal 0 tests whether the
 *  signal could be delivered without sending anything. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(process.platform === "win32")(
  "ctx.spawn, real child",
  () => {
    test("the child's exit status passes through verbatim", async () => {
      await Promise.all(
        [0, 1, 2, 3].map(async (code) => {
          const cli = createTestCli({
            commands: { converge: childCommand("exit", String(code)) },
            spawn: realSpawn,
          });

          expect((await cli.run(["converge"])).exitCode).toBe(code);
        }),
      );
    });

    test("a missing program is the structured CLI.SPAWN_FAILED error", async () => {
      const missing = defineCommand({
        help: { summary: "Spawns a program that does not exist" },
        maySpawn: true,
        handler: async (_args, ctx) => {
          await ctx.spawn({
            command: "/definitely/not/a/real/binary-s3",
          });
          return ok(exitWithChildStatus());
        },
      });
      const cli = createTestCli({
        commands: { converge: missing },
        spawn: realSpawn,
      });

      const result = await cli.run(["converge", "--format", "human"]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("CLI.SPAWN_FAILED");
      expect(result.stderr).toContain("ENOENT");
    });

    test("the child runs in the engine's own process group", async () => {
      const dir = scratch();
      const pgidFile = join(dir, "pgid");
      const cli = createTestCli({
        commands: { converge: childCommand("pgid", pgidFile) },
        spawn: realSpawn,
      });

      expect((await cli.run(["converge"])).exitCode).toBe(0);

      const ownPgid = execSync(`ps -o pgid= -p ${process.pid}`)
        .toString()
        .trim();
      expect(readFileSync(pgidFile, "utf8")).toBe(ownPgid);
    });

    test("SIGTERM delivered to the engine is forwarded to the live child", async () => {
      const dir = scratch();
      const ready = join(dir, "ready");
      const controller = new AbortController();
      const cli = createTestCli({
        commands: { converge: childCommand("trap-term", ready) },
        spawn: realSpawn,
      });

      const running = cli.run(["converge"], { abort: controller.signal });
      await waitForFile(ready);
      controller.abort("SIGTERM");
      const result = await running;

      // 42 is the fixture's SIGTERM-trap exit: only reachable if the
      // engine's forward actually arrived at the child.
      expect(result.exitCode).toBe(42);
      expect(result.spawns[0].kills).toEqual(["SIGTERM"]);
    });

    test("one recorded signal replays on child exit; the engine outlives the child", async () => {
      const dir = scratch();
      const ready = join(dir, "ready");
      let abortedDuringChild: boolean | undefined;
      let abortedAfterChild: boolean | undefined;
      const controller = new AbortController();
      const watcher = defineCommand({
        help: { summary: "Observes the abort around a real child" },
        maySpawn: true,
        handler: async (_args, ctx) => {
          const live = ctx.spawn({
            command: NODE,
            args: [CHILD, "ready-then-exit", ready],
          });
          await waitForFile(ready);
          controller.abort();
          abortedDuringChild = ctx.signal.aborted;
          await live;
          abortedAfterChild = ctx.signal.aborted;
          return ok(exitWithChildStatus());
        },
      });
      const cli = createTestCli({
        commands: { converge: watcher },
        spawn: realSpawn,
      });

      const result = await cli.run(["converge"], { abort: controller.signal });

      expect(abortedDuringChild).toBe(false);
      expect(abortedAfterChild).toBe(true);
      expect(result.exitCode).toBe(0);
    });

    test("the abort ladder: SIGTERM, the ruled grace, then SIGKILL", async () => {
      const dir = scratch();
      const ready = join(dir, "ready");
      const graceAskedMs: number[] = [];
      const controller = new AbortController();
      const late = defineCommand({
        help: { summary: "Spawns after the abort already fired" },
        maySpawn: true,
        handler: async (_args, ctx) => {
          ctx.report({ kind: "status", subject: "run", status: "ready" });
          await new Promise((resolve) => setTimeout(resolve, 0));
          await ctx.spawn({
            command: NODE,
            args: [CHILD, "ignore-term", ready],
          });
          return ok(exitWithChildStatus());
        },
      });
      const cli = createTestCli({
        commands: { converge: late },
        spawn: termAfterReady(realSpawn, ready),
        delay: async (ms) => {
          graceAskedMs.push(ms);
          await new Promise((resolve) => setTimeout(resolve, 500));
        },
      });

      const result = await cli.run(["converge"], {
        abort: controller.signal,
        onEvent: (event) => {
          if (event.kind === "status") {
            controller.abort();
          }
        },
      });

      expect(graceAskedMs).toEqual([5000]);
      expect(result.spawns[0].kills).toEqual(["SIGTERM", "SIGKILL"]);
      expect(result.exitCode).toBe(137);
    });
  },
  20_000,
);

interface HostRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function startHost(
  scenario: string,
  dir: string,
  opts?: { readonly detached?: boolean },
): {
  readonly pid: number;
  readonly done: Promise<HostRun>;
} {
  const host = spawn(NODE, [HOST, scenario, dir], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    detached: opts?.detached ?? false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  host.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  host.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const done = new Promise<HostRun>((resolve, reject) => {
    host.on("error", reject);
    host.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
  if (host.pid === undefined) {
    throw new Error("the host did not start");
  }
  return { pid: host.pid, done };
}

describe.skipIf(process.platform === "win32")(
  "ctx.spawn, real child through a real engine host",
  () => {
    test("structured mode routes child output to diagnostics and keeps stdout framed", async () => {
      const dir = scratch();

      const host = startHost("unframed-stdout", dir);
      const run = await host.done;

      expect(run.exitCode).toBe(0);
      const frames = run.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { kind: string; text?: string });
      expect(frames.map((frame) => frame.kind)).toEqual(["message", "result"]);
      expect(frames[0]?.text).toBe("during-child");
      expect(run.stdout).not.toContain("child-said-hello");
      expect(run.stderr).toContain("child-said-hello");
      expect(run.stderr).toContain("child-said-stderr");
    });

    test("native Ctrl-C reaches the child through the shared process group", async () => {
      const dir = scratch();

      const host = startHost("native-sigint", dir, { detached: true });
      await waitForFile(join(dir, "ready"));
      // The terminal's Ctrl-C: one SIGINT to the foreground process
      // group. The engine never forwards SIGINT, so the child dying by
      // SIGINT proves the group delivered it.
      process.kill(-host.pid, "SIGINT");
      const run = await host.done;

      const result = JSON.parse(
        readFileSync(join(dir, "result.json"), "utf8"),
      ) as { exitCode: number | null; signal: string | null; aborted: boolean };
      expect(result.signal).toBe("SIGINT");
      // The handler observed the replayed abort AFTER the child ended:
      // the engine outlived the child and resumed the handler.
      expect(result.aborted).toBe(true);
      expect(run.exitCode).toBe(130);
    });

    test("two signals during the window: abort, then force exit after the handler's turn", async () => {
      const dir = scratch();

      const host = startHost("double-sigint", dir);
      await waitForFile(join(dir, "ready"));
      // The engine is signalled directly (no group), so the child never
      // sees the first SIGINT; the second press is the escalation that
      // forwards SIGTERM and ends the idling child. The child's end is
      // driven by that forward, never by a timer.
      process.kill(host.pid, "SIGINT");
      // The host writes this marker only after the engine has finished
      // handling the first press, so the second press cannot arrive
      // early enough to be mistaken for part of the first.
      await waitForFile(join(dir, "signal-1"));
      process.kill(host.pid, "SIGINT");
      const run = await host.done;

      // result.json only exists if the handler got its cleanup turn
      // before the force exit.
      const result = JSON.parse(
        readFileSync(join(dir, "result.json"), "utf8"),
      ) as { exitCode: number | null; signal: string | null; aborted: boolean };
      expect(result.aborted).toBe(true);
      expect(result.signal).toBe("SIGTERM");
      expect(run.exitCode).toBe(130);
    });

    test("a child the handler abandoned is ended before the engine exits", async () => {
      const dir = scratch();

      const host = startHost("abandon-child", dir);
      const run = await host.done;

      const childPid = Number(readFileSync(join(dir, "child-pid"), "utf8"));
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain("resolved while a child was still live");
      // The host has exited. An orphan would still be running here.
      expect(alive(childPid)).toBe(false);
    });
  },
  20_000,
);
