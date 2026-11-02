import { EventEmitter } from "node:events";
import { describe, expect, test } from "vitest";
import { assembleRuntime, type HostProcess } from "../src/runtime";

class HostStream extends EventEmitter {
  writableNeedDrain = true;
  write(_text: string): boolean {
    return false;
  }
}

function hostStreams() {
  return { stdout: new HostStream(), stderr: new HostStream() };
}

async function runtimeWith(streams: ReturnType<typeof hostStreams>) {
  const proc: HostProcess = {
    argv: ["node", "bin.js"],
    version: "v22.18.0",
    versions: { node: "22.18.0" },
    platform: "linux",
    arch: "x64",
    env: {},
    cwd: () => "/projects/acme",
    stdout: streams.stdout,
    stderr: streams.stderr,
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

describe.each(["stdout", "stderr"] as const)("runtime.%s.drained", (name) => {
  test("stays pending until the host stream emits drain, then resolves", async () => {
    const streams = hostStreams();
    const host = streams[name];
    const runtime = await runtimeWith(streams);

    const waiting = runtime[name].drained?.() ?? Promise.resolve();

    expect(await settledWithin(waiting, 20)).toBe(false);
    host.writableNeedDrain = false;
    host.emit("drain");
    await expect(waiting).resolves.toBeUndefined();
    for (const event of LISTENED) {
      expect(host.listenerCount(event)).toBe(0);
    }
  });

  test("resolves when the host stream closes instead of draining", async () => {
    const streams = hostStreams();
    const host = streams[name];
    const runtime = await runtimeWith(streams);

    const waiting = runtime[name].drained?.() ?? Promise.resolve();
    host.emit("close");

    await expect(waiting).resolves.toBeUndefined();
    for (const event of LISTENED) {
      expect(host.listenerCount(event)).toBe(0);
    }
  });

  test("rejects when the host stream fails", async () => {
    const streams = hostStreams();
    const host = streams[name];
    const runtime = await runtimeWith(streams);

    const waiting = runtime[name].drained?.() ?? Promise.resolve();
    host.emit("error", new Error("EPIPE"));

    await expect(waiting).rejects.toThrow("EPIPE");
    for (const event of LISTENED) {
      expect(host.listenerCount(event)).toBe(0);
    }
  });

  test("resolves at once when the host stream does not need to drain", async () => {
    const streams = hostStreams();
    streams[name].writableNeedDrain = false;
    const runtime = await runtimeWith(streams);

    await expect(runtime[name].drained?.()).resolves.toBeUndefined();
    expect(streams[name].listenerCount("drain")).toBe(0);
  });
});
