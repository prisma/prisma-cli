import type { StreamEvent } from "../envelopes";
import type { EngineEvent, LogLevel, Severity } from "../events";
import type { Invocation } from "./invocation";
import { renderEventHuman } from "./render";

export const SEVERITY_RANK: Readonly<Record<LogLevel, number>> = {
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
    "✖ [CLI.INTERNAL_ERROR] @prisma/cli-engine: report() was called after the handler resolved\n",
  );
}

export function reportEvent(invocation: Invocation, event: EngineEvent): void {
  const state = invocation.state;
  if (state.resolved) {
    reportAfterResolution(invocation);
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

export function emitFrame(invocation: Invocation, frame: StreamEvent): void {
  invocation.runtime.stdout.write(`${JSON.stringify(frame)}\n`);
  invocation.hooks.onStreamEvent?.(frame);
}
