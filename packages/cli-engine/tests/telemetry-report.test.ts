/**
 * The reporting module called directly, without a running CLI: the
 * decision, the disclosure and the composition, each observable on its
 * own. The end-to-end behaviour is in telemetry-run.test.ts.
 *
 * Every case hands the module an env record pointing at a fresh temp
 * directory — both XDG_CONFIG_HOME and APPDATA, so the store resolves
 * inside the temp directory on every platform and no test touches the
 * real user config.
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EngineCommandSnapshot } from "../src/run-summary";
import type { TelemetryPayload } from "../src/telemetry/payload";
import {
  firstRunNotice,
  reportCommandStart,
  type TelemetryHost,
} from "../src/telemetry/report";
import { readUserConfig } from "../src/telemetry/user-config";

const DOCS_URL = "https://example.invalid/docs/telemetry";

const DEPLOY: EngineCommandSnapshot = {
  commandPath: ["app", "deploy"],
  flags: [
    { name: "dry-run", source: "cli" },
    { name: "json", source: "default" },
  ],
  positionalCount: 2,
};

let configRoot: string;
let payloads: TelemetryPayload[];
let stderrText: string;

function isolatedEnv(): Record<string, string> {
  return { XDG_CONFIG_HOME: configRoot, APPDATA: configRoot };
}

/** The path that env resolves to, computed here rather than asked of
 *  the code under test. */
function configPath(): string {
  return join(configRoot, "prisma", "config.json");
}

function makeHost(overrides?: {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly isCI?: boolean;
  readonly spawnTelemetry?: ((payload: TelemetryPayload) => void) | null;
  /** A host whose stderr is gone — a closed pipe, a full disk. */
  readonly stderrThrows?: boolean;
}): TelemetryHost {
  const spawner = overrides?.spawnTelemetry;
  return {
    env: overrides?.env ?? isolatedEnv(),
    cwd: "/projects/acme",
    stderr: {
      write: (text) => {
        if (overrides?.stderrThrows === true) {
          throw new Error("stderr is closed");
        }
        stderrText += text;
      },
    },
    isCI: overrides?.isCI ?? false,
    spawnTelemetry:
      spawner === null
        ? undefined
        : (payload) => {
            payloads.push(payload);
            spawner?.(payload);
          },
  };
}

function report(host: TelemetryHost, snapshot = DEPLOY): void {
  reportCommandStart({
    host,
    telemetry: { docsUrl: DOCS_URL },
    name: "prisma",
    version: "8.1.2",
    snapshot,
  });
}

beforeEach(() => {
  configRoot = mkdtempSync(join(tmpdir(), "prisma-cli-engine-report-"));
  payloads = [];
  stderrText = "";
  mkdirSync(dirname(configPath()), { recursive: true });
});

afterEach(() => {
  rmSync(configRoot, { recursive: true, force: true });
});

describe("firstRunNotice", () => {
  it("names the CLI, the docs and the two ways out — and no file to hand-edit", () => {
    expect(firstRunNotice("prisma", DOCS_URL)).toBe(
      'Prisma collects anonymous CLI usage data, enabled by default. What\'s collected and why: https://example.invalid/docs/telemetry. Opt out: run "prisma telemetry disable", set DO_NOT_TRACK=1 or PRISMA_DISABLE_TELEMETRY=1.',
    );
  });

  it("does not name the config file — the preference is machine-edited", () => {
    expect(firstRunNotice("prisma", DOCS_URL)).not.toContain("config.json");
    expect(firstRunNotice("prisma", DOCS_URL)).not.toContain("enableTelemetry");
  });
});

