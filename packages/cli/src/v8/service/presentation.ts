import type { Block, Presentations } from "@prisma/cli-engine";
import type { NextAction } from "@prisma/cli-engine/protocol";
import { runCommandAction } from "./errors";
import type {
  ServiceBuildResult,
  ServiceDeploymentSummary,
  ServiceDomainAddResult,
  ServiceDomainRemoveResult,
  ServiceDomainRetryResult,
  ServiceDomainShowResult,
  ServiceDomainSummary,
  ServiceDomainTarget,
  ServiceDomainWaitResult,
  ServiceListDeploysResult,
  ServiceOpenResult,
  ServiceShowDeployResult,
  ServiceShowResult,
} from "./results";

type FieldRow = { label: string; value: string };

function fields(rows: FieldRow[]): Block {
  return { kind: "fields", rows };
}

function title(text: string): Block {
  return { kind: "summary", tone: "info", text };
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

export function buildPresentations(result: ServiceBuildResult): Presentations {
  return {
    human: () => [
      title("Building the local service artifact."),
      fields([
        { label: "build type", value: result.buildType },
        { label: "entrypoint", value: result.entrypoint ?? "none" },
        { label: "directory", value: result.directory },
      ]),
    ],
    next: () => [runCommandAction("Deploy the service", "service deploy")],
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
        `service show-deploy ${inspectable.id}`,
      ),
    );
  } else {
    next.push(runCommandAction("Deploy the service", "service deploy"));
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

export function listDeploysPresentations(
  result: ServiceListDeploysResult,
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
            tone: "info",
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
              `service show-deploy ${newest.id}`,
            ),
          ]
        : [runCommandAction("Deploy the service", "service deploy")];
    },
  };
}

export function showDeployPresentations(
  result: ServiceShowDeployResult,
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

export function openPresentations(result: ServiceOpenResult): Presentations {
  return {
    human: () => [
      title(
        result.opened
          ? "Opening the live URL for the selected service."
          : "Resolving the live URL for the selected service.",
      ),
      fields([
        { label: "project", value: result.projectId },
        { label: "service", value: result.service.name },
        { label: "url", value: result.url },
        { label: "opened", value: result.opened ? "yes" : "no" },
      ]),
    ],
    stdout: () => [result.url],
    next: () => [runCommandAction("Inspect the service", "service show")],
  };
}

export function domainAddPresentations(
  result: ServiceDomainAddResult,
): Presentations {
  return {
    human: () => [
      title(
        result.existing
          ? "Showing the existing custom domain for the selected service."
          : "Adding a custom domain to the selected service.",
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
      title("Removing a custom domain from the selected service."),
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
      title("Retrying custom domain verification."),
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
      {
        kind: "summary",
        tone: "ok",
        text: `${result.hostname} is live at ${result.liveUrl}`,
      },
      fields([
        ...domainTargetRows(result),
        { label: "hostname", value: result.hostname },
        { label: "status", value: result.status },
      ]),
    ],
  };
}
