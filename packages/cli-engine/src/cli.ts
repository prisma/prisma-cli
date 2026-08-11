import type { CommandFamily, MountedTree } from "./command-family";
import { buildEngine } from "./execution/engine";
import type { RunSummary } from "./run-summary";
import type { Runtime } from "./runtime";
import type { TelemetryDeclaration } from "./telemetry/report";

/**
 * The observation hooks a bin may attach to a run. Deliberately
 * narrower than the engine's internal hook set (whose other members
 * are test seams reachable only through the ./testing harness).
 */
export interface CliRunHooks {
  /** Fired exactly once per run, after settlement, for runs that
   *  reached a mounted command. Never fired for --help/--version.
   *  Errors thrown by the hook are swallowed. */
  readonly onSettled?: (summary: RunSummary) => void;
}

export interface Cli {
  /**
   * Parse, execute, render, return the exit code. Never touches
   * process globals — it exits only through the runtime's exit proxy
   * (second-signal force exit) and writes only to the provided streams.
   * `hooks` is the bin's observation seam (telemetry).
   */
  run(
    argv: readonly string[],
    runtime: Runtime,
    hooks?: CliRunHooks,
  ): Promise<number>;
}

/**
 * Shell-side construction. Group help is declared with the mount.
 * Collisions, unknown groups, reserved-flag violations, grammar
 * violations, and foreign-section references fail construction (build
 * time, not run time).
 */
export function createCli(spec: {
  readonly name: string;
  readonly version: string;
  readonly commandFamilies: readonly CommandFamily[];
  readonly groups: Readonly<
    Record<string, { readonly brief: string; readonly description?: string }>
  >;
  readonly commands: MountedTree;
  /**
   * Declaring this turns telemetry on: the engine reads the user's
   * preference, discloses on the first enabled run, mints the shared
   * installation id, and hands one payload per run to
   * `Runtime.spawnTelemetry`. Omitting it means the CLI reports
   * nothing — no config read, no disclosure, no mint, no seam call.
   */
  readonly telemetry?: TelemetryDeclaration;
}): Cli {
  const engine = buildEngine(spec);
  return {
    run: (argv, runtime, hooks) =>
      engine.execute(argv, runtime, { onSettled: hooks?.onSettled }),
  };
}
