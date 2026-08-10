/**
 * Mapping from the project controllers' legacy CliError shapes to the
 * v8 protocol's dotted PROJECT.* structured errors, following
 * `v8/auth/errors.ts`. Unmapped codes fall through to
 * `PROJECT.<RAW_CODE>` (the API-passthrough rule), including the
 * legacy `AUTH_REQUIRED`: the engine settles every real credentials
 * failure itself, so what reaches this mapper is the permission
 * residue (a returned 403), which is not a sign-in problem.
 */

import type { NextAction } from "@prisma/cli-engine/protocol";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import { CliError } from "../../shell/errors";

const PROJECT_CODE_MAP: Readonly<Record<string, `${string}.${string}`>> = {
  USAGE_ERROR: "PROJECT.USAGE_ERROR",
  PROJECT_NOT_FOUND: "PROJECT.NOT_FOUND",
  PROJECT_AMBIGUOUS: "PROJECT.AMBIGUOUS",
  PROJECT_SETUP_REQUIRED: "PROJECT.SETUP_REQUIRED",
  LOCAL_STATE_STALE: "PROJECT.LOCAL_STATE_STALE",
  LOCAL_PROJECT_WORKSPACE_MISMATCH: "PROJECT.LOCAL_WORKSPACE_MISMATCH",
  LOCAL_STATE_WRITE_FAILED: "PROJECT.LOCAL_STATE_WRITE_FAILED",
  PROJECT_CREATE_FAILED: "PROJECT.CREATE_FAILED",
  PROJECT_RENAME_FAILED: "PROJECT.RENAME_FAILED",
  PROJECT_REMOVE_BLOCKED: "PROJECT.REMOVE_BLOCKED",
  PROJECT_TRANSFER_REJECTED: "PROJECT.TRANSFER_REJECTED",
  TRANSFER_RECIPIENT_REQUIRED: "PROJECT.TRANSFER_RECIPIENT_REQUIRED",
  TRANSFER_RECIPIENT_UNAVAILABLE: "PROJECT.TRANSFER_RECIPIENT_UNAVAILABLE",
  CONFIRMATION_REQUIRED: "PROJECT.CONFIRMATION_REQUIRED",
  PROJECT_LINK_TARGET_REQUIRED: "PROJECT.LINK_TARGET_REQUIRED",
  WORKSPACE_NOT_AUTHENTICATED: "AUTH.WORKSPACE_NOT_AUTHENTICATED",
  WORKSPACE_AMBIGUOUS: "AUTH.WORKSPACE_AMBIGUOUS",
  ENV_VARIABLE_ALREADY_EXISTS: "PROJECT.ENV_VARIABLE_ALREADY_EXISTS",
  ENV_VARIABLE_NOT_FOUND: "PROJECT.ENV_VARIABLE_NOT_FOUND",
  ENV_BRANCH_NOT_FOUND: "PROJECT.ENV_BRANCH_NOT_FOUND",
  ENV_BRANCH_SCOPE_IS_PRODUCTION: "PROJECT.ENV_BRANCH_SCOPE_IS_PRODUCTION",
  ENV_BRANCH_CREATE_REQUIRES_DEFAULT_BRANCH:
    "PROJECT.ENV_BRANCH_CREATE_REQUIRES_DEFAULT_BRANCH",
  ENV_FILE_APPLY_FAILED: "PROJECT.ENV_FILE_APPLY_FAILED",
  ENV_API_ERROR: "PROJECT.ENV_API_ERROR",
  PROJECT_API_ERROR: "PROJECT.API_ERROR",
};

const PACKAGE_RUNNER_PREFIX = /^\S+(?: -y)? @prisma\/cli@\S+ /;
const COMMENT_PREFIX = /^#\s*/;

/** Legacy command strings are `prisma-cli …`, except one `prisma auth
 *  login` copy bug and the package-runner formatter's output. */
export function portCommandString(command: string): string {
  if (command.startsWith(`${CLI_NAME} `)) {
    return command;
  }
  if (command.startsWith("prisma ")) {
    return `${CLI_NAME} ${command.slice("prisma ".length)}`;
  }
  return command.replace(PACKAGE_RUNNER_PREFIX, `${CLI_NAME} `);
}

const STALE_INTERACTIVE_SIGN_IN =
  ", or rerun the command in a TTY to sign in interactively.";

/** `--trace` is gone in v8; the log level replaces it. Interactive
 *  sign-in is gone too (R-S2b-2), so the legacy offer to rerun in a TTY
 *  describes something v8 cannot do; `auth login` is the whole remedy. */
function portFixText(fix: string): string {
  return fix
    .replace("--trace", "--log-level verbose")
    .replace(STALE_INTERACTIVE_SIGN_IN, ".");
}

/** A `#`-comment line in the legacy nextSteps is not an action: it
 *  explains the command that follows it, so it becomes that action's
 *  `reason`. */
function runCommandActions(nextSteps: readonly string[]): NextAction[] {
  const actions: NextAction[] = [];
  let reason: string | undefined;
  for (const step of nextSteps) {
    if (step.startsWith("#")) {
      reason = step.replace(COMMENT_PREFIX, "");
      continue;
    }
    const command = portCommandString(step);
    actions.push({
      kind: "run-command",
      label: command,
      command,
      ...(reason === undefined ? {} : { reason }),
    });
    reason = undefined;
  }
  return actions;
}

function nextActionsFor(error: CliError): NextAction[] {
  return [
    ...(error.fix
      ? [{ kind: "user-choice" as const, label: portFixText(error.fix) }]
      : []),
    ...runCommandActions(error.nextSteps),
  ];
}

export function mapProjectOperationError(
  error: unknown,
): CliStructuredError | null {
  if (!(error instanceof CliError)) {
    return null;
  }
  const code = PROJECT_CODE_MAP[error.code] ?? `PROJECT.${error.code}`;
  return new CliStructuredError(code as `${string}.${string}`, error.summary, {
    why: error.why ?? undefined,
    meta: Object.keys(error.meta).length > 0 ? error.meta : undefined,
    nextActions: nextActionsFor(error),
  });
}

export function rethrowMapped(error: unknown): never {
  const mapped = mapProjectOperationError(error);
  if (mapped) {
    throw mapped;
  }
  throw error;
}
