import type { CommandFamily, MountedTree } from "./command-family";
import type { WorkflowStep } from "./commands";
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
    Record<
      string,
      {
        readonly brief: string;
        readonly description?: string;
        /** The group's common path, rendered as a `Workflow` section. */
        readonly workflow?: readonly WorkflowStep[];
      }
    >
  >;
  readonly commands: MountedTree;
  /** Words for the root help card; the engine formats. */
  readonly help?: {
    readonly tagline?: string;
    readonly description?: string;
    /** The CLI's common path, rendered as a `Workflow` section. */
    readonly workflow?: readonly WorkflowStep[];
    readonly examples?: readonly string[];
    readonly docsUrl?: string;
  };
  /**
   * Declaring this, together with a `Runtime.spawnTelemetry` seam,
   * turns telemetry on: the engine reads the user's preference,
   * discloses on the first enabled run, mints the shared installation
   * id, and hands one payload per run to the seam. Both halves are
   * required — with either one missing the CLI reports nothing, and
   * reads no config, prints no disclosure and mints no id.
   */
  readonly telemetry?: TelemetryDeclaration;
}): Cli {
  const engine = buildEngine(spec);
  return {
    run: (argv, runtime, hooks) =>
      engine.execute(argv, runtime, { onSettled: hooks?.onSettled }),
  };
}
