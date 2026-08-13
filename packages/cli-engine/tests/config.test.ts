/**
 * The config loader behind Runtime.loadConfig — cwd-only discovery,
 * definePrismaConfig marker semantics with the pinned Prisma 7 fail-early
 * diagnostic, the engine's closed set of section names, and
 * needs.config validation wired end to end through the harness.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ConfigSection,
  createCli,
  defineCommand,
  defineCommandFamily,
  defineConfig,
  defineConfigSection,
  definePrismaConfig,
  flag,
  type LoadedConfig,
  loadConfig,
  PRISMA_CONFIG_VERSION,
  positional,
  type Runtime,
  type SectionValidation,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { afterAll, describe, expect, test } from "vitest";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));

const FIXTURES = join(TESTS_DIR, "fixtures", "config");

const EPOCH = () => new Date(0);
const T0 = "1970-01-01T00:00:00.000Z";

describe("definePrismaConfig", () => {
  test("stamps the version marker on the config object", () => {
    expect(definePrismaConfig({ toy: { greeting: "hi" } })).toEqual({
      toy: { greeting: "hi" },
      $prismaConfig: PRISMA_CONFIG_VERSION,
    });
  });

  test("the deprecated defineConfig alias stamps the same marker", () => {
    expect(defineConfig({ toy: { greeting: "hi" } })).toEqual(
      definePrismaConfig({ toy: { greeting: "hi" } }),
    );
  });
});

describe("loadConfig", { timeout: 60_000 }, () => {
  test("a marked file yields raw sections without the marker key, and names the file it read", async () => {
    expect(await loadConfig(join(FIXTURES, "marked"))).toEqual({
      path: join(FIXTURES, "marked", "prisma.config.ts"),
      sections: { toy: { greeting: "hello" }, other: { level: 2 } },
      diagnostics: [],
    });
  });

  /** With no file there are no sections, so nothing ever asks which
   *  file they came from; the path still names the one that was looked
   *  for rather than going absent. */
  test("no file at all yields no sections and no error — validators own absence", async () => {
    expect(await loadConfig(FIXTURES)).toEqual({
      path: join(FIXTURES, "prisma.config.ts"),
      sections: {},
      diagnostics: [],
    });
  });

  test("discovery is cwd-only: a config in the parent directory is not found", async () => {
    expect(await loadConfig(join(FIXTURES, "marked", "nested"))).toEqual({
      path: join(FIXTURES, "marked", "nested", "prisma.config.ts"),
      sections: {},
      diagnostics: [],
    });
  });

  test("an evaluated file without the marker fails early with the pinned Prisma 7 diagnostic", async () => {
    expect(await loadConfig(join(FIXTURES, "unmarked"))).toEqual({
      path: join(FIXTURES, "unmarked", "prisma.config.ts"),
      sections: {},
      diagnostics: [
        {
          section: null,
          diagnostic: {
            code: "CLI.CONFIG_MISSING_MARKER",
            severity: "error",
            summary: `${join(FIXTURES, "unmarked", "prisma.config.ts")} was not written for this version of the Prisma CLI, so it cannot be used.`,
            why: "Configs for this CLI are created with definePrismaConfig, which records a version marker on the exported object. This file's default export has no marker — it is most likely a Prisma 7 config, which uses the same filename — and the CLI stops rather than misread it.",
            nextActions: [
              {
                kind: "user-choice",
                label:
                  "Migrate the file: wrap the exported object in definePrismaConfig from @prisma/cli-engine and export the result as the default export.",
              },
            ],
            where: { path: join(FIXTURES, "unmarked", "prisma.config.ts") },
          },
        },
      ],
    });
  });

  test("a marker version other than the supported one fails with a file-level diagnostic", async () => {
    expect(await loadConfig(join(FIXTURES, "wrong-version"))).toEqual({
      path: join(FIXTURES, "wrong-version", "prisma.config.ts"),
      sections: {},
      diagnostics: [
        {
          section: null,
          diagnostic: {
            code: "CLI.CONFIG_VERSION_UNSUPPORTED",
            severity: "error",
            summary: `${join(FIXTURES, "wrong-version", "prisma.config.ts")} declares config version 2, but this CLI supports only version ${PRISMA_CONFIG_VERSION}.`,
            nextActions: [
              {
                kind: "user-choice",
                label:
                  "Regenerate the config with a definePrismaConfig matching this CLI, or update the CLI to a version that supports the declared config version.",
              },
            ],
            where: {
              path: join(FIXTURES, "wrong-version", "prisma.config.ts"),
            },
          },
        },
      ],
    });
  });

  test("a section value keeps its types — arrays and Dates survive the loader", async () => {
    const loaded = await loadConfig(join(FIXTURES, "passthrough"));
    expect(loaded.diagnostics).toEqual([]);
    expect(Object.keys(loaded.sections)).toEqual(["values"]);
    const values = loaded.sections.values as {
      readonly list: unknown;
      readonly when: unknown;
    };
    expect(values.list).toEqual([1, 2]);
    expect(values.when).toBeInstanceOf(Date);
  });

  test("a file that throws while evaluating yields a file-level diagnostic", async () => {
    const loaded = await loadConfig(join(FIXTURES, "unreadable"));
    expect(loaded.sections).toEqual({});
    expect(loaded.diagnostics).toHaveLength(1);
    expect(loaded.diagnostics[0].section).toBeNull();
    expect(loaded.diagnostics[0].diagnostic.code).toBe("CLI.CONFIG_UNREADABLE");
    expect(loaded.diagnostics[0].diagnostic.summary).toBe(
      `${join(FIXTURES, "unreadable", "prisma.config.ts")} could not be evaluated: boom at config evaluation time`,
    );
  });
});

