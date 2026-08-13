import { kebabCase } from "../args";
import type { CommandRedirect } from "../command-family";
import type {
  AnyCommand,
  CompletedEnvelope,
  ErroredEnvelope,
} from "../commands";
import { PRESENTED, type PresentedResult } from "../presentation";
import {
  CliStructuredError,
  type Diagnostic,
  type NextAction,
} from "../protocol";
import { type ChildStatusSettlement, childExitCode } from "../spawn";
import type { EngineSpec, Invocation } from "./engine";
import { makePaint } from "./palette";
import {
  diagnosticSection,
  firstLine,
  renderCompletedHuman,
  renderNextAction,
  withDocsUrl,
  writeSections,
} from "./rendering";
import { emitFrame } from "./reporting";
import { resolveExample, usageErrorCode } from "./stricli-adapter";

function undocumentedExitCode(
  def: AnyCommand,
  exitCode: number,
): Error | undefined {
  if (exitCode === 0) {
    return undefined;
  }
  const documented =
    def.kind === "result-command" ? Object.keys(def.exitCodes).map(Number) : [];
  if (documented.includes(exitCode)) {
    return undefined;
  }
  return new Error(
    `@prisma/cli-engine: the handler completed with exit code ${exitCode}, which is not 0 or one of the command's documented exit codes`,
  );
}

export function settleCompleted(
  invocation: Invocation,
  def: AnyCommand,
  presented: PresentedResult<unknown>,
): void {
  if (
    typeof presented !== "object" ||
    presented === null ||
    (presented as unknown as Record<symbol, unknown>)[PRESENTED] !== true
  ) {
    settleBug(
      invocation,
      new Error(
        "@prisma/cli-engine: a handler returned ok(...) without a PresentedResult built by ctx.present",
      ),
    );
    return;
  }
  const violation = undocumentedExitCode(def, presented.exitCode);
  if (violation !== undefined) {
    settleBug(invocation, violation);
    return;
  }
  const state = invocation.state;
  invocation.hooks.onPresented?.(presented);
  const exitCode = runExitCode(invocation, presented.exitCode);
  state.settledExitCode = exitCode;
  if (state.format === "json") {
    const envelope: CompletedEnvelope = {
      ok: true,
      commandId: state.commandId,
      result: presented.presentation.json,
      exitCode,
      diagnostics: presented.diagnostics.map((diagnostic) =>
        withDocsUrl(state, diagnostic),
      ),
      nextActions: presented.presentation.next,
    };
    emitFrame(invocation, {
      kind: "result",
      envelope,
      commandId: state.commandId,
      timestamp: invocation.now().toISOString(),
    });
    return;
  }
  renderCompletedHuman(invocation, presented);
}

function diagnosticOf(error: CliStructuredError): Diagnostic {
  const { ok: _ok, ...diagnostic } = error.toEnvelope();
  return diagnostic;
}

/** The list is typed, but nothing at runtime has checked it: an error
 *  built by another copy of the engine passes `CliStructuredError.is`
 *  on its name, its code and its `toEnvelope` alone, and a handler's
 *  `notOk` failure is checked by nothing at all. A value that is not a
 *  list settles as no accompanying findings rather than reaching the
 *  human renderer and the json envelope as garbage. */
function accompanyingFindings(diagnostics: unknown): readonly Diagnostic[] {
  return Array.isArray(diagnostics)
    ? (diagnostics as readonly Diagnostic[])
    : [];
}

export function settleErrored(
  invocation: Invocation,
  error: CliStructuredError,
  diagnostics: readonly Diagnostic[] = [],
): void {
  const state = invocation.state;
  state.settledExitCode = error.code === "CLI.PROMPT_CANCELLED" ? 3 : 2;
  emitErrored(invocation, {
    ok: false,
    commandId: state.commandId,
    error: diagnosticOf(error),
    diagnostics: accompanyingFindings(diagnostics),
    nextActions: error.nextActions,
  });
}

/** The conventional code for a delivered signal: 128 + its number, so
 *  130 for SIGINT and 143 for SIGTERM. */
