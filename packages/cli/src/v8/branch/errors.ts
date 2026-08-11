/**
 * Mapping from the branch controller's legacy CliError shapes to the
 * v8 protocol's dotted BRANCH.* structured errors, following
 * `v8/auth/errors.ts`. Unmapped codes fall through to
 * `BRANCH.<RAW_CODE>` (the API-passthrough rule); the project
 * resolution codes are shared with the project group's mapper.
 */

import type { NextAction } from "@prisma/cli-engine/protocol";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import { CliError } from "../../shell/errors";
import { mapProjectOperationError, portCommandString } from "../project/errors";

const BRANCH_CODE_MAP: Readonly<Record<string, `${string}.${string}`>> = {
  BRANCH_API_ERROR: "BRANCH.API_ERROR",
};

/** The project-resolution codes `branch list` can raise; they keep the
 *  project group's dotted codes and copy. */
const PROJECT_CODES: ReadonlySet<string> = new Set([
  "PROJECT_NOT_FOUND",
  "PROJECT_AMBIGUOUS",
  "PROJECT_SETUP_REQUIRED",
  "LOCAL_STATE_STALE",
  "LOCAL_PROJECT_WORKSPACE_MISMATCH",
]);

const STALE_INTERACTIVE_SIGN_IN =
  /, or rerun the command in a TTY to sign in interactively\./g;
const TRACE_FLAG = /--trace/g;

/** `--trace` is gone in v8; the log level replaces it. Interactive
 *  sign-in is gone too (R-S2b-2), so the legacy offer to rerun in a TTY
 *  describes something v8 cannot do; `auth login` is the whole remedy. */
function portFixText(fix: string): string {
  return fix
    .replace(TRACE_FLAG, "--log-level verbose")
    .replace(STALE_INTERACTIVE_SIGN_IN, ".");
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

export function mapBranchOperationError(
  error: unknown,
): CliStructuredError | null {
  if (!(error instanceof CliError)) {
    return null;
  }
  if (PROJECT_CODES.has(error.code)) {
    return mapProjectOperationError(error);
  }
  const code = BRANCH_CODE_MAP[error.code] ?? `BRANCH.${error.code}`;
  return new CliStructuredError(code as `${string}.${string}`, error.summary, {
    why: error.why ?? undefined,
    meta: Object.keys(error.meta).length > 0 ? error.meta : undefined,
    nextActions: nextActionsFor(error),
  });
}
