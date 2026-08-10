import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createTestCli } from "@prisma/cli-engine/testing";
import { readUserConfig, userConfigPath } from "@repo/cli-telemetry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  telemetryDisableCommand,
  telemetryEnableCommand,
  telemetryStatusCommand,
} from "../src/v8/telemetry/commands";
import { isCI } from "../src/v8/telemetry/is-ci";

vi.mock("../src/v8/telemetry/is-ci", () => ({ isCI: vi.fn(() => false) }));

const V4_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function makeCli() {
  return createTestCli({
    commands: {
      "telemetry status": telemetryStatusCommand,
      "telemetry enable": telemetryEnableCommand,
      "telemetry disable": telemetryDisableCommand,
    },
    groups: {
      telemetry: { brief: "Inspect and change anonymous CLI telemetry" },
    },
    now: () => new Date(0),
  });
}

let xdgRoot: string;
let originalXdg: string | undefined;
let configPath: string;

beforeEach(() => {
  xdgRoot = mkdtempSync(join(tmpdir(), "v8-telemetry-cmd-"));
  originalXdg = process.env["XDG_CONFIG_HOME"];
  process.env["XDG_CONFIG_HOME"] = xdgRoot;
  configPath = userConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  vi.mocked(isCI).mockReset();
  vi.mocked(isCI).mockReturnValue(false);
});

afterEach(() => {
  if (originalXdg === undefined) {
    delete process.env["XDG_CONFIG_HOME"];
  } else {
    process.env["XDG_CONFIG_HOME"] = originalXdg;
  }
  rmSync(xdgRoot, { recursive: true, force: true });
});

function seedConfig(config: Record<string, unknown>): void {
  writeFileSync(configPath, JSON.stringify(config));
}

describe("prisma-v8 telemetry status", () => {
  it("reports the opt-out default when no choice is stored, without writing anything", async () => {
    const result = await makeCli().run(["telemetry", "status"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "Telemetry is enabled: no explicit choice is stored, so the opt-out default applies.\n" +
        `Config file: ${configPath}\n` +
        "Installation ID: not stored\n",
    );
    expect(result.stderr).toContain("ℹ Telemetry is enabled");
    // Read-only: no config file appears, no id is minted.
    expect(existsSync(configPath)).toBe(false);
  });

  it("reports a stored opt-in and the presence (never the value) of the installation id", async () => {
    seedConfig({ enableTelemetry: true, installationId: "id-secret-123" });

    const result = await makeCli().run(["telemetry", "status"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'Telemetry is enabled: "enableTelemetry": true is stored in your config.',
    );
    expect(result.stdout).toContain("Installation ID: stored");
    expect(result.stdout).not.toContain("id-secret-123");
  });

  it("reports a stored opt-out", async () => {
    seedConfig({ enableTelemetry: false });

    const result = await makeCli().run(["telemetry", "status"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'Telemetry is disabled: "enableTelemetry": false is stored in your config.',
    );
  });

  it("reports an environment opt-out over a stored opt-in", async () => {
    seedConfig({ enableTelemetry: true, installationId: "id-1" });

    const result = await makeCli().run(["telemetry", "status"], {
      env: { DO_NOT_TRACK: "1" },
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Telemetry is disabled: an environment opt-out is set (DO_NOT_TRACK / PRISMA_NEXT_DISABLE_TELEMETRY).",
    );
  });

  it("reports CI as hard-disabled ahead of every other signal", async () => {
    vi.mocked(isCI).mockReturnValue(true);
    seedConfig({ enableTelemetry: true, installationId: "id-1" });

    const result = await makeCli().run(["telemetry", "status"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Telemetry is disabled: CI environment detected — telemetry is hard-disabled.",
    );
  });

  it("serializes the full status as the json envelope result", async () => {
    seedConfig({ enableTelemetry: true, installationId: "id-1" });

    const result = await makeCli().run(["telemetry", "status", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toHaveLength(1);
    const frame = result.json[0];
    if (frame?.kind !== "result" || frame.envelope.ok !== true) {
      throw new Error("expected a completed result frame");
    }
    expect(frame.envelope.commandId).toBe("telemetry.status");
    expect(frame.envelope.result).toEqual({
      enabled: true,
      reason: "stored-opt-in",
      configPath,
      installationIdStored: true,
    });
  });
});

describe("prisma-v8 telemetry enable", () => {
  it("stores the opt-in, mints an installation id, and names the config file", async () => {
    const result = await makeCli().run(["telemetry", "enable"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `Telemetry enabled. Preference stored in ${configPath}.\n`,
    );
    const config = readUserConfig();
    expect(config.enableTelemetry).toBe(true);
    expect(config.installationId).toMatch(V4_UUID);
  });

  it("preserves an existing installation id rather than rotating it", async () => {
    seedConfig({ installationId: "sticky-id" });

    await makeCli().run(["telemetry", "enable"], {
      isTty: { stdout: true },
    });

    const config = readUserConfig();
    expect(config.enableTelemetry).toBe(true);
    expect(config.installationId).toBe("sticky-id");
  });

  it("serializes the consent decision as the json envelope result", async () => {
    const result = await makeCli().run(["telemetry", "enable", "--json"]);

    expect(result.exitCode).toBe(0);
    const frame = result.json[0];
    if (frame?.kind !== "result" || frame.envelope.ok !== true) {
      throw new Error("expected a completed result frame");
    }
    expect(frame.envelope.result).toEqual({
      enableTelemetry: true,
      configPath,
    });
  });
});

describe("prisma-v8 telemetry disable", () => {
  it("stores the opt-out without minting an installation id", async () => {
    const result = await makeCli().run(["telemetry", "disable"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `Telemetry disabled. Preference stored in ${configPath}.\n`,
    );
    const config = readUserConfig();
    expect(config.enableTelemetry).toBe(false);
    expect(config.installationId).toBeUndefined();
  });

  it("keeps an existing installation id while disabling (MAU continuity on re-enable)", async () => {
    seedConfig({ enableTelemetry: true, installationId: "sticky-id" });

    await makeCli().run(["telemetry", "disable"], {
      isTty: { stdout: true },
    });

    const config = readUserConfig();
    expect(config.enableTelemetry).toBe(false);
    expect(config.installationId).toBe("sticky-id");
  });

  it("serializes the consent decision as the json envelope result", async () => {
    const result = await makeCli().run(["telemetry", "disable", "--json"]);

    expect(result.exitCode).toBe(0);
    const frame = result.json[0];
    if (frame?.kind !== "result" || frame.envelope.ok !== true) {
      throw new Error("expected a completed result frame");
    }
    expect(frame.envelope.result).toEqual({
      enableTelemetry: false,
      configPath,
    });
  });
});