function signalExitCode(signal: "SIGINT" | "SIGTERM"): number {
  return signal === "SIGTERM" ? 143 : 130;
}

/**
 * The engine's own signal record decides how a run ends. A run a
 * delivered signal terminated settles 128 + that signal's number even
 * when its handler caught the signal, cleaned up, and returned
 * successfully: the exit code states how the RUN ended, and a handler
 * cannot author it — the documented codes stop at 99.
 *
 * Verbatim codes are the exception, because they were never this CLI's
 * to state: a real child's status (the child owned the terminal and the
 * signal reached it too) and a server command's protocol conclusion
 * both pass through untouched.
 */
function runExitCode(invocation: Invocation, completed: number): number {
  const signal = invocation.state.deliveredSignal;
  return signal === undefined ? completed : signalExitCode(signal);
}

function isAbortCause(cause: unknown, signal: AbortSignal): boolean {
  if (!signal.aborted) {
    return false;
  }
  if (cause === signal.reason) {
    return true;
  }
  return cause instanceof Error && cause.name === "AbortError";
}

export function settleThrown(invocation: Invocation, cause: unknown): void {
  if (isAbortCause(cause, invocation.signal)) {
    settleAborted(invocation);
  } else if (CliStructuredError.is(cause)) {
    settleErrored(invocation, cause, cause.diagnostics);
  } else {
    settleBug(invocation, cause);
  }
}

function settleAborted(invocation: Invocation): void {
  const state = invocation.state;
  const signal = state.deliveredSignal;
  // The run's signal is aborted from one place, and it records the
  // signal first, so an abort without one would be an engine fault;
  // it settles cancelled rather than claiming a signal that never came.
  state.settledExitCode = signal === undefined ? 3 : signalExitCode(signal);
  emitErrored(invocation, {
    ok: false,
    commandId: state.commandId,
    error: {
      code: "CLI.ABORTED",
      severity: "error",
      summary: "The command was aborted before it completed.",
      nextActions: [],
    },
    diagnostics: [],
    nextActions: [],
  });
}

/**
 * Settle an exit code the engine did not author, verbatim, with no
 * envelope and no presentation: something other than this CLI's code
 * space produced it. The two callers are the child-status settlement
 * and the server-command handoff. A delivered signal does not overrule
 * it — a code from outside is reported as it was received.
 */
export function settleVerbatimExitCode(
  invocation: Invocation,
  exitCode: number,
): void {
  invocation.state.settledExitCode = exitCode;
}

/**
 * The child owned the terminal, so its status becomes the run's
 * verbatim: the one path on which a result command settles a code it
 * never documented, because the code is not the handler's own
 * conclusion, it is the child's.
 *
 * The status comes from the engine's own record of the child, never
 * from the handler, so there is nothing here for a handler to state.
 * Two conditions fence it, both construction errors: the command must
 * hand the terminal to another program — reachable from a
 * non-declaring handler this would also end a json stream without its
 * terminal result frame — and a child must actually have run.
 *
 * A signal-killed child overrules whatever the handler asked for. The
 * user stopped the run: it settles 128 + the signal number, with no
 * envelope and no next actions, because there is nothing to reproduce.
 */
export function settleChildStatus(
  invocation: Invocation,
  def: AnyCommand,
  settlement: ChildStatusSettlement,
): void {
  if (!def.maySpawn) {
    throw new Error(
      `@prisma/cli-engine: command '${invocation.state.commandId}' returned exitWithChildStatus without declaring maySpawn — only a command that hands the terminal to another program may settle with that program's status`,
    );
  }
  const child = invocation.state.lastChild;
  if (child === undefined) {
    throw new Error(
      `@prisma/cli-engine: command '${invocation.state.commandId}' returned exitWithChildStatus without a child having run — that settlement reports the status of a child ctx.spawn started, and this run started none`,
    );
  }
  // Only human format is reachable here: maySpawn forces it.
  if (child.signal === null) {
    for (const action of settlement.nextActions) {
      invocation.runtime.stderr.write(
        `${renderNextAction(action, makePaint(invocation.state.colorEnabled))}\n`,
      );
    }
  }
  settleVerbatimExitCode(invocation, childExitCode(child));
}

