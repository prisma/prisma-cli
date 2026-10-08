/**
 * Subjects that are prefixes of one another, asked in one batch: a
 * value goes to the subject it equals, and otherwise to the longest
 * subject it names, whatever the order of argv or of the questions.
 */
import { defineCommand } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli, type TestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

function question(subject: string) {
  return {
    question: `What happens to ${subject}?`,
    subject,
    verbs: ["rename", "delete"],
    validate: () => undefined,
  } as const;
}

function cliAsking(subjects: readonly string[]) {
  const probe = defineCommand({
    help: { summary: "Statement probe" },
    statements: { rename: { arity: 1 }, delete: { arity: 1 } },
    handler: async (_args, ctx) => {
      const answer = await ctx.prompt.statements(subjects.map(question));
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

function deleting(text: string) {
  return { verb: "delete", text, values: [text] };
}

describe("subjects that prefix one another, in one batch", () => {
  test("a value for A:B does not answer A", async () => {
    const result = await cliAsking(["A", "A:B"]).run([
      "probe",
      "--delete",
      "A:B",
      "--json",
    ]);

    expect(errorOf(result)).toMatchObject({
      code: "CLI.CONSENT_REQUIRED",
      meta: { unanswered: [{ subject: "A" }] },
    });
  });

  test.each([
    [
      ["A", "A:B"],
      ["--delete", "A:B", "--delete", "A"],
    ],
    [
      ["A", "A:B"],
      ["--delete", "A", "--delete", "A:B"],
    ],
    [
      ["A:B", "A"],
      ["--delete", "A:B", "--delete", "A"],
    ],
    [
      ["A:B", "A"],
      ["--delete", "A", "--delete", "A:B"],
    ],
  ])("questions %j with %j each get their own value", async (subjects, flags) => {
    const result = await cliAsking(subjects).run(["probe", ...flags]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      answer: subjects.map(deleting),
    });
  });

  test("a value naming only the shorter subject still answers it", async () => {
    const result = await cliAsking(["A", "A:B"]).run([
      "probe",
      "--rename",
      "A:Z",
      "--delete",
      "A:B",
    ]);

    expect(result.presented?.data).toEqual({
      answer: [
        { verb: "rename", text: "A:Z", values: ["A:Z"] },
        deleting("A:B"),
      ],
    });
  });

  test("an interactive run asks about A rather than answering it with A:B's value", async () => {
    const result = await cliAsking(["A", "A:B"]).run(
      ["probe", "--delete", "A:B"],
      { isTty: { stdin: true }, stdin: "rename A:C\n" },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("? What happens to A? (rename or delete) ");
    expect(result.presented?.data).toEqual({
      answer: [
        { verb: "rename", text: "A:C", values: ["A:C"] },
        deleting("A:B"),
      ],
    });
  });

  test("a leftover value is reported against the longest subject it names", async () => {
    const result = await cliAsking(["A", "A:B"]).run([
      "probe",
      "--delete",
      "A",
      "--delete",
      "A:B",
      "--delete",
      "A:B",
      "--json",
    ]);

    expect(errorOf(result)?.summary).toBe(
      "--delete A:B was given, but the question about A:B was already answered by another flag.",
    );
  });
});
