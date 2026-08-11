/**
 * The clack rendering tier: a raw-mode-capable fake TTY stdin drives
 * confirm/consent/select/text through @clack/prompts. Asserts resolved
 * values, that every prompt UI byte goes to stderr and none to stdout,
 * setRawMode forwarding, and \x03 cancellation mapping to exit 3.
 */
import {
  type Block,
  createCli,
  defineCommand,
  type PromptSurface,
  type Runtime,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { describe, expect, test } from "vitest";

const ANSWER_LINE = /answer=(.*)\n/;

const DOWN = "\x1b[B";
const ENTER = "\r";
const CTRL_C = "\x03";
const BACKSPACE = "\x7f";

function keystrokeStdin(keys: readonly string[]) {
  let cursor = 0;
  const encoder = new TextEncoder();
  const rawModeCalls: boolean[] = [];
  const stdin = {
    setRawMode: (enabled: boolean) => {
      rawModeCalls.push(enabled);
    },
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<Uint8Array>>((resolve) => {
          if (cursor >= keys.length) {
            return; // a held-open TTY: no more keystrokes, no EOF
          }
          const value = encoder.encode(keys[cursor]);
          cursor += 1;
          setTimeout(() => resolve({ done: false, value }), 5);
        }),
      return: async (): Promise<IteratorResult<Uint8Array>> => ({
        done: true,
        value: undefined,
      }),
    }),
  };
  return { stdin, rawModeCalls };
}

function promptCli(run: (prompt: PromptSurface) => Promise<unknown>) {
  const probe = defineCommand({
    help: { summary: "Prompt probe" },
    handler: async (_args, ctx) => {
      const answer = await run(ctx.prompt);
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
          },
        ),
      );
    },
  });
  return createCli({
    name: "probe",
    version: "0.0.0",
    commandFamilies: [],
    groups: {},
    commands: { probe },
  });
}

async function runInteractive(
  run: (prompt: PromptSurface) => Promise<unknown>,
  keys: readonly string[],
) {
  const { stdin, rawModeCalls } = keystrokeStdin(keys);
  let stdout = "";
  let stderr = "";
  const runtime: Runtime = {
    isCI: false,
    stdout: {
      write: (text) => {
        stdout += text;
      },
    },
    stderr: {
      write: (text) => {
        stderr += text;
      },
    },
    stdin,
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
  };
  const exitCode = await promptCli(run).run(["probe"], runtime);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI stripping
  const plainStderr = stderr.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  return { exitCode, stdout, stderr, plainStderr, rawModeCalls };
}

function answerIn(plainStderr: string): string | undefined {
  const match = plainStderr.match(ANSWER_LINE);
  return match?.[1];
}

