/**
 * Prompt execution. Each prompt resolves to its answered value directly;
 * failures throw structured errors the engine catches and settles.
 * Under --yes and in non-interactive contexts a prompt with a declared
 * default resolves to it without displaying; one without a default
 * HALTS the invocation with a structured error (the engine renders the
 * errored envelope, exit 2). consent is structurally undefaultable: --yes
 * never grants it. A matching `--confirm <token>` grants it in every
 * session, interactive or not, before anything is rendered; outside an
 * interactive terminal that is the only thing that can. Cancellation
 * (EOF at the prompt) is a distinct structured error mapped to exit 3.
 *
 * A statement is the second consent form: answered with a verb and free
 * text. A `--<verb>` flag whose value names the subject answers it in
 * every session; each value answers one statement, and a value nothing
 * consumed fails an otherwise successful run.
 *
 * Rendering is two-tier: real TTYs (isTty.stdin AND stdin.setRawMode
 * present, no scripted answers) render through @clack/prompts via
 * clack-renderer.ts; everything else uses the plain line renderer
 * below. --yes resolution, `--confirm` matching, and structural failures
 * are decided before the tier branch, so both tiers share identical
 * semantics. A consent WITH a token renders as type-to-confirm on both
 * tiers; the tiers differ only in what a wrong answer does — clack
 * re-prompts, the line renderer fails structurally, because a scripted
 * or piped answer cannot be corrected.
 */
import { kebabCase } from "../args";
import type {
  PromptSurface,
  StatementAnswer,
  StatementQuestion,
} from "../context";
import { CliStructuredError } from "../protocol";
import type { InputStream } from "../runtime";
import {
  type ClackRenderer,
  clackCapable,
  makeClackRenderer,
} from "./clack-renderer";
import { constructionError } from "./command-tree";
import type { Invocation, RunState } from "./engine";
import { announceUrl } from "./open-url";
import type { StatementFlagValue } from "./statement-flags";

const WHITESPACE = /\s/;

/** How often browserWait asks whether the user has finished. */
const BROWSER_WAIT_POLL_INTERVAL_MS = 1000;

/** A `--confirm` value grants at most one consent: the matched value is
 *  removed, so two consents on the same token need two --confirms. */
function consumeConfirmValue(state: RunState, token: string): boolean {
  const index = state.confirmValues.indexOf(token);
  if (index === -1) {
    return false;
  }
  state.confirmValues.splice(index, 1);
  return true;
}

function flagForm(verb: string, text: string): string {
  return `--${kebabCase(verb)} ${text}`;
}

function namesSubject(text: string, subject: string): boolean {
  return text === subject || text.startsWith(`${subject}:`);
}

function subjectOf(text: string): string {
  const colon = text.indexOf(":");
  return colon === -1 ? text : text.slice(0, colon);
}

/** The first unconsumed verb-flag value naming the subject, tried verb
 *  by verb. A value the command rejects fails the run: a wrong flag
 *  cannot be corrected by asking again. */
function answerFromFlags<V extends string>(
  state: RunState,
  question: StatementQuestion<V>,
): StatementAnswer<V> | undefined {
  for (const verb of question.verbs) {
    const value = state.statementValues.find(
      (candidate) =>
        !candidate.consumed &&
        candidate.verb === verb &&
        namesSubject(candidate.text, question.subject),
    );
    if (value === undefined) {
      continue;
    }
    const rejection = question.validate(verb, value.text);
    if (rejection !== undefined) {
      throw new CliStructuredError(
        "CLI.PROMPT_INVALID",
        `${flagForm(verb, value.text)} does not answer "${question.question}": ${rejection}`,
      );
    }
    value.consumed = true;
    return { verb, text: value.text };
  }
  return undefined;
}

