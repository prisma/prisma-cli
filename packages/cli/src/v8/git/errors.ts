/**
 * Mapping from the git-connection flow's legacy CliError shapes to the
 * v8 protocol's dotted GIT.* structured errors, following
 * `v8/auth/errors.ts`. Unmapped codes fall through to
 * `GIT.<RAW_CODE>` (the API-passthrough rule), including the legacy
 * `AUTH_REQUIRED` residue a returned 403 still produces — the engine
 * settles every real credentials failure itself. The project
 * resolution codes are shared with the project group's mapper.
 */

import type { NextAction } from "@prisma/cli-engine/protocol";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import { CliError } from "../../shell/errors";
import { mapProjectOperationError, portCommandString } from "../project/errors";

const GIT_CODE_MAP: Readonly<Record<string, `${string}.${string}`>> = {
  USAGE_ERROR: "GIT.USAGE_ERROR",
  REPO_PROVIDER_UNSUPPORTED: "GIT.REPO_PROVIDER_UNSUPPORTED",
  REPO_ALREADY_CONNECTED: "GIT.REPO_ALREADY_CONNECTED",
  REPO_INSTALLATION_REQUIRED: "GIT.REPO_INSTALLATION_REQUIRED",
  REPO_NOT_ACCESSIBLE: "GIT.REPO_NOT_ACCESSIBLE",
  REPO_NOT_CONNECTED: "GIT.REPO_NOT_CONNECTED",
  REPO_CONNECTION_FAILED: "GIT.REPO_CONNECTION_FAILED",
};

/** The project-resolution codes the git commands can raise; they keep
 *  the project group's dotted codes and copy. */
const PROJECT_CODES: ReadonlySet<string> = new Set([
  "PROJECT_NOT_FOUND",
  "PROJECT_AMBIGUOUS",
  "PROJECT_SETUP_REQUIRED",
  "LOCAL_STATE_STALE",
  "LOCAL_PROJECT_WORKSPACE_MISMATCH",
]);

/** `--trace` is gone in v8; the log level replaces it. */
function portFixText(fix: string): string {
  return fix.replace("--trace", "--log-level verbose");
}

function nextActionsFor(error: CliError): NextAction[] {
  return [
    ...(error.fix
      ? [{ kind: "user-choice" as const, label: portFixText(error.fix) }]
      : []),
    ...error.nextSteps.map((step) => {
      const command = portCommandString(step);
      return { kind: "run-command" as const, label: command, command };
    }),
  ];
}

export function mapGitOperationError(
  error: unknown,
): CliStructuredError | null {
  if (!(error instanceof CliError)) {
    return null;
  }
  if (PROJECT_CODES.has(error.code)) {
    return mapProjectOperationError(error);
  }
  const code = GIT_CODE_MAP[error.code] ?? `GIT.${error.code}`;
  return new CliStructuredError(code as `${string}.${string}`, error.summary, {
    why: error.why ?? undefined,
    meta: Object.keys(error.meta).length > 0 ? error.meta : undefined,
    nextActions: nextActionsFor(error),
  });
}
