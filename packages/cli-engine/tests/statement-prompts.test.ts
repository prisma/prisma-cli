/**
 * prompt.statement and prompt.statements: a consent answered with a
 * verb and free text. A matching verb flag answers before anything
 * renders; otherwise a non-interactive run or --yes refuses with
 * CLI.CONSENT_REQUIRED, and an interactive run asks. A verb-flag value
 * nothing consumed fails an otherwise successful run.
 */
import {
  type Block,
  defineCommand,
  defineCommandFamily,
  flag,
  type PromptSurface,
} from "@prisma/cli-engine";
import { CliStructuredError, notOk, ok } from "@prisma/cli-engine/protocol";
import { createTestCli, type TestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

const EPOCH = () => new Date(0);
const INTERACTIVE = { isTty: { stdin: true, stdout: true } };

function probe(ask: (prompt: PromptSurface) => Promise<unknown>) {
  return defineCommand({
    help: { summary: "Statement probe" },
    handler: async (_args, ctx) => {
      const answer = await ask(ctx.prompt);
      return ok(
        ctx.present(
          { data: { answer } },
          {
            human: (): readonly Block[] => [
              {
                kind: "summary",
                status: "ok",
                text: `answer=${JSON.stringify(answer)}`,
              },
            ],
            stdout: () => [],
            json: () => ({ answer }),
            next: () => [],
          },
        ),
      );
    },
  });
}

function cliWith(ask: (prompt: PromptSurface) => Promise<unknown>) {
  const command = probe(ask);
  return createTestCli({
    commandFamilies: [
      defineCommandFamily({
        commands: { probe: command },
        statementVerbs: ["rename", "delete"],
      }),
    ],
    commands: { probe: command },
    now: EPOCH,
  });
}

const LEGACY_QUESTION =
  'Table "Legacy" would be dropped and its rows lost. What do you mean?';
const USER_NAME_QUESTION =
  'Column "User.name" would be dropped. What do you mean?';

function renameCheck(subject: string) {
  return (verb: "rename" | "delete", text: string) =>
    verb === "rename" && !text.startsWith(`${subject}:`)
      ? `Write the rename as ${subject}:<new name>.`
      : undefined;
}

const legacyQuestion = {
  question: LEGACY_QUESTION,
  subject: "Legacy",
  verbs: ["rename", "delete"],
  forms: { rename: "Legacy:<new name>" },
  validate: renameCheck("Legacy"),
} as const;

const userNameQuestion = {
  question: USER_NAME_QUESTION,
  subject: "User.name",
  verbs: ["rename", "delete"],
  forms: { rename: "User.name:<new name>" },
  validate: renameCheck("User.name"),
} as const;

const askLegacy = (prompt: PromptSurface) =>
  prompt.statement(LEGACY_QUESTION, legacyQuestion);

const askBoth = (prompt: PromptSurface) =>
  prompt.statements([legacyQuestion, userNameQuestion]);

function errorOf(result: Awaited<ReturnType<TestCli["run"]>>) {
  const last = result.json[result.json.length - 1];
  return last.kind === "result" && !last.envelope.ok
    ? last.envelope.error
    : undefined;
}

describe("a verb flag answers the statement", () => {
  test("--delete Legacy answers without rendering anything", async () => {
    const result = await cliWith(askLegacy).run([
      "probe",
      "--delete",
      "Legacy",
      "--format",
      "human",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      answer: { verb: "delete", text: "Legacy" },
    });
    expect(result.stderr).toBe('✔ answer={"verb":"delete","text":"Legacy"}\n');
  });

  test("a value that starts with the subject and a colon names it", async () => {
    const result = await cliWith(askLegacy).run([
      "probe",
      "--rename=Legacy:Archive",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      answer: { verb: "rename", text: "Legacy:Archive" },
    });
  });

  test("the flag answers a json run on a terminal without prompting", async () => {
    const result = await cliWith(askLegacy).run(
      ["probe", "--delete", "Legacy", "--json"],
      INTERACTIVE,
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      answer: { verb: "delete", text: "Legacy" },
    });
    expect(result.stderr).toBe("");
  });

  test("the flag answers under --yes", async () => {
    const result = await cliWith(askLegacy).run([
      "probe",
      "--yes",
      "--delete",
      "Legacy",
    ]);

    expect(result.exitCode).toBe(0);
  });

  test("a value naming a longer subject does not answer", async () => {
    const result = await cliWith(askLegacy).run([
      "probe",
      "--delete",
      "LegacyArchive",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)?.code).toBe("CLI.CONSENT_REQUIRED");
  });

  test("a value the command rejects fails the run with its message", async () => {
    const result = await cliWith(askLegacy).run([
      "probe",
      "--rename",
      "Legacy",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)).toEqual({
      code: "CLI.PROMPT_INVALID",
      severity: "error",
      summary: `--rename Legacy does not answer "${LEGACY_QUESTION}": Write the rename as Legacy:<new name>.`,
      nextActions: [],
    });
  });
});

