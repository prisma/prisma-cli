/**
 * Every case here drives the config path through `XDG_CONFIG_HOME`
 * pointed at a fresh temp directory, so no test reads or writes the
 * real user config.
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

let xdgRoot: string;
let originalXdg: string | undefined;

beforeEach(() => {
  xdgRoot = mkdtempSync(join(tmpdir(), "prisma-cli-engine-telemetry-"));
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

describe("userConfigPath", () => {
  it("resolves the shared prisma-next config file (the same file the ORM binary reads)", () => {
    expect(userConfigPath()).toBe(join(xdgRoot, "prisma-next", "config.json"));
  });

  it("re-resolves per call, so a changed XDG_CONFIG_HOME is honoured", () => {
    const other = mkdtempSync(join(tmpdir(), "prisma-cli-engine-telemetry-"));
    process.env["XDG_CONFIG_HOME"] = other;
    expect(userConfigPath()).toBe(join(other, "prisma-next", "config.json"));
    rmSync(other, { recursive: true, force: true });
  });
});

describe("readUserConfig", () => {
  it("returns {} when the file does not exist", () => {
    expect(readUserConfig()).toEqual({});
    expect(existsSync(userConfigPath())).toBe(false);
  });

  it("returns {} when the file cannot be read", () => {
    mkdirSync(userConfigPath());
    expect(readUserConfig()).toEqual({});
  });

  it("returns {} when the file is malformed", () => {
    writeFileSync(userConfigPath(), "{not valid json");
    expect(readUserConfig()).toEqual({});
  });

  it("returns {} when the file parses to something other than an object", () => {
    writeFileSync(userConfigPath(), "[1, 2, 3]");
    expect(readUserConfig()).toEqual({});
  });

  it("exposes both known fields from a well-formed file", () => {
    writeFileSync(
      userConfigPath(),
      JSON.stringify({
        enableTelemetry: true,
        installationId: "pre-existing-uuid",
      }),
    );
    expect(readUserConfig()).toMatchObject({
      enableTelemetry: true,
      installationId: "pre-existing-uuid",
    });
  });

  it("passes unknown fields through verbatim", () => {
    writeFileSync(
      userConfigPath(),
      JSON.stringify({ someFutureField: "opaque", nested: { foo: "bar" } }),
    );
    const config = readUserConfig();
    expect(config["someFutureField"]).toBe("opaque");
    expect(config["nested"]).toEqual({ foo: "bar" });
  });
});

describe("writeUserConfig", () => {
  it("keeps unknown fields already on disk", () => {
    writeFileSync(
      userConfigPath(),
      JSON.stringify({
        installationId: "kept",
        someFutureField: "preserve-me",
        nested: { foo: 1 },
      }),
    );
    writeUserConfig({ enableTelemetry: true });
    const config = readUserConfig();
    expect(config).toEqual({
      enableTelemetry: true,
      installationId: "kept",
      someFutureField: "preserve-me",
      nested: { foo: 1 },
    });
  });

  it("mints a v4 installation id alongside an explicit opt-in", () => {
    writeUserConfig({ enableTelemetry: true });
    expect(readUserConfig().installationId).toMatch(V4_UUID);
  });

  it("mints no installation id for an explicit opt-out", () => {
    writeUserConfig({ enableTelemetry: false });
    expect(readUserConfig()).toEqual({ enableTelemetry: false });
  });

  it("writes through a temp file and leaves none behind", () => {
    writeUserConfig({ enableTelemetry: true });
    const written = readFileSync(userConfigPath(), "utf-8");
    expect(() => JSON.parse(written)).not.toThrow();
    expect(
      readdirSync(dirname(userConfigPath())).filter((name) =>
        name.endsWith(".tmp"),
      ),
    ).toEqual([]);
  });

  it("creates the config directory when it is missing", () => {
    rmSync(xdgRoot, { recursive: true, force: true });
    writeUserConfig({ enableTelemetry: false });
    expect(existsSync(userConfigPath())).toBe(true);
  });
});

describe("ensureInstallationId", () => {
  it("mints a v4 UUID and persists it", () => {
    const id = ensureInstallationId();
    expect(id).toMatch(V4_UUID);
    expect(readUserConfig().installationId).toBe(id);
  });

  it("records no consent the user never gave — enableTelemetry stays absent", () => {
    ensureInstallationId();
    expect(readUserConfig()).toEqual({
      installationId: expect.stringMatching(V4_UUID),
    });
  });

  it("returns the stored id instead of minting a second one", () => {
    const first = ensureInstallationId();
    expect(ensureInstallationId()).toBe(first);
    expect(ensureInstallationId()).toBe(first);
  });

  it("keeps the same id across an on → off → on cycle", () => {
    const minted = ensureInstallationId();
    writeUserConfig({ enableTelemetry: true });
    expect(readUserConfig().installationId).toBe(minted);
    writeUserConfig({ enableTelemetry: false });
    expect(readUserConfig().installationId).toBe(minted);
    writeUserConfig({ enableTelemetry: true });
    expect(readUserConfig().installationId).toBe(minted);
    expect(ensureInstallationId()).toBe(minted);
  });

  it("leaves an existing stored opt-out untouched while minting", () => {
    writeUserConfig({ enableTelemetry: false });
    const id = ensureInstallationId();
    expect(readUserConfig()).toEqual({
      enableTelemetry: false,
      installationId: id,
    });
  });
});
