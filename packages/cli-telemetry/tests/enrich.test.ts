import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildTelemetryEvent,
  buildTelemetryEventFromProcess,
  type EnrichEnvironment,
  type ProjectConfigFields,
  parsePackageManager,
  readTsVersionFromPackageJson,
} from "../src/enrich";
import type { ParentToSenderPayload } from "../src/payload";

const basePayload: ParentToSenderPayload = {
  installationId: "install-1",
  version: "0.9.0",
  command: "migration new",
  flags: ["name", "dry-run"],
  projectRoot: "/project",
  endpoint: "http://localhost/events",
};

const baseProjectConfig: ProjectConfigFields = {
  databaseTarget: "postgres",
  extensions: ["pgvector"],
};

const baseEnv: EnrichEnvironment = {
  platform: "darwin",
  arch: "arm64",
  versions: { node: "24.13.0" },
  env: {},
  agent: null,
  readProjectPackageJson: () => null,
};

describe("parsePackageManager", () => {
  it("extracts the leading <pm>/<version> token from npm_config_user_agent", () => {
    expect(
      parsePackageManager("pnpm/10.27.0 npm/? node/v24.13.0 darwin arm64"),
    ).toBe("pnpm/10.27.0");
  });

  it("handles npm, yarn, and bun ua strings", () => {
    expect(parsePackageManager("npm/10.5.0 node/v24.13.0 darwin arm64")).toBe(
      "npm/10.5.0",
    );
    expect(
      parsePackageManager("yarn/4.6.0 npm/? node/v24.13.0 darwin arm64"),
    ).toBe("yarn/4.6.0");
    expect(parsePackageManager("bun/1.3.0 node/v24.13.0 darwin arm64")).toBe(
      "bun/1.3.0",
    );
  });

  it("returns null for undefined, empty, or malformed values", () => {
    expect(parsePackageManager(undefined)).toBeNull();
    expect(parsePackageManager("")).toBeNull();
    expect(parsePackageManager("nopepenope")).toBeNull();
  });
});

describe("readTsVersionFromPackageJson", () => {
  it("reads typescript from devDependencies and strips a leading ^", () => {
    expect(
      readTsVersionFromPackageJson(
        JSON.stringify({ devDependencies: { typescript: "^5.9.3" } }),
      ),
    ).toBe("5.9.3");
  });

  it("falls back to dependencies when devDependencies is absent", () => {
    expect(
      readTsVersionFromPackageJson(
        JSON.stringify({ dependencies: { typescript: "5.9.3" } }),
      ),
    ).toBe("5.9.3");
  });

  it("strips a leading ~ in addition to ^", () => {
    expect(
      readTsVersionFromPackageJson(
        JSON.stringify({ devDependencies: { typescript: "~5.9.0" } }),
      ),
    ).toBe("5.9.0");
  });

  it("prefers devDependencies over dependencies when both are present", () => {
    expect(
      readTsVersionFromPackageJson(
        JSON.stringify({
          devDependencies: { typescript: "5.9.0" },
          dependencies: { typescript: "5.0.0" },
        }),
      ),
    ).toBe("5.9.0");
  });

  it("returns null on null input (file missing)", () => {
    expect(readTsVersionFromPackageJson(null)).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(readTsVersionFromPackageJson("{not-json")).toBeNull();
  });

  it("returns null when typescript key is absent", () => {
    expect(
      readTsVersionFromPackageJson(
        JSON.stringify({ dependencies: { foo: "1.0" } }),
      ),
    ).toBeNull();
  });

  it("returns null when typescript is not a string", () => {
    expect(
      readTsVersionFromPackageJson(
        JSON.stringify({ devDependencies: { typescript: 5 } }),
      ),
    ).toBeNull();
  });
});

