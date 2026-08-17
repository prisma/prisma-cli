/**
 * Telemetry as a real run sees it: the fire point in executeMounted,
 * driven through createTestCli. The config path is isolated per test by
 * the run's own env — both XDG_CONFIG_HOME and APPDATA, so the store
 * resolves inside the temp directory on every platform and no test
 * touches the real user config.
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
import {
  defineCommand,
  defineServerCommand,
  flag,
  positional,
  type TelemetryPayload,
} from "@prisma/cli-engine";
import { CliStructuredError, notOk, ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readUserConfig } from "../src/telemetry/user-config";

const DOCS_URL = "https://example.invalid/docs/telemetry";

let configRoot: string;
/** What the handler and the seam did, in the order they did it. */
let order: string[];

function isolatedEnv(): Record<string, string> {
  return { XDG_CONFIG_HOME: configRoot, APPDATA: configRoot };
}

/** The path that env resolves to, computed here rather than asked of
 *  the code under test. */
function configPath(): string {
  return join(configRoot, "prisma", "config.json");
}

/** The disclosure, spelled out here rather than imported, so a change to
 *  the wording has to be made twice on purpose. */
function notice(): string {
  return `Prisma collects anonymous CLI usage data, enabled by default. What's collected and why: ${DOCS_URL}. Opt out: run "prisma-test telemetry disable", set DO_NOT_TRACK=1 or PRISMA_DISABLE_TELEMETRY=1.\n`;
}

const deploy = defineCommand({
  help: { summary: "Deploy something" },
  args: {
    flags: {
      dryRun: flag.boolean({ brief: "no writes" }),
      name: flag.string({ brief: "deployment name", placeholder: "name" }),
    },
    positionals: {
      target: positional.string({ brief: "where", placeholder: "target" }),
      extra: positional.optionalString({
        brief: "spare",
        placeholder: "extra",
      }),
    },
  },
  handler: async (_args, ctx) => {
    order.push("handler");
    ctx.report({ kind: "message", severity: "warn", text: "heads up" });
    return ok(
      ctx.present(
        { data: null },
        {
          human: () => [{ kind: "summary", status: "ok", text: "deployed" }],
          stdout: () => [],
          json: () => null,
          next: () => [],
        },
      ),
    );
  },
});

const failing = defineCommand({
  help: { summary: "Always errors" },
  handler: async () => notOk(new CliStructuredError("APP.BROKEN", "It broke")),
});

const telemetryStatus = defineCommand({
  help: { summary: "Show the telemetry preference" },
  handler: async (_args, ctx) =>
    ok(
      ctx.present(
        { data: null },
        {
          human: () => [{ kind: "summary", status: "ok", text: "enabled" }],
          stdout: () => [],
          json: () => null,
          next: () => [],
        },
      ),
    ),
});

/** Fails its needs check against the harness's empty credential store,
 *  so the handler never runs. */
const signedOut = defineCommand({
  help: { summary: "Show the signed-in user" },
  needs: { credentials: true },
  handler: async (_args, ctx) => {
    order.push("handler");
    return ok(
      ctx.present(
        { data: null },
        {
          human: () => [{ kind: "summary", status: "ok", text: "signed in" }],
          stdout: () => [],
          json: () => null,
          next: () => [],
        },
      ),
    );
  },
});

/** Declares the spawn capability and can still complete in json mode. */
const spawning = defineCommand({
  help: { summary: "May hand the terminal to a child" },
  maySpawn: true,
  handler: async (_args, ctx) => {
    order.push("handler");
    return ok(
      ctx.present(
        { data: null },
        {
          human: () => [{ kind: "summary", status: "ok", text: "spawned" }],
          stdout: () => [],
          json: () => null,
          next: () => [],
        },
      ),
    );
  },
});

/** Taken by the server-command branch, which sits between the snapshot
 *  and everything else. */
const lsp = defineServerCommand({
  help: { summary: "Speaks a foreign protocol over stdio" },
  handler: async () => {
    order.push("handler");
    return 0;
  },
});

function makeCli(options?: {
  readonly declared?: boolean;
  readonly telemetrySpawner?: ((payload: TelemetryPayload) => void) | null;
  readonly isCI?: boolean;
}) {
  return createTestCli({
    commands: {
      "app deploy": deploy,
      "app fail": failing,
      "app whoami": signedOut,
      "app spawner": spawning,
      lsp,
      "telemetry status": telemetryStatus,
    },
    groups: {
      app: { brief: "app commands" },
      telemetry: { brief: "telemetry commands" },
    },
    telemetry: options?.declared === false ? undefined : { docsUrl: DOCS_URL },
    telemetrySpawner: options?.telemetrySpawner,
    isCI: options?.isCI,
    now: () => new Date(0),
  });
}

