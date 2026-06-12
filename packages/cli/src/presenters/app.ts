import { renderDeployOutputRows } from "../lib/app/deploy-output";
import { formatDomainFailureFix } from "../lib/app/domain-guidance";
import { renderList, renderShow, serializeList } from "../output/patterns";
import type { CommandDescriptor } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import { renderVerboseBlock, type VerboseRow } from "../shell/ui";
import type {
  AppBuildResult,
  AppDeployAllResult,
  AppDeployResult,
  AppDeploySettings,
  AppDomainAddResult,
  AppDomainRemoveResult,
  AppDomainRetryResult,
  AppDomainShowResult,
  AppDomainStatus,
  AppListDeploysResult,
  AppOpenResult,
  AppPromoteResult,
  AppRemoveResult,
  AppRollbackResult,
  AppRunResult,
  AppShowDeployResult,
  AppShowResult,
} from "../types/app";
import {
  renderResolvedProjectContextBlock,
  stripVerboseContext,
} from "./verbose-context";

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
        {
          key: "entrypoint",
          value: result.entrypoint ?? "none",
          tone: result.entrypoint ? "default" : "dim",
        },
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
    ...renderBranchDatabaseDeploySummary(context, result),
    "",
    ...renderDeployOutputRows(context.ui, [
      { label: "Logs", value: "prisma-cli app logs" },
    ]),
    ...renderDeployResolvedContextBlock(context, result),
    ...renderDeploySettingsBlock(context, result),
  ];
  return lines;
}

export function isAppDeployAllResult(
  result: AppDeployResult | AppDeployAllResult,
): result is AppDeployAllResult {
  return "deployments" in result;
}

export function renderAppDeployAll(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppDeployAllResult,
): string[] {
  const lines: string[] = [];
  for (const deployment of result.deployments) {
    lines.push(deployment.target);
    lines.push(
      ...renderAppDeploy(context, descriptor, deployment.result).map((line) =>
        line ? `  ${line}` : line,
      ),
    );
    lines.push("");
  }

  lines.push(
    ...renderDeployOutputRows(
      context.ui,
      result.deployments.map((deployment) => ({
        label: deployment.target,
        value:
          deployment.result.deployment.url ?? deployment.result.deployment.id,
      })),
    ),
  );
  return lines;
}

export function serializeAppDeployAll(result: AppDeployAllResult) {
  return {
    count: result.deployments.length,
    deployments: result.deployments.map((deployment) => ({
      target: deployment.target,
      ...serializeAppDeploy(deployment.result),
    })),
  };
}

export function serializeAppDeploy(result: AppDeployResult) {
  const { deploySettings, localPin: _localPin, ...serialized } = result;
  const { id: _branchId, ...branch } = serialized.branch;

  return {
    ...serialized,
    branch,
    deploySettings: {
      config: deploySettings.config,
      buildCommand: deploySettings.buildCommand,
      outputDirectory: deploySettings.outputDirectory,
    },
  };
}

