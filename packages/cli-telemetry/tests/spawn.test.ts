/**
 * The spawner after the engine took the decision: it forks, sends the
 * payload it was given, and detaches. It resolves no gating, reads no
 * config and composes nothing.
 */
import { fork } from "node:child_process";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParentToSenderPayload } from "../src/payload";
import { runTelemetry, senderModuleUrl } from "../src/spawn";

vi.mock("node:child_process", () => ({ fork: vi.fn() }));

const PAYLOAD: ParentToSenderPayload = {
  installationId: "id-1",
  version: "0.9.0",
  command: "init",
  flags: ["target"],
  projectRoot: "/projects/acme",
  endpoint: "https://telemetry.invalid/events",
};

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

let child: FakeChild;

beforeEach(() => {
  child = new FakeChild();
  vi.mocked(fork).mockReset();
  vi.mocked(fork).mockReturnValue(child as unknown as ReturnType<typeof fork>);
});

describe("runTelemetry", () => {
  it("forks the sender detached, with the parent's streams ignored", () => {
    expect(
      runTelemetry({ payload: PAYLOAD, senderPath: "/sender/path.js" }),
    ).toEqual({ spawned: true });

    expect(fork).toHaveBeenCalledWith("/sender/path.js", [], {
      detached: true,
      stdio: ["pipe", "ignore", "ignore", "ipc"],
    });
  });

  it("sends the payload verbatim, then disconnects and unrefs", () => {
    runTelemetry({ payload: PAYLOAD, senderPath: "/sender/path.js" });

    expect(child.send.mock.calls[0]?.[0]).toBe(PAYLOAD);
    expect(child.disconnect).toHaveBeenCalledTimes(1);
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it("reports fork-failed instead of throwing when fork throws", () => {
    vi.mocked(fork).mockImplementation(() => {
      throw new Error("EMFILE");
    });

    expect(
      runTelemetry({ payload: PAYLOAD, senderPath: "/sender/path.js" }),
    ).toEqual({ spawned: false, reason: "fork-failed" });
  });
});

describe("senderModuleUrl", () => {
  it("resolves the sender entry relative to the consumer's import.meta.url", () => {
    const consumer = "file:///some/consumer/dist/cli.js";
    expect(senderModuleUrl(consumer)).toBe("/some/consumer/dist/sender.js");
  });
});