describe("top-level keys that are not sections", { timeout: 60_000 }, () => {
  /** The check is the engine's, not the loader's: loadConfig hands back
   *  every top-level key the file had, and the run fails on the ones no
   *  mounted command or command family declared. */
  test("an unrecognised key fails the run before the handler, naming the recognised sections", async () => {
    const ran = { value: false };
    const section = toySection();
    const show = showCommand(section, ran);
    const cli = createTestCli({
      commandFamilies: [
        defineCommandFamily({ configSection: section, commands: { show } }),
      ],
      commands: { show },
      loadConfig: (configPath) =>
        loadConfig(join(FIXTURES, "marked"), configPath),
    });
    const run = await cli.run(["show", "--json"]);
    expect(run.exitCode).toBe(2);
    expect(ran.value).toBe(false);
    const frame = run.json[0];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error(`expected an errored result frame, got ${run.stderr}`);
    }
    const path = join(FIXTURES, "marked", "prisma.config.ts");
    expect(frame.envelope.error).toEqual({
      code: "CLI.CONFIG_UNKNOWN_SECTION",
      severity: "error",
      summary: `${path} has a top-level key 'other', which is not a config section this CLI recognises.`,
      why: "The sections this CLI recognises are: toy.",
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Remove the key, or rename it to one of the recognised section names.",
        },
      ],
      where: { path },
    });
  });

  /** The reason the check moved out of the loader: the loader is a
   *  Runtime member each host supplies, and this one checks nothing at
   *  all. Move the check back into the loader and this test fails. */
  test("a loader that checks nothing does not reopen the closed set", async () => {
    const ran = { value: false };
    const cli = createTestCli({
      commands: { show: showCommand(toySection(), ran) },
      loadConfig: async () => ({
        path: "/host/picked/this.config.ts",
        sections: { toy: { greeting: "hi" }, telemtry: { enabled: true } },
        diagnostics: [],
      }),
    });
    const run = await cli.run(["show"], { isTty: { stdout: true } });
    expect(run.exitCode).toBe(2);
    expect(ran.value).toBe(false);
    expect(run.stderr).toContain("CLI.CONFIG_UNKNOWN_SECTION");
    expect(run.stderr).toContain("'telemtry'");
    expect(run.stderr).toContain("/host/picked/this.config.ts");
    expect(run.stderr).toContain("recognises are: toy");
  });

  /**
   * `extends` is an ordinary top-level key here. c12 would otherwise
   * read it as an instruction to merge another file in — pulling
   * sections out of a file that was never checked for the version
   * marker, and over the network for a value beginning `http://` or
   * `gh:` — so the loader passes `extend: false` and the key comes back
   * with the others, for the engine to report like any other
   * unrecognised name. The fixture's value is a string because that is
   * the form c12 acts on.
   */
  test("a top-level 'extends' is data, not an instruction to merge another file", async () => {
    const loaded = await loadConfig(join(FIXTURES, "extends-key"));
    expect(loaded.sections).toEqual({
      extends: "./base.config.ts",
      values: { list: [1, 2] },
    });
    expect(loaded.diagnostics).toEqual([]);
  });

  /** The same key with a URL value. Left to c12 this downloads a
   *  tarball, unpacks it under node_modules and evaluates what was in
   *  it; here it is data like any other string. */
  test("an 'extends' value that names a URL is not fetched", async () => {
    const loaded = await loadConfig(join(FIXTURES, "extends-remote"));
    expect(loaded.sections.extends).toBe("http://127.0.0.1:1/evil.tar.gz");
    expect(loaded.diagnostics).toEqual([]);
  });

  /**
   * The one key the report cannot cover. c12 takes `$meta` as layer
   * metadata and deletes it from the config object whatever else it is
   * told, so it never reaches the engine's unknown-key check.
   * definePrismaConfig freezes what it returns, so that delete throws and the
   * whole file is refused — a worse message than the unknown-key one,
   * and the reason no section may be named `$meta`.
   */
  test("a top-level '$meta' can never be reported as an unknown section", async () => {
    const loaded = await loadConfig(join(FIXTURES, "meta-key"));
    expect(loaded.sections).toEqual({});
    expect(loaded.diagnostics.map(({ diagnostic }) => diagnostic.code)).toEqual(
      ["CLI.CONFIG_UNREADABLE"],
    );
    expect(loaded.diagnostics[0].diagnostic.summary).toContain(
      "Cannot delete property '$meta'",
    );
  });

  /**
   * The second key that can never be reported. c12 merges layers with
   * defu, which drops `__proto__` rather than let a config file reach an
   * object's prototype, so the key is gone before the loader sees the
   * object — and the rest of the file loads normally around it. That is
   * why no section may be named `__proto__`.
   */
  test("a top-level '__proto__' never reaches the loader at all", async () => {
    const loaded = await loadConfig(join(FIXTURES, "proto-key"));
    expect(loaded.sections).toEqual({ toy: { greeting: "hello" } });
    expect(Object.hasOwn(loaded.sections, "__proto__")).toBe(false);
    expect(loaded.diagnostics).toEqual([]);
  });

  test("a command mounted with no command family declares its section too", async () => {
    const cli = createTestCli({
      commands: { show: showCommand(toySection()) },
      loadConfig: async () => ({
        path: "/host/picked/this.config.ts",
        sections: { toy: { greeting: "hi" } },
        diagnostics: [],
      }),
    });
    const run = await cli.run(["show"], { isTty: { stdout: true } });
    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toEqual({ greeting: "hi" });
  });

  /** The shell mounts its own commands with no command family, so this
   *  is the shape a shell-owned command with a config section takes. */
  test("a family-less command's own section is not rejected as an unknown key", async () => {
    const ran = { value: false };
    const cli = createTestCli({
      commands: { show: showCommand(toySection(), ran) },
      loadConfig: (configPath) => loadConfig(FIXTURES, configPath),
    });
    const run = await cli.run(
      ["show", "--config", join(FIXTURES, "named", "elsewhere.config.ts")],
      { isTty: { stdout: true } },
    );
    expect(run.stderr).not.toContain("CLI.CONFIG_UNKNOWN_SECTION");
    expect(run.exitCode).toBe(0);
    expect(ran.value).toBe(true);
    expect(run.presented?.data).toEqual({ greeting: "from the named file" });
  });
});

