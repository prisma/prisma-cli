/**
 * The value-free command snapshot the engine records at parse time and
 * hands to `RunHooks.onSettled`. Consumed by the shell's telemetry
 * wiring; carries NO user data — command-path segments, flag names
 * with their value source, and a bare count of positionals. Flag
 * values, positional values, and raw argv never appear here.
 */
export interface EngineCommandSnapshot {
  /** Mount-path segments of the executed command ('telemetry status'
   *  → ['telemetry', 'status']). Never includes the binary name. */
  readonly commandPath: readonly string[];
  /**
   * One entry per flag the command accepts (the engine-injected shared
   * family first, then the command's own declarations), named in the
   * user-facing kebab-case spelling. `source` is what the engine knows
   * at parse time: flags explicitly present on argv are 'cli'; the
   * engine reads no flags from the environment today, so everything
   * else is 'default'. 'env' is reserved for a future env-sourced
   * flag mechanism.
   */
  readonly flags: ReadonlyArray<{
    readonly name: string;
    readonly source: "cli" | "env" | "default";
  }>;
  /** How many positional arguments the run supplied — a count only. */
  readonly positionalCount: number;
}

/**
 * What `RunHooks.onSettled` receives, exactly once per run, after the
 * run has settled (exit code determined, terminal output written).
 * Never fired for `--help` or `--version`, and never for a run that
 * failed before a mounted command was reached (nothing executed, so
 * there is no snapshot to report). `durationMs` comes from the
 * engine's injectable clock.
 */
export interface RunSummary {
  /** The mounted command's dotted id ('telemetry.status'). Derived
   *  from the same mount entry as `snapshot.commandPath` — it always
   *  equals `snapshot.commandPath.join('.')`. Both are kept: consumers
   *  addressing the command use the id; the snapshot is the value-free
   *  wire projection. */
  readonly commandId: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly snapshot: EngineCommandSnapshot;
}