describe("without a flag, a non-interactive run refuses", () => {
  test("the refusal names the subject and one flag form per verb", async () => {
    const result = await cliWith(askLegacy).run(["probe", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)).toEqual({
      code: "CLI.CONSENT_REQUIRED",
      severity: "error",
      summary:
        '"Legacy" needs a statement, and the session is not interactive.',
      why: LEGACY_QUESTION,
      nextActions: [
        { kind: "user-choice", label: "Pass --rename Legacy:<new name>" },
        { kind: "user-choice", label: "Pass --delete Legacy" },
      ],
      meta: {
        subject: "Legacy",
        verbs: ["rename", "delete"],
        unanswered: [{ subject: "Legacy", verbs: ["rename", "delete"] }],
      },
    });
  });

  test("--yes does not answer it, even on a terminal", async () => {
    const result = await cliWith(askLegacy).run(
      ["probe", "--yes", "--json"],
      INTERACTIVE,
    );

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)?.summary).toBe(
      '"Legacy" needs a statement, which --yes cannot give.',
    );
  });

  test("the human refusal prints each flag form as a next action", async () => {
    const result = await cliWith(askLegacy).run(["probe", "--format", "human"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("[CLI.CONSENT_REQUIRED]");
    expect(result.stderr).toContain("Pass --rename Legacy:<new name>");
    expect(result.stderr).toContain("Pass --delete Legacy");
  });
});

describe("an interactive run asks", () => {
  test("a bare verb answers with the subject", async () => {
    const result = await cliWith(askLegacy).run(["probe"], {
      ...INTERACTIVE,
      answers: ["delete"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      answer: { verb: "delete", text: "Legacy" },
    });
  });

  test("a verb with text answers with that text", async () => {
    const result = await cliWith(askLegacy).run(["probe"], {
      ...INTERACTIVE,
      answers: ["rename Legacy:Archive"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      answer: { verb: "rename", text: "Legacy:Archive" },
    });
  });

  test("the line renderer shows the question and the verbs", async () => {
    const result = await cliWith(askLegacy).run(["probe"], {
      isTty: { stdin: true },
      stdin: "delete\n",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(`? ${LEGACY_QUESTION} (rename/delete) `);
  });

  test("an unknown verb fails the line renderer", async () => {
    const result = await cliWith(askLegacy).run(["probe", "--json"], {
      ...INTERACTIVE,
      answers: ["drop Legacy"],
    });

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)?.summary).toBe(
      `"drop Legacy" is not a valid answer to "${LEGACY_QUESTION}": Start the answer with rename or delete.`,
    );
  });

  test("an answer the command rejects fails the line renderer with its message", async () => {
    const result = await cliWith(askLegacy).run(["probe", "--json"], {
      ...INTERACTIVE,
      answers: ["rename Archive"],
    });

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)).toMatchObject({
      code: "CLI.PROMPT_INVALID",
      summary: `"rename Archive" is not a valid answer to "${LEGACY_QUESTION}": Write the rename as Legacy:<new name>.`,
    });
  });
});

describe("prompt.statements asks several questions together", () => {
  test("a flag answers one, and the refusal lists only the other", async () => {
    const result = await cliWith(askBoth).run([
      "probe",
      "--delete",
      "Legacy",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)).toMatchObject({
      code: "CLI.CONSENT_REQUIRED",
      summary:
        '"User.name" needs a statement, and the session is not interactive.',
      nextActions: [
        { kind: "user-choice", label: "Pass --rename User.name:<new name>" },
        { kind: "user-choice", label: "Pass --delete User.name" },
      ],
      meta: {
        unanswered: [{ subject: "User.name", verbs: ["rename", "delete"] }],
      },
    });
  });

  test("one refusal lists every unanswered question", async () => {
    const result = await cliWith(askBoth).run(["probe", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)).toEqual({
      code: "CLI.CONSENT_REQUIRED",
      severity: "error",
      summary:
        '2 subjects need a statement, and the session is not interactive: "Legacy", "User.name".',
      why: `${LEGACY_QUESTION}\n${USER_NAME_QUESTION}`,
      nextActions: [
        { kind: "user-choice", label: "Pass --rename Legacy:<new name>" },
        { kind: "user-choice", label: "Pass --delete Legacy" },
        { kind: "user-choice", label: "Pass --rename User.name:<new name>" },
        { kind: "user-choice", label: "Pass --delete User.name" },
      ],
      meta: {
        unanswered: [
          { subject: "Legacy", verbs: ["rename", "delete"] },
          { subject: "User.name", verbs: ["rename", "delete"] },
        ],
      },
    });
  });

  test("flags answer every question, in any order", async () => {
    const result = await cliWith(askBoth).run([
      "probe",
      "--delete",
      "User.name",
      "--rename",
      "Legacy:Archive",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      answer: [
        { verb: "rename", text: "Legacy:Archive" },
        { verb: "delete", text: "User.name" },
      ],
    });
  });

  test("an interactive run asks the unanswered questions in order", async () => {
    const result = await cliWith(askBoth).run(["probe"], {
      isTty: { stdin: true },
      stdin: "rename Legacy:Archive\ndelete\n",
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      answer: [
        { verb: "rename", text: "Legacy:Archive" },
        { verb: "delete", text: "User.name" },
      ],
    });
    expect(result.stderr.indexOf(LEGACY_QUESTION)).toBeLessThan(
      result.stderr.indexOf(USER_NAME_QUESTION),
    );
  });

  test("an interactive run asks only what the flags left unanswered", async () => {
    const result = await cliWith(askBoth).run(["probe", "--delete", "Legacy"], {
      isTty: { stdin: true },
      stdin: "rename User.name:fullName\n",
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      answer: [
        { verb: "delete", text: "Legacy" },
        { verb: "rename", text: "User.name:fullName" },
      ],
    });
    expect(result.stderr).not.toContain(LEGACY_QUESTION);
  });

  test("two questions about one subject consume one value each", async () => {
    const twice = (prompt: PromptSurface) =>
      prompt.statements([legacyQuestion, legacyQuestion]);
    const result = await cliWith(twice).run([
      "probe",
      "--delete",
      "Legacy",
      "--delete",
      "Legacy",
    ]);

    expect(result.exitCode).toBe(0);
  });
});

