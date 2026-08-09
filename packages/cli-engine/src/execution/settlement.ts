import type { AnyCommand } from "../definition/commands";
import type {
  CompletedEnvelope,
  ErroredEnvelope,
} from "../definition/envelopes";
import { PRESENTED, type PresentedResult } from "../definition/presentation";
import { CliStructuredError, type Diagnostic } from "../protocol";
import { emitFrame } from "./events";
import { firstLine, type Invocation } from "./invocation";
import { renderCompletedHuman, withDocsUrl, writeDiagnostic } from "./render";

function undocumentedExitCode(
  def: AnyCommand,
  exitCode: number,
): Error | undefined {
  if (exitCode === 0) {
    return undefined;
  }
  const documented =
    def.kind === "result-command" && def.exitCodes !== undefined
      ? Object.keys(def.exitCodes).map(Number)
      : [];
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
  state.settledExitCode = presented.exitCode;
  if (state.format === "json") {
    const envelope: CompletedEnvelope = {
      ok: true,
      commandId: state.commandId,
      result:
        presented.presentation.json === undefined
          ? presented.data
          : presented.presentation.json,
      exitCode: presented.exitCode,
      diagnostics: presented.diagnostics.map((diagnostic) =>
        withDocsUrl(state, diagnostic),
      ),
      nextActions: presented.presentation.next ?? [],
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
    diagnostics,
    nextActions: error.nextActions ?? [],
  });
}

/** Signal exit codes (R6): 130 SIGINT, 143 SIGTERM. The engine's own
 *  controller only ever aborts with a signal name. */
function signalExitCode(reason: unknown): number {
  return reason === "SIGTERM" ? 143 : 130;
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
    settleErrored(invocation, cause);
  } else {
    settleBug(invocation, cause);
  }
}

function settleAborted(invocation: Invocation): void {
  const state = invocation.state;
  state.settledExitCode = signalExitCode(invocation.signal.reason);
  emitErrored(invocation, {
    ok: false,
    commandId: state.commandId,
    error: {
      code: "CLI.ABORTED",
      severity: "error",
      summary: "The command was aborted before it completed.",
    },
    diagnostics: [],
    nextActions: [],
  });
}

/** A session command that returned ok — including after the signal
 *  fired — shut down cleanly: exit 0, no presentation. In json mode the
 *  stream still terminates with exactly one result frame. */
export function settleSessionCompleted(invocation: Invocation): void {
  const state = invocation.state;
  state.settledExitCode = 0;
  if (state.format !== "json") {
    return;
  }
  const envelope: CompletedEnvelope = {
    ok: true,
    commandId: state.commandId,
    result: null,
    exitCode: 0,
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
  const stderr = invocation.runtime.stderr;
  writeDiagnostic(stderr, envelope.error);
  for (const diagnostic of envelope.diagnostics) {
    writeDiagnostic(stderr, diagnostic);
  }
}
