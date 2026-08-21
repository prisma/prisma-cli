import type { Block, Presentations } from "@prisma/cli-engine";
import type { NextAction } from "@prisma/cli-engine/protocol";
import { adviceAction, runCommandAction } from "./errors";
import type {
  ServiceCreateResult,
  ServiceDeleteResult,
  ServiceDeploymentDeleteResult,
  ServiceDeploymentListResult,
  ServiceDeploymentRunStateResult,
  ServiceDeploymentShowResult,
  ServiceDeploymentSummary,
  ServiceDomainAddResult,
  ServiceDomainDeleteResult,
  ServiceDomainRetryResult,
  ServiceDomainShowResult,
  ServiceDomainSummary,
  ServiceDomainTarget,
  ServiceDomainWaitResult,
  ServiceListResult,
  ServiceOpenResult,
  ServicePromoteResult,
  ServiceRollbackResult,
  ServiceShowResult,
} from "./results";

type FieldRow = { label: string; value: string };

function fields(rows: FieldRow[]): Block {
  return { kind: "fields", rows };
}

/** The heading a command that only reports opens with. */
function title(text: string): Block {
  return { kind: "summary", status: "info", text };
}

/** The line a command that changed something ends on: what it did, in
 *  the past tense, marked as a success. */
function completed(text: string): Block {
  return { kind: "summary", status: "ok", text };
}

function formatRecentDeployments(
  deployments: ServiceDeploymentSummary[],
): string {
  if (deployments.length === 0) {
    return "none";
  }
  return deployments
    .map(
      (deployment) =>
        `${deployment.id} (${deployment.status}${deployment.live ? ", live" : ""})`,
    )
    .join(", ");
}

function domainTargetRows(target: ServiceDomainTarget): FieldRow[] {
  return [
    { label: "workspace", value: target.workspace.name },
    { label: "project", value: target.project.name },
    { label: "branch", value: target.branch.name },
    { label: "service", value: target.service.name },
  ];
}

function domainDnsRows(domain: ServiceDomainSummary): FieldRow[] {
  return domain.dnsRecords.map((record) => ({
    label: `dns ${record.type}`,
    value: `${record.name} -> ${record.value}${record.ttl === null ? "" : ` (ttl ${record.ttl})`}`,
  }));
}

function domainFailureRows(domain: ServiceDomainSummary): FieldRow[] {
  if (!domain.failureReason) {
    return [];
  }
  return [
    {
      label: "failure",
      value: domain.failureCategory
        ? `${domain.failureCategory}: ${domain.failureReason}`
        : domain.failureReason,
    },
  ];
}

export function listPresentations(result: ServiceListResult): Presentations {
  return {
    json: () => result,
    human: () => [
      title("Listing services for the selected project."),
      fields([
        { label: "project", value: result.projectName },
        { label: "branch", value: result.branch },
      ]),
      ...(result.services.length === 0
        ? [
            {
              kind: "summary",
              status: "info",
              text: "No services found.",
            } as const,
          ]
        : [
            {
              kind: "table",
              columns: ["name", "id", "region", "live url"],
              rows: result.services.map((service) => [
                service.name,
                service.id,
                service.region ?? "",
                service.liveUrl ?? "not deployed",
              ]),
            } as const,
          ]),
    ],
    /** The machine rows leave an absent region and an undeployed service
     *  empty, rather than repeating the words the human table shows. */
    stdout: () =>
      result.services.map((service) =>
        [
          service.name,
          service.id,
          service.region ?? "",
          service.liveUrl ?? "",
        ].join("\t"),
      ),
    next: () => {
      const first = result.services[0];
      return first
        ? [
            runCommandAction(
              "Show a service",
              `service show --service ${first.name}`,
            ),
          ]
        : // Not a run-command: `command` is executed verbatim, and
          // `service create <name>` would make a service literally
          // called "<name>". Naming it is the user's choice, which is
          // what a user-choice action is for.
          [
            adviceAction(
              "Create a service with service create <name>, choosing the name.",
            ),
          ];
    },
  };
}

export function createPresentations(
  result: ServiceCreateResult,
): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    human: () => [
      result.existing
        ? title(
            `${result.service.name} already exists on ${result.branch}; showing it.`,
          )
        : completed(`Created ${result.service.name} on ${result.branch}.`),
      fields([
        { label: "project", value: result.projectId },
        { label: "branch", value: result.branch },
        { label: "service", value: result.service.name },
        { label: "id", value: result.service.id },
        { label: "region", value: result.service.region ?? "" },
        // A service with no deployment has no address that resolves, so
        // it reports what it needs next instead of a dead URL.
        {
          label: "live url",
          value: result.service.liveUrl ?? "not deployed",
        },
      ]),
    ],
    next: () => [
      runCommandAction("Deploy to the service", "deploy"),
      runCommandAction(
        "Show the service",
        `service show --service ${result.service.name}`,
      ),
    ],
  };
}