describe("--config", { timeout: 60_000 }, () => {
  const OUTSIDE = join(FIXTURES, "named", "elsewhere.config.ts");

  test("the named file is loaded instead of the one in cwd", async () => {
    const loaded = await loadConfig(join(FIXTURES, "marked"), OUTSIDE);
    expect(loaded).toEqual({
      path: OUTSIDE,
      sections: { toy: { greeting: "from the named file" } },
      diagnostics: [],
    });
  });

  test("a relative path is resolved against cwd", async () => {
    const loaded = await loadConfig(
      FIXTURES,
      join("named", "elsewhere.config.ts"),
    );
    expect(loaded.path).toBe(OUTSIDE);
    expect(loaded.sections).toEqual({
      toy: { greeting: "from the named file" },
    });
  });

  test("a named file that does not exist is an error, not an empty config", async () => {
    const missing = join(FIXTURES, "named", "nope.config.ts");
    const loaded = await loadConfig(FIXTURES, missing);
    expect(loaded.sections).toEqual({});
    expect(loaded.diagnostics).toEqual([
      {
        section: null,
        diagnostic: {
          code: "CLI.CONFIG_NOT_FOUND",
          severity: "error",
          summary: `--config named ${missing}, and there is no file there.`,
          why: "A config file found by discovery may be absent — the section validators supply their defaults. A config file named on the command line may not: the CLI would otherwise run against different settings than the ones asked for.",
          nextActions: [
            {
              kind: "user-choice",
              label:
                "Correct the path passed to --config, or drop the flag to use the prisma.config.ts in the current directory.",
            },
          ],
          where: { path: missing },
        },
      },
    ]);
  });

  test("without the flag, a missing prisma.config.ts stays an empty config", async () => {
    expect(await loadConfig(join(FIXTURES, "named"))).toEqual({
      path: join(FIXTURES, "named", "prisma.config.ts"),
      sections: {},
      diagnostics: [],
    });
  });

  /** A diagnostic's summary is the line a user reads first, so it has
   *  to name the file that was actually read — which under --config is
   *  not prisma.config.ts. */
  test("a diagnostic about the named file names that file, not prisma.config.ts", async () => {
    const legacy = join(FIXTURES, "named", "legacy.config.ts");
    const loaded = await loadConfig(FIXTURES, legacy);
    expect(loaded.diagnostics).toHaveLength(1);
    const { diagnostic } = loaded.diagnostics[0];
    expect(diagnostic.code).toBe("CLI.CONFIG_MISSING_MARKER");
    expect(diagnostic.summary).toContain(legacy);
    expect(diagnostic.summary).not.toContain("prisma.config.ts");
  });

  test("an invalid section names the file --config asked for", async () => {
    const cli = createTestCli({
      commands: { show: showCommand(toySection()) },
      loadConfig: async (configPath) => ({
        path: configPath ?? "prisma.config.ts",
        sections: { toy: { greeting: 5 } },
        diagnostics: [],
      }),
    });
    const run = await cli.run(["show", "--config", "other.config.ts"], {
      isTty: { stdout: true },
    });
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(
      "The 'toy' section of other.config.ts is invalid.",
    );
  });
});