describe("reportCommandStart", () => {
  it("composes one payload from the run's identity and its snapshot", () => {
    report(makeHost());

    expect(payloads).toEqual([
      {
        installationId: expect.any(String),
        version: "8.1.2",
        command: "app deploy",
        flags: ["dry-run"],
        projectRoot: "/projects/acme",
        endpoint: "https://cmpbfbsdp09hr3jf7pojjs5qs.ewr.prisma.build/events",
      },
    ]);
  });

  it("honours the endpoint override", () => {
    report(
      makeHost({
        env: {
          ...isolatedEnv(),
          PRISMA_TELEMETRY_ENDPOINT: "http://127.0.0.1:4000",
        },
      }),
    );

    expect(payloads.map((payload) => payload.endpoint)).toEqual([
      "http://127.0.0.1:4000/events",
    ]);
  });

  it("discloses once, to stderr, and mints the id the payload carries", () => {
    report(makeHost());
    const first = stderrText;
    const minted = readUserConfig(isolatedEnv()).installationId;
    report(makeHost());

    expect(first).toBe(`${firstRunNotice("prisma", DOCS_URL)}\n`);
    expect(stderrText).toBe(first);
    expect(minted).toEqual(expect.any(String));
    expect(payloads.map((payload) => payload.installationId)).toEqual([
      minted,
      minted,
    ]);
  });

  it("mints without recording consent the user never gave", () => {
    report(makeHost());

    expect(readUserConfig(isolatedEnv()).enableTelemetry).toBeUndefined();
  });

  it("exempts the telemetry command entirely — no event, no mint, no disclosure", () => {
    report(makeHost(), {
      commandPath: ["telemetry", "status"],
      flags: [],
      positionalCount: 0,
    });

    expect(payloads).toEqual([]);
    expect(stderrText).toBe("");
    expect(existsSync(configPath())).toBe(false);
  });

  it("exempts only a top-level telemetry command, not one nested under a group", () => {
    report(makeHost(), {
      commandPath: ["app", "telemetry"],
      flags: [],
      positionalCount: 0,
    });

    expect(payloads.map((payload) => payload.command)).toEqual([
      "app telemetry",
    ]);
  });

  it("reports nothing in CI, and mints nothing", () => {
    report(makeHost({ isCI: true }));

    expect(payloads).toEqual([]);
    expect(stderrText).toBe("");
    expect(existsSync(configPath())).toBe(false);
  });

  it("reports nothing under either environment opt-out", () => {
    report(makeHost({ env: { ...isolatedEnv(), DO_NOT_TRACK: "1" } }));
    report(
      makeHost({
        env: { ...isolatedEnv(), PRISMA_DISABLE_TELEMETRY: "yes" },
      }),
    );

    expect(payloads).toEqual([]);
    expect(stderrText).toBe("");
    expect(existsSync(configPath())).toBe(false);
  });

  it("reports nothing on a stored opt-out, and leaves the file alone", () => {
    writeFileSync(configPath(), JSON.stringify({ enableTelemetry: false }));

    report(makeHost());

    expect(payloads).toEqual([]);
    expect(stderrText).toBe("");
    expect(readUserConfig(isolatedEnv())).toEqual({ enableTelemetry: false });
  });

  it("reports on a stored opt-in without disclosing again", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({ enableTelemetry: true, installationId: "stored-id" }),
    );

    report(makeHost());

    expect(payloads.map((payload) => payload.installationId)).toEqual([
      "stored-id",
    ]);
    expect(stderrText).toBe("");
  });

  it("swallows a throwing seam", () => {
    expect(() =>
      report(
        makeHost({
          spawnTelemetry: () => {
            throw new Error("sender is gone");
          },
        }),
      ),
    ).not.toThrow();
  });

  it("mints and reports even when the disclosure cannot be written", () => {
    report(makeHost({ stderrThrows: true }));

    expect(payloads.map((payload) => payload.command)).toEqual(["app deploy"]);
    expect(readUserConfig(isolatedEnv()).installationId).toEqual(
      expect.any(String),
    );
  });

  it("does nothing at all when the env names no config directory — nowhere to read, nowhere to mint", () => {
    report(makeHost({ env: {} }));

    expect(payloads).toEqual([]);
    expect(stderrText).toBe("");
  });

  it("does nothing at all when the host wires no seam — a CLI that cannot deliver must not disclose or mint", () => {
    report(makeHost({ spawnTelemetry: null }));

    expect(payloads).toEqual([]);
    expect(stderrText).toBe("");
    expect(existsSync(configPath())).toBe(false);
  });

  it("skips the event rather than sending a junk id when the mint fails", () => {
    // A file where the config DIRECTORY must go: the read tolerates it
    // as `{}`, and the write cannot create the directory.
    rmSync(configRoot, { recursive: true, force: true });
    writeFileSync(configRoot, "not a directory");

    report(makeHost());

    expect(payloads).toEqual([]);
    expect(stderrText).toContain("Prisma collects anonymous CLI usage data");
  });

  it("treats a malformed stored config as no stored choice, and reports", () => {
    writeFileSync(configPath(), "{not valid json");

    report(makeHost());

    expect(payloads.map((payload) => payload.command)).toEqual(["app deploy"]);
    expect(readUserConfig(isolatedEnv()).installationId).toEqual(
      expect.any(String),
    );
  });
});
