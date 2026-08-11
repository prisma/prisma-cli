import type { NextAction } from "@prisma/cli-engine/protocol";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import type { CliError } from "../../errors";
import { DomainApiError, type DomainRecord } from "../../lib/app/app-provider";
import { formatDomainFailureFix } from "../../lib/app/domain-guidance";
import type { NextAction as LegacyNextAction } from "../../next-actions";

type DomainCommand = "add" | "show" | "remove" | "retry" | "wait";

export function runCommandAction(label: string, command: string): NextAction {
  return { kind: "run-command", label, command: `${CLI_NAME} ${command}` };
}

function adviceAction(label: string): NextAction {
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

/**
 * The rename surface for copy that flows through legacy error builders:
 * command lines and the "app target" noun in prose. Deliberately
 * narrow — `prisma.compute.ts` keys stay `app` (SDK-owned), including
 * prose that describes the config's `app`/`apps` entries.
 */
export function renameAppCopy(text: string): string {
  return text
    .replaceAll(`${LEGACY_CLI_NAME} app `, `${CLI_NAME} service `)
    .replaceAll("App target", "Service target")
    .replaceAll("app target", "service target");
}

/** A legacy `nextSteps` command line as this binary spells it. */
function toV8CommandLine(legacyStep: string): string {
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
              command: toV8CommandLine(step),
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
    "Selected service does not exist in the resolved project",
    {
      why: `The service "${serviceName}" could not be found in resolved project "${projectId}".`,
      nextActions: [
        adviceAction(
          "Pass the name of an existing service, or rerun list-deploys in a TTY to choose one.",
        ),
        runCommandAction("List deployments", "service list-deploys"),
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

export function noDeploymentsError(
  summary: string,
  why: string,
): CliStructuredError {
  return new CliStructuredError("SERVICE.NO_DEPLOYMENTS", summary, {
    why,
    nextActions: [runCommandAction("Inspect the service", "service show")],
  });
}

export function deploymentNotFoundError(
  deploymentId: string,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.DEPLOYMENT_NOT_FOUND",
    `Deployment "${deploymentId}" not found`,
    {
      why: "The requested deployment does not exist or is no longer available.",
      nextActions: [
        runCommandAction(
          "Choose an available deployment id",
          "service list-deploys",
        ),
      ],
    },
  );
}

export function deploymentNotFoundForServiceError(
  deploymentId: string,
  serviceName: string,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.DEPLOYMENT_NOT_FOUND",
    `Deployment "${deploymentId}" not found for service "${serviceName}"`,
    {
      why: "The requested deployment does not belong to the resolved service or is no longer available.",
      nextActions: [
        runCommandAction(
          "Choose an available deployment id",
          "service list-deploys",
        ),
      ],
    },
  );
}

/** promote / rollback / remove need a service that already exists. */
export function releaseTargetRequiredError(
  command: "promote" | "rollback" | "remove",
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.TARGET_REQUIRED",
    `Service ${command} requires an existing service`,
    {
      why: "The resolved project does not have a service that can be selected for this command.",
      nextActions: [
        adviceAction(
          `Deploy a service first, or rerun ${command} with --service <name> once a service exists.`,
        ),
        runCommandAction("List deployments", "service list-deploys"),
      ],
    },
  );
}

export function noPreviousDeploymentError(): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.NO_PREVIOUS_DEPLOYMENT",
    "No previous deployment available for rollback",
    {
      why: "The selected service does not have an earlier deployment to switch back to.",
      nextActions: [
        adviceAction(
          "Deploy a second version first, or pass --to <deployment-id> for a specific earlier deployment.",
        ),
        runCommandAction("List deployments", "service list-deploys"),
      ],
    },
  );
}

export function removeFailedError(
  summary: string,
  cause: unknown,
): CliStructuredError {
  return new CliStructuredError("SERVICE.REMOVE_FAILED", summary, {
    why: cause instanceof Error ? cause.message : String(cause),
    nextActions: [
      runCommandAction("Inspect the service", "service show"),
      runCommandAction("List deployments", "service list-deploys"),
    ],
    cause,
  });
}

/** A blank `--branch` must never fall back to the inferred (possibly
 *  production) branch. */
export function branchValueEmptyError(): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.BRANCH_INVALID",
    "The --branch value cannot be empty",
    {
      why: "service remove scopes the removal to the given branch; an empty --branch would silently fall back to the inferred (possibly production) branch.",
      nextActions: [
        adviceAction(
          "Pass a non-empty branch name, or omit --branch to use the inferred branch.",
        ),
        runCommandAction(
          "Remove on a branch",
          "service remove --service <name> --branch <branch>",
        ),
      ],
    },
  );
}

export function liveUrlUnavailableError(): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.FEATURE_UNAVAILABLE",
    "Live URL is not available for the selected service",
    {
      why: "Deployments exist, but the provider does not expose a stable live service URL for this service yet.",
      nextActions: [
        runCommandAction("Inspect the deployment state", "service show"),
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
          "service domain add <hostname> --branch production",
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
        runCommandAction("Add a domain", "service domain add shop.acme.com"),
      ],
    },
  );
}

export function domainNotFoundError(hostname: string): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.DOMAIN_NOT_FOUND",
    `Custom domain "${hostname}" not found`,
    {
      why: "The hostname is not attached to the selected service.",
      nextActions: [
        adviceAction(
          "Check the hostname and selected service, or add the domain first.",
        ),
        runCommandAction("Add the domain", `service domain add ${hostname}`),
      ],
    },
  );
}

