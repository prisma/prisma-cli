import type { NextAction } from "@prisma/cli-engine/protocol";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import { formatCommandArgument } from "../../command-arguments";
import { DomainApiError, type DomainRecord } from "../../lib/app/app-provider";
import {
  domainStateGuidance,
  waitsForPlatform,
} from "../../lib/app/domain-guidance";
import type { ServiceDomainTarget } from "./results";

export type DomainCommand = "add" | "show" | "delete" | "retry" | "wait";

export function domainRecoveryCommand(
  command: DomainCommand,
  hostname: string,
  target: ServiceDomainTarget,
): string {
  return `service domain ${command} ${formatCommandArgument(hostname)} --service ${formatCommandArgument(target.service.id)} --project ${formatCommandArgument(target.project.id)} --branch ${formatCommandArgument(target.branch.name)}`;
}

export function runCommandAction(label: string, command: string): NextAction {
  return { kind: "run-command", label, command: `${CLI_NAME} ${command}` };
}

export function adviceAction(label: string): NextAction {
  return { kind: "user-choice", label };
}

/**
 * Consent declined interactively. The engine settles this code as a
 * user cancellation (exit 3).
 */
export function userCancelledError(summary: string): CliStructuredError {
  return new CliStructuredError("CLI.PROMPT_CANCELLED", summary);
}

export function workspaceRequiredError(): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.WORKSPACE_REQUIRED",
    "No workspace is selected for the current session",
    {
      why: "Platform commands need an authenticated session with an accessible workspace.",
      nextActions: [runCommandAction("Sign in", "auth login")],
    },
  );
}

export function serviceSelectionInvalidError(
  serviceName: string,
  projectId: string,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.SELECTION_INVALID",
    "The requested service does not exist in the resolved project",
    {
      why: `The service "${serviceName}" could not be found in resolved project "${projectId}".`,
      nextActions: [
        adviceAction("Pass the id or name of an existing service."),
        // Not `service version list`: that command has to resolve a
        // service before it can list anything, so it fails the same way.
        runCommandAction("List services", "service list"),
      ],
    },
  );
}

export function serviceNameRequiredError(): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.NAME_REQUIRED",
    "Service create requires a name",
    {
      why: "The name positional was empty or only whitespace.",
      nextActions: [
        adviceAction("Pass a name, as in service create my-service."),
        runCommandAction("List services", "service list"),
      ],
    },
  );
}

export function projectNotFoundError(projectId: string): CliStructuredError {
  return new CliStructuredError("PROJECT.NOT_FOUND", "Project not found", {
    why: `The resolved project "${projectId}" does not exist in the authenticated workspace or is no longer accessible.`,
    nextActions: [
      runCommandAction("Inspect the directory binding", "project show"),
      runCommandAction("Link a project", "project link <id-or-name>"),
    ],
  });
}

export function deployFailedError(
  summary: string,
  cause: unknown,
  nextActions: NextAction[],
): CliStructuredError {
  return new CliStructuredError("SERVICE.DEPLOY_FAILED", summary, {
    why: cause instanceof Error ? cause.message : String(cause),
    nextActions,
    cause,
  });
}

export function noVersionsError(
  summary: string,
  why: string,
  serviceName: string,
): CliStructuredError {
  return new CliStructuredError("SERVICE.NO_VERSIONS", summary, {
    why,
    nextActions: [
      runCommandAction("Inspect the service", `service show ${serviceName}`),
    ],
  });
}

export function versionNotFoundError(deploymentId: string): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.VERSION_NOT_FOUND",
    `Version "${deploymentId}" not found`,
    {
      why: "The requested service version does not exist or is no longer available.",
      nextActions: [
        runCommandAction(
          "Choose an available version id",
          "service version list <service>",
        ),
      ],
    },
  );
}

/** `--tail` and `--from-start` ask for opposite ends of the log, so a
 *  run naming both has no answer to give. Refused before any work. */
