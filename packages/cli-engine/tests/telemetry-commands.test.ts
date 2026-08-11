/**
 * `telemetry status | enable | disable`, mounted through the engine's
 * own mount fragment and driven by createTestCli. The config path is
 * isolated per test by the run's env — both XDG_CONFIG_HOME and APPDATA,
 * so the store resolves inside the temp directory on every platform and
 * no test touches the real user config.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { telemetryCommandGroup } from "@prisma/cli-engine";
import { createTestCli } from "@prisma/cli-engine/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readUserConfig } from "../src/telemetry/user-config";

const DOCS_URL = "https://example.invalid/docs/telemetry";
const V4_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let configRoot: string;

function isolatedEnv(): Record<string, string> {
  return { XDG_CONFIG_HOME: configRoot, APPDATA: configRoot };
}

/** The path that env resolves to, computed here rather than asked of
 *  the code under test. */
function configPath(): string {
  return join(configRoot, "prisma", "config.json");
}

const telemetry = telemetryCommandGroup({ docsUrl: DOCS_URL });

function makeCli() {
  return createTestCli({
    commands: telemetry.commands,
    groups: telemetry.groups,
    telemetry: { docsUrl: DOCS_URL },
    now: () => new Date(0),
  });
}

function run(
  argv: readonly string[],
  opts?: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly isCI?: boolean;
  },
) {
  return makeCli().run(argv, {
    cwd: "/projects/acme",
    env: opts?.env ?? isolatedEnv(),
    isCI: opts?.isCI,
    isTty: { stdout: true },
  });
}

/** The `result` frame's envelope payload from a --json run. */
function jsonResult(frames: readonly unknown[]): unknown {
  const terminal = frames.at(-1) as
    | { readonly envelope?: { readonly result?: unknown } }
    | undefined;
  return terminal?.envelope?.result;
}

function seedConfig(config: Record<string, unknown>): void {
  writeFileSync(configPath(), JSON.stringify(config));
}

beforeEach(() => {
  configRoot = mkdtempSync(join(tmpdir(), "prisma-cli-engine-commands-"));
  mkdirSync(dirname(configPath()), { recursive: true });
});

afterEach(() => {
  rmSync(configRoot, { recursive: true, force: true });
});

