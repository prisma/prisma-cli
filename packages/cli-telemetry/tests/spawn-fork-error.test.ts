/**
 * The async fork-failure path: `child_process.fork` can report failure
 * AFTER the synchronous call returns, as an "error" event on the child.
 * Without a listener, Node turns that event into an uncaught exception —
 * crashing the parent CLI (or flipping its exit code mid-exit) over a
 * telemetry fork. `runTelemetry` must attach a swallowing listener.
 */
import { fork } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { runTelemetry } from "../src/spawn";

vi.mock("node:child_process", () => ({ fork: vi.fn() }));

class FakeChild extends EventEmitter {
  send = vi.fn(
    (_payload: unknown, callback?: (error: Error | null) => void): boolean => {
      callback?.(null);
      return true;
    },
  );
  disconnect = vi.fn();
  unref = vi.fn();
}

describe("runTelemetry — async fork error", () => {
  it("neither throws nor alters the process exit code when the child emits 'error' after spawn", async () => {
    const child = new FakeChild();
    vi.mocked(fork).mockReturnValue(
      child as unknown as ReturnType<typeof fork>,
    );
    const exitCodeBefore = process.exitCode;

    const outcome = runTelemetry({
      command: { commandPath: ["init"], flags: [], positionalCount: 0 },
      version: "0.9.0",
      projectRoot: process.cwd(),
      senderPath: "/sender/path.js",
      isCI: false,
      env: {},
      userConfig: { enableTelemetry: true, installationId: "id-1" },
    });
    expect(outcome).toEqual({ spawned: true });

    // An EventEmitter throws synchronously from emit('error') when no
    // listener is attached — this line IS the assertion that
    // runTelemetry registered one.
    expect(() => child.emit("error", new Error("spawn failed"))).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(process.exitCode).toBe(exitCodeBefore);
  });
});
