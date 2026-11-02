import { EventEmitter } from "node:events";
import { describe, expect, test } from "vitest";
import { assembleRuntime, type HostProcess } from "../src/runtime";

class HostStream extends EventEmitter {
  writableNeedDrain = true;
  write(_text: string): boolean {
    return false;
  }
}

async function runtimeWith(stdout: HostStream) {
  const proc: HostProcess = {
    argv: ["node", "bin.js"],
    version: "v22.18.0",
    versions: { node: "22.18.0" },
    platform: "linux",
    arch: "x64",
    env: {},
    cwd: () => "/projects/acme",
    stdout,
    stderr: new HostStream(),
    stdin: {
      async *[Symbol.asyncIterator]() {},
    },
    on: () => undefined,
    off: () => undefined,
    exit: (code: number): never => {
      throw new Error(`process.exit(${code}) reached the test`);
    },
  };
  return await assembleRuntime(proc);
}

async function settledWithin(promise: Promise<void>, ms: number) {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return settled;
}

const LISTENED = ["drain", "error", "close"] as const;

describe("runtime.stdout.drained", () => {
  test("stays pending until the host stream emits drain, then resolves", async () => {
    const stdout = new HostStream();
    const runtime = await runtimeWith(stdout);

    const waiting = runtime.stdout.drained?.() ?? Promise.resolve();

    expect(await settledWithin(waiting, 20)).toBe(false);
    stdout.writableNeedDrain = false;
    stdout.emit("drain");
    await expect(waiting).resolves.toBeUndefined();
    for (const event of LISTENED) {
      expect(stdout.listenerCount(event)).toBe(0);
    }
  });

  test("resolves when the host stream closes instead of draining", async () => {
    const stdout = new HostStream();
    const runtime = await runtimeWith(stdout);

    const waiting = runtime.stdout.drained?.() ?? Promise.resolve();
    stdout.emit("close");

    await expect(waiting).resolves.toBeUndefined();
    for (const event of LISTENED) {
      expect(stdout.listenerCount(event)).toBe(0);
    }
  });

  test("rejects when the host stream fails", async () => {
    const stdout = new HostStream();
    const runtime = await runtimeWith(stdout);

    const waiting = runtime.stdout.drained?.() ?? Promise.resolve();
    stdout.emit("error", new Error("EPIPE"));

    await expect(waiting).rejects.toThrow("EPIPE");
    for (const event of LISTENED) {
      expect(stdout.listenerCount(event)).toBe(0);
    }
  });

  test("resolves at once when the host stream does not need to drain", async () => {
    const stdout = new HostStream();
    stdout.writableNeedDrain = false;
    const runtime = await runtimeWith(stdout);

    await expect(runtime.stdout.drained?.()).resolves.toBeUndefined();
    expect(stdout.listenerCount("drain")).toBe(0);
  });
});
