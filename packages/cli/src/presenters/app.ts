import type { CommandDescriptor } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import type {
  AppBuildResult,
  AppDeployResult,
  AppDomainAddResult,
  AppDomainRemoveResult,
  AppDomainRetryResult,
  AppDomainShowResult,
  AppDomainStatus,
  AppListEnvResult,
  AppListDeploysResult,
  AppOpenResult,
  AppPromoteResult,
  AppRemoveResult,
  AppRollbackResult,
  AppShowResult,
  AppRunResult,
  AppShowDeployResult,
  AppUpdateEnvResult,
} from "../types/app";
import { renderList, renderShow, serializeList } from "../output/patterns";
import { renderDeployOutputRows } from "../lib/app/deploy-output";
import { formatDomainFailureFix } from "../lib/app/domain-guidance";

export function renderAppBuild(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppBuildResult,
): string[] {
  return renderShow(
    {
      title: "Building the local app artifact.",
      descriptor,
      fields: [
        { key: "build type", value: result.buildType },
        { key: "entrypoint", value: result.entrypoint ?? "none", tone: result.entrypoint ? "default" : "dim" },
        { key: "directory", value: result.directory },
      ],
    },
    context.ui,
  );
}

export function serializeAppBuild(result: AppBuildResult) {
  return result;
}

export function renderAppDeploy(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppDeployResult,
): string[] {
  void descriptor;

  const lines = [
    `Live in ${formatDuration(result.durationMs)}`,
    ...(result.deployment.url ? [context.ui.link(result.deployment.url)] : []),
    "",
    ...renderDeployOutputRows(context.ui, [
      { label: "Logs", value: "prisma-cli app logs" },
    ]),
  ];
  return lines;
}