/**
 * c12 resolves a relative path a second time against its own cwd, and
 * jiti cannot import a relative specifier at all, so the loader makes
 * the path absolute before it does anything else with it. The shipped
 * bin always passes an absolute process.cwd(), so only these tests hold
 * the behaviour in place.
 */
describe("a relative cwd", { timeout: 60_000 }, () => {
  const RELATIVE_FIXTURES = relative(process.cwd(), FIXTURES);

  test("discovery reads the config under a relative cwd", async () => {
    const loaded = await loadConfig(join(RELATIVE_FIXTURES, "marked"));
    expect(loaded.sections).toEqual({
      toy: { greeting: "hello" },
      other: { level: 2 },
    });
  });

  test("a relative --config value resolves against a relative cwd", async () => {
    const loaded = await loadConfig(
      RELATIVE_FIXTURES,
      join("named", "elsewhere.config.ts"),
    );
    expect(loaded.sections).toEqual({
      toy: { greeting: "from the named file" },
    });
  });

  test("the path a diagnostic reports is absolute even so", async () => {
    const loaded = await loadConfig(join(RELATIVE_FIXTURES, "unmarked"));
    expect(loaded.path).toBe(join(FIXTURES, "unmarked", "prisma.config.ts"));
    expect(loaded.diagnostics[0]?.diagnostic.where).toEqual({
      path: join(FIXTURES, "unmarked", "prisma.config.ts"),
    });
  });
});

/**
 * Left to itself, c12 merges a config file's `$<NODE_ENV>` and
 * `$env.<NODE_ENV>` blocks over the root, so the same file would mean
 * different things in different shells. The loader switches that off,
 * and keeps `$`-prefixed keys, which is how the version marker survives
 * and how an unrecognised `$` key still gets reported.
 */
describe("NODE_ENV does not change the effective config", {
  timeout: 60_000,
}, () => {
  async function underNodeEnv<T>(
    value: string,
    body: () => Promise<T>,
  ): Promise<T> {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = value;
    try {
      return await body();
    } finally {
      if (before === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = before;
      }
    }
  }

  test("a $<NODE_ENV> block does not overlay a section value", async () => {
    const loaded = await underNodeEnv("production", () =>
      loadConfig(join(FIXTURES, "env-overlay")),
    );
    expect(loaded.sections.toy).toEqual({ greeting: "plain" });
  });

  test("a $env block does not overlay a section value", async () => {
    const loaded = await underNodeEnv("production", () =>
      loadConfig(join(FIXTURES, "env-block")),
    );
    expect(loaded.sections.toy).toEqual({ greeting: "plain" });
  });

  /** An empty diagnostics list is the marker being accepted; the unused
   *  `$production` block surviving as a section is what lets the engine
   *  report it rather than let it vanish. */
  test("the $prismaConfig marker survives, and the unused $ block reaches the engine as a section", async () => {
    const loaded = await underNodeEnv("production", () =>
      loadConfig(join(FIXTURES, "env-overlay")),
    );
    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.sections.$production).toEqual({
      toy: { greeting: "overlaid by $production" },
    });
  });
});

/**
 * The shipped CLI is plain Node, not tsx, so the loader has to evaluate
 * TypeScript by itself. These tests run the BUILT package in a separate
 * `node` process that cannot execute TypeScript, and check both halves:
 * a direct `import()` of the config file fails there, and loadConfig
 * still returns its sections.
 */
const SANDBOX_ROOT = join(TESTS_DIR, "tmp");

const PROBE = `
import { pathToFileURL } from "node:url";
import { loadConfig } from "@prisma/cli-engine";

const [cwd, configPath, namedPath] = process.argv.slice(2);

let directImportError = null;
try {
  await import(pathToFileURL(configPath).href);
} catch (error) {
  directImportError = error.code ?? error.message;
}

const loaded = await loadConfig(cwd);
const named = await loadConfig(cwd, namedPath);
const missing = await loadConfig(cwd, namedPath + ".gone");
process.stdout.write("__PROBE__" + JSON.stringify({
  directImportError,
  loaded,
  named,
  missingNamed: {
    sections: missing.sections,
    code: missing.diagnostics[0]?.diagnostic.code ?? null,
  },
}));
`;

/** The file --config names in the probe: TypeScript plain Node cannot
 *  run, in a directory discovery would never look in. */
const NAMED_CONFIG = `import { definePrismaConfig } from "@prisma/cli-engine";

const greeting: string = "from the file --config named";

export default definePrismaConfig({ toy: { greeting } });
`;

interface ProbeResult {
  readonly directImportError: string | null;
  readonly loaded: {
    readonly path: unknown;
    readonly sections: unknown;
    readonly diagnostics: unknown;
  };
  readonly named: {
    readonly path: unknown;
    readonly sections: unknown;
    readonly diagnostics: unknown;
  };
  readonly missingNamed: {
    readonly sections: unknown;
    readonly code: string | null;
  };
}

