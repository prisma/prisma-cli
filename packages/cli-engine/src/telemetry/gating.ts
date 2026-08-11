import type { UserConfig } from "./user-config";

/**
 * Why telemetry resolved the way it did. Total: every resolution carries
 * a reason, enabled or not, so `telemetry status` projects its copy from
 * the resolution instead of re-deriving the decision.
 */
export type TelemetryDisabledReason = "ci" | "env-opt-out" | "stored-opt-out";
export type TelemetryEnabledReason = "stored-opt-in" | "default-on";
export type TelemetryStatusReason =
  | TelemetryDisabledReason
  | TelemetryEnabledReason;

export type GatingResolution =
  | { readonly enabled: true; readonly reason: TelemetryEnabledReason }
  | { readonly enabled: false; readonly reason: TelemetryDisabledReason };

export interface GatingInputs {
  /**
   * Environment-variable lookups the resolver consults. Tests pass a
   * literal record; production passes the process environment. The two
   * opt-out signals are `PRISMA_DISABLE_TELEMETRY` (Prisma-specific)
   * and `DO_NOT_TRACK` (community convention).
   */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Result of `readUserConfig()` — file-missing tolerated as `{}`. */
  readonly config: UserConfig;
  /** CI detection, supplied by the host through `Runtime.isCI`. The
   *  engine never detects CI itself. CI hard-disables. */
  readonly inCI: boolean;
}

/**
 * A `PRISMA_DISABLE_TELEMETRY` value counts as an opt-out only if it
 * parses as a truthy string. The set-but-falsy spellings (`''`, `'0'`,
 * `'false'`) are intentionally treated as not-set so a parent shell that
 * exports the variable to a benign value doesn't accidentally disable
 * telemetry for child processes.
 */
function isTruthyOptOut(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const normalised = raw.trim().toLowerCase();
  if (normalised === "") return false;
  if (normalised === "0") return false;
  if (normalised === "false") return false;
  return true;
}

/**
 * Pure-function resolution of the gating decision. Same input → same
 * output; no I/O. The caller reads the env, the user config and the CI
 * signal.
 *
 * Decision order:
 *   1. CI (`inCI`) → disabled (`ci`). CI environments never emit,
 *      regardless of any stored consent.
 *   2. Env-var override (`PRISMA_DISABLE_TELEMETRY` truthy, or
 *      `DO_NOT_TRACK=1`) → disabled (`env-opt-out`), winning over any
 *      stored or unset preference.
 *   3. Stored `enableTelemetry === false` → disabled (`stored-opt-out`).
 *   4. Stored `enableTelemetry === true` → enabled (`stored-opt-in`).
 *   5. Stored `enableTelemetry === undefined` (file missing, or field
 *      not set) → ENABLED (`default-on`). This is the opt-out default:
 *      absence of an explicit choice means telemetry is on. This branch
 *      carries the whole opt-out model — do not "fix" it to default-off.
 */
export function resolveGating(inputs: GatingInputs): GatingResolution {
  if (inputs.inCI) {
    return { enabled: false, reason: "ci" };
  }
  if (
    isTruthyOptOut(inputs.env["PRISMA_DISABLE_TELEMETRY"]) ||
    inputs.env["DO_NOT_TRACK"] === "1"
  ) {
    return { enabled: false, reason: "env-opt-out" };
  }
  if (inputs.config.enableTelemetry === false) {
    return { enabled: false, reason: "stored-opt-out" };
  }
  if (inputs.config.enableTelemetry === true) {
    return { enabled: true, reason: "stored-opt-in" };
  }
  return { enabled: true, reason: "default-on" };
}
