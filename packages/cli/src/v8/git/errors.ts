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
import type { GitHubRepositoryReference } from "../../adapters/git";
import {
  repoInstallationRequiredError,
  repoNotAccessibleError,
} from "../../controllers/project";
import { CliError } from "../../errors";
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

/** The install-required and not-accessible errors put the raw install
 *  URL in their nextSteps beside real commands. A URL is not a command,
 *  so it becomes an `open-url` action. */
function nextStepAction(step: string): NextAction {
  if (step.startsWith("https://") || step.startsWith("http://")) {
    return { kind: "open-url", label: step, url: step };
  }
  const command = portCommandString(step);
  return { kind: "run-command", label: command, command };
}

function nextActionsFor(error: CliError): NextAction[] {
  return [
    ...(error.fix
      ? [{ kind: "user-choice" as const, label: portFixText(error.fix) }]
      : []),
    ...error.nextSteps.map(nextStepAction),
  ];
}

/** The legacy errors branch their fix text on whether a browser was
 *  opened. The engine's browser wait always shows the URL, so the
 *  opened branch is the one that describes what v8 does. */
const BROWSER_OPENED = true;

/**
 * The install wait's two terminal outcomes. The legacy constructors own
 * every copy string; the design drops `opened` from the meta they build
 * (`browserWait` does not report it and the URL is always shown), so
 * the structured error is assembled from their fields with the meta
 * d3 §3.8 pins.
 */
export function installWaitFailedError(
  repository: GitHubRepositoryReference,
  installUrl: string,
  inspectableInstallationCount: number,
): CliStructuredError {
  const legacy =
    inspectableInstallationCount > 0
      ? repoNotAccessibleError(repository, installUrl, BROWSER_OPENED)
      : repoInstallationRequiredError(repository, installUrl, BROWSER_OPENED);

  return new CliStructuredError(
    GIT_CODE_MAP[legacy.code] as `${string}.${string}`,
    legacy.summary,
    {
      why: legacy.why ?? undefined,
      meta: { repository: repository.fullName, installUrl },
      nextActions: nextActionsFor(legacy),
    },
  );
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
