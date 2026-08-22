import type { NextAction } from "@prisma/cli-engine/protocol";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import type { CliError } from "../../errors";
import { DomainApiError, type DomainRecord } from "../../lib/app/app-provider";
import { formatDomainFailureFix } from "../../lib/app/domain-guidance";
import type { NextAction as LegacyNextAction } from "../../next-actions";

type DomainCommand = "add" | "show" | "delete" | "retry" | "wait";

export function runCommandAction(label: string, command: string): NextAction {
  return { kind: "run-command", label, command: `${CLI_NAME} ${command}` };
}

export function adviceAction(label: string): NextAction {
  return { kind: "user-choice", label };
}

function toEngineNextAction(action: LegacyNextAction): NextAction {
  return {
    kind: action.kind,
    label: action.label,
    ...(action.command !== undefined ? { command: action.command } : {}),
    ...(action.commands !== undefined ? { commands: action.commands } : {}),
    ...(action.reason !== undefined ? { reason: action.reason } : {}),
  };
}

/**
 * The binary name legacy error copy is written in. It is fixed, not
 * `CLI_NAME`: these strings are inputs to the rewriting below, and a
 * renamed binary must still recognise them.
 */
const LEGACY_CLI_NAME = "prisma-cli";

const CNAME_HINT = /\bcname(?:s)?\s+to\b/;
const PRISMA_BUILD_HOST = /\b((?:[a-z0-9-]+\.)+prisma\.build)\b/i;

/**
 * The rename surface for copy that flows through legacy error builders:
 * command lines and the "app target" noun in prose.
 */
export function renameAppCopy(text: string): string {
  return text
    .replaceAll(`${LEGACY_CLI_NAME} app `, `${CLI_NAME} service `)
    .replaceAll("App target", "Service target")
    .replaceAll("app target", "service target");
}

/** A legacy `nextSteps` command line as this binary spells it. */
function toCurrentCommandLine(legacyStep: string): string {
  const renamed = renameAppCopy(legacyStep);
  return renamed.startsWith(`${LEGACY_CLI_NAME} `)
    ? `${CLI_NAME} ${renamed.slice(LEGACY_CLI_NAME.length + 1)}`
    : renamed;
}

/**
 * Maps a legacy CliError onto the engine error protocol: the flat code
 * becomes `SERVICE.<code>`, the free-text fix becomes a user-choice
 * action carried alongside any typed legacy actions, and nextSteps that
 * are command lines become run-command actions. Copy passes through the
 * rename surface.
 */
export function fromLegacyCliError(error: CliError): CliStructuredError {
  const fixAction = error.fix ? [adviceAction(renameAppCopy(error.fix))] : [];
  const nextActions: NextAction[] =
    error.nextActions.length > 0
      ? [...error.nextActions.map(toEngineNextAction), ...fixAction]
      : [
          ...fixAction,
          ...error.nextSteps
            .filter((step) => step.startsWith(`${LEGACY_CLI_NAME} `))
            .map((step) => ({
              kind: "run-command" as const,
              label: "Run",
              command: toCurrentCommandLine(step),
            })),
        ];
  return new CliStructuredError(
    `SERVICE.${error.code}`,
    renameAppCopy(error.summary),
    {
      ...(error.why ? { why: renameAppCopy(error.why) } : {}),
      nextActions,
      ...(error.where ? { where: { path: error.where } } : {}),
      ...(Object.keys(error.meta).length > 0 ? { meta: error.meta } : {}),
      ...(error.docsUrl ? { docsUrl: error.docsUrl } : {}),
    },
  );
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
  return new CliStructuredError(
    "SERVICE.PROJECT_NOT_FOUND",
    "Project not found",
    {
      why: `The resolved project "${projectId}" does not exist in the authenticated workspace or is no longer accessible.`,
      nextActions: [
        runCommandAction("Inspect the directory binding", "project show"),
        runCommandAction("Link a project", "project link <id-or-name>"),
      ],
    },
  );
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

export function branchNotDeployableError(
  branchName: string,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.BRANCH_NOT_DEPLOYABLE",
    "Custom domains require the production branch",
    {
      why: `Custom domains on preview branch "${branchName}" are not supported in Public Beta.`,
      nextActions: [
        adviceAction(
          "Use --branch production, or attach the domain after promoting/deploying to the production branch.",
        ),
        runCommandAction(
          "Add on production",
          "service domain add <hostname> --service <name> --branch production",
        ),
      ],
    },
  );
}