export function showPresentations(result: ServiceShowResult): Presentations {
  const next: NextAction[] = [];
  if (result.liveUrl) {
    next.push(
      runCommandAction(
        "Open the live URL",
        `service open --service ${result.service.name}`,
      ),
    );
  }
  const inspectable = result.liveDeployment ?? result.recentDeployments[0];
  if (inspectable) {
    next.push(
      runCommandAction(
        "Show the deployment",
        `service deployment show ${inspectable.id}`,
      ),
    );
  }
  return {
    stdout: () => [],
    json: () => result,
    human: () => [
      title(`Showing the state of service ${result.service.name}.`),
      fields([
        { label: "project", value: result.projectId },
        { label: "service", value: result.service.name },
        {
          label: "live deployment",
          value: result.liveDeployment?.id ?? "",
        },
        { label: "live url", value: result.liveUrl ?? "unavailable" },
        {
          label: "recent deployments",
          value: formatRecentDeployments(result.recentDeployments),
        },
      ]),
    ],
    next: () => next,
  };
}

export function deploymentListPresentations(
  result: ServiceDeploymentListResult,
): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    human: () => [
      title(`Listing deployments for service ${result.service.name}.`),
      fields([
        { label: "project", value: result.projectId },
        { label: "service", value: result.service.name },
      ]),
      result.deployments.length === 0
        ? {
            kind: "summary",
            status: "info",
            text: "No deployments found.",
          }
        : {
            kind: "table",
            columns: ["deployment", "status", "created", "live"],
            rows: result.deployments.map((deployment) => [
              deployment.id,
              deployment.status,
              deployment.createdAt,
              deployment.live ? "yes" : "",
            ]),
          },
    ],
    next: () => {
      const newest = result.deployments[0];
      return newest
        ? [
            runCommandAction(
              "Show the newest deployment",
              `service deployment show ${newest.id}`,
            ),
          ]
        : [];
    },
  };
}

export function deploymentShowPresentations(
  result: ServiceDeploymentShowResult,
): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    next: () => [],
    human: () => [
      title("Showing deployment details."),
      fields([
        ...(result.service
          ? [{ label: "service", value: result.service.name }]
          : []),
        { label: "deployment", value: result.deployment.id },
        { label: "status", value: result.deployment.status },
        ...(result.deployment.url
          ? [{ label: "url", value: result.deployment.url }]
          : []),
        ...(result.deployment.live === null
          ? []
          : [{ label: "live", value: result.deployment.live ? "yes" : "no" }]),
        { label: "created", value: result.deployment.createdAt },
      ]),
    ],
  };
}

export function openPresentations(
  result: ServiceOpenResult,
  liveDeploymentId: string,
): Presentations {
  return {
    json: () => result,
    human: () => [
      result.opened
        ? completed(`Opened the live URL for service ${result.service.name}.`)
        : title(`Resolved the live URL for service ${result.service.name}.`),
      fields([
        { label: "project", value: result.projectId },
        { label: "service", value: result.service.name },
        { label: "url", value: result.url },
        { label: "opened", value: result.opened ? "yes" : "no" },
      ]),
    ],
    stdout: () => [result.url],
    next: () => [
      runCommandAction(
        "Inspect the service",
        `service show --service ${result.service.name}`,
      ),
      runCommandAction(
        "Show the live deployment",
        `service deployment show ${liveDeploymentId}`,
      ),
    ],
  };
}

function deploymentNextActions(
  deploymentId: string,
  serviceName: string,
): NextAction[] {
  return [
    runCommandAction(
      "List deployments",
      `service deployment list --service ${serviceName}`,
    ),
    runCommandAction(
      "Show the deployment",
      `service deployment show ${deploymentId}`,
    ),
  ];
}

export function promotePresentations(
  result: ServicePromoteResult,
  alreadyLive: boolean,
): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    human: () => [
      completed(
        alreadyLive
          ? `${result.deployment.id} was already live for ${result.service.name}.`
          : `Promoted ${result.deployment.id} to production.`,
      ),
      fields([
        { label: "project", value: result.projectId },
        { label: "service", value: result.service.name },
        { label: "deployment", value: result.deployment.id },
        { label: "status", value: result.deployment.status },
        ...(result.deployment.url
          ? [{ label: "url", value: result.deployment.url }]
          : []),
      ]),
    ],
    next: () =>
      deploymentNextActions(result.deployment.id, result.service.name),
  };
}

export function rollbackPresentations(
  result: ServiceRollbackResult,
  alreadyLive: boolean,
): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    human: () => [
      completed(
        alreadyLive
          ? `${result.deployment.id} was already live for ${result.service.name}.`
          : `Rolled ${result.service.name} back to ${result.deployment.id}.`,
      ),
      fields([
        { label: "project", value: result.projectId },
        { label: "service", value: result.service.name },
        { label: "deployment", value: result.deployment.id },
        { label: "status", value: result.deployment.status },
        {
          label: "previous live deployment",
          value: result.previousLiveDeploymentId ?? "unknown",
        },
        ...(result.deployment.url
          ? [{ label: "url", value: result.deployment.url }]
          : []),
      ]),
    ],
    next: () =>
      deploymentNextActions(result.deployment.id, result.service.name),
  };
}