describe("a verb-flag value nothing consumed", () => {
  test("fails a run that otherwise succeeded", async () => {
    const result = await cliWith(askLegacy).run([
      "probe",
      "--delete",
      "Legacy",
      "--delete",
      "Lagacy",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)).toEqual({
      code: "CLI.CONSENT_UNUSED",
      severity: "error",
      summary:
        "--delete Lagacy was given but nothing in this run asked about Lagacy.",
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Remove the flag, or spell the subject the way the command names it.",
        },
      ],
      meta: { unused: [{ verb: "delete", text: "Lagacy" }] },
    });
  });

  test("fails a run that never asked", async () => {
    const quiet = async () => "nothing asked";
    const result = await cliWith(quiet).run([
      "probe",
      "--rename",
      "Legacy:Archive",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(errorOf(result)?.summary).toBe(
      "--rename Legacy:Archive was given but nothing in this run asked about Legacy.",
    );
  });

  test("a value given twice for one question leaves the second unused", async () => {
    const result = await cliWith(askLegacy).run([
      "probe",
      "--delete",
      "Legacy",
      "--delete",
      "Legacy",
      "--json",
    ]);

    expect(errorOf(result)?.code).toBe("CLI.CONSENT_UNUSED");
  });

  test("a run that failed for another reason reports that reason only", async () => {
    const failing = defineCommand({
      help: { summary: "Failing probe" },
      handler: async () =>
        notOk(new CliStructuredError("CLI.INVALID_ARGUMENTS", "Bad input.")),
    });
    const cli = createTestCli({
      commandFamilies: [
        defineCommandFamily({
          commands: { probe: failing },
          statementVerbs: ["delete"],
        }),
      ],
      commands: { probe: failing },
    });
    const result = await cli.run(["probe", "--delete", "Legacy", "--json"]);

    expect(errorOf(result)?.code).toBe("CLI.INVALID_ARGUMENTS");
  });
});

describe("verb registration", () => {
  test("a statement naming an unregistered verb is a construction error", async () => {
    const unregistered = (prompt: PromptSurface) =>
      prompt.statement("Archive it?", {
        subject: "Legacy",
        verbs: ["archive"],
        validate: () => undefined,
      });
    const result = await cliWith(unregistered).run(["probe", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(errorOf(result)?.summary).toContain(
      "verb 'archive', which no command family registers in statementVerbs",
    );
  });

  test("a command declaring a flag with a verb's name fails construction", () => {
    const command = defineCommand({
      args: { flags: { delete: flag.boolean({ brief: "Delete it" }) } },
      help: { summary: "Clashing probe" },
      handler: async () =>
        notOk(new CliStructuredError("CLI.INVALID_ARGUMENTS", "Unused.")),
    });

    expect(() =>
      createTestCli({
        commandFamilies: [
          defineCommandFamily({
            commands: { probe: command },
            statementVerbs: ["delete"],
          }),
        ],
        commands: { probe: command },
      }),
    ).toThrow(
      "command 'probe' declares reserved flag 'delete' (the shared flag family is engine-injected)",
    );
  });

  test("a verb that is already a shared flag fails construction", () => {
    const command = probe(async () => undefined);

    expect(() =>
      createTestCli({
        commandFamilies: [
          defineCommandFamily({
            commands: { probe: command },
            statementVerbs: ["confirm"],
          }),
        ],
        commands: { probe: command },
      }),
    ).toThrow("statement verb 'confirm' is already a shared flag");
  });

  test("a verb that is not camelCase fails construction", () => {
    const command = probe(async () => undefined);

    expect(() =>
      createTestCli({
        commandFamilies: [
          defineCommandFamily({
            commands: { probe: command },
            statementVerbs: ["drop-table"],
          }),
        ],
        commands: { probe: command },
      }),
    ).toThrow(
      "statement verb 'drop-table' must be camelCase (it transliterates to --kebab-case on the CLI)",
    );
  });
});