export function domainTargetRequiredError(): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.DOMAIN_TARGET_REQUIRED",
    "Custom domain requires an existing service on the production branch",
    {
      why: "The resolved production branch does not have a service that can receive a custom domain.",
      nextActions: [runCommandAction("Inspect the service", "service show")],
    },
  );
}

export function selectedServiceMissingError(
  envVarName: string,
  serviceId: string,
  projectId: string,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.SELECTION_INVALID",
    "Selected service does not exist in the resolved production branch",
    {
      why: `The service "${serviceId}" from ${envVarName} could not be found in resolved project "${projectId}".`,
      nextActions: [
        adviceAction(
          `Unset ${envVarName}, pass --service <name>, or deploy the service on the production branch.`,
        ),
      ],
    },
  );
}

export function domainVerificationFailedError(
  hostname: string,
  domain: DomainRecord,
): CliStructuredError {
  const why = domain.failureReason
    ? domain.failureCategory
      ? `${domain.failureCategory}: ${domain.failureReason}`
      : domain.failureReason
    : "The platform reported a terminal failed state for this custom domain.";
  const guidance = formatDomainFailureFix(domain);
  return new CliStructuredError(
    "SERVICE.DOMAIN_VERIFICATION_FAILED",
    `Custom domain "${hostname}" failed verification`,
    {
      why,
      nextActions: [
        ...(guidance ? [adviceAction(renameAppCopy(guidance))] : []),
        runCommandAction("Show the domain", `service domain show ${hostname}`),
        runCommandAction(
          "Retry verification",
          `service domain retry ${hostname}`,
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
        runCommandAction("Show the domain", `service domain show ${hostname}`),
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
          "service domain wait shop.acme.com --timeout 15m",
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
    if (
      command === "add" &&
      (error.status === 400 || error.status === 422) &&
      isDomainDnsError(error)
    ) {
      return domainDnsNotConfiguredError(hostname, error);
    }

    if (command === "add" && error.status === 400) {
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
              "service domain add shop.acme.com",
            ),
          ],
        },
      );
    }

    if (
      command === "add" &&
      (error.status === 429 || isDomainQuotaError(error))
    ) {
      return new CliStructuredError(
        "SERVICE.DOMAIN_QUOTA_EXCEEDED",
        "Custom domain quota exceeded",
        {
          why: error.message,
          meta: debugMeta(error),
          nextActions: [
            adviceAction(
              "Remove an existing custom domain before adding another one.",
            ),
            runCommandAction(
              "Remove a domain",
              "service domain remove <hostname>",
            ),
          ],
        },
      );
    }

    if (command === "add" && error.status === 409) {
      return new CliStructuredError(
        "SERVICE.DOMAIN_ALREADY_REGISTERED",
        `Custom domain "${hostname}" is already registered`,
        {
          why: error.hint ?? error.message,
          meta: debugMeta(error),
          nextActions: [
            adviceAction(
              "Select the service that owns this hostname and remove it there, or contact Prisma support if you cannot access it.",
            ),
          ],
        },
      );
    }

    if (command === "add" && error.status === 422) {
      return new CliStructuredError(
        "SERVICE.NO_DEPLOYMENTS",
        "Custom domain requires a live production deployment",
        {
          why: "The selected production service does not have a promoted version that can receive a custom domain.",
          meta: debugMeta(error),
          nextActions: [
            // Legacy paired "rerun the domain command" with the fix line
            // that told the user what to do first. The deploy action went
            // with the dropped command; without the advice the only thing
            // left told the user to rerun what had just failed.
            adviceAction(
              "Promote a deployment on the service's production branch, then add the domain again.",
            ),
            runCommandAction(
              "Add the domain",
              `service domain add ${hostname}`,
            ),
          ],
        },
      );
    }

    if (
      (command === "show" ||
        command === "remove" ||
        command === "retry" ||
        command === "wait") &&
      error.status === 404
    ) {
      return domainNotFoundError(hostname);
    }

    if (command === "retry" && error.status === 409) {
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
              `service domain show ${hostname}`,
            ),
          ],
        },
      );
    }
  }

  return new CliStructuredError(
    "SERVICE.DEPLOY_FAILED",
    `Custom domain ${command} failed`,
    {
      why: error instanceof Error ? error.message : String(error),
      meta: debugMeta(error),
      nextActions: [
        runCommandAction("Show the domain", `service domain show ${hostname}`),
      ],
      cause: error,
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
    /\bcname(?:s)?\s+to\b/.test(text)
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
              `service domain add ${hostname}`,
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
  const match = /\b((?:[a-z0-9-]+\.)+prisma\.build)\b/i.exec(text);
  return match?.[1]?.toLowerCase() ?? null;
}

export function configTargetRequiresConfigError(
  configTarget: string,
  configFilename: string,
): CliStructuredError {
  return new CliStructuredError(
    "SERVICE.COMPUTE_CONFIG_TARGET_UNKNOWN",
    `Service target "${configTarget}" requires a compute config file`,
    {
      why: `No ${configFilename} exists in the current directory, so there are no named service targets.`,
      nextActions: [
        adviceAction(
          `Create ${configFilename} with an apps entry named "${configTarget}", or rerun without the target argument.`,
        ),
      ],
    },
  );
}