export function logsRangeConflictError(): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.LOGS_RANGE_CONFLICT",
    "Choose one end of the log to read from",
    {
      why: "--tail and --from-start are mutually exclusive: one reads the last lines, the other reads from the beginning.",
      nextActions: [
        adviceAction(
          "Pass --tail <n> for the last n lines, or --from-start for the whole log.",
        ),
      ],
    },
  );
}

/** The version exists but names no owning service, so there is
 *  nothing to report or act on it as. */
export function versionDetachedError(deploymentId: string): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.VERSION_DETACHED",
    `Version "${deploymentId}" has no owning service`,
    {
      why: "The Management API returned the version without a service, so there is nothing to report or act on it as.",
      nextActions: [
        runCommandAction(
          "Show the version",
          `service version show ${deploymentId}`,
        ),
      ],
    },
  );
}

export function versionNotFoundForServiceError(
  deploymentId: string,
  serviceName: string,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.VERSION_NOT_FOUND",
    `Version "${deploymentId}" not found for service "${serviceName}"`,
    {
      why: "The requested version does not belong to the resolved service or is no longer available.",
      nextActions: [
        runCommandAction(
          "Choose an available version id",
          `service version list ${serviceName}`,
        ),
      ],
    },
  );
}

/** Every command that acts on an existing service needs its target
 *  named explicitly; nothing is inferred, remembered, or prompted for. */
export function serviceTargetRequiredError(
  commandName: string,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.TARGET_REQUIRED",
    `Command "${commandName}" requires a service`,
    {
      why: "Service commands act only on an explicitly named service, and this run named none.",
      nextActions: [
        adviceAction("Pass the service id or name as the first argument."),
        // Not `service version list`: it resolves a service first, so
        // it cannot help a run that could not resolve one.
        runCommandAction("List services", "service list"),
      ],
    },
  );
}

export function noPreviousVersionError(
  serviceName: string,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.NO_PREVIOUS_VERSION",
    "No previous version available for rollback",
    {
      why: "The service does not have an earlier version to switch back to.",
      nextActions: [
        adviceAction(
          "Deploy a second version first, or pass --to <version-id> for a specific earlier version.",
        ),
        runCommandAction(
          "List versions",
          `service version list ${serviceName}`,
        ),
      ],
    },
  );
}

/** Rolling back without `--to` needs the live deployment: the default
 *  target is defined relative to it. */
export function liveVersionUnknownError(
  serviceName: string,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.LIVE_VERSION_UNKNOWN",
    "Cannot determine which version is currently live",
    {
      why: "The service record does not name a live version, so the version to roll back to cannot be chosen without guessing what production is serving.",
      nextActions: [
        runCommandAction(
          "Roll back to a named version",
          `service version rollback ${serviceName} --to <version>`,
        ),
        runCommandAction(
          "List versions",
          `service version list ${serviceName}`,
        ),
      ],
    },
  );
}

export function deleteFailedError(
  summary: string,
  cause: unknown,
  serviceName: string,
): CliStructuredError {
  return new CliStructuredError("SERVICE.DELETE_FAILED", summary, {
    why: cause instanceof Error ? cause.message : String(cause),
    nextActions: [
      runCommandAction("Inspect the service", `service show ${serviceName}`),
      runCommandAction("List versions", `service version list ${serviceName}`),
    ],
    cause,
  });
}

/** A blank `--branch` names no branch and must never fall through to
 *  the branch the command targets when the flag is omitted. */
export function branchValueEmptyError(): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.BRANCH_INVALID",
    "The --branch value cannot be empty",
    {
      why: "The command scopes its work to the given branch; an empty --branch names none, and omitting the flag targets the default branch instead.",
      nextActions: [
        adviceAction(
          "Pass a non-empty branch name, or omit --branch to target the default branch.",
        ),
      ],
    },
  );
}

export function liveUrlUnavailableError(
  serviceName: string,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.FEATURE_UNAVAILABLE",
    "Live URL is not available for this service",
    {
      why: "Versions exist, but the provider does not expose a stable live service URL for this service yet.",
      nextActions: [
        runCommandAction(
          "Inspect the service state",
          `service show ${serviceName}`,
        ),
      ],
    },
  );
}

