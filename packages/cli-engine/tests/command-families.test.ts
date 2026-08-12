/**
 * Command families (§10): the foreign-section construction check and
 * docs-URL derivation from the owning command family's docsBaseUrl.
 */
import {
  type ConfigSection,
  defineCommand,
  defineCommandFamily,
  defineConfigSection,
} from "@prisma/cli-engine";
import { CliStructuredError, notOk, ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

const EPOCH = () => new Date(0);

const ownSection = defineConfigSection<{ greeting: string }>({
  name: "toy",
  validate: () => ({ ok: true, value: { greeting: "hi" }, diagnostics: [] }),
});

const foreignSection = defineConfigSection<{ level: number }>({
  name: "other",
  validate: () => ({ ok: true, value: { level: 1 }, diagnostics: [] }),
});

function configCommand<T>(section: ConfigSection<T>) {
  return defineCommand({
    help: { summary: "Reads a config section" },
    needs: { config: section },
    handler: async (_args, ctx) =>
      ok(
        ctx.present(
          { data: ctx.config },
          {
            human: () => [],
            stdout: () => [],
            json: () => ctx.config,
            next: () => [],
          },
        ),
      ),
  });
}

describe("foreign-section references", () => {
  test("a command needing a section that is not its command family's fails construction", () => {
    const command = configCommand(foreignSection);
    const family = defineCommandFamily({
      configSection: ownSection,
      commands: { command },
    });

    expect(() =>
      createTestCli({ commandFamilies: [family], commands: { command } }),
    ).toThrow(
      "command 'command' needs the 'other' config section, which is not its command family's section",
    );
  });

  test("a command needing its own command family's section constructs", () => {
    const command = configCommand(ownSection);
    const family = defineCommandFamily({
      configSection: ownSection,
      commands: { command },
    });

    expect(() =>
      createTestCli({ commandFamilies: [family], commands: { command } }),
    ).not.toThrow();
  });

  test("a command owned by no command family is not checked (harness mounts)", () => {
    const command = configCommand(foreignSection);

    expect(() => createTestCli({ commands: { command } })).not.toThrow();
  });
});

/**
 * The config file's top-level keys are the declared section names, so a
 * section may only be named something the file format leaves free.
 * `$`-prefixed keys are metadata ($prismaConfig is the version marker,
 * and a $meta key is deleted before the loader sees it), and `extends`
 * is the key config loaders take as a merge directive. That is a
 * construction error, raised at build time.
 */
describe("section names the config file reserves", () => {
  function sectionNamed(name: string) {
    return defineConfigSection<null>({
      name,
      validate: () => ({ ok: true, value: null, diagnostics: [] }),
    });
  }

  function familyClaiming(name: string) {
    const section = sectionNamed(name);
    const command = configCommand(section);
    return {
      commandFamilies: [
        defineCommandFamily({ configSection: section, commands: { command } }),
      ],
      commands: { command },
    };
  }

  test.each([
    "extends",
    "__proto__",
    "$env",
    "$meta",
    "$prismaConfig",
    "$production",
  ])("a command family claiming the section '%s' fails construction", (name) => {
    expect(() => createTestCli(familyClaiming(name))).toThrow(
      `command family declares config section '${name}', a name the config file reserves`,
    );
  });

  /** The shell mounts commands with no family at all, so the check
   *  cannot be on the families alone. */
  test("a command with no command family claiming a reserved name fails construction too", () => {
    const command = configCommand(sectionNamed("$env"));

    expect(() => createTestCli({ commands: { command } })).toThrow(
      "command 'command' declares config section '$env', a name the config file reserves",
    );
  });

  test("an ordinary section name still constructs", () => {
    expect(() => createTestCli(familyClaiming("extended"))).not.toThrow();
  });
});

describe("docs-URL derivation", () => {
  const BASE = "https://pris.ly/cli/errors/";

  const failing = defineCommand({
    help: { summary: "Always errors" },
    handler: async () =>
      notOk(new CliStructuredError("TOY.BROKEN", "It broke")),
  });

  const overriding = defineCommand({
    help: { summary: "Errors with its own docsUrl" },
    handler: async () =>
      notOk(
        new CliStructuredError("TOY.BROKEN", "It broke", {
          docsUrl: "https://example.invalid/override",
        }),
      ),
  });

  const finding = defineCommand({
    help: { summary: "Completes with a finding" },
    exitCodes: { 4: "findings" },
    handler: async (_args, ctx) =>
      ok(
        ctx.present(
          {
            data: null,
            exitCode: 4,
            diagnostics: [
              {
                code: "TOY.FINDING",
                severity: "warn",
                summary: "Found",
                nextActions: [],
              },
            ],
          },
          {
            human: () => [],
            stdout: () => [],
            json: () => null,
            next: () => [],
          },
        ),
      ),
  });

  function familyCli() {
    const family = defineCommandFamily({
      commands: { failing, overriding, finding },
      docsBaseUrl: BASE,
    });
    return createTestCli({
      commandFamilies: [family],
      commands: { failing, overriding, finding },
      now: EPOCH,
    });
  }

  test("an errored envelope carries docsUrl derived as base + code", async () => {
    const result = await familyCli().run(["failing", "--json"]);

    const frame = result.json[0];
    if (frame.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored result frame");
    }
    expect(frame.envelope.error.docsUrl).toBe(`${BASE}TOY.BROKEN`);
  });

  test("human rendering shows the derived docs link", async () => {
    const result = await familyCli().run(["failing"], {
      isTty: { stdout: true },
    });

    expect(result.stderr).toBe(
      `✘ [TOY.BROKEN] It broke\n  docs: ${BASE}TOY.BROKEN\n`,
    );
  });

  test("a docsBaseUrl without a trailing slash still derives a well-formed link", async () => {
    const family = defineCommandFamily({
      commands: { failing },
      docsBaseUrl: "https://pris.ly/cli/errors",
    });
    const cli = createTestCli({
      commandFamilies: [family],
      commands: { failing },
      now: EPOCH,
    });
    const result = await cli.run(["failing", "--json"]);

    const frame = result.json[0];
    if (frame.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored result frame");
    }
    expect(frame.envelope.error.docsUrl).toBe(
      "https://pris.ly/cli/errors/TOY.BROKEN",
    );
  });

  test("a docsBaseUrl that is not a URL fails construction", () => {
    const family = defineCommandFamily({
      commands: { failing },
      docsBaseUrl: "not a url",
    });

    expect(() =>
      createTestCli({
        commandFamilies: [family],
        commands: { failing },
        now: EPOCH,
      }),
    ).toThrow("docsBaseUrl 'not a url' is not a valid URL");
  });

  test("a per-raise docsUrl wins over the derived one", async () => {
    const result = await familyCli().run(["overriding", "--json"]);

    const frame = result.json[0];
    if (frame.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored result frame");
    }
    expect(frame.envelope.error.docsUrl).toBe(
      "https://example.invalid/override",
    );
  });

  test("completed-envelope diagnostics get the derived docsUrl too", async () => {
    const result = await familyCli().run(["finding", "--json"]);

    const frame = result.json[0];
    if (frame.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed result frame");
    }
    expect(frame.envelope.diagnostics).toEqual([
      {
        code: "TOY.FINDING",
        severity: "warn",
        summary: "Found",
        nextActions: [],
        docsUrl: `${BASE}TOY.FINDING`,
      },
    ]);
  });

  test("a command from a command family without docsBaseUrl stays undecorated", async () => {
    const family = defineCommandFamily({ commands: { failing } });
    const cli = createTestCli({
      commandFamilies: [family],
      commands: { failing },
      now: EPOCH,
    });
    const result = await cli.run(["failing", "--json"]);

    const frame = result.json[0];
    if (frame.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored result frame");
    }
    expect(frame.envelope.error.docsUrl).toBeUndefined();
  });
});
