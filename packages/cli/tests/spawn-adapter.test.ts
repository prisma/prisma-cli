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

  test("preserves a UTF-8 character split across child output chunks", async () => {
    const child = spawnChild({
      command: NODE,
      args: [
        "-e",
        "process.stdout.write(Buffer.from([0xf0, 0x9f])); setTimeout(() => process.stdout.write(Buffer.from([0x98, 0x80])), 50)",
      ],
      cwd: process.cwd(),
      env: process.env,
      output: "diagnostic",
    });

    await expect(child.ended).resolves.toEqual({ exitCode: 0, signal: null });
    expect(diagnosticText).toBe("😀");
  });

  test("waits for diagnostic backpressure to drain before settling", async () => {
    const listeners: Record<string, ((cause?: unknown) => void) | undefined> =
      {};
    let firstWrite = true;
    let forwarded = "";
    const backpressuredSpawn = makeSpawnChild({
      write: (text) => {
        forwarded += text;
        if (!firstWrite) return true;
        firstWrite = false;
        return false;
      },
      once: (event, listener) => {
        listeners[event] = listener;
      },
    });
    const child = backpressuredSpawn({
      command: NODE,
      args: ["-e", "process.stdout.write('held-output')"],
      cwd: process.cwd(),
      env: process.env,
      output: "diagnostic",
    });
    let settled = false;
    const ended = child.ended.then((result) => {
      settled = true;
      return result;
    });

    await vi.waitFor(() => expect(listeners.drain).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    listeners.drain?.();

    await expect(ended).resolves.toEqual({ exitCode: 0, signal: null });
    expect(forwarded).toBe("held-output");
  });

  test("a diagnostic sink that errors instead of draining still settles with the child's status", async () => {
    const listeners: Record<string, Array<(cause?: unknown) => void>> = {};
    const failingSpawn = makeSpawnChild({
      write: () => false,
      once: (event, listener) => {
        listeners[event] ??= [];
        listeners[event].push(listener);
      },
    });
    const child = failingSpawn({
      command: NODE,
      args: ["-e", "process.stdout.write('doomed-output'); process.exit(7)"],
      cwd: process.cwd(),
      env: process.env,
      output: "diagnostic",
    });

    await vi.waitFor(() =>
      expect(listeners.drain?.length ?? 0).toBeGreaterThan(0),
    );
    for (const listener of listeners.error ?? []) {
      listener(new Error("EPIPE"));
    }

    await expect(child.ended).resolves.toEqual({ exitCode: 7, signal: null });
  });

  test("a throwing diagnostic sink does not reject the child's status", async () => {
    const throwingSpawn = makeSpawnChild({
      write: () => {
        throw new Error("sink is gone");
      },
    });
    const child = throwingSpawn({
      command: NODE,
      args: ["-e", "process.stdout.write('lost'); process.exit(3)"],
      cwd: process.cwd(),
      env: process.env,
      output: "diagnostic",
    });

    await expect(child.ended).resolves.toEqual({ exitCode: 3, signal: null });
  });

  test.skipIf(process.platform === "win32")(
    "a grandchild holding the pipes does not block settlement past the drain grace",
    async () => {
      const gracedSpawn = makeSpawnChild(
        {
          write: (text) => {
            diagnosticText += text;
          },
        },
        { drainGraceMs: 200 },
      );
      const child = gracedSpawn({
        command: NODE,
        args: [
          "-e",
          `require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { detached: true, stdio: ["ignore", "inherit", "ignore"] }).unref();`,
        ],
        cwd: process.cwd(),
        env: process.env,
        output: "diagnostic",
      });

      await expect(child.ended).resolves.toEqual({ exitCode: 0, signal: null });
    },
    20_000,
  );
});