function run(
  cli: ReturnType<typeof makeCli>,
  argv: readonly string[],
  opts?: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly isCI?: boolean;
  },
) {
  return cli.run(argv, {
    cwd: "/projects/acme",
    env: opts?.env ?? isolatedEnv(),
    isCI: opts?.isCI,
  });
}

const DEPLOY_ARGV = [
  "app",
  "deploy",
  "--name",
  "customer-acme-payments",
  "prod-target",
  "spare-target",
];

beforeEach(() => {
  configRoot = mkdtempSync(join(tmpdir(), "prisma-cli-engine-run-"));
  order = [];
  mkdirSync(dirname(configPath()), { recursive: true });
});

afterEach(() => {
  rmSync(configRoot, { recursive: true, force: true });
});

describe("the engine reports at command start", () => {
  it("hands the seam one payload BEFORE the handler runs", async () => {
    const cli = makeCli({
      telemetrySpawner: () => {
        order.push("telemetry");
      },
    });

    const result = await run(cli, DEPLOY_ARGV);

    expect(result.exitCode).toBe(0);
    expect(order).toEqual(["telemetry", "handler"]);
  });

  it("reports a run that fails its needs check, whose handler never runs", async () => {
    const result = await run(makeCli(), ["app", "whoami"]);

    expect(result.exitCode).toBe(2);
    expect(order).toEqual([]);
    expect(result.telemetry.map((payload) => payload.command)).toEqual([
      "app whoami",
    ]);
  });

  it("reports a spawning command before its json-capable handler", async () => {
    const result = await run(makeCli(), ["app", "spawner", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(order).toEqual(["handler"]);
    expect(result.telemetry.map((payload) => payload.command)).toEqual([
      "app spawner",
    ]);
  });

  it("reports a server command, before its branch hands over stdio", async () => {
    const cli = makeCli({
      telemetrySpawner: () => {
        order.push("telemetry");
      },
    });

    const result = await run(cli, ["lsp"]);

    expect(result.exitCode).toBe(0);
    expect(order).toEqual(["telemetry", "handler"]);
    expect(result.telemetry.map((payload) => payload.command)).toEqual(["lsp"]);
  });

  it("reports a failing run too — the event does not wait for an outcome", async () => {
    const result = await run(makeCli(), ["app", "fail"]);

    expect(result.exitCode).toBe(2);
    expect(result.telemetry.map((payload) => payload.command)).toEqual([
      "app fail",
    ]);
  });

  it("carries the command path and the typed flag names, and no values", async () => {
    const result = await run(makeCli(), DEPLOY_ARGV);

    expect(result.telemetry).toEqual([
      {
        installationId: expect.any(String),
        version: "0.0.0",
        command: "app deploy",
        flags: ["name"],
        projectRoot: "/projects/acme",
        endpoint: "https://cmpbfbsdp09hr3jf7pojjs5qs.ewr.prisma.build/events",
      },
    ]);
    const serialized = JSON.stringify(result.telemetry);
    expect(serialized).not.toContain("customer-acme-payments");
    expect(serialized).not.toContain("prod-target");
    expect(serialized).not.toContain("spare-target");
    expect(serialized).not.toContain("dry-run");
  });

  it("reports a negated option under its declared key, without the polarity", async () => {
    const result = await run(makeCli(), [
      "app",
      "deploy",
      "--no-color",
      "prod-target",
    ]);

    expect(result.telemetry.map((payload) => payload.flags)).toEqual([
      ["color"],
    ]);
    expect(JSON.stringify(result.telemetry)).not.toContain("no-color");
  });

  it("reports nothing for --help, --version or an unknown command", async () => {
    const cli = makeCli();

    const help = await run(cli, ["app", "deploy", "--help"]);
    const version = await run(cli, ["--version"]);
    const unknown = await run(cli, ["app", "nonesuch"]);

    expect(help.telemetry).toEqual([]);
    expect(version.telemetry).toEqual([]);
    expect(unknown.telemetry).toEqual([]);
    expect(existsSync(configPath())).toBe(false);
  });

  it("exempts the telemetry command — no event, no mint, no disclosure", async () => {
    const result = await run(makeCli(), ["telemetry", "status"]);

    expect(result.exitCode).toBe(0);
    expect(result.telemetry).toEqual([]);
    expect(result.stderr).toBe("");
    expect(existsSync(configPath())).toBe(false);
  });

  it("reports nothing when the run's env names no config directory", async () => {
    const result = await run(makeCli(), DEPLOY_ARGV, { env: {} });

    expect(result.exitCode).toBe(0);
    expect(result.telemetry).toEqual([]);
    expect(result.stderr).not.toContain("anonymous CLI usage data");
    expect(existsSync(configPath())).toBe(false);
  });

  it("reports nothing at all when the CLI declares no telemetry", async () => {
    const result = await run(makeCli({ declared: false }), DEPLOY_ARGV);

    expect(result.exitCode).toBe(0);
    expect(result.telemetry).toEqual([]);
    expect(existsSync(configPath())).toBe(false);
  });
});

describe("the first-run disclosure", () => {
  it("prints once, on stderr, on the first enabled run", async () => {
    const cli = makeCli();

    const first = await run(cli, DEPLOY_ARGV);
    const second = await run(cli, DEPLOY_ARGV);

    expect(first.stderr).toContain(notice());
    expect(first.stdout).not.toContain("anonymous CLI usage data");
    expect(second.stderr).not.toContain("anonymous CLI usage data");
  });

  it("keeps one installation id across runs, and records no consent", async () => {
    const cli = makeCli();

    const first = await run(cli, DEPLOY_ARGV);
    const second = await run(cli, DEPLOY_ARGV);

    const stored = readUserConfig(isolatedEnv());
    expect(stored.enableTelemetry).toBeUndefined();
    expect([
      ...first.telemetry.map((payload) => payload.installationId),
      ...second.telemetry.map((payload) => payload.installationId),
    ]).toEqual([stored.installationId, stored.installationId]);
  });

  it("never prints in CI", async () => {
    const result = await run(makeCli(), DEPLOY_ARGV, { isCI: true });

    expect(result.stderr).not.toContain("anonymous CLI usage data");
    expect(result.telemetry).toEqual([]);
  });

  it("never prints when an environment opt-out is set", async () => {
    const result = await run(makeCli(), DEPLOY_ARGV, {
      env: { ...isolatedEnv(), DO_NOT_TRACK: "1" },
    });

    expect(result.stderr).not.toContain("anonymous CLI usage data");
    expect(result.telemetry).toEqual([]);
  });

  it("never prints when the user has stored an opt-out", async () => {
    writeFileSync(configPath(), JSON.stringify({ enableTelemetry: false }));

    const result = await run(makeCli(), DEPLOY_ARGV);

    expect(result.stderr).not.toContain("anonymous CLI usage data");
    expect(result.telemetry).toEqual([]);
  });
});

describe("gating, through a run", () => {
  it("reports on a stored opt-in", async () => {
    writeFileSync(
      configPath(),
      JSON.stringify({ enableTelemetry: true, installationId: "stored-id" }),
    );

    const result = await run(makeCli(), DEPLOY_ARGV);

    expect(result.telemetry.map((payload) => payload.installationId)).toEqual([
      "stored-id",
    ]);
    expect(result.stderr).not.toContain("anonymous CLI usage data");
  });

  it("ignores the retired PRISMA_NEXT_DISABLE_TELEMETRY — the old name does nothing", async () => {
    const result = await run(makeCli(), DEPLOY_ARGV, {
      env: { ...isolatedEnv(), PRISMA_NEXT_DISABLE_TELEMETRY: "1" },
    });

    expect(result.telemetry).toHaveLength(1);
  });

  it("ignores a preference stored at the retired prisma-next path", async () => {
    mkdirSync(join(configRoot, "prisma-next"), { recursive: true });
    writeFileSync(
      join(configRoot, "prisma-next", "config.json"),
      JSON.stringify({ enableTelemetry: false, installationId: "old-id" }),
    );

    const result = await run(makeCli(), DEPLOY_ARGV);

    expect(
      result.telemetry.map((payload) => payload.installationId),
    ).not.toEqual(["old-id"]);
    expect(result.telemetry).toHaveLength(1);
    expect(existsSync(configPath())).toBe(true);
  });

  it("still reports when an opt-out variable is set to a falsy spelling", async () => {
    const result = await run(makeCli(), DEPLOY_ARGV, {
      env: {
        ...isolatedEnv(),
        PRISMA_DISABLE_TELEMETRY: "false",
        DO_NOT_TRACK: "0",
      },
    });

    expect(result.telemetry).toHaveLength(1);
  });

  it("takes isCI from the run, not only from the CLI", async () => {
    const cli = makeCli({ isCI: true });

    const inCI = await run(cli, DEPLOY_ARGV);
    const notInCI = await run(cli, DEPLOY_ARGV, { isCI: false });

    expect(inCI.telemetry).toEqual([]);
    expect(notInCI.telemetry).toHaveLength(1);
  });

  /** The safety property, through a whole run: nobody answered the CI
   *  question, and the environment is a CI vendor that sets no CI
   *  variable. Reporting has to stop anyway. */
  it("stays silent in a CI nobody declared", async () => {
    const teamCity = await run(makeCli(), DEPLOY_ARGV, {
      env: { ...isolatedEnv(), TEAMCITY_VERSION: "2024.03.1" },
    });
    const azurePipelines = await run(makeCli(), DEPLOY_ARGV, {
      env: { ...isolatedEnv(), TF_BUILD: "True" },
    });

    expect(teamCity.telemetry).toEqual([]);
    expect(teamCity.stderr).not.toContain("anonymous CLI usage data");
    expect(azurePipelines.telemetry).toEqual([]);
  });

  it("reports from a developer's shell, where nobody answered either", async () => {
    const result = await run(makeCli(), DEPLOY_ARGV, {
      env: { ...isolatedEnv(), TERM: "xterm-256color", EDITOR: "vim" },
    });

    expect(result.telemetry).toHaveLength(1);
  });

  it("lets a host force not-CI over an environment that looks like CI", async () => {
    const result = await run(makeCli(), DEPLOY_ARGV, {
      env: { ...isolatedEnv(), GITHUB_ACTIONS: "true", CI: "true" },
      isCI: false,
    });

    expect(result.telemetry).toHaveLength(1);
  });

  it("honours the endpoint override", async () => {
    const result = await run(makeCli(), DEPLOY_ARGV, {
      env: {
        ...isolatedEnv(),
        PRISMA_TELEMETRY_ENDPOINT: "http://127.0.0.1:4000",
      },
    });

    expect(result.telemetry.map((payload) => payload.endpoint)).toEqual([
      "http://127.0.0.1:4000/events",
    ]);
  });
});

describe("no telemetry failure is observable in the run", () => {
  /** The same run with no telemetry declared: what the user would have
   *  seen if the engine reported nothing at all. */
  async function baseline() {
    return run(makeCli({ declared: false }), DEPLOY_ARGV);
  }

  it("a throwing seam changes nothing — not the exit code, not one byte of output", async () => {
    writeFileSync(
      configPath(),
      JSON.stringify({ installationId: "stored-id" }),
    );
    const expected = await baseline();

    const result = await run(
      makeCli({
        telemetrySpawner: () => {
          throw new Error("the sender is gone");
        },
      }),
      DEPLOY_ARGV,
    );

    expect(result.exitCode).toBe(expected.exitCode);
    expect(result.stdout).toBe(expected.stdout);
    expect(result.stderr).toBe(expected.stderr);
    expect(result.telemetry).toHaveLength(1);
  });

  it("a declaration with no seam behaves exactly like no declaration — no notice, no file, not one byte", async () => {
    const expected = await baseline();

    const result = await run(makeCli({ telemetrySpawner: null }), DEPLOY_ARGV);

    expect(result.exitCode).toBe(expected.exitCode);
    expect(result.stdout).toBe(expected.stdout);
    expect(result.stderr).toBe(expected.stderr);
    expect(result.stderr).not.toContain("anonymous CLI usage data");
    expect(existsSync(configPath())).toBe(false);
    expect(result.telemetry).toEqual([]);
  });

  it("a malformed stored config costs the run nothing but the disclosure it was due", async () => {
    const expected = await baseline();
    writeFileSync(configPath(), "{not valid json");

    const result = await run(makeCli(), DEPLOY_ARGV);

    expect(result.exitCode).toBe(expected.exitCode);
    expect(result.stdout).toBe(expected.stdout);
    // The disclosure this run was due is contracted output, not a
    // failure. It is the only difference, and the malformed file adds
    // nothing of its own.
    expect(result.stderr).toBe(`${notice()}${expected.stderr}`);
    expect(result.telemetry).toHaveLength(1);
  });

  it("an unwritable config directory costs the run nothing but the disclosure", async () => {
    const expected = await baseline();
    rmSync(configRoot, { recursive: true, force: true });
    writeFileSync(configRoot, "a file where the config directory must go");

    const result = await run(makeCli(), DEPLOY_ARGV);

    expect(result.exitCode).toBe(expected.exitCode);
    expect(result.stdout).toBe(expected.stdout);
    expect(result.stderr).toBe(`${notice()}${expected.stderr}`);
    expect(result.telemetry).toEqual([]);
  });
});
