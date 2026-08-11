import type { EngineEvent, Severity, StreamEvent } from "../events";
import type { Invocation } from "./engine";
import { renderEventHuman } from "./rendering";
import type { DelegatedTerminal } from "./spawn";

/** Commentary buffered during a live child is capped: a session that
 *  holds a converge open for an hour must not accumulate (or later
 *  flush) an unbounded backlog. Events past the cap are dropped and
 *  counted; the flush ends with an explicit dropped-events marker. */
export const SPAWN_COMMENTARY_BUFFER_CAP = 1_000;

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  error: 0,
  warn: 1,
  info: 2,
  verbose: 3,
};

/** The display severity a commentary event is filtered by. `output`
 *  data lines are the command's data, never filtered (undefined). */
function eventDisplaySeverity(event: EngineEvent): Severity | undefined {
  if (event.kind === "message") {
    return event.severity;
  }
  if (event.kind === "output" && event.channel === "data") {
    return undefined;
  }
  return "info";
}

/** report() after the handler resolved is a bug (InternalError). The
 *  run has always settled by the time the resolved flag is observable,
 *  so the only surface left is a stderr note — throwing here would
 *  surface as an unhandled rejection in a detached async context. */
function reportAfterResolution(invocation: Invocation): void {
  invocation.runtime.stderr.write(
    "✘ [CLI.INTERNAL_ERROR] @prisma/cli-engine: report() was called after the handler resolved\n",
  );
}

export function reportEvent(invocation: Invocation, event: EngineEvent): void {
  const state = invocation.state;
  if (state.resolved) {
    reportAfterResolution(invocation);
    return;
  }
  // No engine write may interleave with a delegated terminal's child
  // output; the buffer is flushed in order when the child ends.
  const terminal = state.delegatedTerminal;
  if (terminal !== undefined) {
    if (terminal.buffered.length >= SPAWN_COMMENTARY_BUFFER_CAP) {
      terminal.dropped += 1;
      return;
    }
    terminal.buffered.push(event);
    return;
  }
  invocation.hooks.onEvent?.(event);
  const severity = eventDisplaySeverity(event);
  if (
    severity !== undefined &&
    SEVERITY_RANK[severity] > SEVERITY_RANK[state.logLevel]
  ) {
    return;
  }
  if (state.format === "json") {
    emitFrame(invocation, {
      ...event,
      commandId: state.commandId,
      timestamp: invocation.now().toISOString(),
    });
    return;
  }
  renderEventHuman(invocation, event);
}

export function flushBufferedEvents(
  invocation: Invocation,
  terminal: DelegatedTerminal,
): void {
  for (const event of terminal.buffered) {
    reportEvent(invocation, event);
  }
  if (terminal.dropped > 0) {
    reportEvent(invocation, {
      kind: "message",
      severity: "warn",
      text: `${terminal.dropped} buffered event${terminal.dropped === 1 ? "" : "s"} dropped while a child owned the terminal`,
    });
  }
}

export function emitFrame(invocation: Invocation, frame: StreamEvent): void {
  invocation.runtime.stdout.write(`${JSON.stringify(frame)}\n`);
  invocation.hooks.onStreamEvent?.(frame);
}
