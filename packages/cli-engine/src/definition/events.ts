import type { NextAction } from "../protocol";

/**
 * The commentary severity scale; also the log-level axis. Distinct from
 * Diagnostic severity: 'verbose' grades commentary, which never enters
 * the envelope.
 */
export type Severity = "error" | "warn" | "info" | "verbose";
export type LogLevel = Severity;

/**
 * The engine event envelope. `kind`-specific fields are the common
 * vocabulary the engine renders (human mode) and streams (json mode);
 * `data` is the command family's extension, passed through untouched.
 * Events are transcript, never aggregated into any envelope. Follow-ups
 * are handler-owned: completed via `presentations.next`, errored via the
 * error's own `nextActions`.
 */
export type EngineEvent =
  | {
      readonly kind: "step-started";
      readonly step: string;
      readonly id?: string;
      readonly parentId?: string;
      readonly data?: unknown;
    }
  | {
      readonly kind: "step-finished";
      readonly step: string;
      readonly id?: string;
      readonly outcome: "ok" | "failed" | "skipped" | "warning";
      readonly data?: unknown;
    }
  | {
      readonly kind: "progress";
      readonly step?: string;
      readonly completed: number;
      readonly total?: number;
      readonly data?: unknown;
    }
  /**
   * Commentary at a severity; display-filtered by log level. 'error' is
   * not valid here: fatal problems are the Result's error;
   * envelope-worthy findings are diagnostics.
   */
  | {
      readonly kind: "message";
      readonly severity: Exclude<Severity, "error">;
      readonly text: string;
      readonly data?: unknown;
    }
  | {
      readonly kind: "output";
      readonly source: string;
      readonly channel: "data" | "diagnostic";
      readonly line: string;
      readonly data?: unknown;
    }
  /**
   * Transcript-only: framed in json mode, never rendered in human mode,
   * never aggregated into any envelope.
   */
  | {
      readonly kind: "remediation";
      readonly action: NextAction;
      readonly data?: unknown;
    }
  | {
      readonly kind: "endpoint";
      readonly name: string;
      readonly url: string;
      readonly data?: unknown;
    }
  | {
      readonly kind: "status";
      readonly subject: string;
      readonly status: string;
      readonly from?: string;
      readonly data?: unknown;
    }
  | {
      readonly kind: "artifact";
      readonly path: string;
      readonly description?: string;
      readonly data?: unknown;
    };