/** The paths come back with the result: the sandbox is made here, and
 *  the assertions name the files it made. */
function runProbeOnPlainNode(
  config: string,
  nodeArgs: string[],
): ProbeResult & { readonly configPath: string; readonly namedPath: string } {
  mkdirSync(SANDBOX_ROOT, { recursive: true });
  const root = mkdtempSync(join(SANDBOX_ROOT, "plain-node-"));
  const cwd = join(root, "project");
  const elsewhere = join(root, "elsewhere");
  mkdirSync(cwd);
  mkdirSync(elsewhere);
  const configPath = join(cwd, "prisma.config.ts");
  const namedPath = join(elsewhere, "named.config.ts");
  const probePath = join(root, "probe.mjs");
  writeFileSync(configPath, config);
  writeFileSync(namedPath, NAMED_CONFIG);
  writeFileSync(probePath, PROBE);

  const run = spawnSync(
    process.execPath,
    [...nodeArgs, probePath, cwd, configPath, namedPath],
    { encoding: "utf8" },
  );
  if (run.status !== 0) {
    throw new Error(`probe exited ${run.status}:\n${run.stderr}`);
  }
  const marker = run.stdout.indexOf("__PROBE__");
  if (marker === -1) {
    throw new Error(`probe printed no result:\n${run.stdout}\n${run.stderr}`);
  }
  return {
    ...JSON.parse(run.stdout.slice(marker + "__PROBE__".length)),
    configPath,
    namedPath,
  };
}

afterAll(() => {
  rmSync(SANDBOX_ROOT, { recursive: true, force: true });
});

describe("loadConfig on a Node that cannot execute TypeScript", {
  timeout: 60_000,
}, () => {
  test("reads a config when Node's TypeScript support is switched off", () => {
    const probe = runProbeOnPlainNode(
      `import { definePrismaConfig } from "@prisma/cli-engine";

const greeting: string = "hello from plain node";

export default definePrismaConfig({ toy: { greeting } });
`,
      ["--no-experimental-strip-types"],
    );
    expect(probe.directImportError).toBe("ERR_UNKNOWN_FILE_EXTENSION");
    expect(probe.loaded).toEqual({
      path: probe.configPath,
      sections: { toy: { greeting: "hello from plain node" } },
      diagnostics: [],
    });
    expect(probe.named).toEqual({
      path: probe.namedPath,
      sections: { toy: { greeting: "from the file --config named" } },
      diagnostics: [],
    });
    expect(probe.missingNamed).toEqual({
      sections: {},
      code: "CLI.CONFIG_NOT_FOUND",
    });
  });

  test("reads a config using TypeScript that Node cannot strip", () => {
    const probe = runProbeOnPlainNode(
      `import { definePrismaConfig } from "@prisma/cli-engine";

enum Level {
  Verbose = "verbose",
}

export default definePrismaConfig({ toy: { greeting: Level.Verbose } });
`,
      [],
    );
    // Which error a Node in our supported range (>=22.12.0) reports for
    // TypeScript it cannot strip varies by version, so this asserts only
    // that the direct import failed. What the test is for is the pair:
    // the direct import fails where loadConfig, below, succeeds.
    expect(probe.directImportError).toEqual(expect.any(String));
    expect(probe.loaded).toEqual({
      path: probe.configPath,
      sections: { toy: { greeting: "verbose" } },
      diagnostics: [],
    });
  });
});

interface ToyConfig {
  readonly greeting: string;
}

function toySection(seen?: unknown[]): ConfigSection<ToyConfig> {
  return defineConfigSection<ToyConfig>({
    name: "toy",
    validate: (raw): SectionValidation<ToyConfig> => {
      seen?.push(raw);
      if (raw === undefined) {
        return { ok: true, value: { greeting: "default" }, diagnostics: [] };
      }
      const greeting =
        typeof raw === "object" && raw !== null
          ? (raw as { readonly greeting?: unknown }).greeting
          : undefined;
      if (typeof greeting === "string") {
        return { ok: true, value: { greeting }, diagnostics: [] };
      }
      return {
        ok: false,
        diagnostics: [
          {
            code: "TOY.GREETING_INVALID",
            severity: "error",
            summary: "toy.greeting must be a string.",
            nextActions: [
              {
                kind: "user-choice",
                label: "Set toy.greeting to a string in prisma.config.ts.",
              },
            ],
          },
        ],
      };
    },
  });
}

function showCommand(
  section: ConfigSection<ToyConfig>,
  ran?: { value: boolean },
) {
  return defineCommand({
    help: { summary: "Show the validated toy config" },
    needs: { config: section },
    handler: async (_args, ctx) => {
      if (ran !== undefined) {
        ran.value = true;
      }
      return ok(
        ctx.present(
          { data: ctx.config },
          {
            human: () => [
              { kind: "summary", status: "ok", text: ctx.config.greeting },
            ],
          },
        ),
      );
    },
  });
}