function statementUnavailable<V extends string>(
  unanswered: readonly StatementQuestion<V>[],
  state: RunState,
): CliStructuredError {
  const subjects = unanswered.map((question) => `"${question.subject}"`);
  const situation = state.yes
    ? "which --yes cannot give"
    : "and the session is not interactive";
  const summary =
    unanswered.length === 1
      ? `${subjects[0]} needs a statement, ${situation}.`
      : `${unanswered.length} subjects need a statement, ${situation}: ${subjects.join(", ")}.`;
  const listed = unanswered.map(({ subject, verbs }) => ({ subject, verbs }));
  return new CliStructuredError("CLI.CONSENT_REQUIRED", summary, {
    why: unanswered.map((question) => question.question).join("\n"),
    nextActions: unanswered.flatMap((question) =>
      question.verbs.map((verb) => ({
        kind: "user-choice" as const,
        label: `Pass ${flagForm(verb, question.forms?.[verb] ?? question.subject)}`,
      })),
    ),
    meta:
      listed.length === 1
        ? { ...listed[0], unanswered: listed }
        : { unanswered: listed },
  });
}

type ParsedStatement<V extends string> =
  | { readonly answer: StatementAnswer<V> }
  | { readonly problem: string };

/** An interactive answer: `<verb> <text>`, or `<verb>` alone to mean
 *  the subject. */
function parseStatement<V extends string>(
  raw: string,
  question: StatementQuestion<V>,
): ParsedStatement<V> {
  const trimmed = raw.trim();
  const space = trimmed.search(WHITESPACE);
  const typedVerb = space === -1 ? trimmed : trimmed.slice(0, space);
  const rest = space === -1 ? "" : trimmed.slice(space).trim();
  const verb = question.verbs.find((candidate) => candidate === typedVerb);
  if (verb === undefined) {
    return {
      problem: `Start the answer with ${question.verbs.join(" or ")}.`,
    };
  }
  const text = rest === "" ? question.subject : rest;
  const rejection = question.validate(verb, text);
  return rejection === undefined
    ? { answer: { verb, text } }
    : { problem: rejection };
}

/** Fails a run that otherwise succeeded when a verb flag answered
 *  nothing: a mistyped subject must not pass silently. */
export function unusedStatementValuesError(
  state: RunState,
): CliStructuredError | undefined {
  const unused: readonly StatementFlagValue[] = state.statementValues.filter(
    (value) => !value.consumed,
  );
  if (unused.length === 0) {
    return undefined;
  }
  const given = unused.map((value) => flagForm(value.verb, value.text));
  const subjects = [...new Set(unused.map((value) => subjectOf(value.text)))];
  const summary =
    unused.length === 1
      ? `${given[0]} was given but nothing in this run asked about ${subjects[0]}.`
      : `${given.join(", ")} were given but nothing in this run asked about ${subjects.join(", ")}.`;
  return new CliStructuredError("CLI.CONSENT_UNUSED", summary, {
    nextActions: [
      {
        kind: "user-choice",
        label:
          "Remove the flag, or spell the subject the way the command names it.",
      },
    ],
    meta: { unused: unused.map(({ verb, text }) => ({ verb, text })) },
  });
}

