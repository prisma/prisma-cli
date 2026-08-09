/**
 * Product manifests (§10): the foreign-section construction check and
 * docs-URL derivation from the owning product's docsBaseUrl.
 */
import {
  type ConfigSection,
  createTestCli,
  defineCommand,
  defineConfigSection,
  type ProductManifest,
} from "@prisma/cli-engine";
import { CliStructuredError, notOk, ok } from "@prisma/cli-engine/protocol";
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
    handler: async () => ({
      default: async (_args, ctx) =>
        ok(ctx.present({ data: ctx.config }, { human: () => [] })),
    }),
  });
}

describe("foreign-section references", () => {
  test("a command needing a section that is not its product's fails construction", () => {
    const command = configCommand(foreignSection);
    const product: ProductManifest = {
      configSection: ownSection,
      commands: { command },
    };

    expect(() =>
      createTestCli({ products: [product], commands: { command } }),
    ).toThrow(
      "command 'command' needs the 'other' config section, which is not its product's declared section",
    );
  });

  test("a command needing its own product's section constructs", () => {
    const command = configCommand(ownSection);
    const product: ProductManifest = {
      configSection: ownSection,
      commands: { command },
    };

    expect(() =>
      createTestCli({ products: [product], commands: { command } }),
    ).not.toThrow();
  });

  test("a command owned by no product is not checked (harness mounts)", () => {
    const command = configCommand(foreignSection);

    expect(() => createTestCli({ commands: { command } })).not.toThrow();
  });
});

describe("docs-URL derivation", () => {
  const BASE = "https://pris.ly/cli/errors/";

  const failing = defineCommand({
    help: { summary: "Always errors" },
    handler: async () => ({
      default: async () =>
        notOk(new CliStructuredError("TOY.BROKEN", "It broke")),
    }),
  });

  const overriding = defineCommand({
    help: { summary: "Errors with its own docsUrl" },
    handler: async () => ({
      default: async () =>
        notOk(
          new CliStructuredError("TOY.BROKEN", "It broke", {
            docsUrl: "https://example.invalid/override",
          }),
        ),
    }),
  });

  const finding = defineCommand({
    help: { summary: "Completes with a finding" },
    exitCodes: { 4: "findings" },
    handler: async () => ({
      default: async (_args, ctx) =>
        ok(
          ctx.present(
            {
              data: null,
              exitCode: 4,
              diagnostics: [
                { code: "TOY.FINDING", severity: "warn", summary: "Found" },
              ],
            },
            { human: () => [] },
          ),
        ),
    }),
  });

  function productCli() {
    const product: ProductManifest = {
      commands: { failing, overriding, finding },
      docsBaseUrl: BASE,
    };
    return createTestCli({
      products: [product],
      commands: { failing, overriding, finding },
      now: EPOCH,
    });
  }

  test("an errored envelope carries docsUrl derived as base + code", async () => {
    const result = await productCli().run(["failing", "--json"]);

    const frame = result.json[0];
    if (frame.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored result frame");
    }
    expect(frame.envelope.error.docsUrl).toBe(`${BASE}TOY.BROKEN`);
  });

  test("human rendering shows the derived docs link", async () => {
    const result = await productCli().run(["failing"], {
      isTty: { stdout: true },
    });

    expect(result.stderr).toBe(
      "✖ [TOY.BROKEN] It broke\n" + `  docs: ${BASE}TOY.BROKEN\n`,
    );
  });

  test("a per-raise docsUrl wins over the derived one", async () => {
    const result = await productCli().run(["overriding", "--json"]);

    const frame = result.json[0];
    if (frame.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored result frame");
    }
    expect(frame.envelope.error.docsUrl).toBe(
      "https://example.invalid/override",
    );
  });

  test("completed-envelope diagnostics get the derived docsUrl too", async () => {
    const result = await productCli().run(["finding", "--json"]);

    const frame = result.json[0];
    if (frame.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed result frame");
    }
    expect(frame.envelope.diagnostics).toEqual([
      {
        code: "TOY.FINDING",
        severity: "warn",
        summary: "Found",
        docsUrl: `${BASE}TOY.FINDING`,
      },
    ]);
  });

  test("a command from a product without docsBaseUrl stays undecorated", async () => {
    const product: ProductManifest = { commands: { failing } };
    const cli = createTestCli({
      products: [product],
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