describe("needs.config", { timeout: 60_000 }, () => {
  test("a valid section reaches the handler as ctx.config and the envelope result", async () => {
    const cli = createTestCli({
      commands: { show: showCommand(toySection()) },
      config: { toy: { greeting: "hi" } },
      now: EPOCH,
    });
    const run = await cli.run(["show", "--json"]);
    expect(run.exitCode).toBe(0);
    expect(run.json).toEqual([
      {
        kind: "result",
        envelope: {
          ok: true,
          commandId: "show",
          result: { greeting: "hi" },
          exitCode: 0,
          diagnostics: [],
          nextActions: [],
        },
        commandId: "show",
        timestamp: T0,
      },
    ]);
  });

  test("an absent section hands the validator undefined; its default becomes ctx.config", async () => {
    const seen: unknown[] = [];
    const cli = createTestCli({
      commands: { show: showCommand(toySection(seen)) },
      config: {},
    });
    const run = await cli.run(["show"], { isTty: { stdout: true } });
    expect(seen).toEqual([undefined]);
    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toEqual({ greeting: "default" });
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe("✔ default\n");
  });

  test("an invalid section fails early with the validator's diagnostics in the errored envelope", async () => {
    const ran = { value: false };
    const cli = createTestCli({
      commands: { show: showCommand(toySection(), ran) },
      config: { toy: { greeting: 5 } },
      now: EPOCH,
    });
    const run = await cli.run(["show", "--json"]);
    expect(run.exitCode).toBe(2);
    expect(ran.value).toBe(false);
    expect(run.json).toEqual([
      {
        kind: "result",
        envelope: {
          ok: false,
          commandId: "show",
          error: {
            code: "CLI.CONFIG_SECTION_INVALID",
            severity: "error",
            summary: "The 'toy' section of prisma.config.ts is invalid.",
            nextActions: [
              {
                kind: "user-choice",
                label:
                  "Fix the reported problems in that section, then run the command again.",
              },
            ],
          },
          diagnostics: [
            {
              code: "TOY.GREETING_INVALID",
              severity: "error",
              summary: "toy.greeting must be a string.",
              nextActions: [
                {
                  kind: "user-choice",
                  label: "Set toy.greeting to a string in prisma.config.ts.",
                },
              ],
            },
          ],
          nextActions: [
            {
              kind: "user-choice",
              label:
                "Fix the reported problems in that section, then run the command again.",
            },
          ],
        },
        commandId: "show",
        timestamp: T0,
      },
    ]);
  });

  test("an invalid section renders both the engine error and the validator diagnostics in human mode", async () => {
    const cli = createTestCli({
      commands: { show: showCommand(toySection()) },
      config: { toy: { greeting: 5 } },
    });
    const run = await cli.run(["show"], { isTty: { stdout: true } });
    expect(run.exitCode).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("✘ [CLI.CONFIG_SECTION_INVALID]");
    expect(run.stderr).toContain("✘ [TOY.GREETING_INVALID]");
  });

  test("a validator that throws is an engine-boundary bug: exit 1", async () => {
    const throwing = defineConfigSection<ToyConfig>({
      name: "toy",
      validate: () => {
        throw new Error("kaboom");
      },
    });
    const cli = createTestCli({
      commands: { show: showCommand(throwing) },
      config: { toy: {} },
      now: EPOCH,
    });
    const run = await cli.run(["show", "--json"]);
    expect(run.exitCode).toBe(1);
    const frame = run.json[0];
    if (frame.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored result frame");
    }
    expect(frame.envelope.error.code).toBe("CLI.INTERNAL_ERROR");
    expect(frame.envelope.error.summary).toContain(
      "'toy' config section validator threw",
    );
  });

  function jsonRuntime(cwd: string, reads?: { value: number }) {
    let stdoutText = "";
    const runtime: Runtime = {
      stdout: {
        write: (text) => {
          stdoutText += text;
        },
      },
      stderr: { write: () => {} },
      stdin: {
        async *[Symbol.asyncIterator]() {},
      },
      cwd,
      env: {},
      isTty: { stdin: false, stdout: false, stderr: false },
      exit: (code: number): never => {
        throw new Error(`runtime.exit(${code})`);
      },
      onSignal: () => () => {},
      loadConfig: (configPath): Promise<LoadedConfig> => {
        if (reads !== undefined) {
          reads.value += 1;
        }
        return loadConfig(cwd, configPath);
      },
      managementApi: { baseUrl: "https://test.invalid" },
      host: {
        runtime: { name: "node", version: "v22.12.0" },
        platform: "linux",
        arch: "x64",
      },
    };
    return { runtime, stdout: () => stdoutText };
  }

  test("an unmarked Prisma 7 config does not fail a command with no config need — the file is never read", async () => {
    const plain = defineCommand({
      help: { summary: "No needs at all" },
      handler: async (_args, ctx) =>
        ok(ctx.present({ data: null }, { human: () => [] })),
    });
    const cli = createCli({
      name: "t",
      version: "0.0.0",
      commandFamilies: [],
      groups: {},
      commands: { plain },
    });
    const reads = { value: 0 };
    const { runtime, stdout } = jsonRuntime(join(FIXTURES, "unmarked"), reads);
    const exitCode = await cli.run(["plain"], runtime);
    expect(exitCode).toBe(0);
    expect(reads.value).toBe(0);
    const frame = JSON.parse(stdout().trim());
    expect(frame.envelope.ok).toBe(true);
  });

  test("the same unmarked config fails a config-needing command early with exit 2", async () => {
    const ran = { value: false };
    const cli = createCli({
      name: "t",
      version: "0.0.0",
      commandFamilies: [],
      groups: {},
      commands: { show: showCommand(toySection(), ran) },
    });
    const reads = { value: 0 };
    const { runtime, stdout } = jsonRuntime(join(FIXTURES, "unmarked"), reads);
    const exitCode = await cli.run(["show"], runtime);
    expect(exitCode).toBe(2);
    expect(ran.value).toBe(false);
    expect(reads.value).toBe(1);
    const frame = JSON.parse(stdout().trim());
    expect(frame.envelope.ok).toBe(false);
    expect(frame.envelope.error.code).toBe("CLI.CONFIG_MISSING_MARKER");
  });

  test("loadConfig output feeds the engine: disk to ctx.config end to end", async () => {
    const loaded = await loadConfig(
      FIXTURES,
      join(FIXTURES, "named", "elsewhere.config.ts"),
    );
    const cli = createTestCli({
      commands: { show: showCommand(toySection()) },
      config: loaded.sections,
    });
    const run = await cli.run(["show"], { isTty: { stdout: true } });
    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toEqual({ greeting: "from the named file" });
  });
});