function makeLineReader(
  stdin: InputStream,
  invocation: Invocation,
): () => Promise<string | undefined> {
  const iterator = stdin[Symbol.asyncIterator]();
  invocation.state.stdinIterator = iterator;
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  const takeBufferedLine = (): string | undefined => {
    const newline = buffer.indexOf("\n");
    if (newline === -1) {
      return undefined;
    }
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    return line.endsWith("\r") ? line.slice(0, -1) : line;
  };
  const takeFinalLine = (): string | undefined => {
    if (buffer.length === 0) {
      return undefined;
    }
    const line = buffer;
    buffer = "";
    return line;
  };
  return async () => {
    for (;;) {
      const buffered = takeBufferedLine();
      if (buffered !== undefined) {
        return buffered;
      }
      if (done) {
        return takeFinalLine();
      }
      // biome-ignore lint/performance/noAwaitInLoops: stdin is pulled one chunk at a time until a newline turns up; asking for the next chunk before the current one has been appended to the buffer would reorder the user's input.
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

/** What a prompt resolves to when it cannot be shown: its declared
 *  default, or a halt when it has none. */
function answerWithoutAsking<T>(
  question: string,
  fallback: T | undefined,
  state: RunState,
): T {
  if (fallback === undefined) {
    throw promptUnanswerable(question, state);
  }
  return fallback;
}

function consentUnavailable(
  question: string,
  state: RunState,
  token: string | undefined,
): CliStructuredError {
  const situation = state.yes
    ? `"${question}" requires explicit consent, which --yes cannot grant.`
    : `"${question}" requires explicit consent, and the session is not interactive.`;
  if (token === undefined) {
    return new CliStructuredError("CLI.CONSENT_REQUIRED", situation, {
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Run the command interactively. Consent can only be granted outside an interactive terminal when the command declares a consent token.",
        },
      ],
    });
  }
  return new CliStructuredError(
    "CLI.CONSENT_REQUIRED",
    `${situation} Grant it by passing --confirm ${token}.`,
    {
      nextActions: [
        {
          kind: "user-choice",
          label: `Run the command interactively and type ${token}, or pass --confirm ${token}.`,
        },
      ],
      meta: { consentToken: token },
    },
  );
}

function promptInvalid(question: string, raw: string): CliStructuredError {
  return new CliStructuredError(
    "CLI.PROMPT_INVALID",
    `"${raw}" is not a valid answer to "${question}".`,
  );
}

/** A consent whose token was typed wrong where re-prompting is not
 *  possible (scripted answers, piped stdin). */
function consentTokenMismatch(
  question: string,
  token: string,
  raw: string,
): CliStructuredError {
  return new CliStructuredError(
    "CLI.PROMPT_INVALID",
    `"${raw}" does not confirm "${question}": the answer must be exactly ${token}.`,
    { meta: { consentToken: token } },
  );
}

/** browserWait outside an interactive terminal: nothing is opened and
 *  nothing is polled, so the URL travels in the error instead. */
function browserWaitUnavailable(
  message: string,
  url: string,
): CliStructuredError {
  return new CliStructuredError(
    "CLI.INTERACTION_REQUIRED",
    `${message} requires an interactive terminal: it waits for you to finish at ${url}.`,
    {
      why: "The session is not interactive (no TTY stdin, CI, or --no-interactive), so the browser cannot be opened and the wait would never end.",
      nextActions: [
        {
          kind: "user-choice",
          label: `Open ${url} and finish there, then run the command again from an interactive terminal (or pass --interactive).`,
        },
      ],
      meta: { url },
    },
  );
}

function browserWaitTimedOut(
  message: string,
  url: string,
  timeout: number,
): CliStructuredError {
  return new CliStructuredError(
    "CLI.BROWSER_WAIT_TIMEOUT",
    `${message} was not finished within ${Math.round(timeout / 1000)}s.`,
    {
      why: `The command waited for ${url} and stopped waiting before it completed.`,
      nextActions: [
        {
          kind: "user-choice",
          label: "Run the command again and finish in the browser.",
        },
      ],
      meta: { url, timeoutMs: timeout },
    },
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
  let renderer: Promise<ClackRenderer> | undefined;

  const useClack = (): boolean =>
    hooks.answers === undefined && clackCapable(runtime);

  const renderWithClack = async <T>(
    question: string,
    run: (r: ClackRenderer) => Promise<T | symbol>,
  ): Promise<T> => {
    renderer ??= (() => {
      const iterator = runtime.stdin[Symbol.asyncIterator]();
      invocation.state.stdinIterator = iterator;
      const stdin: InputStream = {
        [Symbol.asyncIterator]: () => iterator,
        setRawMode: (enabled) => runtime.stdin.setRawMode?.(enabled),
      };
      return makeClackRenderer(stdin, runtime.stderr);
    })();
    const r = await renderer;
    const value = await run(r);
    if (r.isCancel(value)) {
      throw promptCancelled(question);
    }
    return value as T;
  };

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
    readLine ??= makeLineReader(runtime.stdin, invocation);
    const line = await readLine();
    if (line === undefined) {
      throw promptCancelled(question);
    }
    return line;
  };

  /** The interactive rendering of a consent that declares a token: the
   *  user types the token itself. Clack lets them try again; the line
   *  renderer cannot, so a wrong answer there is structural. */
  const confirmByTyping = async (
    question: string,
    token: string,
  ): Promise<boolean> => {
    if (useClack()) {
      await renderWithClack<string>(question, (r) =>
        r.confirmToken(question, token),
      );
      return true;
    }
    const typed = await ask(
      question,
      `? ${question} (type ${token} to confirm) `,
    );
    if (typeof typed !== "string" || typed.trim() !== token) {
      throw consentTokenMismatch(question, token, String(typed));
    }
    return true;
  };

  const askSelect = async <T extends string>(
    question: string,
    options: ReadonlyArray<{ value: T; label: string }>,
    fallback: T | undefined,
  ): Promise<T> => {
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
  };

  const askText = async (
    question: string,
    fallback: string | undefined,
  ): Promise<string> => {
    const hint = fallback === undefined ? "" : ` (${fallback})`;
    const raw = await ask(question, `? ${question}${hint} `);
    if (typeof raw !== "string") {
      throw promptInvalid(question, String(raw));
    }
    if (raw === "") {
      return fallback ?? "";
    }
    return raw;
  };

  const askStatement = async <V extends string>(
    question: StatementQuestion<V>,
  ): Promise<StatementAnswer<V>> => {
    if (useClack()) {
      const raw = await renderWithClack<string>(question.question, (r) =>
        r.statement(question.question, question.verbs.join(" or "), (value) => {
          const parsed = parseStatement(value, question);
          return "problem" in parsed ? parsed.problem : undefined;
        }),
      );
      const parsed = parseStatement(raw, question);
      if ("problem" in parsed) {
        throw promptInvalid(question.question, raw);
      }
      return parsed.answer;
    }
    const raw = await ask(
      question.question,
      `? ${question.question} (${question.verbs.join("/")}) `,
    );
    if (typeof raw !== "string") {
      throw promptInvalid(question.question, String(raw));
    }
    const parsed = parseStatement(raw, question);
    if ("problem" in parsed) {
      throw new CliStructuredError(
        "CLI.PROMPT_INVALID",
        `"${raw}" is not a valid answer to "${question.question}": ${parsed.problem}`,
      );
    }
    return parsed.answer;
  };

  const requireRegisteredVerbs = <V extends string>(
    questions: readonly StatementQuestion<V>[],
  ): void => {
    for (const question of questions) {
      if (question.verbs.length === 0) {
        throw constructionError(
          `command '${state.commandId}' asked a statement about '${question.subject}' with no verbs`,
        );
      }
      for (const verb of question.verbs) {
        if (!state.statementVerbs.includes(verb)) {
          throw constructionError(
            `command '${state.commandId}' asked a statement with verb '${verb}', which it does not declare in statements`,
          );
        }
      }
    }
  };

  /** Flags answer first, so a refusal can name every question still
   *  unanswered at once; the rest are asked one after another. */
  const statements = async <V extends string>(
    questions: readonly StatementQuestion<V>[],
  ): Promise<StatementAnswer<V>[]> => {
    requireRegisteredVerbs(questions);
    const fromFlags = questions.map((question) =>
      answerFromFlags(state, question),
    );
    const unanswered = questions.filter(
      (_question, index) => fromFlags[index] === undefined,
    );
    if (unanswered.length > 0 && (state.yes || !state.interactive)) {
      throw statementUnavailable(unanswered, state);
    }
    const answerFrom = async (index: number): Promise<StatementAnswer<V>[]> => {
      if (index === questions.length) {
        return [];
      }
      const answer = fromFlags[index] ?? (await askStatement(questions[index]));
      return [answer, ...(await answerFrom(index + 1))];
    };
    return answerFrom(0);
  };

  /** A prompt writes to stderr and reads the engine's stdin — the same
   *  terminal a live child inherited. Like ctx.present, prompting while
   *  a child owns the terminal is a construction error. */
  const requireOwnTerminal = (): void => {
    if (state.delegatedTerminal !== undefined) {
      throw constructionError(
        `command '${state.commandId}' called ctx.prompt while a child owned the terminal`,
      );
    }
  };
  const surface: Omit<PromptSurface, "statement" | "statements"> = {
    confirm: async (question, opts) => {
      const fallback = opts?.default;
      if (state.yes || !state.interactive) {
        return answerWithoutAsking(question, fallback, state);
      }
      if (useClack()) {
        return renderWithClack(question, (r) => r.confirm(question, fallback));
      }
      let hint = "(y/n)";
      if (fallback === true) {
        hint = "(Y/n)";
      } else if (fallback === false) {
        hint = "(y/N)";
      }
      const raw = await ask(question, `? ${question} ${hint} `);
      return parseBooleanAnswer(raw, fallback, question);
    },
    consent: async (question, opts) => {
      const token = opts?.token;
      if (token !== undefined && consumeConfirmValue(state, token)) {
        return true;
      }
      if (state.yes || !state.interactive) {
        throw consentUnavailable(question, state, token);
      }
      if (token !== undefined) {
        return confirmByTyping(question, token);
      }
      if (useClack()) {
        return renderWithClack(question, (r) => r.consent(question));
      }
      const raw = await ask(question, `? ${question} (y/n) `);
      return isExplicitYes(raw);
    },
    select: async (question, options, opts) => {
      const fallback = opts?.default;
      if (state.yes || !state.interactive) {
        return answerWithoutAsking(question, fallback, state);
      }
      if (useClack()) {
        return renderWithClack(question, (r) =>
          r.select(question, options, fallback),
        );
      }
      return askSelect(question, options, fallback);
    },
    text: async (question, opts) => {
      const fallback = opts?.default;
      if (state.yes || !state.interactive) {
        return answerWithoutAsking(question, fallback, state);
      }
      if (!useClack()) {
        return askText(question, fallback);
      }
      const value = await renderWithClack<string>(question, (r) =>
        r.text(question, opts?.placeholder, fallback),
      );
      return value === "" ? (fallback ?? "") : value;
    },
    browserWait: async ({ url, message, poll, timeout, interval }) => {
      if (!state.interactive) {
        throw browserWaitUnavailable(message, url);
      }
      await announceUrl(invocation, { url, message });
      const deadline = invocation.now().getTime() + timeout;
      for (;;) {
        if (invocation.signal.aborted) {
          throw promptCancelled(message);
        }
        // biome-ignore lint/performance/noAwaitInLoops: polling waits for the browser to finish; each poll must observe the state left by the one before it, and the delay below is what keeps the request rate down.
        if (await poll(invocation.signal)) {
          return;
        }
        if (invocation.now().getTime() >= deadline) {
          throw browserWaitTimedOut(message, url, timeout);
        }
        await invocation.delay(
          interval ?? BROWSER_WAIT_POLL_INTERVAL_MS,
          invocation.signal,
        );
      }
    },
  };
  /** The claim is taken synchronously, before the prompt's first await:
   *  a handler that starts a prompt without awaiting it has already
   *  begun reading stdin, so ctx.spawn must not hand the same terminal
   *  to a child. */
  const claimTerminal = async <T>(prompt: () => Promise<T>): Promise<T> => {
    requireOwnTerminal();
    state.activePrompts += 1;
    try {
      return await prompt();
    } finally {
      state.activePrompts -= 1;
    }
  };
  return {
    confirm: (question, opts) =>
      claimTerminal(() => surface.confirm(question, opts)),
    consent: (question, opts) =>
      claimTerminal(() => surface.consent(question, opts)),
    select: <T extends string>(
      question: string,
      options: ReadonlyArray<{ value: T; label: string }>,
      opts?: { readonly default?: T },
    ) => claimTerminal(() => surface.select(question, options, opts)),
    text: (question, opts) => claimTerminal(() => surface.text(question, opts)),
    statement: async (question, opts) => {
      const [answer] = await claimTerminal(() =>
        statements([{ question, ...opts }]),
      );
      return answer;
    },
    statements: (questions) => claimTerminal(() => statements(questions)),
    browserWait: (request) => claimTerminal(() => surface.browserWait(request)),
  };
}
