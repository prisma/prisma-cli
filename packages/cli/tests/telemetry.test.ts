/**
 * The platform CLI's telemetry commands, driven through the tree
 * `cli.ts` actually mounts. The commands themselves are the engine's and
 * are tested there; what this file pins is that this CLI mounts them,
 * with its own docs URL in the group help, and that they act on the real
 * file at the real path.
 *
 * The config path resolves from XDG_CONFIG_HOME on POSIX and APPDATA on
 * win32, so both are pointed at the temp dir for the tests to be
 * hermetic on every platform. Assertions read the file on disk rather
 * than asking the engine's own reader what the engine wrote.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createTestCli } from "@prisma/cli-engine/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cliGroups, mountedCommands } from "../src/cli";
import { CLI_DOCS_URL } from "../src/cli-name";

const V4_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let configRoot: string;
let configPath: string;

function isolatedEnv(): Record<string, string> {
  return { XDG_CONFIG_HOME: configRoot, APPDATA: configRoot };
}

function makeCli() {
  return createTestCli({
    commands: mountedCommands,
    groups: cliGroups,
    telemetry: { docsUrl: CLI_DOCS_URL },
    now: () => new Date(0),
  });
}

/** What is actually on disk, parsed. Absent file reads as `{}`. */
function storedConfig(): Record<string, unknown> {
  if (!existsSync(configPath)) return {};
  return JSON.parse(readFileSync(configPath, "utf-8")) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  configRoot = mkdtempSync(join(tmpdir(), "telemetry-cmd-"));
  configPath = join(configRoot, "prisma", "config.json");
  mkdirSync(dirname(configPath), { recursive: true });
});

afterEach(() => {
  rmSync(configRoot, { recursive: true, force: true });
});

function seedConfig(config: Record<string, unknown>): void {
  writeFileSync(configPath, JSON.stringify(config));
}

describe("prisma-cli telemetry status", () => {
  it("reports the opt-out default when no choice is stored, without writing anything", async () => {
    const result = await makeCli().run(["telemetry", "status"], {
      env: isolatedEnv(),
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
      env: isolatedEnv(),
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
      env: isolatedEnv(),
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
      env: { ...isolatedEnv(), DO_NOT_TRACK: "1" },
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Telemetry is disabled: an environment opt-out is set (DO_NOT_TRACK / PRISMA_DISABLE_TELEMETRY).",
    );
  });

  it("reports CI as hard-disabled ahead of every other signal", async () => {
    seedConfig({ enableTelemetry: true, installationId: "id-1" });

    const result = await makeCli().run(["telemetry", "status"], {
      env: isolatedEnv(),
      isCI: true,
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Telemetry is disabled: CI environment detected — telemetry is hard-disabled.",
    );
  });

  it("serializes the full status as the json envelope result", async () => {
    seedConfig({ enableTelemetry: true, installationId: "id-1" });

    const result = await makeCli().run(["telemetry", "status", "--json"], {
      env: isolatedEnv(),
    });

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

describe("prisma-cli telemetry enable", () => {
  it("stores the opt-in, mints an installation id, and names the config file", async () => {
    const result = await makeCli().run(["telemetry", "enable"], {
      env: isolatedEnv(),
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `Telemetry enabled. Preference stored in ${configPath}.\n`,
    );
    const config = storedConfig();
    expect(config.enableTelemetry).toBe(true);
    expect(config.installationId).toMatch(V4_UUID);
  });

  it("preserves an existing installation id rather than rotating it", async () => {
    seedConfig({ installationId: "sticky-id" });

    await makeCli().run(["telemetry", "enable"], {
      env: isolatedEnv(),
      isTty: { stdout: true },
    });

    const config = storedConfig();
    expect(config.enableTelemetry).toBe(true);
    expect(config.installationId).toBe("sticky-id");
  });

  it("serializes the consent decision as the json envelope result", async () => {
    const result = await makeCli().run(["telemetry", "enable", "--json"], {
      env: isolatedEnv(),
    });

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

describe("prisma-cli telemetry disable", () => {
  it("stores the opt-out without minting an installation id", async () => {
    const result = await makeCli().run(["telemetry", "disable"], {
      env: isolatedEnv(),
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `Telemetry disabled. Preference stored in ${configPath}.\n`,
    );
    expect(storedConfig()).toEqual({ enableTelemetry: false });
  });

  it("keeps an existing installation id while disabling (MAU continuity on re-enable)", async () => {
    seedConfig({ enableTelemetry: true, installationId: "sticky-id" });

    await makeCli().run(["telemetry", "disable"], {
      env: isolatedEnv(),
      isTty: { stdout: true },
    });

    const config = storedConfig();
    expect(config.enableTelemetry).toBe(false);
    expect(config.installationId).toBe("sticky-id");
  });

  it("serializes the consent decision as the json envelope result", async () => {
    const result = await makeCli().run(["telemetry", "disable", "--json"], {
      env: isolatedEnv(),
    });

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