/**
 * `--config` is an ordinary engine-injected global flag, so the parser
 * owns its grammar. These pin what the parser does with the four
 * malformed shapes prisma/prisma's `detectInvalidConfig` rejects, and
 * what a well-formed value does.
 */
describe("--config on the command line", { timeout: 60_000 }, () => {
  function spyingCli() {
    const asked: (string | undefined)[] = [];
    const section = toySection();
    const show = showCommand(section);
    const cli = createTestCli({
      commandFamilies: [
        defineCommandFamily({ configSection: section, commands: { show } }),
      ],
      commands: { show },
      loadConfig: async (configPath) => {
        asked.push(configPath);
        return {
          path: configPath ?? "prisma.config.ts",
          sections: { toy: { greeting: "hi" } },
          diagnostics: [],
        };
      },
    });
    return { cli, asked };
  }

  test("--config <path> reaches the loader", async () => {
    const { cli, asked } = spyingCli();
    const run = await cli.run(["show", "--config", "/somewhere/other.ts"]);
    expect(run.exitCode).toBe(0);
    expect(asked).toEqual(["/somewhere/other.ts"]);
  });

  test("without the flag the loader is asked for no particular file", async () => {
    const { cli, asked } = spyingCli();
    const run = await cli.run(["show"]);
    expect(run.exitCode).toBe(0);
    expect(asked).toEqual([undefined]);
  });

  test("--config=<path> works too, and its value may start with '-'", async () => {
    const { cli, asked } = spyingCli();
    const run = await cli.run(["show", "--config=-weird.ts"]);
    expect(run.exitCode).toBe(0);
    expect(asked).toEqual(["-weird.ts"]);
  });

  async function usageFailure(argv: readonly string[]) {
    const { cli, asked } = spyingCli();
    const run = await cli.run(argv);
    const frame = run.json[0];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error(`expected an errored result frame, got ${run.stderr}`);
    }
    return {
      exitCode: run.exitCode,
      code: frame.envelope.error.code,
      summary: frame.envelope.error.summary,
      asked,
    };
  }

  test("--config as the last token is a usage error", async () => {
    const failure = await usageFailure(["show", "--config"]);
    expect(failure.exitCode).toBe(2);
    expect(failure.code).toBe("CLI.INVALID_ARGUMENTS");
    expect(failure.summary).toContain("--config");
    expect(failure.asked).toEqual([]);
  });

  test("--config followed by another flag is a usage error", async () => {
    const failure = await usageFailure(["show", "--config", "--json"]);
    expect(failure.exitCode).toBe(2);
    expect(failure.code).toBe("CLI.INVALID_ARGUMENTS");
    expect(failure.asked).toEqual([]);
  });

  test("--config '' — what a shell makes of an unset variable — is a usage error", async () => {
    const failure = await usageFailure(["show", "--config", ""]);
    expect(failure.exitCode).toBe(2);
    expect(failure.code).toBe("CLI.INVALID_ARGUMENTS");
    expect(failure.summary).toContain("--config needs a path");
    expect(failure.asked).toEqual([]);
  });

  test("--config= is a usage error, though the parser cannot see it as a flag", async () => {
    const failure = await usageFailure(["show", "--config="]);
    expect(failure.exitCode).toBe(2);
    expect(failure.code).toBe("CLI.INVALID_ARGUMENTS");
    expect(failure.summary).toBe(
      "--config needs a path, and was given an empty value",
    );
    expect(failure.asked).toEqual([]);
  });

  /** The scan runs before parsing, so it cannot tell a flag from data.
   *  Here `--config=` is another flag's value and no --config was
   *  written at all, and the run is still rejected. Deliberate: the
   *  reference implementation does the same, and `--` is the escape. */
  test("--config= is rejected wherever it appears, including as another flag's value", async () => {
    const echo = defineCommand({
      help: { summary: "Echoes a message" },
      args: { flags: { message: flag.string({ brief: "message" }) } },
      handler: async (args, ctx) =>
        ok(ctx.present({ data: args.flags.message }, { human: () => [] })),
    });
    const cli = createTestCli({ commands: { echo } });
    const run = await cli.run(["echo", "--message", "--config="]);
    expect(run.exitCode).toBe(2);
    const frame = run.json[0];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error(`expected an errored result frame, got ${run.stderr}`);
    }
    expect(frame.envelope.error.code).toBe("CLI.INVALID_ARGUMENTS");
    expect(frame.envelope.error.summary).toBe(
      "--config needs a path, and was given an empty value",
    );
  });

  test("after a bare --, --config= is an ordinary argument", async () => {
    const passthrough = defineCommand({
      help: { summary: "Echoes its arguments" },
      args: {
        positionals: {
          rest: positional.variadic({ brief: "rest", placeholder: "rest" }),
        },
      },
      handler: async (args, ctx) =>
        ok(ctx.present({ data: args.positionals.rest }, { human: () => [] })),
    });
    const cli = createTestCli({ commands: { passthrough } });
    const run = await cli.run(["passthrough", "--", "--config="]);
    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toEqual(["--config="]);
  });

  test("a file named with --config that is not there fails the run, end to end", async () => {
    const missing = join(FIXTURES, "named", "nope.config.ts");
    const ran = { value: false };
    const section = toySection();
    const show = showCommand(section, ran);
    const cli = createTestCli({
      commandFamilies: [
        defineCommandFamily({ configSection: section, commands: { show } }),
      ],
      commands: { show },
      loadConfig: (request) => loadConfig(FIXTURES, request),
    });

    const named = await cli.run(["show", "--config", missing], {
      isTty: { stdout: true },
    });
    expect(named.exitCode).toBe(2);
    expect(ran.value).toBe(false);
    expect(named.stderr).toContain("CLI.CONFIG_NOT_FOUND");

    const discovered = await cli.run(["show"], { isTty: { stdout: true } });
    expect(discovered.exitCode).toBe(0);
    expect(discovered.presented?.data).toEqual({ greeting: "default" });
  });

  test("--config reaches a file discovery would never find", async () => {
    const section = toySection();
    const show = showCommand(section);
    const cli = createTestCli({
      commandFamilies: [
        defineCommandFamily({ configSection: section, commands: { show } }),
      ],
      commands: { show },
      loadConfig: (request) => loadConfig(FIXTURES, request),
    });
    const run = await cli.run(
      ["show", "--config", join(FIXTURES, "named", "elsewhere.config.ts")],
      { isTty: { stdout: true } },
    );
    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toEqual({ greeting: "from the named file" });
  });
});

