import type { CommandDescriptor } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import type {
  AppBuildResult,
  AppDeployResult,
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
  const lines = renderShow(
    {
      title: "Deploying the selected app.",
      descriptor,
      fields: [
        { key: "workspace", value: result.workspace.name },
        { key: "project", value: result.project.name },
        { key: "branch", value: result.branch.name },
        { key: "app", value: result.app.name },
        { key: "deployment", value: result.deployment.id },
        { key: "status", value: result.deployment.status, tone: toneForStatus(result.deployment.status) },
        ...(result.deployment.url ? [{ key: "url", value: result.deployment.url, tone: "link" as const }] : []),
      ],
    },
    context.ui,
  );
  if (result.localPin?.written) {
    lines.push(`Bound this directory in ${result.localPin.path}. Subsequent commands target the same Project.`);
  }
  return lines;
}

export function serializeAppDeploy(result: AppDeployResult) {
  const { localPin: _localPin, ...serialized } = result;
  return serialized;
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