export function domainHostnameInvalidError(
  hostname: string,
  why?: string,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.DOMAIN_HOSTNAME_INVALID",
    `Invalid custom domain "${hostname}"`,
    {
      why:
        why ??
        "Custom domains must be valid hostnames without protocol, path, wildcard, or port.",
      nextActions: [
        adviceAction("Pass a hostname like shop.acme.com."),
        runCommandAction(
          "Add a domain",
          "service domain add shop.acme.com --service <name>",
        ),
      ],
    },
  );
}

export function domainNotFoundError(hostname: string): CliStructuredError {
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
          `service domain add ${hostname} --service <name>`,
        ),
      ],
    },
  );
}

function formatDomainFailureWhy(domain: DomainRecord): string {
  if (!domain.failureReason) {
    return "The platform reported a terminal failed state for this custom domain.";
  }
  if (!domain.failureCategory) {
    return domain.failureReason;
  }
  return `${domain.failureCategory}: ${domain.failureReason}`;
}

export function domainVerificationFailedError(
  hostname: string,
  domain: DomainRecord,
): CliStructuredError {
  const why = formatDomainFailureWhy(domain);
  const guidance = formatDomainFailureFix(domain);
  return new CliStructuredError(
    "SERVICE.DOMAIN_VERIFICATION_FAILED",
    `Custom domain "${hostname}" failed verification`,
    {
      why,
      nextActions: [
        ...(guidance ? [adviceAction(renameAppCopy(guidance))] : []),
        runCommandAction(
          "Show the domain",
          `service domain show ${hostname} --service <name>`,
        ),
        runCommandAction(
          "Retry verification",
          `service domain retry ${hostname} --service <name>`,
        ),
      ],
    },
  );
}

export function domainVerificationTimeoutError(
  hostname: string,
  lastStatus: string,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.DOMAIN_VERIFICATION_TIMEOUT",
    `Timed out waiting for "${hostname}" to become active`,
    {
      why: `The domain is still "${lastStatus}".`,
      nextActions: [
        runCommandAction(
          "Show the domain",
          `service domain show ${hostname} --service <name>`,
        ),
        adviceAction("Retry wait with a longer --timeout."),
      ],
    },
  );
}

export function timeoutInvalidError(value: string): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.TIMEOUT_INVALID",
    `Invalid timeout "${value}"`,
    {
      why: "Timeout must be a duration such as 0, 30s, 15m, or 1h.",
      nextActions: [
        runCommandAction(
          "Wait with a valid timeout",
          "service domain wait shop.acme.com --service <name> --timeout 15m",
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
): CliStructuredError {
  if (error instanceof DomainApiError) {
    const known = domainApiFailure(command, error, hostname);
    if (known) {
      return known;
    }
  }

  return new CliStructuredError(
    "SERVICE.DEPLOY_FAILED",
    `Custom domain ${command} failed`,
    {
      why: error instanceof Error ? error.message : String(error),
      meta: debugMeta(error),
      nextActions: [
        runCommandAction(
          "Show the domain",
          `service domain show ${hostname} --service <name>`,
        ),
      ],
      cause: error,
    },
  );
}

function domainApiFailure(
  command: DomainCommand,
  error: DomainApiError,
  hostname: string,
): CliStructuredError | null {
  if (command === "add") {
    return domainAddFailure(error, hostname);
  }
  if (error.status === 404) {
    return domainNotFoundError(hostname);
  }
  if (command === "retry" && error.status === 409) {
    return domainRetryNotEligibleError(hostname, error);
  }
  return null;
}

function domainAddFailure(
  error: DomainApiError,
  hostname: string,
): CliStructuredError | null {
  if (
    (error.status === 400 || error.status === 422) &&
    isDomainDnsError(error)
  ) {
    return domainDnsNotConfiguredError(hostname, error);
  }
  if (error.status === 400) {
    return domainHostnameRejectedError(hostname, error);
  }
  if (error.status === 429 || isDomainQuotaError(error)) {
    return domainQuotaExceededError(error);
  }
  if (error.status === 409) {
    return domainAlreadyRegisteredError(hostname, error);
  }
  if (error.status === 422) {
    return domainRequiresDeploymentError(hostname, error);
  }
  return null;
}

function domainHostnameRejectedError(
  hostname: string,
  error: DomainApiError,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.DOMAIN_HOSTNAME_INVALID",
    `Invalid custom domain "${hostname}"`,
    {
      why: error.message,
      meta: debugMeta(error),
      nextActions: [
        adviceAction(
          "Pass a valid hostname like shop.acme.com and make sure DNS can be verified.",
        ),
        runCommandAction(
          "Add a domain",
          "service domain add shop.acme.com --service <name>",
        ),
      ],
    },
  );
}

function domainQuotaExceededError(error: DomainApiError): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.DOMAIN_QUOTA_EXCEEDED",
    "Custom domain quota exceeded",
    {
      why: error.message,
      meta: debugMeta(error),
      nextActions: [
        adviceAction(
          "Delete an existing custom domain before adding another one.",
        ),
        runCommandAction(
          "Delete a domain",
          "service domain delete <hostname> --service <name>",
        ),
      ],
    },
  );
}