describe("warnings on a successful section validation", {
  timeout: 60_000,
}, () => {
  const warningSection = defineConfigSection<ToyConfig>({
    name: "toy",
    validate: () => ({
      ok: true,
      value: { greeting: "hi" },
      diagnostics: [
        {
          code: "TOY.LEGACY_GREETING",
          severity: "warn",
          summary: "toy.legacy is deprecated.",
          nextActions: [],
        },
      ],
    }),
  });

  function warningCli() {
    return createTestCli({
      commands: { show: showCommand(warningSection) },
      config: { toy: {} },
      now: EPOCH,
    });
  }

  test("the warning goes to stderr and the command still completes", async () => {
    const run = await warningCli().run(["show"], { isTty: { stdout: true } });
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe(
      "⚠ [TOY.LEGACY_GREETING] toy.legacy is deprecated.\n✔ hi\n",
    );
  });

  test("json mode writes the warning to stderr, never the stream or envelope", async () => {
    const run = await warningCli().run(["show", "--json"]);
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe(
      "⚠ [TOY.LEGACY_GREETING] toy.legacy is deprecated.\n",
    );
    expect(run.json).toEqual([
      {
        kind: "result",
        envelope: {
          ok: true,
          commandId: "show",
          result: { greeting: "hi" },
          exitCode: 0,
          diagnostics: [],
          nextActions: [],
        },
        commandId: "show",
        timestamp: T0,
      },
    ]);
  });

  test("--log-level error hides the warning but not the presentation", async () => {
    const run = await warningCli().run(["show", "--log-level", "error"], {
      isTty: { stdout: true },
    });
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe("✔ hi\n");
  });
});
