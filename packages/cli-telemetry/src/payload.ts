/**
 * Wire-shape payload the parent IPC-sends to the forked child sender:
 * installation id, sanitized command + flags, CLI version, and the
 * project root the child uses to discover everything else. The engine
 * composes it at command start (`TelemetryPayload` in
 * `@prisma/cli-engine`); this is the child's own declaration of the
 * same shape, kept structural so the forked sender stays a leaf with no
 * engine dependency. The two are checked against each other where they
 * meet, in the bin that hands one to the other.
 *
 * The child probes its own process (runtime/os/arch, package manager, ts
 * version, agent). The ORM CLI's child additionally loaded
 * `prisma-next.config.*` via c12 for `databaseTarget` + `extensions`;
 * that config does not exist in this product, so the load was dropped
 * (recorded as an S2a divergence) and those event fields come from the
 * payload alone.
 *
 * `databaseTarget` is an optional parent-side value kept for wire
 * compatibility with the ORM CLI's first-`init` flow. When unset the
 * event ships `null` — there is no third state, so the field's type is
 * `string | undefined`, not `string | null | undefined`.
 *
 * Both sides version-couple on this shape because the IPC carrier is
 * structured-cloned by Node and there's no on-wire compat to maintain.
 */
export interface ParentToSenderPayload {
  readonly installationId: string;
  readonly version: string;
  readonly command: string;
  readonly flags: readonly string[];
  /**
   * Absolute path of the user's project. The child reads
   * `<projectRoot>/package.json` for `tsVersion`.
   */
  readonly projectRoot: string;
  /** Resolved endpoint URL (already includes the `/events` path). */
  readonly endpoint: string;
  /**
   * Optional parent-side database target. The wire-format
   * `TelemetryEvent.databaseTarget: string | null` keeps `null` as the
   * on-the-wire "no target known" marker, but the IPC channel only
   * needs two states so it's `string | undefined`.
   */
  readonly databaseTarget?: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

/**
 * Runtime validation for {@link ParentToSenderPayload}. The child sender
 * uses this before `postEvent` so a payload missing a required field
 * cannot silently produce a degraded telemetry event downstream.
 *
 * Same semantics as the ORM CLI's arktype schema (this repo carries no
 * arktype dependency, so the checks are spelled out): required scalars
 * must be non-empty strings; the optional `databaseTarget` override is
 * a `string` when present (no `null` — see the type's doc-block); the
 * string array is validated element-by-element. Size caps are enforced
 * by the backend, not here — IPC is structured-cloned and the
 * parent/child agree on the schema by version-coupling.
 */
export function isParentToSenderPayload(
  value: unknown,
): value is ParentToSenderPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record["installationId"])) return false;
  if (!isNonEmptyString(record["version"])) return false;
  if (!isNonEmptyString(record["command"])) return false;
  if (!isStringArray(record["flags"])) return false;
  if (!isNonEmptyString(record["projectRoot"])) return false;
  if (!isNonEmptyString(record["endpoint"])) return false;
  if (
    "databaseTarget" in record &&
    typeof record["databaseTarget"] !== "string"
  ) {
    return false;
  }
  return true;
}

/**
 * The full event the child POSTs to the backend. Shape matches the
 * telemetry backend's schema — identical to the ORM CLI's wire format.
 */
export interface TelemetryEvent {
  readonly installationId: string;
  readonly version: string;
  readonly command: string;
  readonly flags: readonly string[];
  readonly runtimeName: string;
  readonly runtimeVersion: string;
  readonly os: string;
  readonly arch: string;
  readonly packageManager: string | null;
  readonly databaseTarget: string | null;
  readonly tsVersion: string | null;
  readonly agent: string | null;
  readonly extensions: readonly string[];
}