export function serializeAppDeploy(result: AppDeployResult) {
  const { localPin: _localPin, ...serialized } = result;
  return serialized;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function renderAppUpdateEnv(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppUpdateEnvResult,
): string[] {
  return renderShow(
    {
      title: "Updating environment variables for the selected app.",
      descriptor,
      fields: [
        { key: "project", value: result.projectId },
        { key: "app", value: result.app.name },
        { key: "deployment", value: result.deployment.id },
        { key: "status", value: result.deployment.status, tone: toneForStatus(result.deployment.status) },
        ...(result.deployment.url ? [{ key: "url", value: result.deployment.url, tone: "link" as const }] : []),
        { key: "variables", value: formatVariableNames(result.variables), tone: result.variables.length > 0 ? "default" : "dim" },
      ],
    },
    context.ui,
  );
}

export function serializeAppUpdateEnv(result: AppUpdateEnvResult) {
  return result;
}

export function renderAppListEnv(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppListEnvResult,
): string[] {
  return renderShow(
    {
      title: "Listing environment variables for the selected app.",
      descriptor,
      fields: [
        { key: "project", value: result.projectId },
        { key: "app", value: result.app?.name ?? "not selected", tone: result.app ? "default" : "dim" },
        {
          key: "deployment",
          value: result.deployment?.id ?? "none",
          tone: result.deployment ? toneForStatus(result.deployment.status) : "dim",
        },
        { key: "variables", value: formatVariableNames(result.variables), tone: result.variables.length > 0 ? "default" : "dim" },
      ],
    },
    context.ui,
  );
}

export function serializeAppListEnv(result: AppListEnvResult) {
  return result;
}

export function renderAppListDeploys(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppListDeploysResult,
): string[] {
  return renderList(
    {
      title: "Listing deployments for the selected app.",
      descriptor,
      parentContext: {
        key: "app",
        value: result.app?.name ?? "not selected",
      },
      items: result.deployments.map((deployment) => ({
        noun: "deployment",
        label: deployment.id,
        id: deployment.id,
        status: deployment.live ? "active" : null,
      })),
      emptyMessage: result.app ? "No deployments found." : "No apps found.",
    },
    context.ui,
  );
}

export function serializeAppListDeploys(result: AppListDeploysResult) {
  if (!result.app) {
    return {
      projectId: result.projectId,
      app: null,
      items: [],
      count: 0,
    };
  }

  return {
    projectId: result.projectId,
    app: result.app,
    ...serializeList({
      context: {
        app: result.app.name,
      },
      items: result.deployments.map((deployment) => ({
        noun: "deployment",
        label: deployment.id,
        id: deployment.id,
        status: deployment.live ? "active" : null,
      })),
    }),
  };
}

export function renderAppShow(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppShowResult,
): string[] {
  return renderShow(
    {
      title: "Showing the selected app state.",
      descriptor,
      fields: [
        { key: "project", value: result.projectId },
        { key: "app", value: result.app?.name ?? "not selected", tone: result.app ? "default" : "dim" },
        {
          key: "live deployment",
          value: result.liveDeployment?.id ?? "none",
          tone: result.liveDeployment ? toneForStatus(result.liveDeployment.status) : "dim",
        },
        {
          key: "live url",
          value: result.liveUrl ?? "unavailable",
          tone: result.liveUrl ? "link" : "dim",
        },
        {
          key: "recent deployments",
          value: formatRecentDeployments(result.recentDeployments),
          tone: result.recentDeployments.length > 0 ? "default" : "dim",
        },
      ],
    },
    context.ui,
  );
}

export function serializeAppShow(result: AppShowResult) {
  return result;
}

export function renderAppShowDeploy(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppShowDeployResult,
): string[] {
  return renderShow(
    {
      title: "Showing deployment details.",
      descriptor,
      fields: [
        ...(result.app ? [{ key: "app", value: result.app.name }] : []),
        { key: "deployment", value: result.deployment.id },
        { key: "status", value: result.deployment.status, tone: toneForStatus(result.deployment.status) },
        ...(result.deployment.url ? [{ key: "url", value: result.deployment.url, tone: "link" as const }] : []),
        ...(result.deployment.live === null
          ? []
          : [{
              key: "live",
              value: result.deployment.live ? "yes" : "no",
              tone: result.deployment.live ? "success" as const : "dim" as const,
            }]),
        { key: "created", value: result.deployment.createdAt, tone: "dim" },
      ],
    },
    context.ui,
  );
}

export function serializeAppShowDeploy(result: AppShowDeployResult) {
  return result;
}

export function renderAppOpen(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppOpenResult,
): string[] {
  return renderShow(
    {
      title: result.opened
        ? "Opening the live URL for the selected app."
        : "Resolving the live URL for the selected app.",
      descriptor,
      fields: [
        { key: "project", value: result.projectId },
        { key: "app", value: result.app.name },
        { key: "url", value: result.url, tone: "link" },
        { key: "opened", value: result.opened ? "yes" : "no", tone: result.opened ? "success" : "dim" },
      ],
    },
    context.ui,
  );
}

export function serializeAppOpen(result: AppOpenResult) {
  return result;
}

export function renderAppDomainAdd(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppDomainAddResult,
): string[] {
  return renderShow(
    {
      title: result.existing
        ? "Showing the existing custom domain for the selected app."
        : "Adding a custom domain to the selected app.",
      descriptor,
      fields: [
        ...domainTargetFields(result),
        { key: "hostname", value: result.domain.hostname },
        { key: "status", value: result.domain.status, tone: toneForDomainStatus(result.domain.status) },
        ...domainDnsFields(result.domain),
      ],
    },
    context.ui,
  );
}

export function serializeAppDomainAdd(result: AppDomainAddResult) {
  return result;
}

export function renderAppDomainShow(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppDomainShowResult,
): string[] {
  return renderShow(
    {
      title: "Showing custom domain status.",
      descriptor,
      fields: [
        ...domainTargetFields(result),
        { key: "hostname", value: result.domain.hostname },
        { key: "status", value: result.domain.status, tone: toneForDomainStatus(result.domain.status) },
        { key: "failure", value: formatDomainFailure(result.domain), tone: result.domain.failureReason ? "error" : "dim" },
        ...domainFixFields(result.domain),
        { key: "cert expires", value: formatOptionalUtcDate(result.domain.certExpiresAt), tone: result.domain.certExpiresAt ? "default" : "dim" },
        { key: "created", value: formatUtcDate(result.domain.createdAt), tone: "dim" },
        ...domainDnsFields(result.domain),
      ],
    },
    context.ui,
  );
}

export function serializeAppDomainShow(result: AppDomainShowResult) {
  return result;
}

export function renderAppDomainRemove(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppDomainRemoveResult,
): string[] {
  return renderShow(
    {
      title: "Removing a custom domain from the selected app.",
      descriptor,
      fields: [
        ...domainTargetFields(result),
        { key: "hostname", value: result.hostname },
        { key: "removed", value: result.removed ? "yes" : "no", tone: result.removed ? "success" : "dim" },
      ],
    },
    context.ui,
  );
}

export function serializeAppDomainRemove(result: AppDomainRemoveResult) {
  return result;
}

export function renderAppDomainRetry(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppDomainRetryResult,
): string[] {
  return renderShow(
    {
      title: "Retrying custom domain verification.",
      descriptor,
      fields: [
        ...domainTargetFields(result),
        { key: "hostname", value: result.domain.hostname },
        { key: "status", value: result.domain.status, tone: toneForDomainStatus(result.domain.status) },
      ],
    },
    context.ui,
  );
}

export function serializeAppDomainRetry(result: AppDomainRetryResult) {
  return result;
}

export function renderAppPromote(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppPromoteResult,
): string[] {
  return renderShow(
    {
      title: "Switching the live deployment for the selected app.",
      descriptor,
      fields: [
        { key: "project", value: result.projectId },
        { key: "app", value: result.app.name },
        { key: "deployment", value: result.deployment.id },
        { key: "status", value: result.deployment.status, tone: toneForStatus(result.deployment.status) },
        ...(result.deployment.url ? [{ key: "url", value: result.deployment.url, tone: "link" as const }] : []),
        { key: "live", value: result.deployment.live ? "yes" : "no", tone: result.deployment.live ? "success" : "dim" },
        { key: "created", value: result.deployment.createdAt, tone: "dim" },
      ],
    },
    context.ui,
  );
}

export function serializeAppPromote(result: AppPromoteResult) {
  return result;
}

export function renderAppRollback(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppRollbackResult,
): string[] {
  return renderShow(
    {
      title: "Restoring the selected app to an earlier deployment.",
      descriptor,
      fields: [
        { key: "project", value: result.projectId },
        { key: "app", value: result.app.name },
        { key: "deployment", value: result.deployment.id },
        { key: "status", value: result.deployment.status, tone: toneForStatus(result.deployment.status) },
        ...(result.deployment.url ? [{ key: "url", value: result.deployment.url, tone: "link" as const }] : []),
        { key: "live", value: result.deployment.live ? "yes" : "no", tone: result.deployment.live ? "success" : "dim" },
        { key: "created", value: result.deployment.createdAt, tone: "dim" },
        ...(result.previousLiveDeploymentId
          ? [{ key: "replaced", value: result.previousLiveDeploymentId, tone: "dim" as const }]
          : []),
      ],
    },
    context.ui,
  );
}

export function serializeAppRollback(result: AppRollbackResult) {
  return result;
}

export function renderAppRun(
  _context: CommandContext,
  _descriptor: CommandDescriptor,
  _result: AppRunResult,
): string[] {
  return [];
}

export function serializeAppRun(result: AppRunResult) {
  return result;
}

export function renderAppRemove(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppRemoveResult,
): string[] {
  return renderShow(
    {
      title: "Removing the selected app.",
      descriptor,
      fields: [
        { key: "project", value: result.projectId },
        { key: "app", value: result.app.name },
        { key: "removed", value: result.removed ? "yes" : "no", tone: result.removed ? "success" : "dim" },
      ],
    },
    context.ui,
  );
}

export function serializeAppRemove(result: AppRemoveResult) {
  return result;
}

function toneForStatus(status: string): "success" | "warning" | "error" | "default" {
  if (status === "running" || status === "ready" || status === "healthy") {
    return "success";
  }

  if (status === "provisioning" || status === "building" || status === "starting") {
    return "warning";
  }

  if (status === "failed" || status === "error") {
    return "error";
  }

  return "default";
}

function toneForDomainStatus(status: AppDomainStatus): "success" | "warning" | "error" | "default" {
  if (status === "active") {
    return "success";
  }

  if (status === "failed") {
    return "error";
  }

  if (status === "pending_dns" || status === "verifying" || status === "provisioning_tls" || status === "verified_routing_blocked") {
    return "warning";
  }

  return "default";
}

function domainTargetFields(result: Pick<AppDomainAddResult, "workspace" | "project" | "branch" | "app">) {
  return [
    { key: "workspace", value: result.workspace.name },
    { key: "project", value: result.project.name },
    { key: "branch", value: result.branch.name },
    { key: "app", value: result.app.name },
  ];
}

function domainDnsFields(domain: Pick<AppDomainAddResult["domain"], "hostname" | "dnsRecords">) {
  const records = domain.dnsRecords;
  if (records.length === 0) {
    return [{
      key: "dns record",
      value: "not provided by platform",
      tone: "dim" as const,
    }];
  }

  return [{
    key: "dns record",
    value: records.map((record) => {
      const ttl = record.ttl ? ` ttl ${record.ttl}` : "";
      return `${record.type} ${record.name} -> ${record.value}${ttl}`;
    }).join(", "),
  }];
}

function formatDomainFailure(domain: AppDomainShowResult["domain"]): string {
  if (!domain.failureReason) {
    return domain.failureCategory ?? "none";
  }

  return domain.failureCategory ? `${domain.failureCategory} - ${domain.failureReason}` : domain.failureReason;
}

function domainFixFields(domain: AppDomainShowResult["domain"]) {
  const fix = formatDomainFailureFix(domain);

  return fix ? [{ key: "fix", value: fix }] : [];
}

function formatOptionalUtcDate(value: string | null): string {
  return value ? formatUtcDate(value) : "-";
}

function formatUtcDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

function formatRecentDeployments(deployments: AppShowResult["recentDeployments"]): string {
  if (deployments.length === 0) {
    return "none";
  }

  return deployments
    .map((deployment) => `${deployment.id}${deployment.live ? " (live)" : ""}`)
    .join(", ");
}

function formatVariableNames(variables: string[]): string {
  if (variables.length === 0) {
    return "none";
  }

  return variables.join(", ");
}