function renderBranchDatabaseDeploySummary(
  context: CommandContext,
  result: AppDeployResult,
): string[] {
  if (!result.branchDatabase || result.branchDatabase.status !== "created") {
    return [];
  }

  return [
    "",
    ...renderDeployOutputRows(context.ui, [
      {
        label: "Database",
        value: result.branchDatabase.database?.name ?? "created",
      },
      {
        label: "Env",
        value: result.branchDatabase.envVars.join(", "),
      },
    ]),
  ];
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

function renderDeployResolvedContextBlock(
  context: CommandContext,
  result: AppDeployResult,
): string[] {
  return renderResolvedProjectContextBlock(
    context.ui,
    {
      workspace: result.workspace,
      project: result.project,
      resolution: result.resolution,
      branch: {
        id: result.branch.id,
        name: result.branch.name,
        kind: result.branch.kind,
      },
    },
    {
      extraRows: [
        { key: "app", value: result.app.name },
        { key: "app id", value: result.app.id, tone: "dim" },
        { key: "deployment id", value: result.deployment.id, tone: "dim" },
        { key: "deployment status", value: result.deployment.status },
        ...(result.localPin
          ? [{ key: "local pin", value: result.localPin.path }]
          : []),
        { key: "deploy duration", value: formatDuration(result.durationMs) },
      ],
    },
  );
}

function renderDeploySettingsBlock(
  context: CommandContext,
  result: AppDeployResult,
): string[] {
  return renderVerboseBlock(
    context.ui,
    [
      ...deploySettingsRows(result.deploySettings),
      ...branchDatabaseRows(result.branchDatabase),
    ],
    { title: "Deploy settings" },
  );
}

function deploySettingsRows(settings: AppDeploySettings): VerboseRow[] {
  return [
    {
      key: "framework",
      value: `${settings.framework.name} (${settings.framework.buildType})`,
    },
    { key: "framework source", value: settings.framework.source, tone: "dim" },
    {
      key: "entrypoint",
      value: settings.entrypoint ?? "derived from build output",
      tone: settings.entrypoint ? "default" : "dim",
    },
    { key: "http port", value: String(settings.httpPort) },
    {
      key: "region",
      value: settings.region ?? "existing app region",
      tone: settings.region ? "default" : "dim",
    },
    {
      key: "env vars",
      value: formatEnvVarNames(settings.envVars),
      tone: settings.envVars.length > 0 ? "default" : "dim",
    },
  ];
}

function branchDatabaseRows(
  branchDatabase: AppDeployResult["branchDatabase"],
): VerboseRow[] {
  if (!branchDatabase) {
    return [{ key: "branch db", value: "not configured", tone: "dim" }];
  }

  return [
    {
      key: "branch db",
      value:
        branchDatabase.status === "created"
          ? `created${branchDatabase.database ? ` (${branchDatabase.database.name})` : ""}`
          : `skipped${branchDatabase.reason ? ` (${branchDatabase.reason})` : ""}`,
      tone: branchDatabase.status === "created" ? "success" : "dim",
    },
    ...(branchDatabase.envVars.length > 0
      ? [{ key: "branch db env", value: branchDatabase.envVars.join(", ") }]
      : []),
  ];
}

function formatEnvVarNames(envVars: string[]): string {
  return envVars.length > 0 ? envVars.join(", ") : "none";
}

export function renderAppListDeploys(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppListDeploysResult,
): string[] {
  const lines = renderList(
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
  lines.push(
    ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
  );
  return lines;
}

export function serializeAppListDeploys(result: AppListDeploysResult) {
  const { verboseContext: _verboseContext, ...serializable } = result;

  if (!serializable.app) {
    return {
      projectId: serializable.projectId,
      app: null,
      items: [],
      count: 0,
    };
  }

  return {
    projectId: serializable.projectId,
    app: serializable.app,
    ...serializeList({
      context: {
        app: serializable.app.name,
      },
      items: serializable.deployments.map((deployment) => ({
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
  const lines = renderShow(
    {
      title: "Showing the selected app state.",
      descriptor,
      fields: [
        { key: "project", value: result.projectId },
        {
          key: "app",
          value: result.app?.name ?? "not selected",
          tone: result.app ? "default" : "dim",
        },
        {
          key: "live deployment",
          value: result.liveDeployment?.id ?? "none",
          tone: result.liveDeployment
            ? toneForStatus(result.liveDeployment.status)
            : "dim",
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
  lines.push(
    ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
  );
  return lines;
}

export function serializeAppShow(result: AppShowResult) {
  return stripVerboseContext(result);
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
        {
          key: "status",
          value: result.deployment.status,
          tone: toneForStatus(result.deployment.status),
        },
        ...(result.deployment.url
          ? [
              {
                key: "url",
                value: result.deployment.url,
                tone: "link" as const,
              },
            ]
          : []),
        ...(result.deployment.live === null
          ? []
          : [
              {
                key: "live",
                value: result.deployment.live ? "yes" : "no",
                tone: result.deployment.live
                  ? ("success" as const)
                  : ("dim" as const),
              },
            ]),
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
  const lines = renderShow(
    {
      title: result.opened
        ? "Opening the live URL for the selected app."
        : "Resolving the live URL for the selected app.",
      descriptor,
      fields: [
        { key: "project", value: result.projectId },
        { key: "app", value: result.app.name },
        { key: "url", value: result.url, tone: "link" },
        {
          key: "opened",
          value: result.opened ? "yes" : "no",
          tone: result.opened ? "success" : "dim",
        },
      ],
    },
    context.ui,
  );
  lines.push(
    ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
  );
  return lines;
}

export function serializeAppOpen(result: AppOpenResult) {
  return stripVerboseContext(result);
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
        {
          key: "status",
          value: result.domain.status,
          tone: toneForDomainStatus(result.domain.status),
        },
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
        {
          key: "status",
          value: result.domain.status,
          tone: toneForDomainStatus(result.domain.status),
        },
        ...domainFailureFields(result.domain),
        {
          key: "cert expires",
          value: formatOptionalUtcDate(result.domain.certExpiresAt),
          tone: result.domain.certExpiresAt ? "default" : "dim",
        },
        {
          key: "created",
          value: formatUtcDate(result.domain.createdAt),
          tone: "dim",
        },
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
        {
          key: "removed",
          value: result.removed ? "yes" : "no",
          tone: result.removed ? "success" : "dim",
        },
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
        {
          key: "status",
          value: result.domain.status,
          tone: toneForDomainStatus(result.domain.status),
        },
        ...domainFailureFields(result.domain),
        ...domainDnsFields(result.domain),
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
  const lines = renderShow(
    {
      title: "Switching the live deployment for the selected app.",
      descriptor,
      fields: [
        { key: "project", value: result.projectId },
        { key: "app", value: result.app.name },
        { key: "deployment", value: result.deployment.id },
        {
          key: "status",
          value: result.deployment.status,
          tone: toneForStatus(result.deployment.status),
        },
        ...(result.deployment.url
          ? [
              {
                key: "url",
                value: result.deployment.url,
                tone: "link" as const,
              },
            ]
          : []),
        {
          key: "live",
          value: result.deployment.live ? "yes" : "no",
          tone: result.deployment.live ? "success" : "dim",
        },
        { key: "created", value: result.deployment.createdAt, tone: "dim" },
      ],
    },
    context.ui,
  );
  lines.push(
    ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
  );
  return lines;
}

export function serializeAppPromote(result: AppPromoteResult) {
  return stripVerboseContext(result);
}

export function renderAppRollback(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AppRollbackResult,
): string[] {
  const lines = renderShow(
    {
      title: "Restoring the selected app to an earlier deployment.",
      descriptor,
      fields: [
        { key: "project", value: result.projectId },
        { key: "app", value: result.app.name },
        { key: "deployment", value: result.deployment.id },
        {
          key: "status",
          value: result.deployment.status,
          tone: toneForStatus(result.deployment.status),
        },
        ...(result.deployment.url
          ? [
              {
                key: "url",
                value: result.deployment.url,
                tone: "link" as const,
              },
            ]
          : []),
        {
          key: "live",
          value: result.deployment.live ? "yes" : "no",
          tone: result.deployment.live ? "success" : "dim",
        },
        { key: "created", value: result.deployment.createdAt, tone: "dim" },
        ...(result.previousLiveDeploymentId
          ? [
              {
                key: "replaced",
                value: result.previousLiveDeploymentId,
                tone: "dim" as const,
              },
            ]
          : []),
      ],
    },
    context.ui,
  );
  lines.push(
    ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
  );
  return lines;
}

export function serializeAppRollback(result: AppRollbackResult) {
  return stripVerboseContext(result);
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
  const lines = renderShow(
    {
      title: "Removing the selected app.",
      descriptor,
      fields: [
        { key: "project", value: result.projectId },
        { key: "app", value: result.app.name },
        {
          key: "removed",
          value: result.removed ? "yes" : "no",
          tone: result.removed ? "success" : "dim",
        },
      ],
    },
    context.ui,
  );
  lines.push(
    ...renderResolvedProjectContextBlock(context.ui, result.verboseContext),
  );
  return lines;
}

export function serializeAppRemove(result: AppRemoveResult) {
  return stripVerboseContext(result);
}

function toneForStatus(
  status: string,
): "success" | "warning" | "error" | "default" {
  if (status === "running" || status === "ready" || status === "healthy") {
    return "success";
  }

  if (
    status === "provisioning" ||
    status === "building" ||
    status === "starting"
  ) {
    return "warning";
  }

  if (status === "failed" || status === "error") {
    return "error";
  }

  return "default";
}

function toneForDomainStatus(
  status: AppDomainStatus,
): "success" | "warning" | "error" | "default" {
  if (status === "active") {
    return "success";
  }

  if (status === "failed") {
    return "error";
  }

  if (
    status === "pending_dns" ||
    status === "verifying" ||
    status === "provisioning_tls" ||
    status === "verified_routing_blocked"
  ) {
    return "warning";
  }

  return "default";
}

function domainTargetFields(
  result: Pick<AppDomainAddResult, "workspace" | "project" | "branch" | "app">,
) {
  return [
    { key: "workspace", value: result.workspace.name },
    { key: "project", value: result.project.name },
    { key: "branch", value: result.branch.name },
    { key: "app", value: result.app.name },
  ];
}

function domainDnsFields(
  domain: Pick<AppDomainAddResult["domain"], "hostname" | "dnsRecords">,
) {
  const records = domain.dnsRecords;
  if (records.length === 0) {
    return [
      {
        key: "dns record",
        value: "not provided by platform",
        tone: "dim" as const,
      },
    ];
  }

  return [
    {
      key: "dns record",
      value: records
        .map((record) => {
          const ttl = record.ttl ? ` ttl ${record.ttl}` : "";
          return `${record.type} ${record.name} -> ${record.value}${ttl}`;
        })
        .join(", "),
    },
  ];
}

function formatDomainFailure(domain: AppDomainShowResult["domain"]): string {
  if (!domain.failureReason) {
    return domain.failureCategory ?? "none";
  }

  return domain.failureCategory
    ? `${domain.failureCategory} - ${domain.failureReason}`
    : domain.failureReason;
}

function domainFailureFields(domain: AppDomainShowResult["domain"]) {
  const tone = hasDomainFailure(domain) ? "error" : "dim";

  return [
    { key: "failure", value: formatDomainFailure(domain), tone },
    ...domainFixFields(domain),
  ];
}

function hasDomainFailure(domain: AppDomainShowResult["domain"]): boolean {
  return Boolean(domain.failureCategory || domain.failureReason);
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

function formatRecentDeployments(
  deployments: AppShowResult["recentDeployments"],
): string {
  if (deployments.length === 0) {
    return "none";
  }

  return deployments
    .map((deployment) => `${deployment.id}${deployment.live ? " (live)" : ""}`)
    .join(", ");
}