/** A session command that returned ok shut down cleanly: no
 *  presentation, and exit 0 — unless a signal ended the run, which
 *  settles 130/143 from the engine's record even though the shutdown
 *  itself succeeded. In json mode the stream still terminates with
 *  exactly one result frame. */
export function settleSessionCompleted(invocation: Invocation): void {
  const state = invocation.state;
  const exitCode = runExitCode(invocation, 0);
  state.settledExitCode = exitCode;
  if (state.format !== "json") {
    return;
  }
  const envelope: CompletedEnvelope = {
    ok: true,
    commandId: state.commandId,
    result: null,
    exitCode,
    diagnostics: [],
    nextActions: [],
  };
  emitFrame(invocation, {
    kind: "result",
    envelope,
    commandId: state.commandId,
    timestamp: invocation.now().toISOString(),
  });
}

export function settleBug(invocation: Invocation, cause: unknown): void {
  const state = invocation.state;
  state.settledExitCode = 1;
  emitErrored(invocation, {
    ok: false,
    commandId: state.commandId,
    error: {
      code: "CLI.INTERNAL_ERROR",
      severity: "error",
      summary: firstLine(
        cause instanceof Error ? cause.message : String(cause),
      ),
      nextActions: [],
    },
    diagnostics: [],
    nextActions: [],
  });
}

export function emitErrored(
  invocation: Invocation,
  raw: ErroredEnvelope,
): void {
  const state = invocation.state;
  const envelope: ErroredEnvelope = {
    ...raw,
    error: withDocsUrl(state, raw.error),
    diagnostics: raw.diagnostics.map((diagnostic) =>
      withDocsUrl(state, diagnostic),
    ),
  };
  if (state.format === "json") {
    emitFrame(invocation, {
      kind: "result",
      envelope,
      commandId: envelope.commandId,
      timestamp: invocation.now().toISOString(),
    });
    return;
  }
  const paint = makePaint(invocation.state.colorEnabled);
  writeSections(
    [envelope.error, ...envelope.diagnostics].map((diagnostic) =>
      diagnosticSection(diagnostic, paint),
    ),
    invocation.runtime.stderr,
  );
}

/** `--version` prints createCli's version and exits 0. In json mode the
 *  version travels as the run's single result frame. */
export function settleVersion(
  spec: EngineSpec,
  invocation: Invocation,
): number {
  const { runtime, state } = invocation;
  if (state.format === "human") {
    runtime.stdout.write(`${spec.version}\n`);
    return 0;
  }
  emitFrame(invocation, {
    kind: "result",
    envelope: {
      ok: true,
      commandId: "version",
      result: { version: spec.version },
      exitCode: 0,
      diagnostics: [],
      nextActions: [],
    },
    commandId: "version",
    timestamp: invocation.now().toISOString(),
  });
  return 0;
}

/** What the user typed that no longer exists: a retired path, or a
 *  retired flag on a command that still exists. */
function retiredInvocation(redirect: CommandRedirect): string {
  if (redirect.flag === undefined) {
    return `\`${redirect.from}\``;
  }
  return `\`--${kebabCase(redirect.flag)}\` on \`${redirect.from}\``;
}

/** A retired invocation the redirect table claims: the run names its
 *  replacement instead of failing as an unknown command or flag. A
 *  retired flag can name a server command, whose stdout belongs to a
 *  foreign client — so this settlement renders to stderr for the same
 *  reason settleUnhandled does. */
export function settleCommandMoved(
  spec: EngineSpec,
  invocation: Invocation,
  redirect: CommandRedirect,
  commandId: string,
): number {
  if (spec.commands[redirect.from]?.kind === "server-command") {
    invocation.state.format = "human";
  }
  const useReplacement: NextAction = {
    kind: "run-command",
    label: "Use the replacement",
    command: resolveExample(redirect.replacement, spec.name),
  };
  emitErrored(invocation, {
    ok: false,
    commandId,
    error: {
      code: "CLI.COMMAND_MOVED",
      severity: "error",
      summary: `${retiredInvocation(redirect)} has been replaced`,
      ...(redirect.reason === undefined ? {} : { why: redirect.reason }),
      nextActions: [useReplacement],
    },
    diagnostics: [],
    nextActions: [useReplacement],
  });
  return 2;
}