describe("buildTelemetryEvent", () => {
  it("round-trips the parent payload and overlays child-side probes", () => {
    const event = buildTelemetryEvent(basePayload, baseProjectConfig, {
      ...baseEnv,
      env: { npm_config_user_agent: "pnpm/10.27.0 node/v24.13.0" },
      readProjectPackageJson: () =>
        JSON.stringify({ devDependencies: { typescript: "^5.9.3" } }),
    });

    expect(event).toEqual({
      installationId: "install-1",
      version: "0.9.0",
      command: "migration new",
      flags: ["name", "dry-run"],
      runtimeName: "node",
      runtimeVersion: "24.13.0",
      os: "darwin",
      arch: "arm64",
      packageManager: "pnpm/10.27.0",
      databaseTarget: "postgres",
      tsVersion: "5.9.3",
      agent: null,
      extensions: ["pgvector"],
    });
  });

  it("detects bun as the runtime when versions.bun is present", () => {
    const event = buildTelemetryEvent(basePayload, baseProjectConfig, {
      ...baseEnv,
      versions: { node: "24.13.0", bun: "1.3.0" },
    });
    expect(event.runtimeName).toBe("bun");
    expect(event.runtimeVersion).toBe("1.3.0");
  });

  it("detects deno as the runtime when versions.deno is present", () => {
    const event = buildTelemetryEvent(basePayload, baseProjectConfig, {
      ...baseEnv,
      versions: { node: "24.13.0", deno: "2.5.0" },
    });
    expect(event.runtimeName).toBe("deno");
    expect(event.runtimeVersion).toBe("2.5.0");
  });

  it("passes the pre-resolved agent label through to the event", () => {
    const event = buildTelemetryEvent(basePayload, baseProjectConfig, {
      ...baseEnv,
      agent: "claude",
    });
    expect(event.agent).toBe("claude");
  });

  it("passes null tsVersion when the project package.json read fails", () => {
    const event = buildTelemetryEvent(basePayload, baseProjectConfig, {
      ...baseEnv,
      readProjectPackageJson: () => null,
    });
    expect(event.tsVersion).toBeNull();
  });

  it("passes null packageManager when npm_config_user_agent is absent", () => {
    expect(
      buildTelemetryEvent(basePayload, baseProjectConfig, baseEnv)
        .packageManager,
    ).toBeNull();
  });

  it("passes the project-config slice straight through (databaseTarget + extensions)", () => {
    const event = buildTelemetryEvent(
      basePayload,
      { databaseTarget: "mongodb", extensions: ["pgvector", "paradedb"] },
      baseEnv,
    );
    expect(event.databaseTarget).toBe("mongodb");
    expect(event.extensions).toEqual(["pgvector", "paradedb"]);
  });
});

describe("buildTelemetryEventFromProcess — payload-only project fields", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "cli-telemetry-payload-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("uses the payload databaseTarget when present", async () => {
    const event = await buildTelemetryEventFromProcess({
      installationId: "install-1",
      version: "0.9.0",
      command: "init",
      flags: [],
      projectRoot: projectDir,
      endpoint: "http://localhost/events",
      databaseTarget: "postgres",
    });
    expect(event.databaseTarget).toBe("postgres");
    expect(event.extensions).toEqual([]);
  });

  it("ships null databaseTarget and empty extensions when the payload has no override (no config load exists)", async () => {
    // A prisma-next.config.* on disk must NOT be read: this product
    // dropped the ORM CLI's c12 load (arbitrary user TS evaluated in a
    // detached child). Divergence recorded in the S2a parity list.
    writeFileSync(
      join(projectDir, "prisma-next.config.mjs"),
      "export default { target: { targetId: 'postgres' }, extensions: [{ id: 'pgvector' }] };\n",
    );
    const event = await buildTelemetryEventFromProcess({
      installationId: "install-1",
      version: "0.9.0",
      command: "migration new",
      flags: [],
      projectRoot: projectDir,
      endpoint: "http://localhost/events",
    });
    expect(event.databaseTarget).toBeNull();
    expect(event.extensions).toEqual([]);
  });

  it("still derives tsVersion from the project package.json", async () => {
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ devDependencies: { typescript: "^5.9.3" } }),
    );
    const event = await buildTelemetryEventFromProcess({
      installationId: "install-1",
      version: "0.9.0",
      command: "init",
      flags: [],
      projectRoot: projectDir,
      endpoint: "http://localhost/events",
    });
    expect(event.tsVersion).toBe("5.9.3");
  });
});
