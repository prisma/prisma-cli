import open from "open";
import type { PortMapping, StreamRecord } from "@prisma/compute-sdk";
import type { ManagementApiClient } from "@prisma/management-api-sdk";

import { FileTokenStorage } from "../adapters/token-storage";
import { authRequiredError, CliError, featureUnavailableError, usageError, workspaceRequiredError } from "../shell/errors";
import { writeJsonEvent, type CommandSuccess } from "../shell/output";
import { canPrompt, type CommandContext } from "../shell/runtime";
import { textPrompt } from "../shell/prompt";
import { renderCommandHeader } from "../shell/ui";
import type {
  AppBuildResult,
  AppDeployResult,
  AppDeploymentSummary,
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
import type { AuthWorkspace } from "../types/auth";
import type { BranchKind } from "../types/branch";
import type { ProjectResolution, ProjectSummary } from "../types/project";
import { requireComputeAuth } from "../lib/auth/guard";
import { readAuthState } from "../lib/auth/auth-ops";
import { getApiBaseUrl, SERVICE_TOKEN_ENV_VAR } from "../lib/auth/client";
import { parseEnvAssignments } from "../lib/app/env-vars";
import {
  DEFAULT_LOCAL_DEV_PORT,
  resolveLocalBuildType,
  runLocalApp,
} from "../lib/app/local-dev";
import { resolveProjectTarget } from "../lib/project/resolution";
import {
  executePreviewBuild,
  PREVIEW_BUILD_TYPES,
  RESOLVED_PREVIEW_BUILD_TYPES,
  type PreviewBuildType,
} from "../lib/app/preview-build";
import {
  createPreviewDeployInteraction,
  PREVIEW_DEFAULT_REGION,
} from "../lib/app/preview-interaction";
import {
  createPreviewDeployProgress,
  createPreviewPromoteProgress,
  createPreviewUpdateEnvProgress,
} from "../lib/app/preview-progress";
import { createPreviewAppProvider, type PreviewAppRecord } from "../lib/app/preview-provider";
import { requireAuthenticatedAuthState } from "./auth";
import { listRealWorkspaceProjects } from "./project";
import { createSelectPromptPort } from "./select-prompt-port";

function isRealMode(context: CommandContext): boolean {
  return !context.runtime.fixturePath && !context.runtime.env.PRISMA_CLI_MOCK_FIXTURE_PATH;
}

export async function runAppBuild(
  context: CommandContext,
  entrypoint: string | undefined,
  requestedBuildType: string | undefined,
): Promise<CommandSuccess<AppBuildResult>> {
  const buildType = normalizeBuildType(requestedBuildType);
  assertSupportedEntrypoint(buildType, entrypoint, "build");

  try {
    const { artifact, buildType: actualBuildType } = await executePreviewBuild({
      appPath: context.runtime.cwd,
      entrypoint,
      buildType,
    });

    return {
      command: "app.build",
      result: {
        directory: artifact.directory,
        entrypoint: artifact.entrypoint,
        buildType: actualBuildType,
      },
      warnings: [],
      nextSteps: ["prisma-cli app deploy"],
    };
  } catch (error) {
    if (buildType === "auto" && isAutoBuildDetectionError(error)) {
      throw usageError(
        "App build requires an explicit framework when detection is ambiguous",
        `This preview auto-detects clear project shapes for ${RESOLVED_PREVIEW_BUILD_TYPES.map(formatBuildTypeName).join(", ")}.`,
        "Pass a supported --build-type value, or pass --entry <path> for a Bun app.",
        getBuildTypeExamples("build"),
        "app",
      );
    }

    throw buildFailedError("Local app build failed", error);
  }
}

export async function runAppRun(
  context: CommandContext,
  entrypoint: string | undefined,
  requestedBuildType: string | undefined,
  requestedPort: string | undefined,
): Promise<CommandSuccess<AppRunResult>> {
  if (context.flags.json) {
    throw usageError(
      "App run does not support --json",
      "This command streams the framework dev server directly and cannot return structured JSON.",
      "Rerun without --json to pass framework logs through directly.",
      ["prisma-cli app run"],
      "app",
    );
  }

  const buildType = normalizeBuildType(requestedBuildType);
  assertSupportedEntrypoint(buildType, entrypoint, "run");
  const port = parseLocalPort(requestedPort);
  const resolvedBuildType = await requireLocalBuildType(context, buildType, "run");

  let runResult: Awaited<ReturnType<typeof runLocalApp>>;
  try {
    runResult = await runLocalApp({
      appPath: context.runtime.cwd,
      buildType: resolvedBuildType,
      entrypoint,
      port,
      env: context.runtime.env,
    });
  } catch (error) {
    throw runFailedError("Local app run failed", error);
  }

  if (runResult.signal === "SIGINT" || runResult.signal === "SIGTERM") {
    process.exitCode = runResult.signal === "SIGINT" ? 130 : 143;
  } else if (runResult.exitCode !== 0) {
    throw runFailedError(
      "Local app run failed",
      `The ${formatFrameworkName(runResult.framework)} process exited with code ${runResult.exitCode}.`,
      runResult.exitCode,
    );
  }

  return {
    command: "app.run",
    result: {
      framework: runResult.framework,
      entrypoint: runResult.entrypoint,
      port: runResult.port,
      command: runResult.command,
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runAppDeploy(
  context: CommandContext,
  appName: string | undefined,
  options?: {
    projectRef?: string;
    entrypoint?: string;
    buildType?: string;
    httpPort?: string;
    envAssignments?: string[];
  },
): Promise<CommandSuccess<AppDeployResult>> {
  ensurePreviewAppMode(context);

  const buildType = normalizeBuildType(options?.buildType);
  assertSupportedEntrypoint(buildType, options?.entrypoint, "deploy");
  const portMapping = parseDeployPortMapping(options?.httpPort);
  const envVars = toOptionalEnvVars(
    parseEnvAssignments(options?.envAssignments, {
      commandName: "deploy",
    }),
  );
  const { provider, target, projectId } = await requireProviderAndProjectContext(context, options?.projectRef, {
    allowCreate: true,
  });
  const apps = await listApps(context, provider, projectId);
  const selectedApp = await resolveDeploySelection(context, projectId, apps, appName);

  const deployResult = await provider.deployApp({
    cwd: context.runtime.cwd,
    projectId,
    appId: selectedApp.appId,
    appName: selectedApp.appName,
    region: selectedApp.region,
    entrypoint: options?.entrypoint,
    buildType,
    portMapping,
    envVars,
    interaction: selectedApp.useInteractiveSelection ? createPreviewDeployInteraction(context) : undefined,
    progress: createPreviewDeployProgress(context.output.stderr, !context.flags.json && !context.flags.quiet),
  }).catch((error) => {
    throw deployFailedError("App deploy failed", error, ["prisma-cli app list-deploys"]);
  });

  await context.stateStore.setSelectedApp(projectId, {
    id: deployResult.app.id,
    name: deployResult.app.name,
  });
  await context.stateStore.setKnownLiveDeployment(projectId, deployResult.app.id, deployResult.deployment.id);

  return {
    command: "app.deploy",
    result: {
      workspace: target.workspace,
      project: target.project,
      branch: target.branch,
      resolution: target.resolution,
      app: {
        id: deployResult.app.id,
        name: deployResult.app.name,
      },
      deployment: deployResult.deployment,
    },
    warnings: [],
    nextSteps: ["prisma-cli app list-deploys", `prisma-cli app show-deploy ${deployResult.deployment.id}`],
  };
}

export async function runAppUpdateEnv(
  context: CommandContext,
  appName: string | undefined,
  envAssignments: string[] | undefined,
  projectRef?: string,
): Promise<CommandSuccess<AppUpdateEnvResult>> {
  ensurePreviewAppMode(context);
  emitLegacyEnvDeprecationWarning(context, "app update-env", "project env add");

  const envVars = parseEnvAssignments(envAssignments, {
    commandName: "update-env",
    requireAtLeastOne: true,
  });
  const { provider, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const apps = await listApps(context, provider, projectId);
  const selectedApp = await resolveExistingAppSelection(context, projectId, apps, appName);

  if (!selectedApp) {
    throw noDeploymentsError(
      "No deployments available to update environment variables",
      "The resolved project does not have any deployed app yet.",
    );
  }

  const deploymentsResult = await provider.listDeployments(selectedApp.id).catch((error) => {
    throw deployFailedError("Failed to inspect app deployments", error, ["prisma-cli app list-deploys"]);
  });

  if (deploymentsResult.deployments.length === 0) {
    throw noDeploymentsError(
      "No deployments available to update environment variables",
      `The selected app "${deploymentsResult.app.name}" does not have any deployments yet.`,
    );
  }

  const updateResult = await provider.updateAppEnv({
    appId: deploymentsResult.app.id,
    envVars,
    progress: createPreviewUpdateEnvProgress(context.output.stderr, !context.flags.json && !context.flags.quiet),
    promoteProgress: createPreviewPromoteProgress(context.output.stderr, !context.flags.json && !context.flags.quiet),
  }).catch((error) => {
    throw deployFailedError("Failed to update app environment variables", error, ["prisma-cli app list-env"]);
  });

  await context.stateStore.setSelectedApp(projectId, {
    id: updateResult.app.id,
    name: updateResult.app.name,
  });
  await context.stateStore.setKnownLiveDeployment(projectId, updateResult.app.id, updateResult.deployment.id);

  return {
    command: "app.update-env",
    result: {
      projectId: updateResult.projectId,
      app: {
        id: updateResult.app.id,
        name: updateResult.app.name,
      },
      deployment: updateResult.deployment,
      variables: updateResult.variables,
    },
    warnings: [],
    nextSteps: ["prisma-cli app list-env", `prisma-cli app show-deploy ${updateResult.deployment.id}`],
  };
}

export async function runAppListEnv(
  context: CommandContext,
  appName: string | undefined,
  projectRef?: string,
): Promise<CommandSuccess<AppListEnvResult>> {
  ensurePreviewAppMode(context);
  emitLegacyEnvDeprecationWarning(context, "app list-env", "project env list");

  const { provider, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const apps = await listApps(context, provider, projectId);
  const selectedApp = await resolveExistingAppSelection(context, projectId, apps, appName);

  if (!selectedApp) {
    return {
      command: "app.list-env",
      result: {
        projectId,
        app: null,
        deployment: null,
        variables: [],
      },
      warnings: [],
      nextSteps: ["prisma-cli app deploy"],
    };
  }

  const deploymentsResult = await provider.listDeployments(selectedApp.id).catch((error) => {
    throw deployFailedError("Failed to inspect app deployments", error, ["prisma-cli app list-deploys"]);
  });
  const knownLiveDeploymentId = await context.stateStore.readKnownLiveDeployment(projectId, deploymentsResult.app.id);
  const missingKnownLiveDeploymentId = knownLiveDeploymentId
    && !deploymentsResult.deployments.some((candidate) => candidate.id === knownLiveDeploymentId)
      ? knownLiveDeploymentId
      : null;
  const currentLiveDeploymentId = await resolveCurrentLiveDeploymentId(
    context,
    projectId,
    deploymentsResult.app,
    deploymentsResult.deployments,
  );
  const deployments = applyLiveDeploymentHint(deploymentsResult.deployments, currentLiveDeploymentId)
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  const deployment = currentLiveDeploymentId
    ? deployments.find((candidate) => candidate.id === currentLiveDeploymentId) ?? null
    : null;

  await context.stateStore.setSelectedApp(projectId, {
    id: deploymentsResult.app.id,
    name: deploymentsResult.app.name,
  });

  if (missingKnownLiveDeploymentId) {
    const envResult = await provider.listAppEnvNames({
      appId: deploymentsResult.app.id,
      deploymentId: missingKnownLiveDeploymentId,
    }).catch((error) => {
      throw deployFailedError("Failed to inspect app environment variables", error, ["prisma-cli app list-deploys"]);
    });

    return {
      command: "app.list-env",
      result: {
        projectId,
        app: {
          id: envResult.app.id,
          name: envResult.app.name,
        },
        deployment: envResult.deployment,
        variables: envResult.variables,
      },
      warnings: [],
      nextSteps: [`prisma-cli app show-deploy ${envResult.deployment.id}`],
    };
  }

  if (!deployment) {
    return {
      command: "app.list-env",
      result: {
        projectId,
        app: {
          id: deploymentsResult.app.id,
          name: deploymentsResult.app.name,
        },
        deployment: null,
        variables: [],
      },
      warnings: [],
      nextSteps: ["prisma-cli app deploy"],
    };
  }

  const envResult = await provider.listAppEnvNames({
    appId: deploymentsResult.app.id,
    deploymentId: deployment.id,
  }).catch((error) => {
    throw deployFailedError("Failed to inspect app environment variables", error, ["prisma-cli app list-deploys"]);
  });

  return {
    command: "app.list-env",
    result: {
      projectId,
      app: {
        id: envResult.app.id,
        name: envResult.app.name,
      },
      deployment: {
        ...deployment,
        live: deployment.live ?? envResult.deployment.live,
      },
      variables: envResult.variables,
    },
    warnings: [],
    nextSteps: deployment.id ? [`prisma-cli app show-deploy ${deployment.id}`] : ["prisma-cli app deploy"],
  };
}

export async function runAppListDeploys(
  context: CommandContext,
  appName: string | undefined,
  projectRef?: string,
): Promise<CommandSuccess<AppListDeploysResult>> {
  ensurePreviewAppMode(context);

  const { provider, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const apps = await listApps(context, provider, projectId);
  const selectedApp = await resolveExistingAppSelection(context, projectId, apps, appName);

  if (!selectedApp) {
    return {
      command: "app.list-deploys",
      result: {
        projectId,
        app: null,
        deployments: [],
      },
      warnings: [],
      nextSteps: ["prisma-cli app deploy"],
    };
  }

  const deploymentsResult = await provider.listDeployments(selectedApp.id).catch((error) => {
    throw deployFailedError("Failed to list app deployments", error, ["prisma-cli app deploy"]);
  });
  const currentLiveDeploymentId = await resolveCurrentLiveDeploymentId(
    context,
    projectId,
    deploymentsResult.app,
    deploymentsResult.deployments,
  );
  const deployments = applyLiveDeploymentHint(deploymentsResult.deployments, currentLiveDeploymentId)
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));

  await context.stateStore.setSelectedApp(projectId, {
    id: deploymentsResult.app.id,
    name: deploymentsResult.app.name,
  });

  return {
    command: "app.list-deploys",
    result: {
      projectId,
      app: {
        id: deploymentsResult.app.id,
        name: deploymentsResult.app.name,
      },
      deployments,
    },
    warnings: [],
    nextSteps: deployments.length > 0
      ? [`prisma-cli app show-deploy ${deployments[0]?.id}`]
      : ["prisma-cli app deploy"],
  };
}

export async function runAppShow(
  context: CommandContext,
  appName: string | undefined,
  projectRef?: string,
): Promise<CommandSuccess<AppShowResult>> {
  ensurePreviewAppMode(context);

  const { provider, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const apps = await listApps(context, provider, projectId);
  const selectedApp = await resolveExistingAppSelection(context, projectId, apps, appName);

  if (!selectedApp) {
    return {
      command: "app.show",
      result: {
        projectId,
        app: null,
        liveDeployment: null,
        liveUrl: null,
        recentDeployments: [],
      },
      warnings: [],
      nextSteps: ["prisma-cli app deploy"],
    };
  }

  const deploymentsResult = await provider.listDeployments(selectedApp.id).catch((error) => {
    throw deployFailedError("Failed to inspect app", error, ["prisma-cli app list-deploys"]);
  });
  const currentLiveDeploymentId = await resolveCurrentLiveDeploymentId(
    context,
    projectId,
    deploymentsResult.app,
    deploymentsResult.deployments,
  );
  const deployments = applyLiveDeploymentHint(deploymentsResult.deployments, currentLiveDeploymentId)
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  const liveDeployment = currentLiveDeploymentId
    ? deployments.find((deployment) => deployment.id === currentLiveDeploymentId) ?? null
    : null;

  await context.stateStore.setSelectedApp(projectId, {
    id: deploymentsResult.app.id,
    name: deploymentsResult.app.name,
  });

  return {
    command: "app.show",
    result: {
      projectId,
      app: {
        id: deploymentsResult.app.id,
        name: deploymentsResult.app.name,
      },
      liveDeployment,
      liveUrl: deploymentsResult.app.liveUrl,
      recentDeployments: deployments.slice(0, 5),
    },
    warnings: [],
    nextSteps: buildAppShowNextSteps(deploymentsResult.app.liveUrl, liveDeployment, deployments),
  };
}

export async function runAppShowDeploy(
  context: CommandContext,
  deploymentId: string,
): Promise<CommandSuccess<AppShowDeployResult>> {
  ensurePreviewAppMode(context);

  const provider = await requirePreviewAppProvider(context);
  const deployment = await provider.showDeployment(deploymentId).catch((error) => {
    throw deployFailedError("Failed to show deployment", error, ["prisma-cli app list-deploys"]);
  });

  if (!deployment) {
    throw new CliError({
      code: "DEPLOYMENT_NOT_FOUND",
      domain: "app",
      summary: `Deployment "${deploymentId}" not found`,
      why: "The requested deployment does not exist or is no longer available.",
      fix: "Run prisma-cli app list-deploys to choose an available deployment id.",
      exitCode: 1,
      nextSteps: ["prisma-cli app list-deploys"],
    });
  }

  const workspaceId = deployment?.app ? await readCurrentWorkspaceId(context) : null;
  const rememberedProject = workspaceId ? await context.stateStore.readRememberedProject(workspaceId) : null;
  const knownLiveDeploymentId = deployment?.app && rememberedProject
    ? await context.stateStore.readKnownLiveDeployment(rememberedProject.id, deployment.app.id)
    : null;
  const providerLiveDeploymentId = deployment.app?.liveDeploymentId ?? null;

  return {
    command: "app.show-deploy",
    result: {
      app: deployment.app
        ? {
            id: deployment.app.id,
            name: deployment.app.name,
          }
        : null,
      deployment: {
        ...deployment.deployment,
        live: providerLiveDeploymentId
          ? deployment.deployment.id === providerLiveDeploymentId
          : knownLiveDeploymentId
            ? deployment.deployment.id === knownLiveDeploymentId
            : deployment.deployment.live,
      },
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runAppOpen(
  context: CommandContext,
  appName: string | undefined,
  projectRef?: string,
): Promise<CommandSuccess<AppOpenResult>> {
  ensurePreviewAppMode(context);

  const { provider, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const apps = await listApps(context, provider, projectId);
  const selectedApp = await resolveExistingAppSelection(context, projectId, apps, appName);

  if (!selectedApp) {
    throw noDeploymentsError(
      "No deployments available to open",
      "The resolved project does not have any deployed app yet.",
    );
  }

  const deploymentsResult = await provider.listDeployments(selectedApp.id).catch((error) => {
    throw deployFailedError("Failed to resolve app URL", error, ["prisma-cli app show"]);
  });
  const currentLiveDeploymentId = await resolveCurrentLiveDeploymentId(
    context,
    projectId,
    deploymentsResult.app,
    deploymentsResult.deployments,
  );
  const deployments = applyLiveDeploymentHint(deploymentsResult.deployments, currentLiveDeploymentId)
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  const liveDeployment = currentLiveDeploymentId
    ? deployments.find((deployment) => deployment.id === currentLiveDeploymentId) ?? null
    : null;

  await context.stateStore.setSelectedApp(projectId, {
    id: deploymentsResult.app.id,
    name: deploymentsResult.app.name,
  });

  if (!liveDeployment) {
    throw noDeploymentsError(
      "No deployments available to open",
      `The selected app "${deploymentsResult.app.name}" does not have any deployments yet.`,
    );
  }

  if (!deploymentsResult.app.liveUrl) {
    throw featureUnavailableError(
      "Live URL is not available for the selected app",
      "Deployments exist, but the provider does not expose a stable live service URL for this app yet.",
      "Run prisma-cli app show to inspect the current deployment state and try again after the app reports a live URL.",
      ["prisma-cli app show"],
      "app",
    );
  }

  const shouldOpen = canPrompt(context);
  if (shouldOpen) {
    await open(deploymentsResult.app.liveUrl);
  }

  return {
    command: "app.open",
    result: {
      projectId,
      app: {
        id: deploymentsResult.app.id,
        name: deploymentsResult.app.name,
      },
      url: deploymentsResult.app.liveUrl,
      opened: shouldOpen,
    },
    warnings: [],
    nextSteps: ["prisma-cli app show", `prisma-cli app show-deploy ${liveDeployment.id}`],
  };
}

export async function runAppLogs(
  context: CommandContext,
  appName: string | undefined,
  deploymentId: string | undefined,
  projectRef?: string,
): Promise<void> {
  ensurePreviewAppMode(context);

  const { provider, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const target = deploymentId
    ? await resolveExplicitLogDeployment(context, provider, projectId, appName, deploymentId)
    : await resolveLiveLogDeployment(context, provider, projectId, appName);

  if (!context.flags.json && !context.flags.quiet) {
    const lines = renderCommandHeader(context.ui, {
      commandLabel: "app logs",
      description: "Streaming logs for the selected deployment.",
      docsPath: "docs/product/command-spec.md#prisma-cli-app-logs---app-name---deployment-id",
      rows: [
        { key: "project", value: projectId },
        { key: "app", value: target.app.name },
        { key: "deployment", value: target.deployment.id },
      ],
    });
    if (lines.length > 0) {
      context.output.stderr.write(`${lines.join("\n")}\n`);
    }
  }

  await provider.streamDeploymentLogs({
    deploymentId: target.deployment.id,
    onRecord: (record) => writeLogRecord(context, record),
  }).catch((error) => {
    throw deployFailedError("Failed to stream app logs", error, [
      `prisma-cli app show-deploy ${target.deployment.id}`,
      "prisma-cli app list-deploys",
    ]);
  });
}

async function resolveExplicitLogDeployment(
  context: CommandContext,
  provider: ReturnType<typeof createPreviewAppProvider>,
  projectId: string,
  appName: string | undefined,
  deploymentId: string,
): Promise<{ app: PreviewAppRecord; deployment: AppDeploymentSummary }> {
  if (appName) {
    const apps = await listApps(context, provider, projectId);
    const selectedApp = await resolveExistingAppSelection(context, projectId, apps, appName);

    if (!selectedApp) {
      throw noDeploymentsError(
        "No deployments available to stream logs",
        "The resolved project does not have any deployed app yet.",
      );
    }

    const deploymentsResult = await provider.listDeployments(selectedApp.id).catch((error) => {
      throw deployFailedError("Failed to list app deployments", error, ["prisma-cli app list-deploys"]);
    });
    const deployment = requireDeploymentForApp(deploymentsResult.deployments, deploymentId, selectedApp.name);

    await context.stateStore.setSelectedApp(projectId, {
      id: deploymentsResult.app.id,
      name: deploymentsResult.app.name,
    });

    return {
      app: deploymentsResult.app,
      deployment,
    };
  }

  const shown = await provider.showDeployment(deploymentId).catch((error) => {
    throw deployFailedError("Failed to show deployment", error, ["prisma-cli app list-deploys"]);
  });

  if (!shown) {
    throw new CliError({
      code: "DEPLOYMENT_NOT_FOUND",
      domain: "app",
      summary: `Deployment "${deploymentId}" not found`,
      why: "The requested deployment does not exist or is no longer available.",
      fix: "Run prisma-cli app list-deploys to choose an available deployment id.",
      exitCode: 1,
      nextSteps: ["prisma-cli app list-deploys"],
    });
  }

  if (!shown.app) {
    throw new CliError({
      code: "DEPLOYMENT_NOT_FOUND",
      domain: "app",
      summary: `Deployment "${deploymentId}" is not attached to an app`,
      why: "The requested deployment could be found, but its app could not be resolved.",
      fix: "Run prisma-cli app list-deploys to choose an available deployment id for the selected app.",
      exitCode: 1,
      nextSteps: ["prisma-cli app list-deploys"],
    });
  }

  const apps = await listApps(context, provider, projectId);
  const resolvedProjectApp = apps.find((app) => app.id === shown.app?.id);
  if (!resolvedProjectApp) {
    throw new CliError({
      code: "DEPLOYMENT_NOT_FOUND",
      domain: "app",
      summary: `Deployment "${deploymentId}" not found in the resolved project`,
      why: "The requested deployment does not belong to an app in the resolved project.",
      fix: "Run prisma-cli app list-deploys to choose an available deployment id for this project.",
      exitCode: 1,
      nextSteps: ["prisma-cli app list-deploys"],
    });
  }

  await context.stateStore.setSelectedApp(projectId, {
    id: resolvedProjectApp.id,
    name: resolvedProjectApp.name,
  });

  return {
    app: resolvedProjectApp,
    deployment: shown.deployment,
  };
}

async function resolveLiveLogDeployment(
  context: CommandContext,
  provider: ReturnType<typeof createPreviewAppProvider>,
  projectId: string,
  appName: string | undefined,
): Promise<{ app: PreviewAppRecord; deployment: AppDeploymentSummary }> {
  const apps = await listApps(context, provider, projectId);
  const selectedApp = await resolveExistingAppSelection(context, projectId, apps, appName);

  if (!selectedApp) {
    throw noDeploymentsError(
      "No deployments available to stream logs",
      "The resolved project does not have any deployed app yet.",
    );
  }

  const deploymentsResult = await provider.listDeployments(selectedApp.id).catch((error) => {
    throw deployFailedError("Failed to list app deployments", error, ["prisma-cli app list-deploys"]);
  });
  const currentLiveDeploymentId = await resolveCurrentLiveDeploymentId(
    context,
    projectId,
    deploymentsResult.app,
    deploymentsResult.deployments,
  );
  const deployments = applyLiveDeploymentHint(deploymentsResult.deployments, currentLiveDeploymentId);
  const deployment = currentLiveDeploymentId
    ? deployments.find((candidate) => candidate.id === currentLiveDeploymentId) ?? null
    : null;

  await context.stateStore.setSelectedApp(projectId, {
    id: deploymentsResult.app.id,
    name: deploymentsResult.app.name,
  });

  if (!deployment) {
    throw noDeploymentsError(
      "No deployments available to stream logs",
      `The selected app "${deploymentsResult.app.name}" does not have any deployments yet.`,
    );
  }

  return {
    app: deploymentsResult.app,
    deployment,
  };
}

function writeLogRecord(context: CommandContext, record: StreamRecord): void {
  if (context.flags.json) {
    writeJsonEvent(context.output, {
      type: record.type,
      command: "app.logs",
      timestamp: new Date().toISOString(),
      data: record,
    });
    return;
  }

  if (record.type === "log") {
    context.output.stdout.write(record.text);
    if (!record.text.endsWith("\n")) {
      context.output.stdout.write("\n");
    }
  }
}

export async function runAppPromote(
  context: CommandContext,
  deploymentId: string,
  appName: string | undefined,
  projectRef?: string,
): Promise<CommandSuccess<AppPromoteResult>> {
  ensurePreviewAppMode(context);

  const { provider, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const apps = await listApps(context, provider, projectId);
  const selectedApp = await requireReleaseAppSelection(context, projectId, apps, appName, "promote");
  const deploymentsResult = await provider.listDeployments(selectedApp.id).catch((error) => {
    throw deployFailedError("Failed to list app deployments", error, ["prisma-cli app list-deploys"]);
  });
  const currentLiveDeploymentId = await resolveCurrentLiveDeploymentId(
    context,
    projectId,
    deploymentsResult.app,
    deploymentsResult.deployments,
  );
  const targetDeployment = requireDeploymentForApp(
    deploymentsResult.deployments,
    deploymentId,
    selectedApp.name,
  );
  const targetAlreadyLive = currentLiveDeploymentId === targetDeployment.id;

  await context.stateStore.setSelectedApp(projectId, {
    id: deploymentsResult.app.id,
    name: deploymentsResult.app.name,
  });

  if (!targetAlreadyLive) {
    await provider.promoteDeployment({
      appId: selectedApp.id,
      deploymentId: targetDeployment.id,
      progress: createPreviewPromoteProgress(
        context.output.stderr,
        !context.flags.json && !context.flags.quiet,
      ),
    }).catch((error) => {
      throw deployFailedError("Failed to promote deployment", error, ["prisma-cli app list-deploys"]);
    });
  }

  await context.stateStore.setKnownLiveDeployment(projectId, deploymentsResult.app.id, targetDeployment.id);

  return {
    command: "app.promote",
    result: {
      projectId,
      app: {
        id: deploymentsResult.app.id,
        name: deploymentsResult.app.name,
      },
      deployment: {
        ...targetDeployment,
        status: "running",
        live: true,
      },
    },
    warnings: targetAlreadyLive ? ["The selected deployment is already live for this app."] : [],
    nextSteps: ["prisma-cli app list-deploys", `prisma-cli app show-deploy ${targetDeployment.id}`],
  };
}

export async function runAppRollback(
  context: CommandContext,
  appName: string | undefined,
  deploymentId: string | undefined,
  projectRef?: string,
): Promise<CommandSuccess<AppRollbackResult>> {
  ensurePreviewAppMode(context);

  const { provider, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const apps = await listApps(context, provider, projectId);
  const selectedApp = await requireReleaseAppSelection(context, projectId, apps, appName, "rollback");
  const deploymentsResult = await provider.listDeployments(selectedApp.id).catch((error) => {
    throw deployFailedError("Failed to list app deployments", error, ["prisma-cli app list-deploys"]);
  });
  const currentLiveDeploymentId = await resolveCurrentLiveDeploymentId(
    context,
    projectId,
    deploymentsResult.app,
    deploymentsResult.deployments,
  );
  const currentLiveDeployment = currentLiveDeploymentId
    ? deploymentsResult.deployments.find((deployment) => deployment.id === currentLiveDeploymentId) ?? null
    : null;
  const targetDeployment = deploymentId
    ? requireDeploymentForApp(deploymentsResult.deployments, deploymentId, selectedApp.name)
    : resolveRollbackTarget(deploymentsResult.deployments, currentLiveDeploymentId);
  const targetAlreadyLive = currentLiveDeploymentId === targetDeployment.id;

  await context.stateStore.setSelectedApp(projectId, {
    id: deploymentsResult.app.id,
    name: deploymentsResult.app.name,
  });

  if (!targetAlreadyLive) {
    await provider.promoteDeployment({
      appId: selectedApp.id,
      deploymentId: targetDeployment.id,
      progress: createPreviewPromoteProgress(
        context.output.stderr,
        !context.flags.json && !context.flags.quiet,
      ),
    }).catch((error) => {
      throw deployFailedError("Failed to roll back deployment", error, ["prisma-cli app list-deploys"]);
    });
  }

  await context.stateStore.setKnownLiveDeployment(projectId, deploymentsResult.app.id, targetDeployment.id);

  return {
    command: "app.rollback",
    result: {
      projectId,
      app: {
        id: deploymentsResult.app.id,
        name: deploymentsResult.app.name,
      },
      deployment: {
        ...targetDeployment,
        status: "running",
        live: true,
      },
      previousLiveDeploymentId: currentLiveDeployment?.id ?? null,
    },
    warnings: targetAlreadyLive ? ["The selected deployment is already live for this app."] : [],
    nextSteps: ["prisma-cli app list-deploys", `prisma-cli app show-deploy ${targetDeployment.id}`],
  };
}

export async function runAppRemove(
  context: CommandContext,
  appName: string | undefined,
  projectRef?: string,
): Promise<CommandSuccess<AppRemoveResult>> {
  ensurePreviewAppMode(context);

  const { provider, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const apps = await listApps(context, provider, projectId);
  const selectedApp = await requireReleaseAppSelection(context, projectId, apps, appName, "remove");

  await confirmAppRemoval(context, selectedApp);

  const removedApp = await provider.removeApp(selectedApp.id).catch((error) => {
    throw removeFailedError("Failed to remove app", error, ["prisma-cli app show", "prisma-cli app list-deploys"]);
  });

  const warnings = await cleanupRemovedAppState(context, projectId, removedApp.id);

  return {
    command: "app.remove",
    result: {
      projectId,
      app: {
        id: removedApp.id,
        name: removedApp.name,
      },
      removed: true,
    },
    warnings,
    nextSteps: ["prisma-cli app deploy", "prisma-cli app list-deploys"],
  };
}

async function resolveDeploySelection(
  context: CommandContext,
  projectId: string,
  apps: PreviewAppRecord[],
  explicitAppName: string | undefined,
): Promise<{
  appId?: string;
  appName?: string;
  region?: string;
  useInteractiveSelection: boolean;
}> {
  if (explicitAppName) {
    const matched = findAppByName(apps, explicitAppName);

    if (matched) {
      return {
        appId: matched.id,
        useInteractiveSelection: false,
      };
    }

    return {
      appName: explicitAppName,
      region: PREVIEW_DEFAULT_REGION,
      useInteractiveSelection: false,
    };
  }

  const savedSelection = await context.stateStore.readSelectedApp(projectId);
  if (savedSelection) {
    const matched = apps.find((app) => app.id === savedSelection.id) ?? findAppByName(apps, savedSelection.name);

    if (matched) {
      return {
        appId: matched.id,
        useInteractiveSelection: false,
      };
    }

    if (!canPrompt(context)) {
      throw usageError(
        "Saved app selection is no longer available",
        "The locally selected app could not be found in the resolved project.",
        "Pass --app <name>, or rerun prisma-cli app deploy in a TTY to choose or create an app again.",
        ["prisma-cli app deploy"],
        "app",
      );
    }
  }

  if (!canPrompt(context)) {
    throw usageError(
      "App deploy requires an app selection in non-interactive mode",
      "This command cannot choose or create an app in the current mode.",
      "Pass --app <name>, or rerun prisma-cli app deploy in a TTY to choose or create an app.",
      ["prisma-cli app deploy --app hello-world"],
      "app",
    );
  }

  return {
    useInteractiveSelection: true,
  };
}

async function resolveExistingAppSelection(
  context: CommandContext,
  projectId: string,
  apps: PreviewAppRecord[],
  explicitAppName: string | undefined,
): Promise<PreviewAppRecord | null> {
  if (explicitAppName) {
    const matched = findAppByName(apps, explicitAppName);
    if (!matched) {
      throw usageError(
        "Selected app does not exist in the resolved project",
        `The app "${explicitAppName}" could not be found in resolved project "${projectId}".`,
        "Pass the name of an existing app, or rerun prisma-cli app list-deploys in a TTY to choose one.",
        ["prisma-cli app list-deploys"],
        "app",
      );
    }

    return matched;
  }

  const savedSelection = await context.stateStore.readSelectedApp(projectId);
  if (savedSelection) {
    const matched = apps.find((app) => app.id === savedSelection.id) ?? findAppByName(apps, savedSelection.name);
    if (matched) {
      return matched;
    }

    if (!canPrompt(context)) {
      throw usageError(
        "Saved app selection is no longer available",
        "The locally selected app could not be found in the resolved project.",
        "Pass --app <name>, or rerun prisma-cli app list-deploys in a TTY to choose an available app.",
        ["prisma-cli app list-deploys"],
        "app",
      );
    }
  }

  if (apps.length === 0) {
    return null;
  }

  if (!canPrompt(context)) {
    throw usageError(
      "App selection required in non-interactive mode",
      "This command cannot choose an app in the current mode.",
      "Pass --app <name>, or rerun prisma-cli app list-deploys in a TTY to choose an app.",
      ["prisma-cli app list-deploys"],
      "app",
    );
  }

  const prompt = createSelectPromptPort(context);
  const selectedId = await prompt.select({
    message: "Select an app",
    choices: sortApps(apps).map((app) => ({
      label: app.name,
      value: app.id,
    })),
  });

  return apps.find((app) => app.id === selectedId) ?? null;
}

async function requireReleaseAppSelection(
  context: CommandContext,
  projectId: string,
  apps: PreviewAppRecord[],
  explicitAppName: string | undefined,
  commandName: "promote" | "rollback" | "remove",
): Promise<PreviewAppRecord> {
  const selectedApp = await resolveExistingAppSelection(context, projectId, apps, explicitAppName);
  if (selectedApp) {
    return selectedApp;
  }

  throw usageError(
    `App ${commandName} requires an existing app`,
    "The resolved project does not have an app that can be selected for this command.",
    `Deploy an app first, or rerun prisma-cli app ${commandName} with --app <name> after an app exists.`,
    ["prisma-cli app deploy", "prisma-cli app list-deploys"],
    "app",
  );
}

async function confirmAppRemoval(
  context: CommandContext,
  app: PreviewAppRecord,
): Promise<void> {
  if (context.flags.yes) {
    return;
  }

  if (!canPrompt(context)) {
    throw new CliError({
      code: "CONFIRMATION_REQUIRED",
      domain: "app",
      summary: "App remove requires confirmation in the current mode",
      why: "This command is destructive and cannot prompt for confirmation in the current mode.",
      fix: `Pass --yes to confirm removal of "${app.name}", or rerun prisma-cli app remove in an interactive TTY.`,
      exitCode: 1,
      nextSteps: [`prisma-cli app remove --app ${app.name} --yes`],
    });
  }

  await textPrompt({
    input: context.runtime.stdin,
    output: context.output.stderr,
    message: `Type ${app.name} to confirm app removal`,
    placeholder: app.name,
    validate: (value) => value === app.name ? undefined : `Type "${app.name}" to confirm removal.`,
  });
}

async function cleanupRemovedAppState(
  context: CommandContext,
  projectId: string,
  appId: string,
): Promise<string[]> {
  const warnings: string[] = [];

  try {
    await context.stateStore.clearSelectedApp(projectId, appId);
  } catch (error) {
    warnings.push(localStateCleanupWarning("selected app", error));
  }

  try {
    await context.stateStore.clearKnownLiveDeployment(projectId, appId);
  } catch (error) {
    warnings.push(localStateCleanupWarning("known live deployment", error));
  }

  return warnings;
}

function requireDeploymentForApp(
  deployments: AppDeploymentSummary[],
  deploymentId: string,
  appName: string,
): AppDeploymentSummary {
  const deployment = deployments.find((candidate) => candidate.id === deploymentId);
  if (deployment) {
    return deployment;
  }

  throw new CliError({
    code: "DEPLOYMENT_NOT_FOUND",
    domain: "app",
    summary: `Deployment "${deploymentId}" not found for app "${appName}"`,
    why: "The requested deployment does not belong to the resolved app or is no longer available.",
    fix: "Run prisma-cli app list-deploys to choose an available deployment id for this app.",
    exitCode: 1,
    nextSteps: ["prisma-cli app list-deploys"],
  });
}

async function resolveCurrentLiveDeploymentId(
  context: CommandContext,
  projectId: string,
  app: Pick<PreviewAppRecord, "id" | "liveDeploymentId">,
  deployments: AppDeploymentSummary[],
): Promise<string | null> {
  if (app.liveDeploymentId && deployments.some((deployment) => deployment.id === app.liveDeploymentId)) {
    return app.liveDeploymentId;
  }

  const providerLiveDeployment = deployments.find((deployment) => deployment.live === true);
  if (providerLiveDeployment) {
    return providerLiveDeployment.id;
  }

  const knownLiveDeploymentId = await context.stateStore.readKnownLiveDeployment(projectId, app.id);
  if (knownLiveDeploymentId && deployments.some((deployment) => deployment.id === knownLiveDeploymentId)) {
    return knownLiveDeploymentId;
  }

  return deployments[0]?.id ?? null;
}

function buildAppShowNextSteps(
  liveUrl: string | null,
  liveDeployment: AppDeploymentSummary | null,
  deployments: AppDeploymentSummary[],
): string[] {
  const nextSteps: string[] = [];

  if (liveUrl) {
    nextSteps.push("prisma-cli app open");
  }

  if (liveDeployment) {
    nextSteps.push(`prisma-cli app show-deploy ${liveDeployment.id}`);
  } else if (deployments[0]) {
    nextSteps.push(`prisma-cli app show-deploy ${deployments[0].id}`);
  } else {
    nextSteps.push("prisma-cli app deploy");
  }

  return nextSteps;
}

function applyLiveDeploymentHint(
  deployments: AppDeploymentSummary[],
  currentLiveDeploymentId: string | null,
): AppDeploymentSummary[] {
  if (!currentLiveDeploymentId) {
    return deployments.map((deployment) => ({
      ...deployment,
      live: deployment.live ?? null,
    }));
  }

  return deployments.map((deployment) => ({
    ...deployment,
    live: deployment.id === currentLiveDeploymentId,
  }));
}

function resolveRollbackTarget(
  deployments: AppDeploymentSummary[],
  currentLiveDeploymentId: string | null,
): AppDeploymentSummary {
  const previousDeployment = deployments.find((deployment) => deployment.id !== currentLiveDeploymentId);
  if (previousDeployment) {
    return previousDeployment;
  }

  throw new CliError({
    code: "NO_PREVIOUS_DEPLOYMENT",
    domain: "app",
    summary: "No previous deployment available for rollback",
    why: "The selected app does not have an earlier deployment to switch back to.",
    fix: "Deploy a second version first, or rerun prisma-cli app rollback --to <deployment-id> for a specific earlier deployment.",
    exitCode: 1,
    nextSteps: ["prisma-cli app deploy", "prisma-cli app list-deploys"],
  });
}

async function listApps(
  context: CommandContext,
  provider: ReturnType<typeof createPreviewAppProvider>,
  projectId: string,
) {
  return provider.listApps(projectId).then(sortApps).catch((error) => {
    if (isMissingProjectError(error)) {
      throw new CliError({
        code: "PROJECT_NOT_FOUND",
        domain: "project",
        summary: "Project not found",
        why: `The resolved project "${projectId}" does not exist in the authenticated workspace or is no longer accessible.`,
        fix: "Pass --project <id-or-name>, or run prisma-cli project show to inspect resolution for this directory.",
        exitCode: 1,
        nextSteps: ["prisma-cli project show", "prisma-cli app deploy --project <id-or-name>"],
      });
    }

    throw deployFailedError("Failed to list apps", error, ["prisma-cli project show"]);
  });
}

async function requirePreviewAppProvider(context: CommandContext) {
  const { provider } = await requirePreviewAppProviderWithClient(context);
  return provider;
}

async function requirePreviewAppProviderWithClient(
  context: CommandContext,
): Promise<{ client: ManagementApiClient; provider: ReturnType<typeof createPreviewAppProvider> }> {
  const client = await requireComputeAuth(context.runtime.env);
  if (!client) {
    throw authRequiredError(["prisma-cli auth login"]);
  }

  return {
    client,
    provider: createPreviewAppProvider(client, createPreviewLogAuthOptions(context.runtime.env)),
  };
}

function createPreviewLogAuthOptions(env: NodeJS.ProcessEnv) {
  const rawToken = env[SERVICE_TOKEN_ENV_VAR]?.trim();
  if (rawToken) {
    return {
      baseUrl: getApiBaseUrl(env),
      getToken: async () => rawToken,
    };
  }

  const tokenStorage = new FileTokenStorage(env);
  return {
    baseUrl: getApiBaseUrl(env),
    getToken: async () => {
      const tokens = await tokenStorage.getTokens();
      if (!tokens) {
        throw new Error("Authentication token is no longer available. Run prisma-cli auth login and try again.");
      }
      return tokens.accessToken;
    },
  };
}

interface ResolvedAppProjectContext {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  branch: {
    name: string;
    kind: BranchKind;
  };
  resolution: ProjectResolution;
}

async function requireProviderAndProjectContext(
  context: CommandContext,
  explicitProject: string | undefined,
  options?: { allowCreate?: boolean },
): Promise<{
  client: ManagementApiClient;
  provider: ReturnType<typeof createPreviewAppProvider>;
  target: ResolvedAppProjectContext;
  projectId: string;
}> {
  const { client, provider } = await requirePreviewAppProviderWithClient(context);
  const target = await resolveProjectContext(context, client, provider, explicitProject, options);
  return {
    client,
    provider,
    target,
    projectId: target.project.id,
  };
}

async function resolveProjectContext(
  context: CommandContext,
  client: ManagementApiClient,
  provider: ReturnType<typeof createPreviewAppProvider>,
  explicitProject: string | undefined,
  options?: { allowCreate?: boolean },
): Promise<ResolvedAppProjectContext> {
  const authState = await requireAuthenticatedAuthState(context);
  if (!authState.workspace) {
    throw workspaceRequiredError();
  }

  const resolved = await resolveProjectTarget({
    context,
    workspace: authState.workspace,
    explicitProject,
    listProjects: () => listRealWorkspaceProjects(client, authState.workspace!),
    createProject: options?.allowCreate
      ? async (name) => {
          const project = await provider.createProject({ name }).catch((error) => {
            throw deployFailedError("Failed to create project for first deploy", error, ["prisma-cli app deploy"]);
          });
          return {
            id: project.id,
            name: project.name,
            workspace: authState.workspace!,
          };
        }
      : undefined,
    allowCreate: options?.allowCreate,
    prompt: createSelectPromptPort(context),
    remember: true,
  });
  const branchName = await context.stateStore.read().then((state) => state.branch.active);

  return {
    ...resolved,
    branch: {
      name: branchName,
      kind: toBranchKind(branchName),
    },
  };
}

function toBranchKind(name: string): BranchKind {
  return name === "production" ? "production" : "preview";
}

async function readCurrentWorkspaceId(context: CommandContext): Promise<string | null> {
  const state = await context.stateStore.read();
  if (state.auth?.workspaceId) {
    return state.auth.workspaceId;
  }

  const authState = await readAuthState(context.runtime.env);
  return authState.workspace?.id ?? null;
}

function normalizeBuildType(requestedBuildType: string | undefined): PreviewBuildType {
  if (!requestedBuildType) {
    return "auto";
  }

  if (isPreviewBuildType(requestedBuildType)) {
    return requestedBuildType;
  }

  throw usageError(
    `Unsupported build type "${requestedBuildType}"`,
    `Only ${PREVIEW_BUILD_TYPES.join(", ")} are supported in the current preview.`,
    "Pass a supported --build-type value.",
    getBuildTypeExamples("build"),
    "app",
  );
}

function isPreviewBuildType(value: string): value is PreviewBuildType {
  return (PREVIEW_BUILD_TYPES as readonly string[]).includes(value);
}

function getBuildTypeExamples(commandName: "build" | "deploy"): string[] {
  return RESOLVED_PREVIEW_BUILD_TYPES.map((buildType) => {
    const entrypoint = buildType === "bun" ? " --entry server.ts" : "";
    return `prisma-cli app ${commandName} --build-type ${buildType}${entrypoint}`;
  });
}

function assertSupportedEntrypoint(
  buildType: PreviewBuildType,
  entrypoint: string | undefined,
  commandName: "build" | "run" | "deploy",
) {
  // Framework strategies derive their runtime entrypoints from build output.
  // Only Bun consumes a user-provided source entrypoint; auto may fall back to Bun.
  if (buildType !== "auto" && buildType !== "bun" && entrypoint) {
    throw usageError(
      `App ${commandName} does not accept --entry with --build-type ${buildType}`,
      `${formatBuildTypeName(buildType)} apps do not use an entrypoint flag in the current preview.`,
      `Remove --entry, or rerun prisma-cli app ${commandName} with --build-type bun when you want to target a Bun entrypoint directly.`,
      [
        `prisma-cli app ${commandName} --build-type ${buildType}`,
        `prisma-cli app ${commandName} --build-type bun --entry server.ts`,
      ],
      "app",
    );
  }
}

async function requireLocalBuildType(
  context: CommandContext,
  buildType: PreviewBuildType,
  commandName: "build" | "run",
) {
  // Local dev server support is intentionally narrower than deploy build support.
  // Nuxt, Astro, and TanStack Start can deploy via SDK strategies, but app run
  // only starts the local dev servers currently documented for the preview.
  const resolvedBuildType = await resolveLocalBuildType(context.runtime.cwd, buildType);
  if (resolvedBuildType) {
    return resolvedBuildType;
  }

  throw usageError(
    `App ${commandName} requires an explicit framework when detection is ambiguous`,
    "This preview only starts local dev servers for clear Next.js or Bun project shapes.",
    "Pass --build-type nextjs for a Next.js app, or pass --build-type bun with --entry <path> for a Bun app.",
    [
      `prisma-cli app ${commandName} --build-type nextjs`,
      `prisma-cli app ${commandName} --build-type bun --entry server.ts`,
    ],
    "app",
  );
}

function parseLocalPort(requestedPort: string | undefined): number {
  if (!requestedPort) {
    return DEFAULT_LOCAL_DEV_PORT;
  }

  const port = Number.parseInt(requestedPort, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw usageError(
      `Invalid port "${requestedPort}"`,
      "Port must be an integer between 1 and 65535.",
      "Pass --port <number> with a valid local port value.",
      ["prisma-cli app run --port 3000"],
      "app",
    );
  }

  return port;
}

function parseDeployPortMapping(requestedPort: string | undefined): PortMapping | undefined {
  if (!requestedPort) {
    return undefined;
  }

  const port = Number.parseInt(requestedPort, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw usageError(
      `Invalid HTTP port "${requestedPort}"`,
      "HTTP port must be an integer between 1 and 65535.",
      "Pass --http-port <number> with a valid port value.",
      ["prisma-cli app deploy --http-port 3000"],
      "app",
    );
  }

  return { http: port };
}

function ensurePreviewAppMode(context: CommandContext) {
  if (isRealMode(context)) {
    return;
  }

  throw featureUnavailableError(
    "App commands are not available in fixture mode",
    "Preview app commands require live app deployment integration.",
    "Rerun without fixture mode enabled to use preview app deployment workflows.",
    ["prisma-cli auth login", "prisma-cli project show"],
    "app",
  );
}

function deployFailedError(summary: string, error: unknown, nextSteps: string[]): CliError {
  return new CliError({
    code: "DEPLOY_FAILED",
    domain: "app",
    summary,
    why: error instanceof Error ? error.message : String(error),
    fix: "Retry the command, or rerun with --trace for more detailed diagnostics.",
    debug: formatDebugDetails(error),
    exitCode: 1,
    nextSteps,
  });
}

function noDeploymentsError(summary: string, why: string): CliError {
  return new CliError({
    code: "NO_DEPLOYMENTS",
    domain: "app",
    summary,
    why,
    fix: "Run prisma-cli app deploy first, or use prisma-cli app show to inspect the current app state.",
    exitCode: 1,
    nextSteps: ["prisma-cli app deploy", "prisma-cli app show"],
  });
}

function buildFailedError(summary: string, error: unknown): CliError {
  return new CliError({
    code: "BUILD_FAILED",
    domain: "app",
    summary,
    why: error instanceof Error ? error.message : String(error),
    fix: "Inspect the framework output, fix the build issue, and rerun prisma-cli app build.",
    debug: formatDebugDetails(error),
    exitCode: 1,
    nextSteps: ["prisma-cli app build", "prisma-cli app deploy"],
  });
}

function runFailedError(summary: string, error: unknown, exitCode = 1): CliError {
  return new CliError({
    code: "RUN_FAILED",
    domain: "app",
    summary,
    why: error instanceof Error ? error.message : String(error),
    fix: "Inspect the framework output above, fix the issue, and rerun prisma-cli app run.",
    exitCode,
    nextSteps: ["prisma-cli app run"],
  });
}

function formatFrameworkName(framework: AppRunResult["framework"]): string {
  return framework === "nextjs" ? "Next.js" : "Bun";
}

function isAutoBuildDetectionError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Entrypoint is required.");
}

function formatBuildTypeName(buildType: PreviewBuildType): string {
  switch (buildType) {
    case "nextjs":
      return "Next.js";
    case "nuxt":
      return "Nuxt";
    case "astro":
      return "Astro";
    case "tanstack-start":
      return "TanStack Start";
    case "bun":
      return "Bun";
    case "auto":
      return "Auto";
  }
}

function removeFailedError(summary: string, error: unknown, nextSteps: string[]): CliError {
  return new CliError({
    code: "REMOVE_FAILED",
    domain: "app",
    summary,
    why: error instanceof Error ? error.message : String(error),
    fix: "Retry the command, or rerun with --trace for more detailed diagnostics.",
    debug: formatDebugDetails(error),
    exitCode: 1,
    nextSteps,
  });
}

function localStateCleanupWarning(target: string, error: unknown): string {
  const cause = error instanceof Error ? error.message : String(error);
  return `The app was removed remotely, but the local ${target} state could not be cleared: ${cause}`;
}

function formatDebugDetails(error: unknown): string | null {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return typeof error === "string" ? error : null;
}

function isMissingProjectError(error: unknown): boolean {
  return error instanceof Error && error.message === "Resource Not Found";
}

function findAppByName(apps: PreviewAppRecord[], name: string): PreviewAppRecord | undefined {
  return apps.find((app) => app.name === name);
}

function sortApps(apps: PreviewAppRecord[]): PreviewAppRecord[] {
  return apps
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function toOptionalEnvVars(
  envVars: Record<string, string>,
): Record<string, string> | undefined {
  return Object.keys(envVars).length > 0 ? envVars : undefined;
}

/**
 * Emits a deprecation banner to stderr when the legacy single-shot
 * env-var commands are invoked. The banner is suppressed in --json
 * mode so machine consumers keep their JSON channel clean; --json
 * users discover the deprecation via release notes and the new
 * `prisma-cli project env` namespace's output anyway.
 *
 * Removal of these legacy commands is deliberately scoped out of the
 * Public Beta — see the Compute Beta plan, sub-track 3B.1, where the
 * Terminal team picks an explicit removal milestone.
 */
function emitLegacyEnvDeprecationWarning(
  context: CommandContext,
  legacyCommand: string,
  replacement: string,
): void {
  if (context.flags.json) {
    return;
  }

  const message = `[deprecation] \`prisma-cli ${legacyCommand}\` is deprecated. Use \`prisma-cli ${replacement}\` instead.`;
  context.runtime.stderr.write(`${message}\n`);
}