/** The command path stricli resolved, without the binary name. */
export function commandSegments(
  spec: EngineSpec,
  prefix: readonly string[],
): readonly string[] {
  return prefix[0] === spec.name ? prefix.slice(1) : prefix;
}

/** Maps stricli's own settlement (parse/route failures, framework bugs)
 *  onto the engine protocol when the pipeline never settled. A failure
 *  addressed at a server command renders to stderr — a foreign client on
 *  the other end of stdout must never receive an engine envelope. */
export function settleUnhandled(
  spec: EngineSpec,
  invocation: Invocation,
  stricliExitCode: number | string | null | undefined,
): number {
  const state = invocation.state;
  const raw = typeof stricliExitCode === "number" ? stricliExitCode : 0;
  if (raw === 0) {
    return 0;
  }
  const segments = commandSegments(spec, state.prefix);
  if (spec.commands[segments.join(" ")]?.kind === "server-command") {
    state.format = "human";
  }
  const usage = usageErrorCode(raw) !== undefined;
  const captured = usage
    ? state.stricliStderr.trim()
    : (state.usageErrorText ??
      state.internalErrorText ??
      state.stricliStderr.trim());
  const full =
    captured.length > 0 ? captured : "The command failed unexpectedly";
  const summary = firstLine(full);
  const remainder = full.slice(full.indexOf("\n") + 1).trim();
  const code = usageErrorCode(raw) ?? "CLI.INTERNAL_ERROR";
  const nextActions =
    code === "CLI.UNKNOWN_COMMAND" ? unknownCommandActions(spec, state) : [];
  const envelope: ErroredEnvelope = {
    ok: false,
    commandId: segments.join("."),
    error: {
      code,
      severity: "error",
      summary,
      ...(usage && full.includes("\n") && remainder.length > 0
        ? { why: remainder }
        : {}),
      nextActions,
    },
    diagnostics: [],
    nextActions,
  };
  emitErrored(invocation, envelope);
  return usage ? 2 : 1;
}

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[] = Array.from({ length: rows * cols }, () => 0);
  for (let i = 0; i < rows; i += 1) {
    d[i * cols] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    d[j] = j;
  }
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i * cols + j] = Math.min(
        d[(i - 1) * cols + j] + 1,
        d[i * cols + j - 1] + 1,
        d[(i - 1) * cols + j - 1] + substitution,
      );
    }
  }
  return d[rows * cols - 1];
}

/** A misspelling is close (edit distance ≤ 2, and short paths tighter);
 *  anything further is not a suggestion worth making. Every unknown
 *  command at least learns where the command list is. */
function unknownCommandActions(
  spec: EngineSpec,
  state: { readonly argv: readonly string[] },
): NextAction[] {
  const attempted: string[] = [];
  for (const token of state.argv) {
    if (token.startsWith("-")) {
      break;
    }
    attempted.push(token);
  }
  const typed = attempted.join(" ");
  const candidates = new Set<string>(Object.keys(spec.commands));
  for (const path of Object.keys(spec.commands)) {
    const segments = path.split(" ");
    for (let depth = 1; depth < segments.length; depth += 1) {
      candidates.add(segments.slice(0, depth).join(" "));
    }
  }
  const ranked = [...candidates]
    .map((path) => ({ path, distance: editDistance(typed, path) }))
    .filter(
      ({ path, distance }) =>
        distance <=
        Math.max(path.length >= 8 ? 3 : 1, Math.min(2, path.length - 1)),
    )
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3);
  return [
    ...ranked.map(
      ({ path }): NextAction => ({
        kind: "run-command",
        label: "Did you mean",
        command: `${spec.name} ${path}`,
      }),
    ),
    {
      kind: "run-command",
      label: "List every command",
      command: `${spec.name} --help`,
    },
  ];
}
