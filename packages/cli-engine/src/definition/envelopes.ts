import type { Diagnostic, NextAction } from "../protocol";
import type { EngineEvent } from "./events";

export interface CompletedEnvelope<T = unknown> {
  /**
   * ok = COMPLETED (the command executed to its end). A completed
   * result may still carry findings and a non-zero exit code — bad
   * news is a result, not an error.
   */
  readonly ok: true;
  /**
   * The command's stable dotted identity — its full command path
   * ('project.env.add'). The schema-dispatch key for machine consumers.
   */
  readonly commandId: string;
  readonly result: T;
  readonly exitCode: number;
  /** The recorded findings, verbatim from the presented outcome. */
  readonly diagnostics: readonly Diagnostic[];
  readonly nextActions: readonly NextAction[];
}

export interface ErroredEnvelope {
  /** ok = false: the command did NOT complete. */
  readonly ok: false;
  readonly commandId: string;
  /**
   * The PRIMARY error — what aborted the command. Severity 'error' by
   * definition. A thrown CliStructuredError serializes to exactly this
   * shape.
   */
  readonly error: Diagnostic;
  /** Accompanying findings when the abort had several. */
  readonly diagnostics: readonly Diagnostic[];
  /**
   * Copied from the error's own nextActions — the uniform consumer
   * read path (envelope.nextActions) on both settlement paths.
   */
  readonly nextActions: readonly NextAction[];
}

/**
 * json mode emits one StreamEvent per line: the handler's events,
 * flattened with the stream metadata, then exactly one terminal
 * 'result' member carrying the envelope.
 */
export type StreamEvent =
  | (EngineEvent & StreamMeta)
  | ({
      readonly kind: "result";
      readonly envelope: CompletedEnvelope | ErroredEnvelope;
    } & StreamMeta);

export interface StreamMeta {
  readonly commandId: string;
  /** ISO 8601 UTC. Injectable clock in tests. */
  readonly timestamp: string;
}
