/**
 * Statement prompts at their edges: the final ask, runs that end with
 * a child's status, malformed questions, verbs with several values,
 * and what reaches stderr, stdout and telemetry.
 */
import {
  defineCommand,
  exitWithChildStatus,
  type PromptSurface,
  type RunSummary,
  type StatementSpec,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli, type TestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

const VERBS = { rename: { arity: 1 }, delete: { arity: 1 } } as const;

function probe(
  ask: (prompt: PromptSurface) => Promise<unknown>,
  statements: Readonly<Record<string, StatementSpec>> = VERBS,
) {
  return defineCommand({
    help: { summary: "Statement probe" },
    statements,
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
}

function cliWith(
  ask: (prompt: PromptSurface) => Promise<unknown>,
  statements?: Readonly<Record<string, StatementSpec>>,
) {
  return createTestCli({ commands: { probe: probe(ask, statements) } });
}

function errorOf(result: Awaited<ReturnType<TestCli["run"]>>) {
  const last = result.json[result.json.length - 1];
  return last.kind === "result" && !last.envelope.ok
    ? last.envelope.error
    : undefined;
}

function legacy(subject = "Legacy") {
  return {
    question: `What happens to ${subject}?`,
    subject,
    verbs: ["rename", "delete"],
    validate: () => undefined,
  } as const;
}

describe("statements(questions, { last: true })", () => {
  const acted: string[] = [];
  const finalAsk = async (prompt: PromptSurface) => {
    const answers = await prompt.statements([legacy()], { last: true });
    acted.push("applied");
    return answers;
  };

  test("an unconsumed value fails before the command acts on the answers", async () => {
    acted.length = 0;
    const result = await cliWith(finalAsk).run([
      "probe",
      "--delete",
      "Legacy",
      "--delete",
      "Other",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)?.summary).toBe(
      "--delete Other was given but nothing in this run asked about Other.",
    );
    expect(acted).toEqual([]);
  });

  test("with nothing left over the command goes on", async () => {
    acted.length = 0;
    const result = await cliWith(finalAsk).run(["probe", "--delete", "Legacy"]);

    expect(result.exitCode).toBe(0);
    expect(acted).toEqual(["applied"]);
  });
});

describe("a run that ends with a child's status", () => {
  const spawning = defineCommand({
    help: { summary: "Spawning probe" },
    maySpawn: true,
    statements: VERBS,
    handler: async (_args, ctx) => {
      await ctx.spawn({ command: "child" });
      return ok(exitWithChildStatus());
    },
  });

  test("a child that exited 0 leaves the unused value to fail the run", async () => {
    const cli = createTestCli({
      commands: { probe: spawning },
      spawnScript: () => ({ exitCode: 0, signal: null }),
    });
    const result = await cli.run(["probe", "--delete", "X", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)?.code).toBe("CLI.CONSENT_UNUSED");
  });

  test("a child that failed reports its own status only", async () => {
    const cli = createTestCli({
      commands: { probe: spawning },
      spawnScript: () => ({ exitCode: 4, signal: null }),
    });
    const result = await cli.run(["probe", "--delete", "X", "--json"]);

    expect(result.exitCode).toBe(4);
    expect(errorOf(result)?.code).toBe("CLI.CHILD_PROCESS_FAILED");
  });
});

describe("a malformed question is a construction error", () => {
  test.each([
    [
      "no verbs",
      { ...legacy(), verbs: [] },
      "asked a statement about 'Legacy' with no verbs",
    ],
    [
      "a verb listed twice",
      { ...legacy(), verbs: ["delete", "delete"] },
      "asked a statement about 'Legacy' listing a verb twice",
    ],
    [
      "a subject containing ':'",
      legacy("Legacy:Archive"),
      "a subject must be non-empty and contain no ':'",
    ],
    [
      "an empty subject",
      legacy(""),
      "a subject must be non-empty and contain no ':'",
    ],
  ])("%s", async (_case, question, message) => {
    const result = await cliWith((prompt) => prompt.statements([question])).run(
      ["probe", "--json"],
    );

    expect(result.exitCode).toBe(1);
    expect(errorOf(result)?.summary).toContain(message);
  });
});

describe("a verb with several values", () => {
  const MOVE = { move: { arity: 2 } };
  const askMove = (prompt: PromptSurface) =>
    prompt.statement("Where does Legacy go?", {
      subject: "Legacy",
      verbs: ["move"],
      validate: () => undefined,
    });

  test("the flag takes that many values", async () => {
    const result = await cliWith(askMove, MOVE).run([
      "probe",
      "--move",
      "Legacy",
      "archive",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      answer: {
        verb: "move",
        text: "Legacy archive",
        values: ["Legacy", "archive"],
      },
    });
  });

  test("too few values is an argument error", async () => {
    const result = await cliWith(askMove, MOVE).run([
      "probe",
      "--move",
      "Legacy",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)).toMatchObject({
      code: "CLI.INVALID_ARGUMENTS",
      summary: "--move needs 2 values, and was given 1.",
    });
  });

  test("an interactive answer gives them separated by spaces", async () => {
    const result = await cliWith(askMove, MOVE).run(["probe"], {
      isTty: { stdin: true },
      answers: ["move Legacy archive"],
    });

    expect(result.presented?.data).toEqual({
      answer: {
        verb: "move",
        text: "Legacy archive",
        values: ["Legacy", "archive"],
      },
    });
  });

  test("an interactive answer's text is its values joined by one space", async () => {
    const seen: string[] = [];
    const askMoveRecording = (prompt: PromptSurface) =>
      prompt.statement("Where does Legacy go?", {
        subject: "Legacy",
        verbs: ["move"],
        validate: (_verb, text) => {
          seen.push(text);
          return undefined;
        },
      });
    const result = await cliWith(askMoveRecording, MOVE).run(["probe"], {
      isTty: { stdin: true },
      answers: ["move Legacy    archive"],
    });

    expect(seen).toEqual(["Legacy archive"]);
    expect(result.presented?.data).toEqual({
      answer: {
        verb: "move",
        text: "Legacy archive",
        values: ["Legacy", "archive"],
      },
    });
  });

  test("an interactive answer with the wrong count fails the line renderer", async () => {
    const result = await cliWith(askMove, MOVE).run(["probe", "--json"], {
      isTty: { stdin: true },
      answers: ["move Legacy"],
    });

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)?.summary).toBe(
      '"move Legacy" is not a valid answer to "Where does Legacy go?": Give 2 values after move.',
    );
  });
});

describe("what each channel sees", () => {
  const askLegacy = (prompt: PromptSurface) => prompt.statements([legacy()]);

  test("an empty value is an argument error", async () => {
    const result = await cliWith(askLegacy).run([
      "probe",
      "--delete",
      "",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)).toMatchObject({
      code: "CLI.INVALID_ARGUMENTS",
      summary: "--delete was given an empty value.",
    });
  });

  test("an argument error names the command and fires the run summary", async () => {
    const summaries: RunSummary[] = [];
    const result = await cliWith(askLegacy).run(
      ["probe", "--delete", "", "--json"],
      { onSettled: (summary) => summaries.push(summary) },
    );

    const last = result.json[result.json.length - 1];
    expect(last.kind === "result" && last.envelope.commandId).toBe("probe");
    expect(summaries).toMatchObject([{ commandId: "probe", exitCode: 2 }]);
  });

  test("a value starting with '-' must be written with '='", async () => {
    const result = await cliWith(askLegacy).run([
      "probe",
      "--delete",
      "-1",
      "--json",
    ]);

    expect(errorOf(result)).toMatchObject({
      code: "CLI.INVALID_ARGUMENTS",
      summary:
        "--delete needs a value, and was given 0. A value that starts with '-' must be written --delete=<value>.",
      nextActions: [{ kind: "user-choice", label: "Write --delete=<value>." }],
    });
  });

  test("a value starting with '-' written with '=' answers", async () => {
    const result = await cliWith((prompt) =>
      prompt.statements([legacy("-x")]),
    ).run(["probe", "--rename=-x"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      answer: [{ verb: "rename", text: "-x", values: ["-x"] }],
    });
  });

  test("a kebab-case spelling of a camelCase command still takes its statements", async () => {
    const cli = createTestCli({
      commands: {
        fooBar: probe((prompt) => prompt.statements([legacy()])),
      },
    });
    const result = await cli.run(["foo-bar", "--delete", "Legacy"]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      answer: [{ verb: "delete", text: "Legacy", values: ["Legacy"] }],
    });
  });

  test("a json run on a terminal prompts on stderr and keeps stdout to frames", async () => {
    const result = await cliWith(askLegacy).run(["probe", "--json"], {
      isTty: { stdin: true },
      stdin: "delete\n",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("? What happens to Legacy? (rename/delete) ");
    for (const line of result.stdout.trim().split("\n")) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  test("telemetry records the flag's name and never its value", async () => {
    const summaries: RunSummary[] = [];
    await cliWith(async () => undefined).run(
      ["probe", "--delete", "SecretTable", "--json"],
      { onSettled: (summary) => summaries.push(summary) },
    );

    expect(summaries[0].snapshot.flags).toContainEqual({
      name: "delete",
      source: "cli",
    });
    expect(JSON.stringify(summaries)).not.toContain("SecretTable");
  });
});
