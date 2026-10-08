/**
 * A consent flag that answered nothing fails the run: a statement value
 * no question matched, or a `--confirm` token no consent asked for.
 * The refusal for a statement batch reports them up front, so a
 * misspelled flag is not found only after the user has answered.
 */
import { defineCommand, type PromptSurface } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli, type TestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

function cliWith(ask: (prompt: PromptSurface) => Promise<unknown>) {
  const probe = defineCommand({
    help: { summary: "Consent probe" },
    statements: { rename: { arity: 1 }, delete: { arity: 1 } },
    handler: async (_args, ctx) => {
      const answer = await ask(ctx.prompt);
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

function question(subject: string) {
  return {
    question: `What happens to ${subject}?`,
    subject,
    verbs: ["rename", "delete"],
    validate: () => undefined,
  } as const;
}

const askBoth = (prompt: PromptSurface) =>
  prompt.statements([question("Legacy"), question("User.nickname")]);

describe("an unconsumed --confirm token", () => {
  test("is ignored on a command that declares no statements", async () => {
    const plain = defineCommand({
      help: { summary: "Plain probe" },
      handler: async (_args, ctx) =>
        ok(
          ctx.present(
            { data: {} },
            {
              human: () => [],
              stdout: () => [],
              json: () => ({}),
              next: () => [],
            },
          ),
        ),
    });
    const result = await createTestCli({ commands: { plain } }).run([
      "plain",
      "--confirm",
      "mydb",
    ]);

    expect(result.exitCode).toBe(0);
  });

  test("fails a run that otherwise succeeded on a command that declares statements", async () => {
    const result = await cliWith(async () => "nothing asked").run([
      "probe",
      "--confirm",
      "mydb",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)).toEqual({
      code: "CLI.CONSENT_UNUSED",
      severity: "error",
      summary: "--confirm mydb answers no consent in this run.",
      nextActions: [
        {
          kind: "user-choice",
          label: "Remove the --confirm flag: nothing in this run asks for it.",
        },
      ],
      meta: { unused: [], confirm: ["mydb"] },
    });
  });

  test("is reported with a statement refusal, which says a statement flag answers it", async () => {
    const result = await cliWith(askBoth).run([
      "probe",
      "--confirm",
      "mydb",
      "--json",
    ]);

    expect(errorOf(result)).toMatchObject({
      code: "CLI.CONSENT_REQUIRED",
      why: "What happens to Legacy?\nWhat happens to User.nickname?\n--confirm mydb answers no consent in this run; a statement flag is what answers these questions.",
      meta: { confirm: ["mydb"] },
    });
  });
});

describe("a statement value that matches no question", () => {
  test("is reported with the refusal, naming the subjects asked about", async () => {
    const result = await cliWith(askBoth).run([
      "probe",
      "--delete",
      "Legcy",
      "--json",
    ]);

    expect(errorOf(result)).toMatchObject({
      code: "CLI.CONSENT_REQUIRED",
      why: "What happens to Legacy?\nWhat happens to User.nickname?\n--delete Legcy answers no question; the questions are about Legacy, User.nickname.",
      meta: { unmatched: [{ verb: "delete", values: ["Legcy"] }] },
    });
  });

  test("is reported as unused with the subjects the run asked about", async () => {
    const result = await cliWith((prompt) =>
      prompt.statements([question("Legacy")]),
    ).run(["probe", "--delete", "Legacy", "--delete", "Legcy", "--json"]);

    expect(errorOf(result)).toMatchObject({
      code: "CLI.CONSENT_UNUSED",
      why: "The run asked about Legacy.",
      meta: { asked: ["Legacy"] },
    });
  });
});

describe("--confirm alongside statements", () => {
  test("a token a consent consumed fails nothing on a statement command", async () => {
    const result = await cliWith((prompt) =>
      prompt.consent("Drop the database?", { token: "mydb" }),
    ).run(["probe", "--confirm", "mydb"]);

    expect(result.exitCode).toBe(0);
  });

  test("an unused token fails at a last batch, before the command acts", async () => {
    const acted: string[] = [];
    const result = await cliWith(async (prompt) => {
      await prompt.statements([question("Legacy")], { last: true });
      acted.push("applied");
    }).run(["probe", "--delete", "Legacy", "--confirm", "mydb", "--json"]);

    expect(errorOf(result)?.summary).toBe(
      "--confirm mydb answers no consent in this run.",
    );
    expect(acted).toEqual([]);
  });

  test("on a command without statements, a mistyped token then the right one typed succeeds", async () => {
    const plain = defineCommand({
      help: { summary: "Plain probe" },
      handler: async (_args, ctx) => {
        const answer = await ctx.prompt.consent("Drop the database?", {
          token: "prod-db",
        });
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
    const result = await createTestCli({ commands: { plain } }).run(
      ["plain", "--confirm", "prdo-db"],
      { isTty: { stdin: true, stdout: true }, stdin: "prod-db\n" },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: true });
  });
});