export function deploymentStartPresentations(
  result: ServiceDeploymentRunStateResult,
): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    human: () => [
      completed(
        result.alreadyInState
          ? `${result.deployment.id} was already running.`
          : `Started ${result.deployment.id}.`,
      ),
      fields([
        { label: "project", value: result.projectId },
        { label: "service", value: result.service.name },
        { label: "deployment", value: result.deployment.id },
        { label: "status", value: result.deployment.status },
        ...(result.deployment.url
          ? [{ label: "url", value: result.deployment.url }]
          : []),
      ]),
    ],
    next: () =>
      deploymentNextActions(result.deployment.id, result.service.name),
  };
}

export function deploymentStopPresentations(
  result: ServiceDeploymentRunStateResult,
): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    human: () => [
      completed(
        result.alreadyInState
          ? `${result.deployment.id} was already stopped.`
          : `Stopped ${result.deployment.id}.`,
      ),
      fields([
        { label: "project", value: result.projectId },
        { label: "service", value: result.service.name },
        { label: "deployment", value: result.deployment.id },
        { label: "status", value: result.deployment.status },
      ]),
    ],
    next: () =>
      deploymentNextActions(result.deployment.id, result.service.name),
  };
}

export function deploymentDeletePresentations(
  result: ServiceDeploymentDeleteResult,
): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    human: () => [
      completed(`Deleted ${result.deploymentId} from ${result.service.name}.`),
      fields([
        { label: "project", value: result.projectId },
        { label: "service", value: result.service.name },
        { label: "deployment", value: result.deploymentId },
        { label: "deleted", value: "yes" },
      ]),
    ],
    next: () => [
      runCommandAction(
        "List deployments",
        `service deployment list --service ${result.service.name}`,
      ),
    ],
  };
}

export function deletePresentations(
  result: ServiceDeleteResult,
): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    human: () => [
      completed(
        `Deleted ${result.service.name} and every deployment it owned.`,
      ),
      fields([
        { label: "project", value: result.projectId },
        { label: "service", value: result.service.name },
        { label: "deleted", value: "yes" },
      ]),
    ],
    // The service is gone, so nothing service-scoped can run next.
    next: () => [runCommandAction("List remaining services", "service list")],
  };
}

export function domainAddPresentations(
  result: ServiceDomainAddResult,
): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    human: () => [
      result.existing
        ? title(`Showing the existing custom domain on ${result.service.name}.`)
        : completed(
            `Added ${result.domain.hostname} to ${result.service.name}.`,
          ),
      fields([
        ...domainTargetRows(result),
        { label: "hostname", value: result.domain.hostname },
        { label: "status", value: result.domain.status },
        ...domainDnsRows(result.domain),
      ]),
    ],
    next: () => [
      runCommandAction(
        "Wait for activation",
        `service domain wait ${result.domain.hostname}`,
      ),
      runCommandAction(
        "Show the domain",
        `service domain show ${result.domain.hostname}`,
      ),
    ],
  };
}

export function domainShowPresentations(
  result: ServiceDomainShowResult,
): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    human: () => [
      title("Showing custom domain status."),
      fields([
        ...domainTargetRows(result),
        { label: "hostname", value: result.domain.hostname },
        { label: "status", value: result.domain.status },
        ...domainFailureRows(result.domain),
        {
          label: "cert expires",
          value: result.domain.certExpiresAt ?? "not yet issued",
        },
        { label: "created", value: result.domain.createdAt },
        ...domainDnsRows(result.domain),
      ]),
    ],
    next: () => {
      if (result.domain.status === "active") {
        return [];
      }
      if (result.domain.status === "failed") {
        return [
          runCommandAction(
            "Retry verification",
            `service domain retry ${result.domain.hostname}`,
          ),
        ];
      }
      return [
        runCommandAction(
          "Wait for activation",
          `service domain wait ${result.domain.hostname}`,
        ),
      ];
    },
  };
}

export function domainDeletePresentations(
  result: ServiceDomainDeleteResult,
): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    next: () => [],
    human: () => [
      completed(`Deleted ${result.hostname} from ${result.service.name}.`),
      fields([
        ...domainTargetRows(result),
        { label: "hostname", value: result.hostname },
        { label: "deleted", value: "yes" },
      ]),
    ],
  };
}

export function domainRetryPresentations(
  result: ServiceDomainRetryResult,
): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    human: () => [
      completed(`Retried verification for ${result.domain.hostname}.`),
      fields([
        ...domainTargetRows(result),
        { label: "hostname", value: result.domain.hostname },
        { label: "status", value: result.domain.status },
        ...domainFailureRows(result.domain),
        ...domainDnsRows(result.domain),
      ]),
    ],
    next: () => [
      runCommandAction(
        "Wait for activation",
        `service domain wait ${result.domain.hostname}`,
      ),
    ],
  };
}

export function domainWaitPresentations(
  result: ServiceDomainWaitResult,
): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    next: () => [],
    human: () => [
      completed(`${result.hostname} is live at ${result.liveUrl}`),
      fields([
        ...domainTargetRows(result),
        { label: "hostname", value: result.hostname },
        { label: "status", value: result.status },
      ]),
    ],
  };
}