describe("the clack tier resolves prompt values", () => {
  test("confirm: Enter accepts the declared default", async () => {
    const result = await runInteractive(
      (prompt) => prompt.confirm("Proceed?", { default: true }),
      [ENTER],
    );

    expect(result.exitCode).toBe(0);
    expect(answerIn(result.plainStderr)).toBe("true");
  });

  test("confirm: 'n' answers false over a true default", async () => {
    const result = await runInteractive(
      (prompt) => prompt.confirm("Proceed?", { default: true }),
      ["n", ENTER],
    );

    expect(result.exitCode).toBe(0);
    expect(answerIn(result.plainStderr)).toBe("false");
  });

  test("select: Enter picks the highlighted default", async () => {
    const result = await runInteractive(
      (prompt) =>
        prompt.select(
          "Pick one",
          [
            { value: "alpha", label: "First" },
            { value: "beta", label: "Second" },
            { value: "gamma", label: "Third" },
          ],
          { default: "beta" },
        ),
      [ENTER],
    );

    expect(result.exitCode).toBe(0);
    expect(answerIn(result.plainStderr)).toBe('"beta"');
  });

  test("select: moving the highlight then Enter picks the highlighted option", async () => {
    const result = await runInteractive(
      (prompt) =>
        prompt.select(
          "Pick one",
          [
            { value: "alpha", label: "First" },
            { value: "beta", label: "Second" },
            { value: "gamma", label: "Third" },
          ],
          { default: "beta" },
        ),
      [DOWN, ENTER],
    );

    expect(result.exitCode).toBe(0);
    expect(answerIn(result.plainStderr)).toBe('"gamma"');
  });

  test("text: typed value wins", async () => {
    const result = await runInteractive(
      (prompt) => prompt.text("Name?", { default: "world" }),
      ["m", "o", "o", "n", ENTER],
    );

    expect(result.exitCode).toBe(0);
    expect(answerIn(result.plainStderr)).toBe('"moon"');
  });

  test("text: Enter accepts the default", async () => {
    const result = await runInteractive(
      (prompt) => prompt.text("Name?", { default: "world" }),
      [ENTER],
    );

    expect(result.exitCode).toBe(0);
    expect(answerIn(result.plainStderr)).toBe('"world"');
  });

  test("consent: Enter-through stays false", async () => {
    const result = await runInteractive(
      (prompt) => prompt.consent("Delete everything?"),
      [ENTER],
    );

    expect(result.exitCode).toBe(0);
    expect(answerIn(result.plainStderr)).toBe("false");
  });

  test("consent: an explicit Yes grants", async () => {
    const result = await runInteractive(
      (prompt) => prompt.consent("Delete everything?"),
      ["y", ENTER],
    );

    expect(result.exitCode).toBe(0);
    expect(answerIn(result.plainStderr)).toBe("true");
  });

  test("consent with a token: typing it exactly grants", async () => {
    const result = await runInteractive(
      (prompt) => prompt.consent("Delete it?", { token: "prod-db" }),
      [..."prod-db", ENTER],
    );

    expect(result.exitCode).toBe(0);
    expect(answerIn(result.plainStderr)).toBe("true");
    expect(result.plainStderr).toContain("Type prod-db to confirm.");
  });

  test("consent with a token: a wrong answer re-prompts instead of failing", async () => {
    const result = await runInteractive(
      (prompt) => prompt.consent("Delete it?", { token: "prod-db" }),
      // The rejected text stays in the field, so the retry erases it first.
      [
        ..."nope",
        ENTER,
        BACKSPACE,
        BACKSPACE,
        BACKSPACE,
        BACKSPACE,
        ..."prod-db",
        ENTER,
      ],
    );

    expect(result.exitCode).toBe(0);
    expect(answerIn(result.plainStderr)).toBe("true");
    expect(result.plainStderr).toContain("Type prod-db exactly");
  });

  test("consent with a token: Ctrl-C cancels, exit 3", async () => {
    const result = await runInteractive(
      (prompt) => prompt.consent("Delete it?", { token: "prod-db" }),
      [..."nope", ENTER, CTRL_C],
    );

    expect(result.exitCode).toBe(3);
  });

  test("a multi-step wizard reuses the one renderer and stdin iterator", async () => {
    const result = await runInteractive(
      async (prompt) => {
        const first = await prompt.confirm("Step one?", { default: true });
        const second = await prompt.select("Step two", [
          { value: "x", label: "Ex" },
          { value: "y", label: "Why" },
        ]);
        return `${first}/${second}`;
      },
      [ENTER, DOWN, ENTER],
    );

    expect(result.exitCode).toBe(0);
    expect(answerIn(result.plainStderr)).toBe('"true/y"');
  });
});

describe("clack tier channels and raw mode", () => {
  test("every prompt UI byte goes to stderr; stdout stays empty", async () => {
    const result = await runInteractive(
      (prompt) => prompt.confirm("Proceed?", { default: true }),
      [ENTER],
    );

    expect(result.stdout).toBe("");
    expect(result.plainStderr).toContain("Proceed?");
  });

  test("setRawMode is forwarded to the runtime stdin and released", async () => {
    const result = await runInteractive(
      (prompt) => prompt.confirm("Proceed?", { default: true }),
      [ENTER],
    );

    expect(result.rawModeCalls[0]).toBe(true);
    expect(result.rawModeCalls[result.rawModeCalls.length - 1]).toBe(false);
  });
});

describe("clack tier cancellation", () => {
  test("\\x03 during a prompt maps to CLI.PROMPT_CANCELLED, exit 3", async () => {
    const result = await runInteractive(
      (prompt) => prompt.confirm("Proceed?", { default: true }),
      [CTRL_C],
    );

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("CLI.PROMPT_CANCELLED");
    expect(result.stdout).toBe("");
  });
});
