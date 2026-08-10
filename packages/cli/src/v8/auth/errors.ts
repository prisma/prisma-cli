/**
 * Mapping from the auth operations layer's legacy CliError shapes to
 * the v8 protocol's dotted AUTH.* structured errors. The mapping is
 * mechanical (flat code -> AUTH.<code minus AUTH_ prefix>, fix prose ->
 * one user-choice nextAction, meta preserved); every mapped code is
 * enumerated in the S2 parity divergence list.
 */
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import { CliError } from "../../shell/errors";

const AUTH_CODE_MAP: Readonly<Record<string, `${string}.${string}`>> = {
  AUTH_CONFIG_INVALID: "AUTH.CONFIG_INVALID",
  WORKSPACE_SWITCH_UNAVAILABLE: "AUTH.WORKSPACE_SWITCH_UNAVAILABLE",
  WORKSPACE_NOT_AUTHENTICATED: "AUTH.WORKSPACE_NOT_AUTHENTICATED",
  WORKSPACE_AMBIGUOUS: "AUTH.WORKSPACE_AMBIGUOUS",
  USAGE_ERROR: "AUTH.USAGE_ERROR",
};

/** The structured error `auth whoami` established for an empty
 *  PRISMA_SERVICE_TOKEN; shared verbatim by login and logout. */
export function authConfigInvalidError(why: string): CliStructuredError {
  return new CliStructuredError(
    "AUTH.CONFIG_INVALID",
    "Authentication configuration is invalid",
    {
      why,
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Provide a valid PRISMA_SERVICE_TOKEN value, or unset the variable to use local OAuth login.",
        },
      ],
    },
  );
}

/**
 * Maps a legacy CliError thrown by the auth operations to its dotted
 * AUTH.* structured form; returns null for anything else so the caller
 * rethrows and the engine settles it as a bug.
 */
export function mapAuthOperationError(
  error: unknown,
): CliStructuredError | null {
  if (!(error instanceof CliError)) {
    return null;
  }
  const code = AUTH_CODE_MAP[error.code];
  if (code === undefined) {
    return null;
  }
  return new CliStructuredError(code, error.summary, {
    why: error.why ?? undefined,
    meta: Object.keys(error.meta).length > 0 ? error.meta : undefined,
    nextActions: error.fix ? [{ kind: "user-choice", label: error.fix }] : [],
  });
}
