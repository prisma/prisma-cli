/**
 * A config section declared once as a schema: the declaration drives
 * validation, the diagnostics naming the field and the file to fix, and
 * the resolution of every field declared `path` against the file that
 * wrote it.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  configSchema,
  defineCommand,
  defineConfigSection,
  loadConfig,
  type SectionProvenance,
  validateSectionWithSchema,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { type } from "arktype";
import { describe, expect, test } from "vitest";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "config",
);

const toySchema = configSchema({
  "dir?": "path",
  "out?": "path",
  "inputs?": "path[]",
  "nested?": { "file?": "path" },
  greeting: "string = 'hello'",
  "level?": "number",
});

const single: SectionProvenance = {
  files: ["/app/prisma.config.ts"],
  keys: {
    dir: "/app/prisma.config.ts",
    inputs: "/app/prisma.config.ts",
    nested: "/app/prisma.config.ts",
  },
};

describe("validateSectionWithSchema", () => {
  const checkedOnlyValue = configSchema("object").narrow(() => true);

  test("resolves a path field against the file that declared it and records baseDir", () => {
    const result = validateSectionWithSchema(
      "toy",
      toySchema,
      {
        dir: "./migrations",
        inputs: ["./a.prisma", "/abs/b.prisma"],
        nested: { file: "x/y.ts" },
      },
      single,
    );

    expect(result).toEqual({
      ok: true,
      value: {
        dir: "/app/migrations",
        inputs: ["/app/a.prisma", "/abs/b.prisma"],
        nested: { file: "/app/x/y.ts" },
        greeting: "hello",
        baseDir: "/app",
      },
      diagnostics: [],
    });
  });

  test("a nested path resolves against the file that declared its top-level key", () => {
    const provenance: SectionProvenance = {
      files: ["/child/prisma.config.ts", "/parent/prisma.config.ts"],
      keys: {
        out: "/child/prisma.config.ts",
        dir: "/parent/prisma.config.ts",
        nested: "/parent/prisma.config.ts",
      },
    };

    const result = validateSectionWithSchema(
      "toy",
      toySchema,
      { out: "./dist", dir: "./migrations", nested: { file: "./f" } },
      provenance,
    );

    expect(result.ok && result.value).toMatchObject({
      out: "/child/dist",
      dir: "/parent/migrations",
      nested: { file: "/parent/f" },
      baseDir: "/child",
    });
  });

  test("a thunk path default resolves against the nearest file when it is applied", () => {
    const schema = configSchema({ dir: ["path", "=", () => "./migrations"] });
    const provenance: SectionProvenance = {
      files: ["/child/prisma.config.ts", "/parent/prisma.config.ts"],
      keys: {},
    };

    const result = validateSectionWithSchema("toy", schema, {}, provenance);

    expect(result.ok && result.value).toMatchObject({
      dir: "/child/migrations",
    });
  });

  test("a relative literal path default is refused when the schema is defined", () => {
    expect(() => configSchema({ dir: "path = './migrations'" })).toThrow(
      "the relative 'path' default './migrations' must be declared as a thunk",
    );
    expect(() =>
      configSchema({ dir: "path = '/abs/migrations'" }),
    ).not.toThrow();
  });

  test("a morph other than path runs once", () => {
    let runs = 0;
    const schema = configSchema({
      dir: "path",
      counted: type("string").pipe((value) => {
        runs += 1;
        return value.toUpperCase();
      }),
    });

    const result = validateSectionWithSchema(
      "toy",
      schema,
      { dir: "./d", counted: "x" },
      single,
    );

    expect(result.ok && result.value).toMatchObject({
      dir: "/app/d",
      counted: "X",
    });
    expect(runs).toBe(1);
  });

  test("baseDir is reserved: a section that writes it is refused", () => {
    const result = validateSectionWithSchema(
      "toy",
      toySchema,
      { baseDir: "/elsewhere" },
      single,
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toMatchObject([
      {
        code: "CLI.CONFIG_FIELD_INVALID",
        meta: { section: "toy", field: "baseDir" },
      },
    ]);
  });

  test("baseDir is part of the validated value's type", () => {
    const result = validateSectionWithSchema("toy", toySchema, {}, single);

    if (!result.ok) throw new Error("expected ok");
    const dir: string | undefined = result.value.baseDir;
    expect(dir).toBe("/app");
  });

  test("what a config file constructed reaches the command working, frozen section or not", () => {
    class Serializer {
      deserialize(json: unknown): unknown {
        return json;
      }
    }
    const checkedOnly = configSchema("object").narrow(() => true);
    const schema = configSchema({
      target: checkedOnly,
      "contract?": { source: checkedOnly, "output?": "path" },
      "extensions?": [checkedOnly, "[]"],
      migrations: [
        { dir: ["path", "=", () => "./migrations"] },
        "=",
        () => ({}),
      ],
    });
    const serializer = new Serializer();
    const load = () => 1;
    const target = Object.freeze({
      kind: "target",
      serializer,
      create() {
        return this.kind;
      },
    });
    const raw = Object.freeze({
      target,
      contract: Object.freeze({
        source: Object.freeze({ load }),
        output: "./out.json",
      }),
      extensions: Object.freeze([target]),
    });

    const result = validateSectionWithSchema("toy", schema, raw, single);

    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const value = result.value as {
      target: typeof target;
      contract: { source: { load: () => number }; output: string };
      extensions: (typeof target)[];
      migrations: { dir: string };
    };
    expect(value.target.serializer).toBe(serializer);
    expect(value.target.create()).toBe("target");
    expect(value.contract.source.load).toBe(load);
    expect(value.extensions[0].serializer).toBe(serializer);
    expect(value.contract.output).toBe("/app/out.json");
    expect(value.migrations.dir).toBe("/app/migrations");
  });

  test("a plain object the schema describes is copied, not written to in place", () => {
    const schema = configSchema({ contract: { output: "path" } });
    const contract = { output: "./out.json" };

    const result = validateSectionWithSchema(
      "toy",
      schema,
      { contract },
      single,
    );

    expect(
      result.ok &&
        (result.value as { contract: { output: string } }).contract.output,
    ).toBe("/app/out.json");
    expect(contract.output).toBe("./out.json");
  });

  test("a plain object that refers back to itself is copied once", () => {
    const schema = configSchema({ node: "object", "out?": "path" });
    const node: { name: string; self?: unknown } = { name: "root" };
    node.self = node;

    const result = validateSectionWithSchema(
      "toy",
      schema,
      { node, out: "./o" },
      single,
    );

    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const value = result.value as { node: typeof node; out: string };
    expect(value.node.self).toBe(value.node);
    expect(value.out).toBe("/app/o");
  });

  test("a checked-only value survives a section whose root has a narrow and defaults", () => {
    const checkedOnly = configSchema("object").narrow(() => true);
    const schema = configSchema({
      family: checkedOnly,
      migrations: [
        { dir: ["path", "=", () => "./migrations"] },
        "=",
        () => ({}),
      ],
    }).narrow(() => true);
    const create = () => 1;
    const family = { kind: "family", create };

    const result = validateSectionWithSchema("toy", schema, { family }, single);

    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect((result.value as { family: typeof family }).family).toEqual(family);
    expect((result.value as { family: typeof family }).family.create).toBe(
      create,
    );
    expect(
      (result.value as { migrations: { dir: string } }).migrations.dir,
    ).toBe("/app/migrations");
  });

  test("a checked-only value with its own pipe keeps what the pipe produced", () => {
    const source = { load: () => 1, inputs: ["./a"] };
    const withResolvedInputs = configSchema("object")
      .narrow(() => true)
      .pipe((value) => ({ ...(value as object), inputs: ["/resolved/a"] }));
    const schema = configSchema({ source: withResolvedInputs, "out?": "path" });

    const result = validateSectionWithSchema(
      "toy",
      schema,
      { source, out: "./o" },
      single,
    );

    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const value = result.value as {
      source: { load: () => number; inputs: string[] };
      out: string;
    };
    expect(value.source.inputs).toEqual(["/resolved/a"]);
    expect(value.source.load).toBe(source.load);
    expect(value.out).toBe("/app/o");
  });

  test("a union resolves paths in the branch the value matches, keeping the rest", () => {
    const checkedOnly = configSchema("object").narrow(() => true);
    const schema = configSchema({
      either: [
        { kind: "'a'", "dir?": "path" },
        "|",
        { kind: "'b'", inner: checkedOnly },
      ],
    });
    const inner = { keep: () => 1 };

    const a = validateSectionWithSchema(
      "toy",
      schema,
      Object.freeze({ either: Object.freeze({ kind: "a", dir: "./d" }) }),
      single,
    );
    const b = validateSectionWithSchema(
      "toy",
      schema,
      { either: { kind: "b", inner } },
      single,
    );

    expect(a.ok && (a.value as { either: { dir: string } }).either.dir).toBe(
      "/app/d",
    );
    expect(
      b.ok && (b.value as { either: { inner: unknown } }).either.inner,
    ).toBe(inner);
  });

  test("a tuple resolves paths by position, prefix and postfix alike", () => {
    const checkedOnly = configSchema("object").narrow(() => true);
    const schema = configSchema({
      pair: ["path", checkedOnly],
      tail: ["path", "...", "object[]", "path"],
    });
    const second = new Date(1);
    const middle = new Date(2);

    const result = validateSectionWithSchema(
      "toy",
      schema,
      { pair: ["./first", second], tail: ["./head", middle, "./last"] },
      single,
    );

    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const value = result.value as {
      pair: [string, unknown];
      tail: [string, unknown, string];
    };
    expect(value.pair).toEqual(["/app/first", second]);
    expect(value.pair[1]).toBe(second);
    expect(value.tail).toEqual(["/app/head", middle, "/app/last"]);
    expect(value.tail[1]).toBe(middle);
  });

  test("a union no alternative matches fails as a field error, not a write to a frozen object", () => {
    const schema = configSchema({
      either: [
        { kind: "'a'", dir: ["path", "=", () => "./d"] },
        "|",
        { kind: "'b'" },
      ],
    });

    const result = validateSectionWithSchema(
      "toy",
      schema,
      Object.freeze({ either: Object.freeze({ kind: "c" }) }),
      single,
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.every(
        (diagnostic) => diagnostic.code === "CLI.CONFIG_FIELD_INVALID",
      ),
    ).toBe(true);
  });

  test("a pipe that returns an object of its own keeps it, rather than the input", () => {
    const replacement = { replaced: true };
    const schema = configSchema({
      nested: configSchema({ source: checkedOnlyValue }).pipe(() => ({
        source: replacement,
      })),
      "out?": "path",
    });
    const original = { keep: () => 1 };

    const result = validateSectionWithSchema(
      "toy",
      schema,
      { nested: { source: original }, out: "./o" },
      single,
    );

    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const value = result.value as {
      nested: { source: unknown };
      out: string;
    };
    expect(value.nested.source).toBe(replacement);
    expect(value.out).toBe("/app/o");
  });

  test("a symbol-keyed property a morph adds is kept", () => {
    const TAG = Symbol("tag");
    const schema = configSchema({
      tagged: configSchema({ n: "number" }).pipe((value) => ({
        ...value,
        [TAG]: true,
      })),
      "out?": "path",
    });

    const result = validateSectionWithSchema(
      "toy",
      schema,
      { tagged: { n: 1 }, out: "./o" },
      single,
    );

    expect(
      result.ok &&
        (result.value as { tagged: Record<symbol, unknown> }).tagged[TAG],
    ).toBe(true);
  });

  test("an index signature resolves every value it describes", () => {
    const schema = configSchema({ "[string]": "path" });

    const result = validateSectionWithSchema(
      "toy",
      schema,
      { a: "./x", b: "./y" },
      single,
    );

    expect(result.ok && result.value).toMatchObject({
      a: "/app/x",
      b: "/app/y",
    });
  });

  test("a default nested under a frozen declared object is applied without writing to the input", () => {
    const schema = configSchema({
      "given?": { "deeper?": { c: "string = 'w'" } },
    });
    const deeper = Object.freeze({});
    const given = Object.freeze({ deeper });
    const raw = Object.freeze({ given });

    const result = validateSectionWithSchema("toy", schema, raw, single);

    expect(result.ok && result.value).toMatchObject({
      given: { deeper: { c: "w" } },
    });
    expect("c" in deeper).toBe(false);
  });

  test("a value that is not a plain object keeps its identity and data", () => {
    const schema = configSchema({ when: "Date" });
    const when = new Date(0);

    const result = validateSectionWithSchema("toy", schema, { when }, single);

    expect(result.ok && result.value.when).toBe(when);
  });

  test("a validation started by a morph inside another does not lose the outer context", () => {
    const inner = configSchema({ dir: "path" });
    const outer = configSchema({
      first: type("string").pipe((value) => {
        validateSectionWithSchema("other", inner, { dir: "./inner" }, single);
        return value;
      }),
      dir: "path",
    });

    const result = validateSectionWithSchema(
      "toy",
      outer,
      { first: "x", dir: "./d" },
      single,
    );

    expect(result.ok && result.value).toMatchObject({ dir: "/app/d" });
  });

  test("an absent section validates as the empty section", () => {
    const result = validateSectionWithSchema("toy", toySchema, undefined, {
      files: [],
      keys: {},
    });

    expect(result).toEqual({
      ok: true,
      value: { greeting: "hello" },
      diagnostics: [],
    });
  });

  test("a wrong type is a diagnostic naming the field and the file to fix", () => {
    const result = validateSectionWithSchema(
      "toy",
      toySchema,
      { dir: 42, level: "high" },
      single,
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      {
        code: "CLI.CONFIG_FIELD_INVALID",
        severity: "error",
        summary: expect.stringContaining("dir must be a string"),
        nextActions: [
          {
            kind: "edit-file",
            label: "Correct toy.dir in /app/prisma.config.ts",
          },
        ],
        where: { path: "/app/prisma.config.ts" },
        meta: { section: "toy", field: "dir" },
      },
      expect.objectContaining({
        code: "CLI.CONFIG_FIELD_INVALID",
        meta: { section: "toy", field: "level" },
      }),
    ]);
  });

  test("a required field missing from an absent section is reported by name", () => {
    const schema = configSchema({ dir: "path" });

    const result = validateSectionWithSchema("toy", schema, undefined, {
      files: [],
      keys: {},
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.meta)).toEqual([
      { section: "toy", field: "dir" },
    ]);
  });

  test("validates a frozen value, as the engine hands a merged section over frozen", () => {
    const result = validateSectionWithSchema(
      "toy",
      toySchema,
      Object.freeze({ dir: "./d", nested: Object.freeze({ file: "./f" }) }),
      single,
    );

    expect(result.ok && result.value).toMatchObject({
      dir: "/app/d",
      nested: { file: "/app/f" },
    });
  });

  test("never throws on hostile input", () => {
    for (const raw of [
      null,
      7,
      "x",
      [],
      {
        dir: {
          get x() {
            throw new Error("boom");
          },
        },
      },
      { __proto__: { dir: 1 } },
    ]) {
      expect(() =>
        validateSectionWithSchema("toy", toySchema, raw, single),
      ).not.toThrow();
    }
  });

  test("the schema's own type is the validated value", () => {
    const section = defineConfigSection({ name: "toy", schema: toySchema });
    const result = section.validate({ dir: "./d" }, single);

    if (!result.ok) throw new Error("expected ok");
    const dir: string | undefined = result.value.dir;
    const greeting: string = result.value.greeting;
    expect({ dir, greeting }).toEqual({ dir: "/app/d", greeting: "hello" });
  });
});

describe("a schema-declared section on a discovery chain", {
  timeout: 60_000,
}, () => {
  const chain = join(FIXTURES, "schema-chain");
  const child = join(chain, "child");

  function probe() {
    const section = defineConfigSection({ name: "toy", schema: toySchema });
    return createTestCli({
      commands: {
        probe: defineCommand({
          help: { summary: "Reports the validated toy section" },
          needs: { config: section },
          handler: async (_args, ctx) =>
            ok(
              ctx.present(
                { data: ctx.config, exitCode: 0 },
                {
                  human: () => [],
                  stdout: () => [],
                  json: () => ctx.config,
                  next: () => [],
                },
              ),
            ),
        }),
      },
      loadConfig: (request) => loadConfig(child, request),
    });
  }

  test("each path resolves against the file that declared it; baseDir is the nearest file's", async () => {
    const run = await probe().run(["probe", "--json"], { cwd: child });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toEqual({
      dir: join(chain, "migrations"),
      greeting: "from the parent",
      out: join(child, "dist"),
      inputs: [join(child, "a.prisma"), "/abs/b.prisma"],
      baseDir: child,
    });
  });
});
