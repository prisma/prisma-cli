import type { EngineCommandSnapshot } from "../run-summary";

/**
 * The payload the engine composes at command start and hands to
 * `Runtime.spawnTelemetry`. The host forwards it to its own sender,
 * which probes its process (runtime/os/arch, package manager, ts
 * version, agent) for the rest of the event and POSTs it.
 *
 * Both sides version-couple on this shape: the carrier is Node's
 * structured clone over IPC, so there is no on-wire compat to maintain.
 */
export interface TelemetryPayload {
  readonly installationId: string;
  readonly version: string;
  /** The command path joined with spaces — `postgres create`. */
  readonly command: string;
  /** Names only, of the flags the user typed. Never values. */
  readonly flags: readonly string[];
  /**
   * Absolute path of the user's project. The sender reads
   * `<projectRoot>/package.json` for `tsVersion`.
   */
  readonly projectRoot: string;
  /** Resolved endpoint URL (already includes the `/events` path). */
  readonly endpoint: string;
  /**
   * Kept for wire compatibility with the ORM CLI's first-`init` flow,
   * where the chosen target is known before the config file exists. The
   * engine never populates it; the wire-format event keeps `null` as its
   * "no target known" marker, but this channel needs only two states so
   * the field is `string | undefined`.
   */
  readonly databaseTarget?: string;
}

/**
 * The value-free projection of a run that flows into the payload. Two
 * fields only — the command path joined with spaces, and the names of
 * the flags the user typed.
 */
export interface SanitizedCommand {
  readonly command: string;
  readonly flags: readonly string[];
}

/**
 * Project the parse-time snapshot into the wire-shape command and flag
 * names. Pure; the snapshot's fields are the only inputs.
 *
 * No flag values, no positionals, no raw argv:
 *   - The wire ships `telemetry status`, never the binary name (the
 *     snapshot's commandPath already excludes it).
 *   - Only flags whose source is `cli` survive — defaulted and
 *     env-sourced flags say nothing about what the user typed.
 *   - Flag names ship in the user-facing kebab-case spelling the engine
 *     recorded; nothing is renamed or filtered per command.
 *   - `positionalCount` is accepted and never read.
 */
export function sanitizeCommandSnapshot(
  snapshot: EngineCommandSnapshot,
): SanitizedCommand {
  return {
    command: snapshot.commandPath.join(" "),
    flags: snapshot.flags.flatMap((flag) =>
      flag.source === "cli" ? [flag.name] : [],
    ),
  };
}

/**
 * The whole payload, from the run's identity plus its snapshot. The
 * snapshot reaches the payload only through
 * {@link sanitizeCommandSnapshot}, so no field of it can arrive by
 * another route. `databaseTarget` is left unset — see its doc-block.
 */
export function composeTelemetryPayload(inputs: {
  readonly installationId: string;
  readonly version: string;
  readonly projectRoot: string;
  readonly endpoint: string;
  readonly snapshot: EngineCommandSnapshot;
}): TelemetryPayload {
  return {
    installationId: inputs.installationId,
    version: inputs.version,
    projectRoot: inputs.projectRoot,
    endpoint: inputs.endpoint,
    ...sanitizeCommandSnapshot(inputs.snapshot),
  };
}