export function domainHostnameInvalidError(
  hostname: string,
  branchName?: string,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.DOMAIN_HOSTNAME_INVALID",
    `Invalid custom domain "${hostname}"`,
    {
      why: "Custom domains must be valid hostnames without protocol, path, wildcard, or port.",
      nextActions: [
        adviceAction("Pass a hostname like shop.acme.com."),
        runCommandAction(
          "Add a domain",
          `service domain add shop.acme.com --service <name>${branchName === undefined ? "" : ` --branch ${formatCommandArgument(branchName)}`}`,
        ),
      ],
    },
  );
}

export function domainNotFoundError(
  hostname: string,
  target: ServiceDomainTarget,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.DOMAIN_NOT_FOUND",
    `Custom domain "${hostname}" not found`,
    {
      why: "The hostname is not attached to the service.",
      nextActions: [
        adviceAction(
          "Check the hostname and the service, or add the domain first.",
        ),
        runCommandAction(
          "Add the domain",
          domainRecoveryCommand("add", hostname, target),
        ),
      ],
    },
  );
}

/** `service domain wait` saw a state that waiting cannot get past. */
export function domainVerificationFailedError(
  hostname: string,
  domain: DomainRecord,
  target: ServiceDomainTarget,
): CliStructuredError {
  const guidance = domainStateGuidance(
    { ...domain, serviceId: domain.appId },
    `${CLI_NAME} ${domainRecoveryCommand("retry", hostname, target)}`,
  );
  return new CliStructuredError(
    "SERVICE.DOMAIN_VERIFICATION_FAILED",
    `Custom domain "${hostname}" cannot become active`,
    {
      why:
        guidance?.waitingOn ?? `The domain is in the state "${domain.state}".`,
      meta: { state: domain.state },
      nextActions: [
        ...(guidance?.fix ? [adviceAction(guidance.fix)] : []),
        runCommandAction(
          "Show the domain",
          domainRecoveryCommand("show", hostname, target),
        ),
        ...(domain.state === "certificate_failed"
          ? [
              runCommandAction(
                "Retry the certificate",
                domainRecoveryCommand("retry", hostname, target),
              ),
            ]
          : []),
      ],
    },
  );
}

export function domainVerificationTimeoutError(
  hostname: string,
  domain: DomainRecord,
  target: ServiceDomainTarget,
): CliStructuredError {
  const guidance = domainStateGuidance(
    { ...domain, serviceId: domain.appId },
    `${CLI_NAME} ${domainRecoveryCommand("retry", hostname, target)}`,
  );
  return new CliStructuredError(
    "SERVICE.DOMAIN_VERIFICATION_TIMEOUT",
    `Timed out waiting for "${hostname}" to become active`,
    {
      why: `The domain is still "${domain.state}".${guidance ? ` ${guidance.waitingOn}` : ""}`,
      meta: { state: domain.state },
      nextActions: [
        ...(guidance?.fix ? [adviceAction(guidance.fix)] : []),
        runCommandAction(
          "Show the domain",
          domainRecoveryCommand("show", hostname, target),
        ),
        adviceAction(
          waitsForPlatform(domain) && !guidance?.failed
            ? "Retry wait with a longer --timeout. If the domain stays in this state, contact support."
            : "Retry wait with a longer --timeout.",
        ),
      ],
    },
  );
}

export function timeoutInvalidError(
  value: string,
  branchName?: string,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.TIMEOUT_INVALID",
    `Invalid timeout "${value}"`,
    {
      why: "Timeout must be a duration such as 0, 30s, 15m, or 1h.",
      nextActions: [
        runCommandAction(
          "Wait with a valid timeout",
          `service domain wait shop.acme.com --service <name> --timeout 15m${branchName === undefined ? "" : ` --branch ${formatCommandArgument(branchName)}`}`,
        ),
      ],
    },
  );
}

function debugMeta(error: unknown): Record<string, unknown> {
  if (error instanceof DomainApiError) {
    return { status: error.status, apiCode: error.code, hint: error.hint };
  }
  return {};
}

