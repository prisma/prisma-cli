/**
 * D5: the minimal config loader behind Runtime.config — cwd-only
 * discovery, defineConfig marker semantics with the pinned Prisma 7
 * fail-early diagnostic, and needs.config validation wired end to end
 * through the harness.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ConfigSection,
  createCli,
  defineCommand,
  defineConfig,
  defineConfigSection,
  loadConfig,
  PRISMA_CONFIG_VERSION,
  type Runtime,
  type SectionValidation,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "config",
);

const EPOCH = () => new Date(0);
const T0 = "1970-01-01T00:00:00.000Z";

describe("defineConfig", () => {
  test("stamps the version marker on the config object", () => {
    expect(defineConfig({ toy: { greeting: "hi" } })).toEqual({
      toy: { greeting: "hi" },
      $prismaConfig: PRISMA_CONFIG_VERSION,
    });
  });
});

describe("loadConfig", () => {
  test("a marked file yields raw sections without the marker key", async () => {
    expect(await loadConfig(join(FIXTURES, "marked"))).toEqual({
      sections: { toy: { greeting: "hello" }, other: { level: 2 } },
      diagnostics: [],
    });
  });

  test("no file at all yields an empty LoadedConfig — validators own absence", async () => {
    expect(await loadConfig(FIXTURES)).toEqual({
      sections: {},
      diagnostics: [],
    });
  });

  test("discovery is cwd-only: a config in the parent directory is not found", async () => {
    expect(await loadConfig(join(FIXTURES, "marked", "nested"))).toEqual({
      sections: {},
      diagnostics: [],
    });
  });

  test("an evaluated file without the marker fails early with the pinned Prisma 7 diagnostic", async () => {
    expect(await loadConfig(join(FIXTURES, "unmarked"))).toEqual({
      sections: {},
      diagnostics: [
        {
          section: null,
          diagnostic: {
            code: "CLI.CONFIG_MISSING_MARKER",
            severity: "error",
            summary:
              "This prisma.config.ts was not written for this version of the Prisma CLI, so it cannot be used.",
            why: "Configs for this CLI are created with defineConfig, which records a version marker on the exported object. This file's default export has no marker — it is most likely a Prisma 7 config, which uses the same filename — and the CLI stops rather than misread it.",
            nextActions: [
              {
                kind: "user-choice",
                label:
                  "Migrate the file: wrap the exported object in defineConfig from @prisma/cli-engine and export the result as the default export.",
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
      sections: {},
      diagnostics: [
        {
          section: null,
          diagnostic: {
            code: "CLI.CONFIG_INVALID",
            severity: "error",
            summary: `prisma.config.ts declares config version 2, but this CLI supports only version ${PRISMA_CONFIG_VERSION}.`,
            nextActions: [
              {
                kind: "user-choice",
                label:
                  "Regenerate the config with a defineConfig matching this CLI, or update the CLI to a version that supports the declared config version.",
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

  test("a file that throws while evaluating yields a file-level diagnostic", async () => {
    const loaded = await loadConfig(join(FIXTURES, "unreadable"));
    expect(loaded.sections).toEqual({});
    expect(loaded.diagnostics).toHaveLength(1);
    expect(loaded.diagnostics[0].section).toBeNull();
    expect(loaded.diagnostics[0].diagnostic.code).toBe("CLI.CONFIG_UNREADABLE");
    expect(loaded.diagnostics[0].diagnostic.summary).toContain(
      "boom at config evaluation time",
    );
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
              { kind: "summary", tone: "ok", text: ctx.config.greeting },
            ],
          },
        ),
      );
    },
  });
}

describe("needs.config", () => {
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
            code: "CLI.CONFIG_INVALID",
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
    expect(run.stderr).toContain("✖ [CLI.CONFIG_INVALID]");
    expect(run.stderr).toContain("✖ [TOY.GREETING_INVALID]");
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

  function jsonRuntime(config: Runtime["config"]) {
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
      cwd: "/",
      env: {},
      isTty: { stdin: false, stdout: false, stderr: false },
      exit: (code: number): never => {
        throw new Error(`runtime.exit(${code})`);
      },
      onSignal: () => () => {},
      config,
      getCredentials: async () => undefined,
      packageManager: "unknown",
    };
    return { runtime, stdout: () => stdoutText };
  }

  test("an unmarked Prisma 7 config does not fail a command with no config need", async () => {
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
    const { runtime, stdout } = jsonRuntime(
      await loadConfig(join(FIXTURES, "unmarked")),
    );
    const exitCode = await cli.run(["plain"], runtime);
    expect(exitCode).toBe(0);
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
    const { runtime, stdout } = jsonRuntime(
      await loadConfig(join(FIXTURES, "unmarked")),
    );
    const exitCode = await cli.run(["show"], runtime);
    expect(exitCode).toBe(2);
    expect(ran.value).toBe(false);
    const frame = JSON.parse(stdout().trim());
    expect(frame.envelope.ok).toBe(false);
    expect(frame.envelope.error.code).toBe("CLI.CONFIG_MISSING_MARKER");
  });

  test("loadConfig output feeds the engine: disk to ctx.config end to end", async () => {
    const loaded = await loadConfig(join(FIXTURES, "marked"));
    const cli = createTestCli({
      commands: { show: showCommand(toySection()) },
      config: loaded.sections,
    });
    const run = await cli.run(["show"], { isTty: { stdout: true } });
    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toEqual({ greeting: "hello" });
  });
});

describe("warnings on a successful section validation", () => {
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
