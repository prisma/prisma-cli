/**
 * Prompt execution. Each prompt resolves to its answered value directly;
 * failures throw structured errors the engine catches and settles.
 * Under --yes and in non-interactive contexts a prompt with a declared
 * default resolves to it without displaying; one without a default
 * HALTS the invocation with a structured error (the engine renders the
 * errored envelope, exit 2). consent is structurally undefaultable and
 * always halts in those contexts. Cancellation (EOF at the prompt) is a
 * distinct structured error mapped to exit 3.
 */
import type { PromptSurface } from "../definition/context";
import type { InputStream } from "../definition/streams";
import { CliStructuredError } from "../protocol";
import type { Invocation, RunState } from "./invocation";

function makeLineReader(stdin: InputStream): () => Promise<string | undefined> {
  const iterator = stdin[Symbol.asyncIterator]();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  return async () => {
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        return line.endsWith("\r") ? line.slice(0, -1) : line;
      }
      if (done) {
        if (buffer.length > 0) {
          const line = buffer;
          buffer = "";
          return line;
        }
        return undefined;
      }
      const next = await iterator.next();
      if (next.done === true) {
        done = true;
        continue;
      }
      buffer += decoder.decode(next.value, { stream: true });
    }
  };
}

function promptCancelled(question: string): CliStructuredError {
  return new CliStructuredError(
    "CLI.PROMPT_CANCELLED",
    `The prompt "${question}" was cancelled before it was answered.`,
  );
}

function promptUnanswerable(
  question: string,
  state: RunState,
): CliStructuredError {
  return new CliStructuredError(
    "CLI.PROMPT_REQUIRED",
    state.yes
      ? `--yes cannot answer "${question}" because the prompt has no default.`
      : `The command asked "${question}" but the session is not interactive and the prompt has no default.`,
    {
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Run the command from an interactive terminal, or pass a flag that answers the prompt.",
        },
      ],
    },
  );
}

function consentUnavailable(
  question: string,
  state: RunState,
): CliStructuredError {
  return new CliStructuredError(
    "CLI.CONSENT_REQUIRED",
    state.yes
      ? `"${question}" requires explicit consent, which --yes cannot grant.`
      : `"${question}" requires explicit consent, and the session is not interactive.`,
    {
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Run the command interactively, or pass the command's explicit consent flag if it documents one.",
        },
      ],
    },
  );
}

function promptInvalid(question: string, raw: string): CliStructuredError {
  return new CliStructuredError(
    "CLI.PROMPT_INVALID",
    `"${raw}" is not a valid answer to "${question}".`,
  );
}

function isExplicitYes(raw: string | boolean): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }
  return ["y", "yes", "true"].includes(raw.trim().toLowerCase());
}

function parseBooleanAnswer(
  raw: string | boolean,
  fallback: boolean | undefined,
  question: string,
): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "") {
    return fallback ?? false;
  }
  if (["y", "yes", "true"].includes(normalized)) {
    return true;
  }
  if (["n", "no", "false"].includes(normalized)) {
    return false;
  }
  throw promptInvalid(question, raw);
}

export function makePromptSurface(invocation: Invocation): PromptSurface {
  const { runtime, hooks, state } = invocation;
  let readLine: (() => Promise<string | undefined>) | undefined;
  let answerCursor = 0;

  const ask = async (
    question: string,
    rendered: string,
  ): Promise<string | boolean> => {
    const answers = hooks.answers;
    if (answers !== undefined) {
      if (answerCursor >= answers.length) {
        throw new Error(
          `@prisma/cli-engine: the run prompted ("${question}") past the scripted answers`,
        );
      }
      const answer = answers[answerCursor];
      answerCursor += 1;
      return answer;
    }
    runtime.stderr.write(rendered);
    readLine ??= makeLineReader(runtime.stdin);
    const line = await readLine();
    if (line === undefined) {
      throw promptCancelled(question);
    }
    return line;
  };

  return {
    confirm: async (question, opts) => {
      const fallback = opts?.default;
      if (state.yes || !state.interactive) {
        if (fallback === undefined) {
          throw promptUnanswerable(question, state);
        }
        return fallback;
      }
      const hint =
        fallback === undefined ? "(y/n)" : fallback ? "(Y/n)" : "(y/N)";
      const raw = await ask(question, `? ${question} ${hint} `);
      return parseBooleanAnswer(raw, fallback, question);
    },
    consent: async (question) => {
      if (state.yes || !state.interactive) {
        throw consentUnavailable(question, state);
      }
      const raw = await ask(question, `? ${question} (y/n) `);
      return isExplicitYes(raw);
    },
    select: async (question, options, opts) => {
      const fallback = opts?.default;
      if (state.yes || !state.interactive) {
        if (fallback === undefined) {
          throw promptUnanswerable(question, state);
        }
        return fallback;
      }
      const rendered = [
        `? ${question}`,
        ...options.map(
          (option) =>
            `  ${option.value === fallback ? "▸" : " "} ${option.value}: ${option.label}`,
        ),
        "> ",
      ].join("\n");
      const raw = await ask(question, rendered);
      if (typeof raw !== "string") {
        throw promptInvalid(question, String(raw));
      }
      const answer = raw.trim();
      if (answer === "") {
        if (fallback === undefined) {
          throw promptInvalid(question, raw);
        }
        return fallback;
      }
      const match = options.find((option) => option.value === answer);
      if (match === undefined) {
        throw promptInvalid(question, raw);
      }
      return match.value;
    },
    text: async (question, opts) => {
      const fallback = opts?.default;
      if (state.yes || !state.interactive) {
        if (fallback === undefined) {
          throw promptUnanswerable(question, state);
        }
        return fallback;
      }
      const hint = fallback === undefined ? "" : ` (${fallback})`;
      const raw = await ask(question, `? ${question}${hint} `);
      if (typeof raw !== "string") {
        throw promptInvalid(question, String(raw));
      }
      if (raw === "") {
        return fallback ?? "";
      }
      return raw;
    },
  };
}
