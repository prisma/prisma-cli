/**
 * Mapping from the database controllers' and provider's legacy
 * CliError shapes to the v8 protocol's dotted POSTGRES.* structured
 * errors, following `v8/auth/errors.ts`. Unmapped codes fall through
 * to `POSTGRES.<RAW_CODE>` (the API-passthrough rule); the project
 * resolution codes are shared with the project group's mapper.
 */

import type { NextAction } from "@prisma/cli-engine/protocol";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import { CliError } from "../../shell/errors";
import { mapProjectOperationError } from "../project/errors";

const POSTGRES_CODE_MAP: Readonly<Record<string, `${string}.${string}`>> = {
  USAGE_ERROR: "POSTGRES.USAGE_ERROR",
  DATABASE_NOT_FOUND: "POSTGRES.NOT_FOUND",
  DATABASE_AMBIGUOUS: "POSTGRES.AMBIGUOUS",
  DATABASE_CONNECTION_MISSING: "POSTGRES.CONNECTION_MISSING",
  DATABASE_CONNECTION_STRING_MISSING: "POSTGRES.CONNECTION_STRING_MISSING",
  DATABASE_BACKUPS_UNSUPPORTED: "POSTGRES.BACKUPS_UNSUPPORTED",
  DATABASE_RESTORE_CONFLICT: "POSTGRES.RESTORE_CONFLICT",
  DATABASE_BACKUP_NOT_FOUND: "POSTGRES.BACKUP_NOT_FOUND",
  DATABASE_API_ERROR: "POSTGRES.API_ERROR",
};

/** The project-resolution codes this group can raise; they keep the
 *  project group's dotted codes and copy. */
const PROJECT_CODES: ReadonlySet<string> = new Set([
  "PROJECT_NOT_FOUND",
  "PROJECT_AMBIGUOUS",
  "PROJECT_SETUP_REQUIRED",
  "LOCAL_STATE_STALE",
  "LOCAL_PROJECT_WORKSPACE_MISMATCH",
]);

const PACKAGE_RUNNER = /[\w./@-]+(?: [\w.-]+)? @prisma\/cli@\S+ /g;
const COMMENT_PREFIX = /^#\s*/;
const LEGACY_GROUP = new RegExp(`${CLI_NAME} database `, "g");

/** §0 rename: wherever a legacy command reference appears — a
 *  nextSteps string or prose inside `fix` — the package-runner prefix
 *  becomes `${CLI_NAME}` and the `database` group becomes `postgres`.
 *  The resource noun "database" in prose is left alone. */
function portCommandReferences(text: string): string {
  return text
    .replace(PACKAGE_RUNNER, `${CLI_NAME} `)
    .replace(LEGACY_GROUP, `${CLI_NAME} postgres `);
}

export function portPostgresCommand(command: string): string {
  const named = portCommandReferences(command);
  return named.startsWith(`${CLI_NAME} `) ? named : `${CLI_NAME} ${named}`;
}

const STALE_INTERACTIVE_SIGN_IN =
  ", or rerun the command in a TTY to sign in interactively.";

/** `--trace` is gone in v8; the log level replaces it. Interactive
 *  sign-in is gone too (R-S2b-2), so the legacy offer to rerun in a TTY
 *  describes something v8 cannot do; `auth login` is the whole remedy. */
function portFixText(fix: string): string {
  return portCommandReferences(fix)
    .replace("--trace", "--log-level verbose")
    .replace(STALE_INTERACTIVE_SIGN_IN, ".");
}

function runCommandActions(nextSteps: readonly string[]): NextAction[] {
  const actions: NextAction[] = [];
  let reason: string | undefined;
  for (const step of nextSteps) {
    if (step.startsWith("#")) {
      reason = step.replace(COMMENT_PREFIX, "");
      continue;
    }
    const command = portPostgresCommand(step);
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

/** PR #127's plan-limit error: the legacy full-page `humanLines`
 *  rendering does not port, so the recovery guidance becomes the one
 *  nextAction beside the verbatim why and meta. */
function planLimitError(error: CliError): CliStructuredError {
  const upgradeUrl = error.meta.upgradeUrl;
  const planName = error.meta.planName;
  const reason =
    typeof upgradeUrl === "string" && upgradeUrl
      ? `Upgrade at ${upgradeUrl}${typeof planName === "string" && planName ? ` (current plan: ${planName})` : ""}.`
      : "Open Prisma Console and upgrade the affected workspace plan.";

  return new CliStructuredError("POSTGRES.PLAN_LIMIT_REACHED", error.summary, {
    why: error.why ?? undefined,
    meta: error.meta,
    nextActions: [
      { kind: "user-choice", label: "Upgrade the workspace plan", reason },
    ],
  });
}

export function mapPostgresOperationError(
  error: unknown,
): CliStructuredError | null {
  if (!(error instanceof CliError)) {
    return null;
  }
  if (error.code === "PLAN_LIMIT_REACHED") {
    return planLimitError(error);
  }
  if (PROJECT_CODES.has(error.code)) {
    return mapProjectOperationError(error);
  }
  const code = POSTGRES_CODE_MAP[error.code] ?? `POSTGRES.${error.code}`;
  return new CliStructuredError(code as `${string}.${string}`, error.summary, {
    why: error.why ?? undefined,
    meta: Object.keys(error.meta).length > 0 ? error.meta : undefined,
    nextActions: [
      ...(error.fix
        ? [{ kind: "user-choice" as const, label: portFixText(error.fix) }]
        : []),
      ...runCommandActions(error.nextSteps),
    ],
  });
}