describe("telemetry status", () => {
  it("reports the opt-out default when no choice is stored", async () => {
    const result = await run(["telemetry", "status"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Telemetry is enabled: no explicit choice is stored, so the opt-out default applies.",
    );
    expect(result.stdout).toContain(`Config file: ${configPath()}`);
    expect(result.stdout).toContain("Installation ID: not stored");
  });

  it("reports a stored opt-in", async () => {
    seedConfig({ enableTelemetry: true, installationId: "stored-id" });

    const result = await run(["telemetry", "status"]);

    expect(result.stdout).toContain(
      'Telemetry is enabled: "enableTelemetry": true is stored in your config.',
    );
    expect(result.stdout).toContain("Installation ID: stored");
  });

  it("reports a stored opt-out", async () => {
    seedConfig({ enableTelemetry: false });

    const result = await run(["telemetry", "status"]);

    expect(result.stdout).toContain(
      'Telemetry is disabled: "enableTelemetry": false is stored in your config.',
    );
  });

  it("reports an environment opt-out, over a stored opt-in", async () => {
    seedConfig({ enableTelemetry: true });

    const result = await run(["telemetry", "status"], {
      env: { ...isolatedEnv(), DO_NOT_TRACK: "1" },
    });

    expect(result.stdout).toContain(
      "Telemetry is disabled: an environment opt-out is set (DO_NOT_TRACK / PRISMA_DISABLE_TELEMETRY).",
    );
  });

  it("reports CI, over everything else", async () => {
    seedConfig({ enableTelemetry: true });

    const result = await run(["telemetry", "status"], { isCI: true });

    expect(result.stdout).toContain(
      "Telemetry is disabled: CI environment detected — telemetry is hard-disabled.",
    );
  });

  it("treats a non-boolean stored value as no explicit choice", async () => {
    seedConfig({ enableTelemetry: "false" });

    const result = await run(["telemetry", "status"]);

    expect(result.stdout).toContain(
      "Telemetry is enabled: no explicit choice is stored, so the opt-out default applies.",
    );
  });

  it("writes nothing and mints nothing", async () => {
    const result = await run(["telemetry", "status"]);

    expect(result.exitCode).toBe(0);
    expect(existsSync(configPath())).toBe(false);
  });

  it("never prints the installation id itself", async () => {
    seedConfig({ installationId: "7f1e1d6c-3b2a-4c5e-9f0d-1a2b3c4d5e6f" });

    const result = await run(["telemetry", "status", "--json"]);

    expect(result.stdout).not.toContain("7f1e1d6c-3b2a-4c5e-9f0d-1a2b3c4d5e6f");
    expect(jsonResult(result.json)).toEqual({
      enabled: true,
      reason: "default-on",
      configPath: configPath(),
      installationIdStored: true,
    });
  });

  it("sends no telemetry event — the exemption holds with the commands mounted", async () => {
    const result = await run(["telemetry", "status"]);

    expect(result.telemetry).toEqual([]);
    expect(result.stderr).not.toContain("anonymous CLI usage data");
  });
});

describe("telemetry enable", () => {
  it("stores the opt-in and mints an installation id", async () => {
    const result = await run(["telemetry", "enable"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      `Telemetry enabled. Preference stored in ${configPath()}.`,
    );
    const stored = readUserConfig(isolatedEnv());
    expect(stored.enableTelemetry).toBe(true);
    expect(stored.installationId).toMatch(V4_UUID);
  });

  it("keeps an existing installation id rather than rotating it", async () => {
    seedConfig({ enableTelemetry: false, installationId: "sticky-id" });

    await run(["telemetry", "enable"]);

    expect(readUserConfig(isolatedEnv())).toEqual({
      enableTelemetry: true,
      installationId: "sticky-id",
    });
  });

  it("reports the stored decision as json", async () => {
    const result = await run(["telemetry", "enable", "--json"]);

    expect(jsonResult(result.json)).toEqual({
      enableTelemetry: true,
      configPath: configPath(),
    });
  });

  it("sends no telemetry event", async () => {
    const result = await run(["telemetry", "enable"]);

    expect(result.telemetry).toEqual([]);
  });
});

describe("telemetry disable", () => {
  it("stores the opt-out and mints nothing", async () => {
    const result = await run(["telemetry", "disable"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      `Telemetry disabled. Preference stored in ${configPath()}.`,
    );
    expect(readUserConfig(isolatedEnv())).toEqual({ enableTelemetry: false });
  });

  it("leaves an already-minted id in place", async () => {
    seedConfig({ installationId: "sticky-id" });

    await run(["telemetry", "disable"]);

    expect(readUserConfig(isolatedEnv())).toEqual({
      enableTelemetry: false,
      installationId: "sticky-id",
    });
  });

  it("reports the stored decision as json", async () => {
    const result = await run(["telemetry", "disable", "--json"]);

    expect(jsonResult(result.json)).toEqual({
      enableTelemetry: false,
      configPath: configPath(),
    });
  });

  it("sends no telemetry event on its way to disabling", async () => {
    const result = await run(["telemetry", "disable"]);

    expect(result.telemetry).toEqual([]);
  });
});

describe("an env that names no config directory", () => {
  it("fails each command with one structured error instead of guessing a location", async () => {
    const runs = await Promise.all(
      [
        ["telemetry", "status"],
        ["telemetry", "enable"],
        ["telemetry", "disable"],
      ].map(async (argv) => ({
        argv,
        result: await run([...argv, "--json"], { env: {} }),
      })),
    );

    for (const { argv, result } of runs) {
      expect(result.exitCode, argv.join(" ")).toBe(2);
      expect(JSON.stringify(result.json), argv.join(" ")).toContain(
        "CLI.TELEMETRY_PREFERENCE_UNAVAILABLE",
      );
    }
  });
});

describe("the mount fragment", () => {
  it("carries the group help text with the commands, so no product retypes it", async () => {
    const group = await run(["telemetry", "--help"]);
    const root = await run(["--help"]);

    expect(root.stdout).toContain("Inspect and change anonymous CLI telemetry");
    expect(group.stdout).toContain(
      "Show telemetry status, or enable / disable anonymous CLI usage data.",
    );
    expect(group.stdout).toContain(DOCS_URL);
    expect(group.stdout).toContain(
      "Show whether anonymous CLI telemetry is enabled and why",
    );
    expect(group.stdout).toContain("Enable anonymous CLI telemetry");
    expect(group.stdout).toContain("Disable anonymous CLI telemetry");
  });

  it("round-trips a preference: disable, then enable, then status", async () => {
    await run(["telemetry", "disable"]);
    const disabled = await run(["telemetry", "status"]);
    await run(["telemetry", "enable"]);
    const enabled = await run(["telemetry", "status"]);

    expect(disabled.stdout).toContain("Telemetry is disabled");
    expect(enabled.stdout).toContain("Telemetry is enabled");
    expect(readUserConfig(isolatedEnv()).installationId).toMatch(V4_UUID);
  });
});
