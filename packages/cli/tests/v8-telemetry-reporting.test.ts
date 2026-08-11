/**
 * The shell's half of telemetry after the engine took the rest: the
 * runtime seam that forks the detached sender, the CI answer the engine
 * gates on, and the guard that keeps the suite from ever reaching a real
 * fork or the developer's real config file.
 *
 * The decision, the disclosure, the mint and the payload are the
 * engine's and are tested there (`packages/cli-engine/tests/telemetry-*`).
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TelemetryPayload } from "@prisma/cli-engine";
import { type ParentToSenderPayload, runTelemetry } from "@repo/cli-telemetry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/v8/main";
import { assembleRuntime, type HostProcess } from "../src/v8/runtime";

vi.mock("@repo/cli-telemetry", () => ({ runTelemetry: vi.fn() }));
vi.mock("ci-info", () => ({ isCI: false }));

const SENDER_ENTRY = /sender\.js$/;

let configRoot: string;

function makeProcess(overrides?: {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
}): HostProcess & { stderrText: string; stdoutText: string } {
  const proc = {
    argv: overrides?.argv ?? ["node", "bin.js"],
    env: {
      XDG_CONFIG_HOME: configRoot,
      APPDATA: configRoot,
      ...overrides?.env,
    },
    cwd: () => "/projects/acme",
    stdoutText: "",
    stderrText: "",
    stdout: {
      write(text: string) {
        proc.stdoutText += text;
      },
    },
    stderr: {
      write(text: string) {
        proc.stderrText += text;
      },
    },
    stdin: {
      async *[Symbol.asyncIterator]() {},
    },
    on: () => undefined,
    off: () => undefined,
    exit: ((code: number) => {
      throw new Error(`process.exit(${code}) reached the test`);
    }) as never,
  };
  return proc;
}

function configPath(): string {
  return join(configRoot, "prisma-next", "config.json");
}

beforeEach(() => {
  configRoot = mkdtempSync(join(tmpdir(), "v8-telemetry-wiring-"));
  vi.mocked(runTelemetry).mockReset();
});

afterEach(() => {
  rmSync(configRoot, { recursive: true, force: true });
});

describe("the runtime's telemetry seam", () => {
  it("forks the sender with the payload the engine composed", async () => {
    const runtime = await assembleRuntime(makeProcess());
    const payload: TelemetryPayload = {
      installationId: "id-1",
      version: "8.0.0",
      command: "auth whoami",
      flags: ["json"],
      projectRoot: "/projects/acme",
      endpoint: "https://telemetry.invalid/events",
    };

    runtime.spawnTelemetry?.(payload);

    expect(runTelemetry).toHaveBeenCalledTimes(1);
    const inputs = vi.mocked(runTelemetry).mock.calls[0]?.[0];
    expect(inputs?.payload).toBe(payload);
    expect(inputs?.senderPath).toMatch(SENDER_ENTRY);
  });

  /**
   * The engine composes `TelemetryPayload`; the child sender declares
   * `ParentToSenderPayload` structurally so it stays a leaf with no
   * engine dependency. This bin is where the two meet, so it is where
   * they are checked against each other — both directions, so neither
   * side can drift a field without failing the build. The assignments
   * are the assertion; the expect only keeps them honest at runtime.
   */
  it("hands the sender exactly the shape the engine composes", () => {
    const engineToSender: ParentToSenderPayload = {} as TelemetryPayload;
    const senderToEngine: TelemetryPayload = {} as ParentToSenderPayload;

    expect(engineToSender).toEqual(senderToEngine);
  });

  it("is wired on every runtime, so a host is never silently unable to report", async () => {
    const runtime = await assembleRuntime(makeProcess());

    expect(runtime.spawnTelemetry).toBeTypeOf("function");
  });

  it("takes the CI answer from ci-info, so a CI run never reports", async () => {
    vi.resetModules();
    vi.doMock("ci-info", () => ({ isCI: true }));
    const { assembleRuntime: assembleInCI } = await import("../src/v8/runtime");

    const runtime = await assembleInCI(makeProcess());

    expect(runtime.isCI).toBe(true);
    vi.doUnmock("ci-info");
    vi.resetModules();
  });
});

describe("the suite never reports", () => {
  it("the harness sets PRISMA_NEXT_DISABLE_TELEMETRY=1", () => {
    expect(process.env["PRISMA_NEXT_DISABLE_TELEMETRY"]).toBe("1");
  });

  it("a real run neither forks the sender nor writes a config file", async () => {
    const proc = makeProcess({
      argv: ["node", "bin.js", "auth", "whoami"],
      env: {
        XDG_CONFIG_HOME: configRoot,
        APPDATA: configRoot,
        PRISMA_AUTH_FILE: join(configRoot, "auth.json"),
        PRISMA_NEXT_DISABLE_TELEMETRY:
          process.env["PRISMA_NEXT_DISABLE_TELEMETRY"],
      },
    });

    await main(proc);

    expect(runTelemetry).not.toHaveBeenCalled();
    expect(existsSync(configPath())).toBe(false);
    expect(proc.stderrText).not.toContain("anonymous CLI usage data");
  });

  it("main attaches no run hooks — the engine owns the fire point now", async () => {
    const proc = makeProcess({ argv: ["node", "bin.js", "--version"] });
    let hooksSeen: unknown = "not called";

    await main(proc, () => ({
      run: (_argv, _runtime, hooks) => {
        hooksSeen = hooks;
        return Promise.resolve(0);
      },
    }));

    expect(hooksSeen).toBeUndefined();
  });
});
