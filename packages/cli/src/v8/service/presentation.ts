import type { Block, Presentations } from "@prisma/cli-engine";
import type { NextAction } from "@prisma/cli-engine/protocol";
import { runCommandAction } from "./errors";
import type {
  ServiceCreateResult,
  ServiceDeploymentDeleteResult,
  ServiceDeploymentListResult,
  ServiceDeploymentRunStateResult,
  ServiceDeploymentShowResult,
  ServiceDeploymentSummary,
  ServiceDomainAddResult,
  ServiceDomainRemoveResult,
  ServiceDomainRetryResult,
  ServiceDomainShowResult,
  ServiceDomainSummary,
  ServiceDomainTarget,
  ServiceDomainWaitResult,
  ServiceListResult,
  ServiceOpenResult,
  ServicePromoteResult,
  ServiceRemoveResult,
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
    human: () => [
      title("Listing services for the selected project."),
      fields([
        { label: "project", value: result.projectId },
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
                service.region ?? "none",
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
        : [runCommandAction("Create a service", "service create <name>")];
    },
  };
}

export function createPresentations(
  result: ServiceCreateResult,
): Presentations {
  return {
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
        { label: "region", value: result.service.region ?? "none" },
        // A service with no deployment has no address that resolves, so
        // it reports what it needs next instead of a dead URL.
        {
          label: "live url",
          value: result.service.liveUrl ?? "not deployed",
        },
      ]),
    ],
    next: () => [
      runCommandAction("Deploy to the service", "composer deploy"),
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
    next.push(runCommandAction("Open the live URL", "service open"));
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
    human: () => [
      title("Showing the selected service state."),
      fields([
        { label: "project", value: result.projectId },
        { label: "service", value: result.service?.name ?? "not selected" },
        {
          label: "live deployment",
          value: result.liveDeployment?.id ?? "none",
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
    human: () => [
      title("Listing deployments for the selected service."),
      fields([
        { label: "project", value: result.projectId },
        { label: "service", value: result.service?.name ?? "not selected" },
      ]),
      result.deployments.length === 0
        ? {
            kind: "summary",
            status: "info",
            text: result.service
              ? "No deployments found."
              : "No services found.",
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
    human: () => [
      result.opened
        ? completed("Opened the live URL for the selected service.")
        : title("Resolved the live URL for the selected service."),
      fields([
        { label: "project", value: result.projectId },
        { label: "service", value: result.service.name },
        { label: "url", value: result.url },
        { label: "opened", value: result.opened ? "yes" : "no" },
      ]),
    ],
    stdout: () => [result.url],
    next: () => [
      runCommandAction("Inspect the service", "service show"),
      runCommandAction(
        "Show the live deployment",
        `service deployment show ${liveDeploymentId}`,
      ),
    ],
  };
}

function deploymentNextActions(deploymentId: string): NextAction[] {
  return [
    runCommandAction("List deployments", "service deployment list"),
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
    next: () => deploymentNextActions(result.deployment.id),
  };
}

export function rollbackPresentations(
  result: ServiceRollbackResult,
  alreadyLive: boolean,
): Presentations {
  return {
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
    next: () => deploymentNextActions(result.deployment.id),
  };
}

export function deploymentStartPresentations(
  result: ServiceDeploymentRunStateResult,
): Presentations {
  return {
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
    next: () => deploymentNextActions(result.deployment.id),
  };
}

export function deploymentStopPresentations(
  result: ServiceDeploymentRunStateResult,
): Presentations {
  return {
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
    next: () => deploymentNextActions(result.deployment.id),
  };
}

export function deploymentDeletePresentations(
  result: ServiceDeploymentDeleteResult,
): Presentations {
  return {
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
      runCommandAction("List deployments", "service deployment list"),
    ],
  };
}

export function removePresentations(
  result: ServiceRemoveResult,
): Presentations {
  return {
    human: () => [
      completed(
        `Removed ${result.service.name} and every deployment it owned.`,
      ),
      fields([
        { label: "project", value: result.projectId },
        { label: "service", value: result.service.name },
        { label: "removed", value: "yes" },
      ]),
    ],
    next: () => [
      runCommandAction("List deployments", "service deployment list"),
    ],
  };
}

export function domainAddPresentations(
  result: ServiceDomainAddResult,
): Presentations {
  return {
    human: () => [
      result.existing
        ? title("Showing the existing custom domain for the selected service.")
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

export function domainRemovePresentations(
  result: ServiceDomainRemoveResult,
): Presentations {
  return {
    human: () => [
      completed(`Removed ${result.hostname} from ${result.service.name}.`),
      fields([
        ...domainTargetRows(result),
        { label: "hostname", value: result.hostname },
        { label: "removed", value: "yes" },
      ]),
    ],
  };
}

export function domainRetryPresentations(
  result: ServiceDomainRetryResult,
): Presentations {
  return {
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
