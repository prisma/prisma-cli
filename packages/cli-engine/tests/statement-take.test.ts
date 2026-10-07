/**
 * ctx.statements.take(verb): a verb's values as the command's own
 * input, taken before anything is asked, in argv order. Taken values
 * are consumed; other verbs' values stay for the questions.
 */
import {
  type CommandContext,
  defineCommand,
  type StatementSpec,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli, type TestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

const VERBS = { rename: { arity: 1 }, delete: { arity: 1 } } as const;

function cliWith(
  run: (ctx: CommandContext<undefined, never>) => Promise<unknown>,
  statements: Readonly<Record<string, StatementSpec>> = VERBS,
) {
  const probe = defineCommand({
    help: { summary: "Statement probe" },
    statements,
    handler: async (_args, ctx) => {
      const answer = await run(ctx);
      return ok(
        ctx.present(
          { data: { answer } },
          {
            human: () => [],
            stdout: () => [],
            json: () => ({ answer }),
            next: () => [],
          },
        ),
      );
    },
  });
  return createTestCli({ commands: { probe } });
}

function errorOf(result: Awaited<ReturnType<TestCli["run"]>>) {
  const last = result.json[result.json.length - 1];
  return last.kind === "result" && !last.envelope.ok
    ? last.envelope.error
    : undefined;
}

describe("ctx.statements.take", () => {
  test("returns one verb's values in argv order and leaves the others for the questions", async () => {
    const result = await cliWith(async (ctx) => {
      const renames = ctx.statements.take("rename");
      const [drop] = await ctx.prompt.statements([
        {
          question: "What happens to Legacy?",
          subject: "Legacy",
          verbs: ["delete"],
          validate: () => undefined,
        },
      ]);
      return { renames, drop };
    }).run([
      "probe",
      "--rename",
      "A:B",
      "--delete",
      "Legacy",
      "--rename",
      "C:D",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      answer: {
        renames: [
          { verb: "rename", text: "A:B", values: ["A:B"] },
          { verb: "rename", text: "C:D", values: ["C:D"] },
        ],
        drop: { verb: "delete", text: "Legacy", values: ["Legacy"] },
      },
    });
  });

  test("taken values are not reported unused", async () => {
    const result = await cliWith(async (ctx) =>
      ctx.statements.take("rename"),
    ).run(["probe", "--rename", "A:B"]);

    expect(result.exitCode).toBe(0);
  });

  test("a value no question or take consumed is still reported", async () => {
    const result = await cliWith(async (ctx) =>
      ctx.statements.take("rename"),
    ).run(["probe", "--rename", "A:B", "--delete", "Legacy", "--json"]);

    expect(errorOf(result)?.code).toBe("CLI.CONSENT_UNUSED");
  });

  test("a second take of the same verb finds nothing left", async () => {
    const result = await cliWith(async (ctx) => [
      ctx.statements.take("rename"),
      ctx.statements.take("rename"),
    ]).run(["probe", "--rename", "A:B"]);

    expect(result.presented?.data).toEqual({
      answer: [[{ verb: "rename", text: "A:B", values: ["A:B"] }], []],
    });
  });

  test("taking a verb the command did not declare is a construction error", async () => {
    const result = await cliWith(async (ctx) =>
      ctx.statements.take("archive"),
    ).run(["probe", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(errorOf(result)?.summary).toContain(
      "took verb 'archive', which it does not declare in statements",
    );
  });
});

describe("a subject containing ':'", () => {
  test("is answered by a value equal to it", async () => {
    const result = await cliWith(async (ctx) =>
      ctx.prompt.statement("What happens to Legacy:Archive?", {
        subject: "Legacy:Archive",
        verbs: ["delete"],
        validate: () => undefined,
      }),
    ).run(["probe", "--delete", "Legacy:Archive"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      answer: {
        verb: "delete",
        text: "Legacy:Archive",
        values: ["Legacy:Archive"],
      },
    });
  });
});
