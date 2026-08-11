/**
 * Input shape: the engine's parse-time command snapshot. Declared
 * structurally here (not imported from `@prisma/cli-engine`) so this
 * package carries no engine dependency — the engine declares the
 * identical shape and the two stay compatible structurally, the same
 * way the ORM CLI's sanitiser declared a thin projection of commander
 * instead of importing it.
 *
 * The snapshot carries NO VALUES, ever: flag names with their value
 * source, the command path, and a bare count of positionals. The
 * engine builds it from what it knows at parse time; raw argv, flag
 * values, and positional values never reach this module.
 */
export interface EngineCommandSnapshot {
  /** Mount-path segments of the executed command, e.g. `['telemetry',
   *  'status']`. Never includes the binary name. */
  readonly commandPath: readonly string[];
  /**
   * One entry per flag the engine knows for the command, in
   * declaration order. `source` is where the value came from: only
   * `'cli'` (explicitly passed by the user) survives sanitisation.
   */
  readonly flags: ReadonlyArray<{
    readonly name: string;
    readonly source: "cli" | "env" | "default";
  }>;
  /**
   * How many positional arguments the run supplied. A count only —
   * positional VALUES never leave the engine. Intentionally never
   * read by the sanitiser; the field exists so the call site makes it
   * obvious positionals were deliberately reduced to a number.
   */
  readonly positionalCount: number;
}

/**
 * Output shape: the sanitised projection that flows into the telemetry
 * payload. Two fields only — command name (space-delimited subcommand
 * path) and flag names (in the snapshot's declaration order).
 */
export interface SanitizedCommand {
  readonly command: string;
  readonly flags: readonly string[];
}

/**
 * Project the engine snapshot into the wire-shape command and
 * flag-name list. Pure; the only allowed inputs are the fields of
 * `EngineCommandSnapshot`.
 *
 * Sanitiser contract — no flag values, no positionals, no raw argv:
 *   - The wire ships `telemetry status`, never the binary name (the
 *     engine's commandPath already excludes it).
 *   - Emit only flags whose source is `cli` — defaulted and
 *     env-sourced flags say nothing about what the user typed.
 *   - Emit the user-facing kebab-case flag spelling the engine
 *     recorded; nothing is renamed here.
 *   - `positionalCount` is accepted but never consumed.
 */
export function sanitizeEngineSnapshot(
  snapshot: EngineCommandSnapshot,
): SanitizedCommand {
  return {
    command: snapshot.commandPath.join(" "),
    flags: snapshot.flags.flatMap((flag) =>
      flag.source === "cli" ? [flag.name] : [],
    ),
  };
}
