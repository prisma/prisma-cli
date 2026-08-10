import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { RunSummary } from "@prisma/cli-engine";
import {
  type RunTelemetryInputs,
  readUserConfig,
  userConfigPath,
} from "@repo/cli-telemetry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveTelemetryHooks } from "../src/v8/telemetry/wiring";

const V4_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function makeSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    commandId: "auth.whoami",
    exitCode: 0,
    durationMs: 5,
    snapshot: {
      commandPath: ["auth", "whoami"],
      flags: [{ name: "json", source: "cli" }],
      positionalCount: 0,
    },
    ...overrides,
  };
}

function makeProc(env: Record<string, string | undefined> = {}) {
  const proc = {
    env,
    cwd: () => "/project/root",
    stderrText: "",
    stderr: {
      write(text: string) {
        proc.stderrText += text;
      },
    },
  };
  return proc;
}

let xdgRoot: string;
let originalXdg: string | undefined;

beforeEach(() => {
  xdgRoot = mkdtempSync(join(tmpdir(), "v8-telemetry-wiring-"));
  originalXdg = process.env["XDG_CONFIG_HOME"];
  process.env["XDG_CONFIG_HOME"] = xdgRoot;
  mkdirSync(dirname(userConfigPath()), { recursive: true });
});

afterEach(() => {
  if (originalXdg === undefined) {
    delete process.env["XDG_CONFIG_HOME"];
  } else {
    process.env["XDG_CONFIG_HOME"] = originalXdg;
  }
  rmSync(xdgRoot, { recursive: true, force: true });
});

describe("resolveTelemetryHooks — decision resolution", () => {
  it("attaches no hook in CI, even with a stored opt-in", () => {
    writeFileSync(
      userConfigPath(),
      JSON.stringify({ enableTelemetry: true, installationId: "id-1" }),
    );
    expect(
      resolveTelemetryHooks(makeProc(), { inCI: true, fire: vi.fn() }),
    ).toBeUndefined();
  });

  it("attaches no hook under an env opt-out", () => {
    expect(
      resolveTelemetryHooks(makeProc({ PRISMA_NEXT_DISABLE_TELEMETRY: "1" }), {
        inCI: false,
        fire: vi.fn(),
      }),
    ).toBeUndefined();
    expect(
      resolveTelemetryHooks(makeProc({ DO_NOT_TRACK: "1" }), {
        inCI: false,
        fire: vi.fn(),
      }),
    ).toBeUndefined();
  });

  it("attaches no hook under a stored opt-out", () => {
    writeFileSync(userConfigPath(), JSON.stringify({ enableTelemetry: false }));
    expect(
      resolveTelemetryHooks(makeProc(), { inCI: false, fire: vi.fn() }),
    ).toBeUndefined();
  });

  it("attaches a hook on the opt-out default (no stored choice)", () => {
    expect(
      resolveTelemetryHooks(makeProc(), { inCI: false, fire: vi.fn() }),
    ).toBeDefined();
  });
});

describe("resolveTelemetryHooks — the attached hook", () => {
  it("fires the sender spawn with the engine snapshot, project root, and stored id", () => {
    writeFileSync(
      userConfigPath(),
      JSON.stringify({ enableTelemetry: true, installationId: "stored-id" }),
    );
    const fire = vi.fn().mockReturnValue({ spawned: true });
    const proc = makeProc();
    const hooks = resolveTelemetryHooks(proc, {
      inCI: false,
      fire,
      senderPath: "/sender/path.js",
    });

    hooks?.onSettled?.(makeSummary());

    expect(fire).toHaveBeenCalledTimes(1);
    const inputs = fire.mock.calls[0]?.[0] as RunTelemetryInputs;
    expect(inputs.command).toEqual({
      commandPath: ["auth", "whoami"],
      flags: [{ name: "json", source: "cli" }],
      positionalCount: 0,
    });
    expect(inputs.projectRoot).toBe("/project/root");
    expect(inputs.senderPath).toBe("/sender/path.js");
    expect(inputs.isCI).toBe(false);
    expect(inputs.userConfig?.installationId).toBe("stored-id");
    expect(typeof inputs.version).toBe("string");
    // No first-run notice for a returning installation.
    expect(proc.stderrText).toBe("");
  });

  it("discloses on stderr and mints the shared installation id on the first enabled run", () => {
    const fire = vi.fn().mockReturnValue({ spawned: true });
    const proc = makeProc();
    const hooks = resolveTelemetryHooks(proc, {
      inCI: false,
      fire,
      senderPath: "/sender/path.js",
    });

    hooks?.onSettled?.(makeSummary());

    expect(proc.stderrText).toContain(
      "Prisma collects anonymous CLI usage data, enabled by default.",
    );
    expect(proc.stderrText).toContain(userConfigPath());
    const stored = readUserConfig();
    expect(stored.installationId).toMatch(V4_UUID);
    // The mint records no consent the user never gave.
    expect(stored.enableTelemetry).toBeUndefined();
    const inputs = fire.mock.calls[0]?.[0] as RunTelemetryInputs;
    expect(inputs.userConfig?.installationId).toBe(stored.installationId);
  });

  it("never fires for the telemetry command family itself", () => {
    writeFileSync(
      userConfigPath(),
      JSON.stringify({ enableTelemetry: true, installationId: "stored-id" }),
    );
    const fire = vi.fn();
    const hooks = resolveTelemetryHooks(makeProc(), { inCI: false, fire });

    for (const leaf of ["status", "enable", "disable"]) {
      hooks?.onSettled?.(
        makeSummary({
          commandId: `telemetry.${leaf}`,
          snapshot: {
            commandPath: ["telemetry", leaf],
            flags: [],
            positionalCount: 0,
          },
        }),
      );
    }

    expect(fire).not.toHaveBeenCalled();
  });

  it("swallows a throwing spawn — the hook never propagates", () => {
    writeFileSync(
      userConfigPath(),
      JSON.stringify({ enableTelemetry: true, installationId: "stored-id" }),
    );
    const fire = vi.fn(() => {
      throw new Error("spawn exploded");
    });
    const hooks = resolveTelemetryHooks(makeProc(), { inCI: false, fire });

    expect(() => hooks?.onSettled?.(makeSummary())).not.toThrow();
    expect(fire).toHaveBeenCalledTimes(1);
  });
});
