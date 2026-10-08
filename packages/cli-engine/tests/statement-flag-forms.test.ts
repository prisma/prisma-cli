/**
 * The flag forms the engine prints are safe to paste into a shell and
 * accepted when pasted back: a value with anything but plain
 * characters is single-quoted, and a value starting with `-` is joined
 * with `=`.
 */
import { defineCommand, type PromptSurface } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli, type TestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

function cliAsking(subject: string) {
  const ask = (prompt: PromptSurface) =>
    prompt.statement(`What happens to ${subject}?`, {
      subject,
      verbs: ["delete"],
      validate: () => undefined,
    });
  const probe = defineCommand({
    help: { summary: "Statement probe" },
    statements: { delete: { arity: 1 } },
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

describe("printed flag forms", () => {
  test.each([
    ["a plain subject", "Legacy", "Pass --delete Legacy"],
    ["a subject with ':' and '.'", "User.name:x", "Pass --delete User.name:x"],
    [
      "a subject a shell would run part of",
      'a b:c"d--$é; DROP TABLE Profile',
      `Pass --delete 'a b:c"d--$é; DROP TABLE Profile'`,
    ],
    ["a subject with a single quote", "it's", `Pass --delete 'it'\\''s'`],
    ["a subject starting with '-'", "-rf", "Pass --delete=-rf"],
    [
      "a subject starting with '-' that needs quoting",
      "-r f",
      "Pass --delete='-r f'",
    ],
  ])("%s", async (_case, subject, label) => {
    const result = await cliAsking(subject).run(["probe", "--json"]);

    expect(errorOf(result)?.nextActions).toEqual([
      { kind: "user-choice", label },
    ]);
  });

  test("the form printed for a subject starting with '-' is accepted back", async () => {
    const result = await cliAsking("-rf").run(["probe", "--delete=-rf"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      answer: { verb: "delete", text: "-rf", values: ["-rf"] },
    });
  });

  test("a leftover value is quoted in the error too", async () => {
    const result = await cliAsking("Legacy").run([
      "probe",
      "--delete",
      "Legacy",
      "--delete",
      "x; rm",
      "--json",
    ]);

    expect(errorOf(result)?.summary).toBe(
      "--delete 'x; rm' was given but nothing in this run asked about x; rm.",
    );
  });
});

describe("a refusal listing several questions", () => {
  test("indents every line of why", async () => {
    const probe = defineCommand({
      help: { summary: "Statement probe" },
      statements: { delete: { arity: 1 } },
      handler: async (_args, ctx) => {
        await ctx.prompt.statements(
          ["A", "B"].map((subject) => ({
            question: `What happens to ${subject}?`,
            subject,
            verbs: ["delete"],
            validate: () => undefined,
          })),
        );
        return ok(
          ctx.present(
            { data: {} },
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
    const result = await createTestCli({ commands: { probe } }).run([
      "probe",
      "--format",
      "human",
    ]);

    expect(result.stderr).toContain(
      "  why: What happens to A?\n       What happens to B?\n",
    );
  });
});
