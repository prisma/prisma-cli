/**
 * The prompt semantics (§4a of the draft), test-pinned ruling by ruling:
 * declared defaults are accepted by --yes and by Enter; a prompt
 * with no default halts under --yes and in non-interactive contexts;
 * consent is structurally undefaultable and always halts there;
 * cancellation maps to exit 3. Format and interactivity are independent
 * axes (operator ruling, 2026-08-09): json selects output shape only,
 * interactivity comes from TTY-stdin detection overridden by
 * --interactive/--no-interactive. Plus needs.interaction, the
 * mechanical interactive-terminal precondition.
 */
import {
  type Block,
  createCli,
  defineCommand,
  type PromptSurface,
  type Runtime,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

const EPOCH = () => new Date(0);

function promptCommand(run: (prompt: PromptSurface) => Promise<unknown>) {
  return defineCommand({
    help: { summary: "Prompt probe" },
    handler: async (_args, ctx) => {
      const answer = await run(ctx.prompt);
      return ok(
        ctx.present(
          { data: { answer } },
          {
            human: (): readonly Block[] => [
              { kind: "summary", status: "ok", text: `answer=${answer}` },
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

function cliWith(run: (prompt: PromptSurface) => Promise<unknown>) {
  return createTestCli({ commands: { probe: promptCommand(run) }, now: EPOCH });
}

const INTERACTIVE = { isTty: { stdin: true, stdout: true } };

function confirmDefaultTrue(prompt: PromptSurface) {
  return prompt.confirm("Proceed?", { default: true });
}

function confirmNoDefault(prompt: PromptSurface) {
  return prompt.confirm("Proceed?");
}

describe("prompt defaults", () => {
  test("--yes accepts a declared default without displaying", async () => {
    const result = await cliWith(confirmDefaultTrue).run(
      ["probe", "--yes"],
      INTERACTIVE,
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: true });
    expect(result.stderr).toBe("✔ answer=true\n");
  });

  test("plain Enter accepts the default in interactive mode", async () => {
    const result = await cliWith(confirmDefaultTrue).run(["probe"], {
      ...INTERACTIVE,
      answers: [""],
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: true });
  });

  test("an explicit interactive answer overrides the default", async () => {
    const result = await cliWith(confirmDefaultTrue).run(["probe"], {
      ...INTERACTIVE,
      answers: ["n"],
    });

    expect(result.presented?.data).toEqual({ answer: false });
  });

  test("a scripted boolean answer is used directly", async () => {
    const result = await cliWith(confirmNoDefault).run(["probe"], {
      ...INTERACTIVE,
      answers: [false],
    });

    expect(result.presented?.data).toEqual({ answer: false });
  });

  test("--no-interactive resolves a defaulted prompt to its default", async () => {
    const result = await cliWith(confirmDefaultTrue).run(
      ["probe", "--no-interactive"],
      INTERACTIVE,
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: true });
  });

  test("a non-TTY json run resolves a defaulted prompt to its default", async () => {
    const result = await cliWith(confirmDefaultTrue).run(["probe", "--json"]);

    const last = result.json[result.json.length - 1];
    expect(result.exitCode).toBe(0);
    expect(last.kind === "result" && last.envelope.ok).toBe(true);
  });

  test("CI suppresses interactivity even on a TTY", async () => {
    const result = await cliWith(confirmDefaultTrue).run(["probe"], {
      ...INTERACTIVE,
      env: { CI: "true" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: true });
    expect(result.stderr).toBe("✔ answer=true\n");
  });

  /** Interactivity asks the engine's CI detection, so a vendor that
   *  sets no CI variable is no longer offered a prompt nobody is there
   *  to answer. TeamCity and Azure Pipelines are both such vendors. */
  test.each([
    ["TeamCity", { TEAMCITY_VERSION: "2024.03.1" }],
    ["Azure Pipelines", { TF_BUILD: "True" }],
  ])("%s suppresses interactivity though it sets no CI variable", async (_name, env) => {
    const result = await cliWith(confirmDefaultTrue).run(["probe"], {
      ...INTERACTIVE,
      env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: true });
    expect(result.stderr).toBe("✔ answer=true\n");
  });

  /** CI=false is a denial, not a marker: it used to read as "CI is in
   *  the environment" and cost a developer their prompt. */
  test("CI=false leaves a TTY interactive", async () => {
    const result = await cliWith(confirmDefaultTrue).run(["probe"], {
      ...INTERACTIVE,
      env: { CI: "false" },
      answers: ["n"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: false });
  });
});

describe("prompts with no default halt", () => {
  test("--yes halts with the engine-rendered structured error, exit 2", async () => {
    const result = await cliWith(confirmNoDefault).run(
      ["probe", "--yes", "--json"],
      {},
    );

    expect(result.exitCode).toBe(2);
    const last = result.json[result.json.length - 1];
    expect(
      last.kind === "result" && !last.envelope.ok && last.envelope.error,
    ).toEqual({
      code: "CLI.PROMPT_REQUIRED",
      severity: "error",
      summary:
        '--yes cannot answer "Proceed?" because the prompt has no default.',
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Run the command from an interactive terminal, or pass a flag that answers the prompt.",
        },
      ],
    });
  });

  test("human format with --no-interactive halts with exit 2", async () => {
    const result = await cliWith(confirmNoDefault).run(
      ["probe", "--no-interactive", "--format", "human"],
      INTERACTIVE,
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.PROMPT_REQUIRED");
    expect(result.stderr).toContain("not interactive");
  });

  test("a handler that catches the prompt throw and rethrows still settles structurally", async () => {
    const caught: unknown[] = [];
    const catching = async (prompt: PromptSurface) => {
      try {
        return await prompt.confirm("Proceed?");
      } catch (cause) {
        caught.push(cause);
        throw cause;
      }
    };
    const result = await cliWith(catching).run(["probe", "--yes", "--json"]);

    expect(caught).toHaveLength(1);
    expect(result.exitCode).toBe(2);
    const last = result.json[result.json.length - 1];
    expect(
      last.kind === "result" && !last.envelope.ok && last.envelope.error.code,
    ).toBe("CLI.PROMPT_REQUIRED");
  });

  test("json format with a non-TTY stdin halts a prompt with no default", async () => {
    const result = await cliWith(confirmNoDefault).run(["probe", "--json"]);

    expect(result.exitCode).toBe(2);
    const last = result.json[result.json.length - 1];
    expect(
      last.kind === "result" && !last.envelope.ok && last.envelope.error.code,
    ).toBe("CLI.PROMPT_REQUIRED");
  });
});

describe("format and interactivity are independent axes", () => {
  test("a TTY stdin keeps a json run interactive: the prompt is asked", async () => {
    const result = await cliWith(confirmNoDefault).run(["probe", "--json"], {
      isTty: { stdin: true },
      stdin: "y\n",
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: true });
    expect(result.stderr).toBe("? Proceed? (y/n) ");
  });

  test("--interactive switches a non-TTY json run back on: prompt UI on stderr, stdout stays single-line frames", async () => {
    const result = await cliWith(confirmNoDefault).run(
      ["probe", "--json", "--interactive"],
      { stdin: "y\n" },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: true });
    expect(result.stderr).toBe("? Proceed? (y/n) ");
    const lines = result.stdout.trim().split("\n");
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    const last = result.json[result.json.length - 1];
    expect(last.kind === "result" && last.envelope.ok).toBe(true);
  });
});

describe("consent", () => {
  const consenting = (prompt: PromptSurface) =>
    prompt.consent("Delete everything?");

  test("--yes can never grant consent: halt, exit 2", async () => {
    const result = await cliWith(consenting).run(
      ["probe", "--yes", "--json"],
      {},
    );

    expect(result.exitCode).toBe(2);
    const last = result.json[result.json.length - 1];
    expect(
      last.kind === "result" && !last.envelope.ok && last.envelope.error,
    ).toEqual({
      code: "CLI.CONSENT_REQUIRED",
      severity: "error",
      summary:
        '"Delete everything?" requires explicit consent, which --yes cannot grant.',
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Run the command interactively. Consent can only be granted outside an interactive terminal when the command declares a consent token.",
        },
      ],
    });
  });

  test("a non-interactive context can never grant consent", async () => {
    const result = await cliWith(consenting).run(["probe", "--json"]);

    expect(result.exitCode).toBe(2);
    const last = result.json[result.json.length - 1];
    expect(
      last.kind === "result" && !last.envelope.ok && last.envelope.error.code,
    ).toBe("CLI.CONSENT_REQUIRED");
  });

  test("an explicit interactive yes grants consent", async () => {
    const result = await cliWith(consenting).run(["probe"], {
      ...INTERACTIVE,
      answers: ["yes"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: true });
  });

  test("Enter-through never grants consent", async () => {
    const result = await cliWith(consenting).run(["probe"], {
      ...INTERACTIVE,
      answers: [""],
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: false });
  });
});

describe("select and text", () => {
  const selecting = (prompt: PromptSurface) =>
    prompt.select(
      "Pick one",
      [
        { value: "alpha", label: "First" },
        { value: "beta", label: "Second" },
      ],
      { default: "beta" },
    );

  test("select: Enter accepts the default", async () => {
    const result = await cliWith(selecting).run(["probe"], {
      ...INTERACTIVE,
      answers: [""],
    });

    expect(result.presented?.data).toEqual({ answer: "beta" });
  });

  test("select: an explicit value wins", async () => {
    const result = await cliWith(selecting).run(["probe"], {
      ...INTERACTIVE,
      answers: ["alpha"],
    });

    expect(result.presented?.data).toEqual({ answer: "alpha" });
  });

  test("select: --yes resolves to the default", async () => {
    const result = await cliWith(selecting).run(["probe", "--yes"], {});

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: "beta" });
  });

  test("select: an answer outside the options halts with exit 2", async () => {
    const result = await cliWith(selecting).run(["probe"], {
      ...INTERACTIVE,
      answers: ["gamma"],
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.PROMPT_INVALID");
  });

  const texting = (prompt: PromptSurface) =>
    prompt.text("Name?", { default: "world" });

  test("text: Enter accepts the default", async () => {
    const result = await cliWith(texting).run(["probe"], {
      ...INTERACTIVE,
      answers: [""],
    });

    expect(result.presented?.data).toEqual({ answer: "world" });
  });

  test("text: a typed value wins", async () => {
    const result = await cliWith(texting).run(["probe"], {
      ...INTERACTIVE,
      answers: ["moon"],
    });

    expect(result.presented?.data).toEqual({ answer: "moon" });
  });
});

describe("the input stream and the script", () => {
  test("without scripted answers the prompt reads the input stream", async () => {
    const result = await cliWith(confirmNoDefault).run(["probe"], {
      ...INTERACTIVE,
      stdin: "y\n",
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({ answer: true });
    expect(result.stderr).toBe("? Proceed? (y/n) ✔ answer=true\n");
  });

  test("EOF at the prompt is a cancellation: exit 3", async () => {
    const result = await cliWith(confirmNoDefault).run(["probe"], {
      ...INTERACTIVE,
      stdin: "",
    });

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("CLI.PROMPT_CANCELLED");
  });

  test("prompting past the scripted answers fails the run as a bug", async () => {
    const result = await cliWith(confirmNoDefault).run(["probe"], {
      ...INTERACTIVE,
      answers: [],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("past the scripted answers");
  });
});

describe("needs.interaction", () => {
  function interactionCli() {
    let ran = false;
    const command = defineCommand({
      help: { summary: "Needs a terminal" },
      needs: { interaction: true },
      handler: async (_args, ctx) => {
        ran = true;
        return ok(
          ctx.present(
            { data: null },
            {
              human: (): readonly Block[] => [
                { kind: "summary", status: "ok", text: "ran" },
              ],
              stdout: () => [],
              json: () => null,
              next: () => [],
            },
          ),
        );
      },
    });
    return {
      cli: createTestCli({ commands: { command }, now: EPOCH }),
      wasRun: () => ran,
    };
  }

  test("fails early in a non-TTY context, before the handler runs", async () => {
    const { cli, wasRun } = interactionCli();
    const result = await cli.run(["command", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(wasRun()).toBe(false);
    const last = result.json[result.json.length - 1];
    expect(
      last.kind === "result" && !last.envelope.ok && last.envelope.error,
    ).toEqual({
      code: "CLI.INTERACTION_REQUIRED",
      severity: "error",
      summary: "This command requires an interactive terminal.",
      why: "It prompts for input that cannot be supplied when the session is not interactive (no TTY stdin, CI, or --no-interactive).",
      nextActions: [
        {
          kind: "user-choice",
          label: "Run it from an interactive terminal, or pass --interactive.",
        },
      ],
    });
  });

  test("--no-interactive fails it even on a TTY", async () => {
    const { cli } = interactionCli();
    const result = await cli.run(["command", "--no-interactive"], INTERACTIVE);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.INTERACTION_REQUIRED");
  });

  test("passes on an interactive terminal", async () => {
    const { cli, wasRun } = interactionCli();
    const result = await cli.run(["command"], INTERACTIVE);

    expect(result.exitCode).toBe(0);
    expect(wasRun()).toBe(true);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("✔ ran\n");
  });
});

describe("stdin cleanup", () => {
  test("a run that prompted closes the stdin iterator, so an unending stdin cannot keep it alive", async () => {
    let returned = false;
    const unendingStdin = {
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<Uint8Array>> =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  done: false,
                  value: new TextEncoder().encode("yes\n"),
                }),
              0,
            );
          }),
        return: async (): Promise<IteratorResult<Uint8Array>> => {
          returned = true;
          return { done: true, value: undefined };
        },
      }),
    };
    const cli = createCli({
      name: "t",
      version: "0.0.0",
      commandFamilies: [],
      groups: {},
      commands: { probe: promptCommand(confirmNoDefault) },
    });
    const runtime: Runtime = {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      stdin: unendingStdin,
      cwd: "/",
      env: {},
      isTty: { stdin: true, stdout: true, stderr: true },
      exit: (code: number): never => {
        throw new Error(`runtime.exit(${code})`);
      },
      onSignal: () => () => {},
      loadConfig: async () => ({
        path: "/prisma.config.ts",
        sections: {},
        diagnostics: [],
      }),
      managementApi: { baseUrl: "https://test.invalid" },
      host: {
        runtime: { name: "node", version: "v22.12.0" },
        platform: "linux",
        arch: "x64",
      },
    };

    const exitCode = await cli.run(["probe"], runtime);

    expect(exitCode).toBe(0);
    expect(returned).toBe(true);
  });
});
