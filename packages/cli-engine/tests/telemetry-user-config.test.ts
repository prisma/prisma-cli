/**
 * Every case here hands the store an env record pointing at a fresh temp
 * directory, so no test reads or writes the real user config. The record
 * sets BOTH `XDG_CONFIG_HOME` and `APPDATA`: the path resolves from the
 * first on POSIX and the second on win32, and a record carrying only one
 * of them would resolve to the contributor's real config file on the
 * other platform.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureInstallationId,
  readUserConfig,
  userConfigPath,
  writeUserConfig,
} from "../src/telemetry/user-config";

const V4_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function configEnv(root: string): Record<string, string> {
  return { XDG_CONFIG_HOME: root, APPDATA: root };
}

let configRoot: string;
let env: Record<string, string>;

beforeEach(() => {
  configRoot = mkdtempSync(join(tmpdir(), "prisma-cli-engine-telemetry-"));
  env = configEnv(configRoot);
  mkdirSync(dirname(userConfigPath(env)), { recursive: true });
});

afterEach(() => {
  rmSync(configRoot, { recursive: true, force: true });
});

describe("userConfigPath", () => {
  it("resolves the shared prisma-next config file (the same file the ORM binary reads)", () => {
    expect(userConfigPath(env)).toBe(
      join(configRoot, "prisma-next", "config.json"),
    );
  });

  it("resolves against the env it is given, not a captured one", () => {
    const other = mkdtempSync(join(tmpdir(), "prisma-cli-engine-telemetry-"));
    expect(userConfigPath(configEnv(other))).toBe(
      join(other, "prisma-next", "config.json"),
    );
    rmSync(other, { recursive: true, force: true });
  });
});

describe("readUserConfig", () => {
  it("returns {} when the file does not exist", () => {
    expect(readUserConfig(env)).toEqual({});
    expect(existsSync(userConfigPath(env))).toBe(false);
  });

  it("returns {} when the file cannot be read", () => {
    mkdirSync(userConfigPath(env));
    expect(readUserConfig(env)).toEqual({});
  });

  it("returns {} when the file is malformed", () => {
    writeFileSync(userConfigPath(env), "{not valid json");
    expect(readUserConfig(env)).toEqual({});
  });

  it("returns {} when the file parses to something other than an object", () => {
    writeFileSync(userConfigPath(env), "[1, 2, 3]");
    expect(readUserConfig(env)).toEqual({});
  });

  it("exposes both known fields from a well-formed file", () => {
    writeFileSync(
      userConfigPath(env),
      JSON.stringify({
        enableTelemetry: true,
        installationId: "pre-existing-uuid",
      }),
    );
    expect(readUserConfig(env)).toMatchObject({
      enableTelemetry: true,
      installationId: "pre-existing-uuid",
    });
  });

  it("passes unknown fields through verbatim", () => {
    writeFileSync(
      userConfigPath(env),
      JSON.stringify({ someFutureField: "opaque", nested: { foo: "bar" } }),
    );
    const config = readUserConfig(env);
    expect(config["someFutureField"]).toBe("opaque");
    expect(config["nested"]).toEqual({ foo: "bar" });
  });
});

describe("writeUserConfig", () => {
  it("keeps unknown fields already on disk", () => {
    writeFileSync(
      userConfigPath(env),
      JSON.stringify({
        installationId: "kept",
        someFutureField: "preserve-me",
        nested: { foo: 1 },
      }),
    );
    writeUserConfig(env, { enableTelemetry: true });
    expect(readUserConfig(env)).toEqual({
      enableTelemetry: true,
      installationId: "kept",
      someFutureField: "preserve-me",
      nested: { foo: 1 },
    });
  });

  it("mints a v4 installation id alongside an explicit opt-in", () => {
    writeUserConfig(env, { enableTelemetry: true });
    expect(readUserConfig(env).installationId).toMatch(V4_UUID);
  });

  it("mints no installation id for an explicit opt-out", () => {
    writeUserConfig(env, { enableTelemetry: false });
    expect(readUserConfig(env)).toEqual({ enableTelemetry: false });
  });

  it("writes through a temp file and leaves none behind", () => {
    writeUserConfig(env, { enableTelemetry: true });
    const written = readFileSync(userConfigPath(env), "utf-8");
    expect(() => JSON.parse(written)).not.toThrow();
    expect(
      readdirSync(dirname(userConfigPath(env))).filter((name) =>
        name.endsWith(".tmp"),
      ),
    ).toEqual([]);
  });

  it("creates the config directory when it is missing", () => {
    rmSync(configRoot, { recursive: true, force: true });
    writeUserConfig(env, { enableTelemetry: false });
    expect(existsSync(userConfigPath(env))).toBe(true);
  });
});

describe("ensureInstallationId", () => {
  it("mints a v4 UUID and persists it", () => {
    const id = ensureInstallationId(env);
    expect(id).toMatch(V4_UUID);
    expect(readUserConfig(env).installationId).toBe(id);
  });

  it("records no consent the user never gave — enableTelemetry stays absent", () => {
    ensureInstallationId(env);
    expect(readUserConfig(env)).toEqual({
      installationId: expect.stringMatching(V4_UUID),
    });
  });

  it("returns the stored id instead of minting a second one", () => {
    const first = ensureInstallationId(env);
    expect(ensureInstallationId(env)).toBe(first);
    expect(ensureInstallationId(env)).toBe(first);
  });

  it("keeps the same id across an on → off → on cycle", () => {
    const minted = ensureInstallationId(env);
    writeUserConfig(env, { enableTelemetry: true });
    expect(readUserConfig(env).installationId).toBe(minted);
    writeUserConfig(env, { enableTelemetry: false });
    expect(readUserConfig(env).installationId).toBe(minted);
    writeUserConfig(env, { enableTelemetry: true });
    expect(readUserConfig(env).installationId).toBe(minted);
    expect(ensureInstallationId(env)).toBe(minted);
  });

  it("leaves an existing stored opt-out untouched while minting", () => {
    writeUserConfig(env, { enableTelemetry: false });
    const id = ensureInstallationId(env);
    expect(readUserConfig(env)).toEqual({
      enableTelemetry: false,
      installationId: id,
    });
  });
});
