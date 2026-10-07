/**
 * A command declares the statements it may ask for. Only that command
 * accepts their flags, its handler never sees their values, and a
 * declaration that would clash with another flag fails construction.
 */
import {
  defineCommand,
  flag,
  type PromptSurface,
  type StatementSpec,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli, type TestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

function command(
  statements: Readonly<Record<string, StatementSpec>>,
  ask: (prompt: PromptSurface) => Promise<unknown> = async () => undefined,
) {
  return defineCommand({
    help: { summary: "Statement probe" },
    args: { flags: { name: flag.string({ brief: "A name" }) } },
    statements,
    handler: async (args, ctx) => {
      const answer = await ask(ctx.prompt);
      return ok(
        ctx.present(
          { data: { flags: args.flags, answer } },
          {
            human: () => [],
            stdout: () => [],
            json: () => ({}),
            next: () => [],
          },
        ),
      );
    },
  });
}

const DELETE = { delete: { arity: 1 } } as const;

function errorOf(result: Awaited<ReturnType<TestCli["run"]>>) {
  const last = result.json[result.json.length - 1];
  return last.kind === "result" && !last.envelope.ok
    ? last.envelope.error
    : undefined;
}

describe("a statement flag belongs to the command that declares it", () => {
  test("another command does not accept it", async () => {
    const cli = createTestCli({
      commands: { probe: command(DELETE), other: command({}) },
    });
    const result = await cli.run(["other", "--delete", "Legacy", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)?.code).toBe("CLI.INVALID_ARGUMENTS");
  });

  test("the handler never sees its values", async () => {
    const answerDelete = (prompt: PromptSurface) =>
      prompt.statement("Drop Legacy?", {
        subject: "Legacy",
        verbs: ["delete"],
        validate: () => undefined,
      });
    const cli = createTestCli({
      commands: { probe: command(DELETE, answerDelete) },
    });
    const result = await cli.run(["probe", "--delete", "Legacy"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      flags: { name: undefined },
      answer: { verb: "delete", text: "Legacy" },
    });
  });

  test("help lists it only on the command that declares it", async () => {
    const cli = createTestCli({
      commands: {
        probe: command({
          delete: { arity: 1, brief: "Drop the table and its rows" },
        }),
        other: command({}),
      },
    });
    const declaring = await cli.run(["probe", "--help", "--format", "human"]);
    const other = await cli.run(["other", "--help", "--format", "human"]);

    expect(declaring.stdout).toContain("--delete <subject>...");
    expect(declaring.stdout).toContain("Drop the table and its rows");
    expect(other.stdout).not.toContain("--delete");
  });

  test("a statement naming a verb the command did not declare is a construction error", async () => {
    const undeclared = (prompt: PromptSurface) =>
      prompt.statement("Archive it?", {
        subject: "Legacy",
        verbs: ["archive"],
        validate: () => undefined,
      });
    const cli = createTestCli({
      commands: { probe: command(DELETE, undeclared) },
    });
    const result = await cli.run(["probe", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(errorOf(result)?.summary).toContain(
      "verb 'archive', which it does not declare in statements",
    );
  });
});

describe("declarations that fail construction", () => {
  const clashes: ReadonlyArray<
    readonly [string, Record<string, StatementSpec>, string]
  > = [
    [
      "an ordinary flag with the same name",
      { name: { arity: 1 } },
      "command 'probe' declares both a flag and a statement named 'name'",
    ],
    [
      "a shared flag's name",
      { confirm: { arity: 1 } },
      "command 'probe' declares statement 'confirm', which is a shared flag",
    ],
    [
      "a name that is not camelCase",
      { "drop-table": { arity: 1 } },
      "command 'probe' statement 'drop-table' must be camelCase (it transliterates to --kebab-case on the CLI)",
    ],
  ];

  test.each(clashes)("%s", (_case, statements, message) => {
    expect(() =>
      createTestCli({ commands: { probe: command(statements) } }),
    ).toThrow(message);
  });

  test("an arity other than 1", () => {
    const pair = { arity: 2 } as unknown as StatementSpec;

    expect(() =>
      createTestCli({ commands: { probe: command({ rename: pair }) } }),
    ).toThrow(
      "command 'probe' statement 'rename' declares arity 2; only 1 is supported",
    );
  });
});