export function domainCommandError(
  command: DomainCommand,
  error: unknown,
  hostname: string,
  target: ServiceDomainTarget,
): CliStructuredError {
  if (error instanceof DomainApiError) {
    const known = domainApiFailure(command, error, hostname, target);
    if (known) {
      return known;
    }
  }

  if (error instanceof DomainApiError && error.status >= 500) {
    return domainCommandFailed(command, hostname, target, error, {
      why: "The operation failed for reasons we are not sure about. You can try again, or contact support.",
      meta: { status: error.status },
    });
  }
  return domainCommandFailed(command, hostname, target, error, {
    why: error instanceof Error ? error.message : String(error),
    meta: debugMeta(error),
  });
}

function domainCommandFailed(
  command: DomainCommand,
  hostname: string,
  target: ServiceDomainTarget,
  cause: unknown,
  detail: { why: string; meta: Record<string, unknown> },
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.DEPLOY_FAILED",
    `Custom domain ${command} failed`,
    {
      ...detail,
      nextActions: [
        runCommandAction(
          "Show the domain",
          domainRecoveryCommand("show", hostname, target),
        ),
      ],
      cause,
    },
  );
}

function domainApiFailure(
  command: DomainCommand,
  error: DomainApiError,
  hostname: string,
  target: ServiceDomainTarget,
): CliStructuredError | null {
  if (command === "add") {
    return domainAddFailure(error, hostname, target);
  }
  if (error.status === 404) {
    return domainNotFoundError(hostname, target);
  }
  return null;
}

function domainAddFailure(
  error: DomainApiError,
  hostname: string,
  target: ServiceDomainTarget,
): CliStructuredError | null {
  if (error.code === "invalid-hostname" || error.status === 400) {
    return domainHostnameRejectedError(hostname, error, target);
  }
  if (error.code === "quota-exceeded") {
    return domainQuotaExceededError(error, target);
  }
  return null;
}

function domainHostnameRejectedError(
  hostname: string,
  error: DomainApiError,
  target: ServiceDomainTarget,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.DOMAIN_HOSTNAME_INVALID",
    `Invalid custom domain "${hostname}"`,
    {
      why: error.message,
      meta: debugMeta(error),
      nextActions: [
        adviceAction("Pass a hostname like shop.acme.com."),
        runCommandAction(
          "Add a domain",
          domainRecoveryCommand("add", hostname, target),
        ),
      ],
    },
  );
}

function domainQuotaExceededError(
  error: DomainApiError,
  target: ServiceDomainTarget,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.DOMAIN_QUOTA_EXCEEDED",
    "Custom domain quota exceeded",
    {
      why: error.message,
      meta: debugMeta(error),
      nextActions: error.hint
        ? [adviceAction(error.hint)]
        : [
            adviceAction(
              "Delete an existing custom domain before adding another one.",
            ),
            runCommandAction(
              "Delete a domain",
              domainRecoveryCommand("delete", "<hostname>", target),
            ),
          ],
    },
  );
}

/**
 * `service domain retry` got HTTP 429: the API's request rate limit, or
 * the workspace's hourly limit of new certificates. The API's message
 * says which, and `Retry-After` says when to run it again.
 */
export function domainRetryRateLimitedError(
  hostname: string,
  error: DomainApiError,
  target: ServiceDomainTarget,
): CliStructuredError {
  const wait =
    error.retryAfterSeconds === null
      ? "later"
      : `in ${Math.max(1, Math.ceil(error.retryAfterSeconds / 60))} minute(s)`;
  return new CliStructuredError(
    "SERVICE.DOMAIN_RETRY_RATE_LIMITED",
    `"${hostname}" was not retried: a limit was reached`,
    {
      why: error.apiMessage,
      meta: {
        ...debugMeta(error),
        retryAfterSeconds: error.retryAfterSeconds,
      },
      nextActions: [
        ...(error.hint ? [adviceAction(error.hint)] : []),
        adviceAction(`Run the retry again ${wait}.`),
        runCommandAction(
          "Retry the domain",
          domainRecoveryCommand("retry", hostname, target),
        ),
      ],
      cause: error,
    },
  );
}