function domainAlreadyRegisteredError(
  hostname: string,
  error: DomainApiError,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.DOMAIN_ALREADY_REGISTERED",
    `Custom domain "${hostname}" is already registered`,
    {
      why: error.hint ?? error.message,
      meta: debugMeta(error),
      nextActions: [
        adviceAction(
          "Select the service that owns this hostname and delete it there, or contact Prisma support if you cannot access it.",
        ),
      ],
    },
  );
}

function domainRequiresDeploymentError(
  hostname: string,
  error: DomainApiError,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.NO_VERSIONS",
    "Custom domain requires a live production version",
    {
      why: "The selected production service does not have a promoted version that can receive a custom domain.",
      meta: debugMeta(error),
      nextActions: [
        // Legacy paired "rerun the domain command" with the fix line
        // that told the user what to do first. The deploy action went
        // with the dropped command; without the advice the only thing
        // left told the user to rerun what had just failed.
        adviceAction(
          "Promote a version on the service's production branch, then add the domain again.",
        ),
        runCommandAction(
          "Add the domain",
          `service domain add ${hostname} --service <name>`,
        ),
      ],
    },
  );
}

function domainRetryNotEligibleError(
  hostname: string,
  error: DomainApiError,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.DOMAIN_RETRY_NOT_ELIGIBLE",
    `Custom domain "${hostname}" is not eligible for retry`,
    {
      why: error.message,
      meta: debugMeta(error),
      nextActions: [
        adviceAction(
          "Wait for the current verification or TLS step to finish, then rerun retry if the domain fails.",
        ),
        runCommandAction(
          "Show the domain",
          `service domain show ${hostname} --service <name>`,
        ),
      ],
    },
  );
}

function isDomainQuotaError(error: DomainApiError): boolean {
  if (error.status !== 409) {
    return false;
  }
  const text = `${error.message} ${error.hint ?? ""}`.toLowerCase();
  return (
    text.includes("quota") || text.includes("maximum") || text.includes("limit")
  );
}

function isDomainDnsError(error: DomainApiError): boolean {
  const text = `${error.message} ${error.hint ?? ""}`.toLowerCase();
  return (
    text.includes("dns is not configured") ||
    text.includes("dns verification failed") ||
    text.includes("no cname") ||
    text.includes("cname record") ||
    text.includes("no a/aaaa") ||
    CNAME_HINT.test(text)
  );
}

function domainDnsNotConfiguredError(
  hostname: string,
  error: DomainApiError,
): CliStructuredError {
  const target = extractDomainDnsTarget(error);
  const record = target ? `CNAME ${hostname} -> ${target}` : null;
  return new CliStructuredError(
    "SERVICE.DOMAIN_DNS_NOT_CONFIGURED",
    `DNS is not configured for "${hostname}"`,
    {
      why: error.hint ?? error.message,
      meta: { ...debugMeta(error), ...(record ? { dnsRecord: record } : {}) },
      nextActions: record
        ? [
            adviceAction(
              `Add ${record} at your DNS provider, then rerun the domain command.`,
            ),
            runCommandAction(
              "Add the domain",
              `service domain add ${hostname} --service <name>`,
            ),
          ]
        : [
            adviceAction(
              "The platform did not return the required DNS target. Re-run with --log-level verbose for the underlying API response details.",
            ),
          ],
    },
  );
}

function extractDomainDnsTarget(error: DomainApiError): string | null {
  const text = `${error.hint ?? ""} ${error.message}`;
  const match = PRISMA_BUILD_HOST.exec(text);
  return match?.[1]?.toLowerCase() ?? null;
}
