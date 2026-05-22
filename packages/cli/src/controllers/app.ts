import { access, readFile } from "node:fs/promises";
import path from "node:path";

import open from "open";
import type { PortMapping, StreamRecord } from "@prisma/compute-sdk";
import type { ManagementApiClient } from "@prisma/management-api-sdk";

import { FileTokenStorage } from "../adapters/token-storage";
import { authRequiredError, CliError, featureUnavailableError, usageError, workspaceRequiredError } from "../shell/errors";
import { writeJsonEvent, type CommandSuccess } from "../shell/output";
import { canPrompt, type CommandContext } from "../shell/runtime";
import { confirmPrompt, selectPrompt, textPrompt } from "../shell/prompt";
import { renderCommandHeader } from "../shell/ui";
import type {
  AppBuildResult,
  AppDeployResult,
  AppDeploymentSummary,
  AppDomainAddResult,
  AppDomainDnsRecord,
  AppDomainRemoveResult,
  AppDomainRetryResult,
  AppDomainShowResult,
  AppDomainStatus,
  AppDomainSummary,
  AppDomainTarget,
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
import { renderDeployOutputRows } from "../lib/app/deploy-output";
import {
  DEFAULT_LOCAL_DEV_PORT,
  resolveLocalBuildType,
  runLocalApp,
} from "../lib/app/local-dev";
import { readBunPackageJson, type BunPackageJsonLike } from "../lib/app/bun-project";
import {
  inferTargetName,
  projectNotFoundError,
  resolveProjectTarget,
  type InferredTargetName,
  type InferredTargetNameSource,
  type ProjectCandidate,
} from "../lib/project/resolution";
import {
  ensureLocalResolutionPinGitignore,
  LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
  readLocalResolutionPin,
  writeLocalResolutionPin,
  type LocalResolutionPinReadResult,
} from "../lib/project/local-pin";
import {
  executePreviewBuild,
  PREVIEW_BUILD_TYPES,
  RESOLVED_PREVIEW_BUILD_TYPES,
  type ResolvedPreviewBuildType,
  type PreviewBuildType,
} from "../lib/app/preview-build";
import { PREVIEW_DEFAULT_REGION } from "../lib/app/preview-interaction";
import {
  createPreviewDeployProgress,
  createPreviewDeployProgressState,
  createPreviewPromoteProgress,
  createPreviewUpdateEnvProgress,
  type PreviewDeployProgressState,
} from "../lib/app/preview-progress";
import {
  createPreviewAppProvider,
  PreviewDomainApiError,
  type PreviewAppRecord,
  type PreviewDomainRecord,
} from "../lib/app/preview-provider";
import { requireAuthenticatedAuthState } from "./auth";
import { listRealWorkspaceProjects } from "./project";
import { createSelectPromptPort } from "./select-prompt-port";

type DeployFramework = "nextjs" | "hono" | "tanstack-start";

const DEPLOY_FRAMEWORKS = ["nextjs", "hono", "tanstack-start"] as const satisfies readonly DeployFramework[];
const FRAMEWORK_DEFAULT_HTTP_PORT = 3000;
const PRISMA_PROJECT_ID_ENV_VAR = "PRISMA_PROJECT_ID";
const PRISMA_APP_ID_ENV_VAR = "PRISMA_APP_ID";

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
    branchName?: string;
    entrypoint?: string;
    buildType?: string;
    framework?: string;
    httpPort?: string;
    envAssignments?: string[];
  },
): Promise<CommandSuccess<AppDeployResult>> {
  ensurePreviewAppMode(context);

  const envProjectId = readDeployEnvOverride(context, PRISMA_PROJECT_ID_ENV_VAR);
  const envAppId = readDeployEnvOverride(context, PRISMA_APP_ID_ENV_VAR);
  const skipLocalPin = Boolean(envProjectId || envAppId);
  const localPin = skipLocalPin
    ? ({ kind: "missing" } satisfies LocalResolutionPinReadResult)
    : await readLocalResolutionPin(context.runtime.cwd);
  if (!skipLocalPin && localPin.kind === "invalid") {
    throw localResolutionPinStaleError();
  }

  const explicitBuildType = Boolean(options?.buildType && options.buildType !== "auto");
  const branch = await resolveDeployBranch(context, options?.branchName);
  if (options?.httpPort) {
    parseDeployHttpPort(options.httpPort);
  }
  let framework = await resolveDeployFramework(context, {
    requestedFramework: options?.framework,
    requestedBuildType: options?.buildType,
    explicitBuildType,
  });
  let runtime = resolveDeployRuntime(options?.httpPort, framework);
  assertSupportedEntrypoint(framework.buildType, options?.entrypoint, "deploy");
  const envVars = toOptionalEnvVars(
    parseEnvAssignments(options?.envAssignments, {
      commandName: "deploy",
    }),
  );
  const firstDeploy = !skipLocalPin && localPin.kind === "missing";
  const { provider, target, projectId } = await requireProviderAndDeployProjectContext(context, options?.projectRef, {
    allowCreate: true,
    branch,
    envProjectId,
    localPin,
  });
  const apps = await listApps(context, provider, projectId, target.branch.name);
  const selectedApp = await resolveDeployAppSelection(context, projectId, apps, {
    explicitAppName: appName,
    explicitAppId: envAppId,
    firstDeploy,
    inferName: () => inferTargetName(context.runtime.cwd),
  });

  await maybeRenderDeploySetupBlock(context, {
    firstDeploy: selectedApp.firstDeploy,
    workspaceName: target.workspace.name,
    projectName: target.project.name,
    projectAnnotation: annotationForProjectResolution(target.resolution),
    branchName: target.branch.name,
    branchAnnotation: branch.annotation,
    appName: selectedApp.displayName,
    appAnnotation: selectedApp.annotation,
    framework,
    runtime,
  });

  const customized = await maybeCustomizeDeploySettings(context, {
    framework,
    runtime,
    firstDeploy: selectedApp.firstDeploy,
    explicitFramework: Boolean(options?.framework),
    explicitBuildType,
    explicitHttpPort: Boolean(options?.httpPort),
  });
  framework = customized.framework;
  runtime = customized.runtime;

  // Customization can switch from a Bun-compatible framework to one that
  // derives its entrypoint from build output, so validate --entry again after it.
  const buildType = framework.buildType;
  assertSupportedEntrypoint(buildType, options?.entrypoint, "deploy");
  const portMapping = parseDeployPortMapping(String(runtime.port));
  const shouldWriteLocalPin = firstDeploy && !skipLocalPin;
  if (shouldWriteLocalPin) {
    await writeLocalResolutionPin(context.runtime.cwd, {
      workspaceId: target.workspace.id,
      projectId: target.project.id,
    });
    await ensureLocalResolutionPinGitignore(context.runtime.cwd);
    maybeRenderLocalPinBound(context, target.project.name);
  }

  const progressState = createPreviewDeployProgressState();
  const deployStartedAt = Date.now();
  const deployResult = await provider.deployApp({
    cwd: context.runtime.cwd,
    projectId,
    branchName: target.branch.name,
    appId: selectedApp.appId,
    appName: selectedApp.appName,
    region: selectedApp.region,
    entrypoint: options?.entrypoint,
    buildType,
    portMapping,
    envVars,
    interaction: undefined,
    progress: createPreviewDeployProgress(context.output.stderr, context.ui, !context.flags.json && !context.flags.quiet, progressState),
  }).catch((error) => {
    throw appDeployFailedError(error, progressState);
  });
  const deployDurationMs = Date.now() - deployStartedAt;

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
      durationMs: deployDurationMs,
      localPin: shouldWriteLocalPin
        ? {
            path: LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
            written: true,
          }
        : undefined,
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
  const { provider, target, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const apps = await listApps(context, provider, projectId, target.branch.name);
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

  const { provider, target, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const apps = await listApps(context, provider, projectId, target.branch.name);
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

  const { provider, target, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const apps = await listApps(context, provider, projectId, target.branch.name);
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

  const { provider, target, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const apps = await listApps(context, provider, projectId, target.branch.name);
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

  const { provider, target, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const apps = await listApps(context, provider, projectId, target.branch.name);
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

export async function runAppDomainAdd(
  context: CommandContext,
  hostname: string,
  options?: {
    appName?: string;
    projectRef?: string;
    branchName?: string;
  },
): Promise<CommandSuccess<AppDomainAddResult>> {
  const normalizedHostname = normalizeDomainHostname(hostname);
  const target = await resolveAppDomainTarget(context, options);

  const added = await target.provider.addDomain({
    appId: target.app.id,
    hostname: normalizedHostname,
  }).catch((error) => {
    throw domainCommandError("add", error, normalizedHostname);
  });

  return {
    command: "app.domain.add",
    result: {
      ...target.resultTarget,
      domain: toAppDomainSummary(added.domain),
      existing: added.existing,
    },
    warnings: [],
    nextSteps: [
      `prisma-cli app domain wait ${normalizedHostname}`,
      `prisma-cli app domain show ${normalizedHostname}`,
    ],
  };
}

export async function runAppDomainShow(
  context: CommandContext,
  hostname: string,
  options?: {
    appName?: string;
    projectRef?: string;
    branchName?: string;
  },
): Promise<CommandSuccess<AppDomainShowResult>> {
  const normalizedHostname = normalizeDomainHostname(hostname);
  const target = await resolveAppDomainTarget(context, options);
  const domain = await resolveDomainByHostname(target.provider, target.app.id, normalizedHostname);
  const detail = await target.provider.showDomain(domain.id).catch((error) => {
    throw domainCommandError("show", error, normalizedHostname);
  });

  return {
    command: "app.domain.show",
    result: {
      ...target.resultTarget,
      domain: toAppDomainSummary(detail),
    },
    warnings: [],
    nextSteps: buildDomainShowNextSteps(detail),
  };
}

export async function runAppDomainRemove(
  context: CommandContext,
  hostname: string,
  options?: {
    appName?: string;
    projectRef?: string;
    branchName?: string;
  },
): Promise<CommandSuccess<AppDomainRemoveResult>> {
  const normalizedHostname = normalizeDomainHostname(hostname);
  const target = await resolveAppDomainTarget(context, options);
  const domain = await resolveDomainByHostname(target.provider, target.app.id, normalizedHostname);

  await confirmDomainRemoval(context, target.resultTarget, normalizedHostname);

  await target.provider.removeDomain(domain.id).catch((error) => {
    throw domainCommandError("remove", error, normalizedHostname);
  });

  return {
    command: "app.domain.remove",
    result: {
      ...target.resultTarget,
      hostname: normalizedHostname,
      removed: true,
    },
    warnings: [],
    nextSteps: [],
  };
}

export async function runAppDomainRetry(
  context: CommandContext,
  hostname: string,
  options?: {
    appName?: string;
    projectRef?: string;
    branchName?: string;
  },
): Promise<CommandSuccess<AppDomainRetryResult>> {
  const normalizedHostname = normalizeDomainHostname(hostname);
  const target = await resolveAppDomainTarget(context, options);
  const domain = await resolveDomainByHostname(target.provider, target.app.id, normalizedHostname);
  const retried = await target.provider.retryDomain(domain.id).catch((error) => {
    throw domainCommandError("retry", error, normalizedHostname);
  });

  return {
    command: "app.domain.retry",
    result: {
      ...target.resultTarget,
      domain: toAppDomainSummary(retried),
    },
    warnings: [],
    nextSteps: [`prisma-cli app domain wait ${normalizedHostname}`],
  };
}

export async function runAppDomainWait(
  context: CommandContext,
  hostname: string,
  options?: {
    appName?: string;
    projectRef?: string;
    branchName?: string;
    timeout?: string;
  },
): Promise<void> {
  const normalizedHostname = normalizeDomainHostname(hostname);
  const timeoutMs = parseDomainWaitTimeout(options?.timeout);
  const target = await resolveAppDomainTarget(context, options);
  const domain = await resolveDomainByHostname(target.provider, target.app.id, normalizedHostname);

  if (!context.flags.json && !context.flags.quiet) {
    context.output.stderr.write(
      [
        `app domain wait -> Waiting for ${normalizedHostname} to become active.`,
        "",
        `Workspace: ${target.resultTarget.workspace.name}   Project: ${target.resultTarget.project.name}   Branch: ${target.resultTarget.branch.name}   App: ${target.resultTarget.app.name}`,
        "",
      ].join("\n"),
    );
  }

  const start = Date.now();
  const deadline = start + timeoutMs;
  const pollIntervalMs = readDomainWaitPollIntervalMs(context);
  let lastStatus: AppDomainStatus | null = null;
  let current = domain;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    emitDomainWaitStatus(context, {
      hostname: normalizedHostname,
      domainId: current.id,
      previousStatus: lastStatus,
      status: current.status,
      elapsedMs: Date.now() - start,
    });
    lastStatus = current.status;

    if (current.status === "active") {
      if (!context.flags.json && !context.flags.quiet) {
        context.output.stderr.write(`\n${normalizedHostname} is live at https://${normalizedHostname}\n`);
      }
      return;
    }

    if (current.status === "failed") {
      throw new CliError({
        code: "DOMAIN_VERIFICATION_FAILED",
        domain: "app",
        summary: `Custom domain "${normalizedHostname}" failed verification`,
        why: formatDomainFailureWhy(current),
        fix: `Fix the DNS record, then run prisma-cli app domain retry ${normalizedHostname}.`,
        exitCode: 1,
        nextSteps: [
          `prisma-cli app domain show ${normalizedHostname}`,
          `prisma-cli app domain retry ${normalizedHostname}`,
        ],
      });
    }

    if (timeoutMs === 0 || Date.now() >= deadline) {
      throw new CliError({
        code: "DOMAIN_VERIFICATION_TIMEOUT",
        domain: "app",
        summary: `Timed out waiting for "${normalizedHostname}" to become active`,
        why: `The domain is still "${current.status}".`,
        fix: `Run prisma-cli app domain show ${normalizedHostname} to inspect the current status, or retry wait with a longer --timeout.`,
        exitCode: 2,
        nextSteps: [`prisma-cli app domain show ${normalizedHostname}`],
      });
    }

    await sleep(Math.min(pollIntervalMs, Math.max(deadline - Date.now(), 0)));
    current = await target.provider.showDomain(current.id).catch((error) => {
      throw domainCommandError("wait", error, normalizedHostname);
    });
  }
}

export async function runAppLogs(
  context: CommandContext,
  appName: string | undefined,
  deploymentId: string | undefined,
  projectRef?: string,
): Promise<void> {
  ensurePreviewAppMode(context);

  const { provider, target: resolvedTarget, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const target = deploymentId
    ? await resolveExplicitLogDeployment(context, provider, projectId, resolvedTarget.branch.name, appName, deploymentId)
    : await resolveLiveLogDeployment(context, provider, projectId, resolvedTarget.branch.name, appName);

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
  branchName: string,
  appName: string | undefined,
  deploymentId: string,
): Promise<{ app: PreviewAppRecord; deployment: AppDeploymentSummary }> {
  if (appName) {
    const apps = await listApps(context, provider, projectId, branchName);
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

  const apps = await listApps(context, provider, projectId, branchName);
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
  branchName: string,
  appName: string | undefined,
): Promise<{ app: PreviewAppRecord; deployment: AppDeploymentSummary }> {
  const apps = await listApps(context, provider, projectId, branchName);
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

  const { provider, target, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const apps = await listApps(context, provider, projectId, target.branch.name);
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

  const { provider, target, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const apps = await listApps(context, provider, projectId, target.branch.name);
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

  const { provider, target, projectId } = await requireProviderAndProjectContext(context, projectRef);
  const apps = await listApps(context, provider, projectId, target.branch.name);
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

interface ResolvedAppDomainTarget {
  provider: ReturnType<typeof createPreviewAppProvider>;
  app: PreviewAppRecord;
  resultTarget: AppDomainTarget;
}

async function resolveAppDomainTarget(
  context: CommandContext,
  options?: {
    appName?: string;
    projectRef?: string;
    branchName?: string;
  },
): Promise<ResolvedAppDomainTarget> {
  ensurePreviewAppMode(context);

  const branch = resolveDomainBranch(options?.branchName);
  if (toBranchKind(branch.name) !== "production") {
    throw new CliError({
      code: "BRANCH_NOT_DEPLOYABLE",
      domain: "branch",
      summary: "Custom domains require the production branch",
      why: `Custom domains on preview branch "${branch.name}" are not supported in Public Beta.`,
      fix: "Use --branch production, or attach the domain after promoting/deploying to the production branch.",
      exitCode: 2,
      nextSteps: ["prisma-cli app domain add <hostname> --branch production"],
    });
  }

  const envProjectId = readDeployEnvOverride(context, PRISMA_PROJECT_ID_ENV_VAR);
  const envAppId = readDeployEnvOverride(context, PRISMA_APP_ID_ENV_VAR);
  const skipLocalPin = Boolean(envProjectId || envAppId);
  const localPin = skipLocalPin
    ? ({ kind: "missing" } satisfies LocalResolutionPinReadResult)
    : await readLocalResolutionPin(context.runtime.cwd);
  if (!skipLocalPin && localPin.kind === "invalid") {
    throw localResolutionPinStaleError();
  }

  const { provider, target, projectId } = await requireProviderAndDeployProjectContext(context, options?.projectRef, {
    allowCreate: false,
    branch,
    envProjectId,
    localPin,
  });
  const apps = await listApps(context, provider, projectId, target.branch.name);
  const selectedApp = await resolveDomainAppSelection(context, projectId, apps, {
    explicitAppName: options?.appName,
    explicitAppId: envAppId,
  });

  await context.stateStore.setSelectedApp(projectId, {
    id: selectedApp.id,
    name: selectedApp.name,
  });

  return {
    provider,
    app: selectedApp,
    resultTarget: {
      workspace: target.workspace,
      project: target.project,
      branch: target.branch,
      app: {
        id: selectedApp.id,
        name: selectedApp.name,
      },
    },
  };
}

function resolveDomainBranch(explicitBranchName: string | undefined): ResolvedDeployBranch {
  return {
    name: explicitBranchName?.trim() || "production",
    annotation: explicitBranchName ? "set by --branch" : "production default",
  };
}

async function resolveDomainAppSelection(
  context: CommandContext,
  projectId: string,
  apps: PreviewAppRecord[],
  options: {
    explicitAppName: string | undefined;
    explicitAppId: string | undefined;
  },
): Promise<PreviewAppRecord> {
  if (options.explicitAppId) {
    const matched = apps.find((app) => app.id === options.explicitAppId);
    if (!matched) {
      throw usageError(
        "Selected app does not exist in the resolved production branch",
        `The app "${options.explicitAppId}" from ${PRISMA_APP_ID_ENV_VAR} could not be found in resolved project "${projectId}".`,
        `Unset ${PRISMA_APP_ID_ENV_VAR}, pass --app <name>, or deploy the app on the production branch.`,
        ["prisma-cli app deploy --branch production"],
        "app",
      );
    }
    return matched;
  }

  const selectedApp = await resolveExistingAppSelection(context, projectId, apps, options.explicitAppName);
  if (selectedApp) {
    return selectedApp;
  }

  throw usageError(
    "Custom domain requires an existing app on the production branch",
    "The resolved production branch does not have an app that can receive a custom domain.",
    "Deploy or promote an app to production first, then rerun the domain command.",
    ["prisma-cli app deploy --branch production", "prisma-cli app show"],
    "app",
  );
}

async function resolveDomainByHostname(
  provider: ReturnType<typeof createPreviewAppProvider>,
  appId: string,
  hostname: string,
): Promise<PreviewDomainRecord> {
  const domains = await provider.listDomains(appId).catch((error) => {
    throw domainCommandError("show", error, hostname);
  });
  const matched = domains.find((domain) => sameDomainHostname(domain.hostname, hostname));
  if (matched) {
    return matched;
  }

  throw domainNotFoundError(hostname);
}

function normalizeDomainHostname(hostname: string): string {
  const normalized = hostname.trim().replace(/\.$/, "").toLowerCase();
  if (!isValidDomainHostname(normalized)) {
    throw new CliError({
      code: "DOMAIN_HOSTNAME_INVALID",
      domain: "app",
      summary: `Invalid custom domain "${hostname}"`,
      why: "Custom domains must be valid hostnames without protocol, path, wildcard, or port.",
      fix: "Pass a hostname like shop.acme.com.",
      exitCode: 2,
      nextSteps: ["prisma-cli app domain add shop.acme.com"],
    });
  }

  return normalized;
}

function isValidDomainHostname(hostname: string): boolean {
  if (hostname.length < 1 || hostname.length > 253) {
    return false;
  }
  if (hostname.includes("://") || hostname.includes("/") || hostname.includes(":") || hostname.startsWith("*.")) {
    return false;
  }

  const labels = hostname.split(".");
  if (labels.length < 2) {
    return false;
  }

  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

function sameDomainHostname(left: string, right: string): boolean {
  return left.trim().replace(/\.$/, "").toLowerCase() === right.trim().replace(/\.$/, "").toLowerCase();
}

function toAppDomainSummary(domain: PreviewDomainRecord): AppDomainSummary {
  return {
    id: domain.id,
    type: domain.type,
    url: domain.url,
    hostname: domain.hostname,
    computeServiceId: domain.computeServiceId,
    status: domain.status,
    foundryStatus: domain.foundryStatus,
    failureReason: domain.failureReason,
    failureCategory: domain.failureCategory,
    certExpiresAt: domain.certExpiresAt,
    createdAt: domain.createdAt,
    updatedAt: domain.updatedAt,
    dnsRecords: domain.dnsRecords.map((record): AppDomainDnsRecord => ({
      type: record.type,
      name: record.name,
      value: record.value,
      ttl: record.ttl,
    })),
  };
}

function buildDomainShowNextSteps(domain: PreviewDomainRecord): string[] {
  if (domain.status === "active") {
    return [];
  }
  if (domain.status === "failed") {
    return [`prisma-cli app domain retry ${domain.hostname}`];
  }
  return [`prisma-cli app domain wait ${domain.hostname}`];
}

async function confirmDomainRemoval(
  context: CommandContext,
  target: AppDomainTarget,
  hostname: string,
): Promise<void> {
  if (context.flags.yes) {
    return;
  }

  if (!canPrompt(context)) {
    throw new CliError({
      code: "CONFIRMATION_REQUIRED",
      domain: "app",
      summary: "Custom domain removal requires confirmation in the current mode",
      why: "This command detaches a domain and cannot prompt for confirmation in the current mode.",
      fix: `Pass --yes to confirm removal of "${hostname}", or rerun prisma-cli app domain remove in an interactive TTY.`,
      exitCode: 1,
      nextSteps: [`prisma-cli app domain remove ${hostname} --app ${target.app.name} --yes`],
    });
  }

  const confirmed = await confirmPrompt({
    input: context.runtime.stdin,
    output: context.output.stderr,
    message: `Detach ${hostname} from App "${target.app.name}"?`,
    initialValue: false,
  });

  if (!confirmed) {
    throw usageError(
      "Custom domain removal canceled",
      "The command was canceled before the domain was detached.",
      "Rerun the command and confirm removal, or pass --yes.",
      [`prisma-cli app domain remove ${hostname} --app ${target.app.name} --yes`],
      "app",
    );
  }
}

function domainCommandError(
  command: "add" | "show" | "remove" | "retry" | "wait",
  error: unknown,
  hostname: string,
): CliError {
  if (error instanceof PreviewDomainApiError) {
    if (command === "add" && error.status === 400) {
      return new CliError({
        code: "DOMAIN_HOSTNAME_INVALID",
        domain: "app",
        summary: `Invalid custom domain "${hostname}"`,
        why: error.message,
        fix: "Pass a valid hostname like shop.acme.com and make sure DNS can be verified.",
        debug: formatDebugDetails(error),
        exitCode: 2,
        nextSteps: ["prisma-cli app domain add shop.acme.com"],
      });
    }

    if (command === "add" && error.status === 429) {
      return new CliError({
        code: "DOMAIN_QUOTA_EXCEEDED",
        domain: "app",
        summary: "Custom domain quota exceeded",
        why: error.message,
        fix: "Remove an existing custom domain before adding another one.",
        debug: formatDebugDetails(error),
        exitCode: 1,
        nextSteps: ["prisma-cli app domain remove <hostname>"],
      });
    }

    if (command === "add" && error.status === 422) {
      return noDeploymentsError(
        "Custom domain requires a live production deployment",
        "The selected app does not have a promoted version that can receive a custom domain.",
      );
    }

    if ((command === "show" || command === "remove" || command === "retry" || command === "wait") && error.status === 404) {
      return domainNotFoundError(hostname);
    }

    if (command === "retry" && error.status === 409) {
      return new CliError({
        code: "DOMAIN_RETRY_NOT_ELIGIBLE",
        domain: "app",
        summary: `Custom domain "${hostname}" is not eligible for retry`,
        why: error.message,
        fix: "Wait for the current verification or TLS step to finish, then rerun retry if the domain fails.",
        debug: formatDebugDetails(error),
        exitCode: 1,
        nextSteps: [`prisma-cli app domain show ${hostname}`],
      });
    }
  }

  return new CliError({
    code: "DEPLOY_FAILED",
    domain: "app",
    summary: `Custom domain ${command} failed`,
    why: error instanceof Error ? error.message : String(error),
    fix: "Retry the command, or rerun with --trace for more detailed diagnostics.",
    debug: formatDebugDetails(error),
    exitCode: 1,
    nextSteps: [`prisma-cli app domain show ${hostname}`],
  });
}

function domainNotFoundError(hostname: string): CliError {
  return new CliError({
    code: "DOMAIN_NOT_FOUND",
    domain: "app",
    summary: `Custom domain "${hostname}" not found`,
    why: "The hostname is not attached to the selected app.",
    fix: "Check the hostname and selected app, or add the domain first.",
    exitCode: 1,
    nextSteps: [`prisma-cli app domain add ${hostname}`],
  });
}

function formatDomainFailureWhy(domain: PreviewDomainRecord): string {
  if (domain.failureReason) {
    return domain.failureCategory
      ? `${domain.failureCategory}: ${domain.failureReason}`
      : domain.failureReason;
  }

  return "The platform reported a terminal failed state for this custom domain.";
}

function parseDomainWaitTimeout(value: string | undefined): number {
  if (!value) {
    return 15 * 60 * 1000;
  }

  const trimmed = value.trim().toLowerCase();
  if (trimmed === "0") {
    return 0;
  }

  const match = /^(\d+)(ms|s|m|h)$/.exec(trimmed);
  if (!match) {
    throw usageError(
      `Invalid timeout "${value}"`,
      "Timeout must be a duration such as 0, 30s, 15m, or 1h.",
      "Pass --timeout 15m, or --timeout 0 to poll once.",
      ["prisma-cli app domain wait shop.acme.com --timeout 15m"],
      "app",
    );
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2];
  const multiplier = unit === "h" ? 60 * 60 * 1000 : unit === "m" ? 60 * 1000 : unit === "s" ? 1000 : 1;
  return amount * multiplier;
}

function readDomainWaitPollIntervalMs(context: CommandContext): number {
  const raw = context.runtime.env.PRISMA_CLI_DOMAIN_WAIT_POLL_MS;
  if (!raw) {
    return 5_000;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5_000;
}

function emitDomainWaitStatus(
  context: CommandContext,
  event: {
    hostname: string;
    domainId: string;
    previousStatus: AppDomainStatus | null;
    status: AppDomainStatus;
    elapsedMs: number;
  },
): void {
  if (context.flags.json) {
    writeJsonEvent(context.output, {
      type: "status",
      command: "app.domain.wait",
      timestamp: new Date().toISOString(),
      data: {
        hostname: event.hostname,
        domainId: event.domainId,
        previousStatus: event.previousStatus,
        status: event.status,
        elapsedMs: event.elapsedMs,
      },
    });
    return;
  }

  if (context.flags.quiet) {
    return;
  }

  if (event.previousStatus === event.status) {
    return;
  }

  const transition = event.previousStatus
    ? `${event.previousStatus} -> ${event.status}`
    : event.status;
  context.output.stderr.write(`  ${transition} (${formatElapsed(event.elapsedMs)})\n`);
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(Math.floor(milliseconds / 1000), 0);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

async function sleep(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function resolveDeployAppSelection(
  context: CommandContext,
  projectId: string,
  apps: PreviewAppRecord[],
  options: {
    explicitAppName: string | undefined;
    explicitAppId: string | undefined;
    firstDeploy: boolean;
    inferName: () => Promise<InferredTargetName>;
  },
): Promise<{
  appId?: string;
  appName?: string;
  region?: string;
  displayName: string;
  annotation: string;
  firstDeploy: boolean;
}> {
  if (options.explicitAppName) {
    const matches = findAppsByName(apps, options.explicitAppName);
    if (matches.length > 1) {
      return resolveAmbiguousDeployApp(context, matches, options.explicitAppName, options.firstDeploy);
    }
    const matched = matches[0];
    if (matched) {
      return {
        appId: matched.id,
        displayName: matched.name,
        annotation: "set by --app",
        firstDeploy: options.firstDeploy,
      };
    }

    return {
      appName: options.explicitAppName,
      region: PREVIEW_DEFAULT_REGION,
      displayName: options.explicitAppName,
      annotation: "set by --app",
      firstDeploy: options.firstDeploy,
    };
  }

  if (options.explicitAppId) {
    const matched = apps.find((app) => app.id === options.explicitAppId);
    if (!matched) {
      throw usageError(
        "Selected app does not exist in the resolved project",
        `The app "${options.explicitAppId}" from ${PRISMA_APP_ID_ENV_VAR} could not be found in resolved project "${projectId}".`,
        `Unset ${PRISMA_APP_ID_ENV_VAR}, pass --app <name>, or choose an app from prisma-cli app list-deploys.`,
        ["prisma-cli app list-deploys"],
        "app",
      );
    }

    return {
      appId: matched.id,
      displayName: matched.name,
      annotation: `from ${PRISMA_APP_ID_ENV_VAR}`,
      firstDeploy: options.firstDeploy,
    };
  }

  const inferredName = await options.inferName();
  const matches = findAppsByName(apps, inferredName.name);
  if (matches.length > 1) {
    return resolveAmbiguousDeployApp(context, matches, inferredName.name, options.firstDeploy);
  }

  const matched = matches[0];
  if (matched) {
    return {
      appId: matched.id,
      displayName: matched.name,
      annotation: "existing app on this branch",
      firstDeploy: options.firstDeploy,
    };
  }

  return {
    appName: inferredName.name,
    region: PREVIEW_DEFAULT_REGION,
    displayName: inferredName.name,
    annotation: inferredName.source === "package-name"
      ? "created from package.json"
      : "created from directory name",
    firstDeploy: options.firstDeploy,
  };
}

async function resolveAmbiguousDeployApp(
  context: CommandContext,
  matches: PreviewAppRecord[],
  targetName: string,
  firstDeploy: boolean,
): Promise<{
  appId?: string;
  appName?: string;
  region?: string;
  displayName: string;
  annotation: string;
  firstDeploy: boolean;
}> {
  if (canPrompt(context)) {
    const createNew = "__create_new_app__";
    const cancel = "__cancel__";
    const selected = await selectPrompt<PreviewAppRecord | typeof createNew | typeof cancel>({
      input: context.runtime.stdin,
      output: context.runtime.stderr,
      message: `Multiple apps are named "${targetName}"`,
      choices: [
        ...sortApps(matches).map((app) => ({
          label: `${app.name} (${app.id})`,
          value: app,
        })),
        {
          label: `Create a new app named "${targetName}"`,
          value: createNew,
        },
        {
          label: "Cancel",
          value: cancel,
        },
      ],
    });

    if (selected === cancel) {
      throw usageError(
        "App selection canceled",
        "The command was canceled before an app was selected.",
        "Re-run the command and choose an app, or pass --app <name>.",
        ["prisma-cli app deploy --app <name>"],
        "app",
      );
    }

    if (selected === createNew) {
      return {
        appName: targetName,
        region: PREVIEW_DEFAULT_REGION,
        displayName: targetName,
        annotation: "created from package.json",
        firstDeploy,
      };
    }

    return {
      appId: selected.id,
      displayName: selected.name,
      annotation: "selected by you",
      firstDeploy,
    };
  }

  throw new CliError({
    code: "APP_AMBIGUOUS",
    domain: "app",
    summary: "App resolution is ambiguous",
    why: `Multiple apps matched "${targetName}".`,
    fix: "Pass --app <name> to choose the app explicitly.",
    meta: {
      candidates: matches.map((app) => ({ id: app.id, name: app.name })),
    },
    exitCode: 2,
    nextSteps: ["prisma-cli app deploy --app <name>"],
  });
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
  branchName?: string,
) {
  return provider.listApps(projectId, { branchName }).then(sortApps).catch((error) => {
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
  options?: {
    allowCreate?: boolean;
    branch?: ResolvedDeployBranch;
  },
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

async function requireProviderAndDeployProjectContext(
  context: CommandContext,
  explicitProject: string | undefined,
  options: {
    allowCreate?: boolean;
    branch?: ResolvedDeployBranch;
    envProjectId?: string;
    localPin: LocalResolutionPinReadResult;
  },
): Promise<{
  client: ManagementApiClient;
  provider: ReturnType<typeof createPreviewAppProvider>;
  target: ResolvedAppProjectContext;
  projectId: string;
}> {
  const { client, provider } = await requirePreviewAppProviderWithClient(context);
  const target = await resolveDeployProjectContext(context, client, provider, explicitProject, options);
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
  options?: {
    allowCreate?: boolean;
    branch?: ResolvedDeployBranch;
  },
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
            throw createProjectOnFirstDeployError({
              error,
              inferredName: name,
              workspaceName: authState.workspace!.name,
            });
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
  const branch = options?.branch ?? await resolveDeployBranch(context, undefined);

  return {
    ...resolved,
    branch: {
      name: branch.name,
      kind: toBranchKind(branch.name),
    },
  };
}

async function resolveDeployProjectContext(
  context: CommandContext,
  client: ManagementApiClient,
  provider: ReturnType<typeof createPreviewAppProvider>,
  explicitProject: string | undefined,
  options: {
    allowCreate?: boolean;
    branch?: ResolvedDeployBranch;
    envProjectId?: string;
    localPin: LocalResolutionPinReadResult;
  },
): Promise<ResolvedAppProjectContext> {
  const authState = await requireAuthenticatedAuthState(context);
  const workspace = authState.workspace;
  if (!workspace) {
    throw workspaceRequiredError();
  }

  const branch = options.branch ?? await resolveDeployBranch(context, undefined);
  const projects = await listRealWorkspaceProjects(client, workspace);
  const createProject = options.allowCreate
    ? async (name: string) => {
        const project = await provider.createProject({ name }).catch((error) => {
          throw createProjectOnFirstDeployError({
            error,
            inferredName: name,
            workspaceName: workspace.name,
          });
        });
        return {
          id: project.id,
          name: project.name,
          workspace,
        };
      }
    : undefined;

  if (explicitProject) {
    const resolved = await resolveProjectTarget({
      context,
      workspace,
      explicitProject,
      listProjects: async () => projects,
      createProject,
      allowCreate: options.allowCreate,
      prompt: createSelectPromptPort(context),
      remember: true,
    });
    return withDeployBranch(resolved, branch);
  }

  if (options.envProjectId) {
    const project = projects.find((candidate) => candidate.id === options.envProjectId);
    if (!project) {
      throw projectNotFoundError(options.envProjectId, workspace);
    }
    return withDeployBranch({
      workspace,
      project: toProjectSummary(project),
      resolution: {
        projectSource: "env",
        targetName: options.envProjectId,
        targetNameSource: "env",
      },
    }, branch);
  }

  const localPin = options.localPin;
  if (localPin.kind === "present") {
    if (localPin.pin.workspaceId !== workspace.id) {
      throw localResolutionPinStaleError();
    }

    const project = projects.find((candidate) => candidate.id === localPin.pin.projectId);
    if (!project) {
      throw localResolutionPinStaleError();
    }

    return withDeployBranch({
      workspace,
      project: toProjectSummary(project),
      resolution: {
        projectSource: "local-pin",
        targetName: project.name,
        targetNameSource: "local-pin",
      },
    }, branch);
  }

  const resolved = await resolveProjectTarget({
    context,
    workspace,
    listProjects: async () => projects,
    createProject,
    allowCreate: options.allowCreate,
    prompt: createSelectPromptPort(context),
    remember: true,
  });
  return withDeployBranch(resolved, branch);
}

function withDeployBranch(
  target: Omit<ResolvedAppProjectContext, "branch">,
  branch: ResolvedDeployBranch,
): ResolvedAppProjectContext {
  return {
    ...target,
    branch: {
      name: branch.name,
      kind: toBranchKind(branch.name),
    },
  };
}

function toProjectSummary(project: Pick<ProjectCandidate, "id" | "name">): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
  };
}

function toBranchKind(name: string): BranchKind {
  return name === "production" || name === "main" ? "production" : "preview";
}

interface ResolvedDeployBranch {
  name: string;
  annotation: string;
}

async function resolveDeployBranch(context: CommandContext, explicitBranchName: string | undefined): Promise<ResolvedDeployBranch> {
  if (explicitBranchName) {
    return {
      name: explicitBranchName,
      annotation: "set by --branch",
    };
  }

  const gitBranch = await readLocalGitBranch(context.runtime.cwd);
  if (gitBranch) {
    return {
      name: gitBranch,
      annotation: "from local Git branch",
    };
  }

  return {
    name: "main",
    annotation: "default",
  };
}

async function readLocalGitBranch(cwd: string): Promise<string | null> {
  const gitPath = path.join(cwd, ".git");
  const headPath = await resolveGitHeadPath(gitPath);
  if (!headPath) {
    return null;
  }

  try {
    const head = (await readFile(headPath, "utf8")).trim();
    const refPrefix = "ref: refs/heads/";
    if (head.startsWith(refPrefix)) {
      return head.slice(refPrefix.length);
    }
  } catch {
    return null;
  }

  return null;
}

async function resolveGitHeadPath(gitPath: string): Promise<string | null> {
  try {
    const raw = await readFile(gitPath, "utf8");
    const prefix = "gitdir:";
    if (raw.startsWith(prefix)) {
      return path.join(path.resolve(path.dirname(gitPath), raw.slice(prefix.length).trim()), "HEAD");
    }
  } catch {
    // Fall through to try the normal .git directory shape below.
    // Common cases: EISDIR (normal git repo), EACCES, ENOENT.
  }

  try {
    await access(path.join(gitPath, "HEAD"));
    return path.join(gitPath, "HEAD");
  } catch {
    return null;
  }
}

interface ResolvedDeployFramework {
  key: string;
  buildType: ResolvedPreviewBuildType;
  displayName: string;
  annotation: string;
}

interface ResolvedDeployRuntime {
  port: number;
  annotation: string;
}

async function resolveDeployFramework(
  context: CommandContext,
  options: {
    requestedFramework: string | undefined;
    requestedBuildType: string | undefined;
    explicitBuildType: boolean;
  },
): Promise<ResolvedDeployFramework> {
  if (options.requestedFramework) {
    return frameworkFromUserFacingValue(options.requestedFramework, "set by --framework");
  }

  if (options.explicitBuildType) {
    const buildType = normalizeBuildType(options.requestedBuildType);
    if (buildType !== "auto") {
      return {
        key: buildType,
        buildType,
        displayName: formatBuildTypeName(buildType),
        annotation: "set by --build-type",
      };
    }
  }

  const detected = await detectDeployFramework(context.runtime.cwd);
  if (detected) {
    return detected;
  }

  throw frameworkNotDetectedError(context.runtime.cwd);
}

function resolveDeployRuntime(
  requestedHttpPort: string | undefined,
  framework: ResolvedDeployFramework,
): ResolvedDeployRuntime {
  if (requestedHttpPort) {
    return {
      port: parseDeployHttpPort(requestedHttpPort),
      annotation: "set by --http-port",
    };
  }

  return {
    port: FRAMEWORK_DEFAULT_HTTP_PORT,
    annotation: `${framework.displayName} default`,
  };
}

async function detectDeployFramework(cwd: string): Promise<ResolvedDeployFramework | null> {
  const packageJson = await readBunPackageJson(cwd);
  const nextConfig = await detectNextConfig(cwd);

  if (nextConfig.exists || hasPackageDependency(packageJson, "next")) {
    return {
      key: "nextjs",
      buildType: "nextjs",
      displayName: "Next.js",
      annotation: nextConfig.standalone
        ? "standalone output detected"
        : nextConfig.exists
          ? "detected from next.config"
          : "detected from package.json",
    };
  }

  if (hasPackageDependency(packageJson, "hono")) {
    return {
      key: "hono",
      buildType: "bun",
      displayName: "Hono",
      annotation: "detected from package.json",
    };
  }

  if (hasPackageDependency(packageJson, "@tanstack/start")) {
    return {
      key: "tanstack-start",
      buildType: "tanstack-start",
      displayName: "TanStack Start",
      annotation: "detected from package.json",
    };
  }

  return null;
}

async function detectNextConfig(cwd: string): Promise<{ exists: boolean; standalone: boolean }> {
  const candidates = [
    "next.config.js",
    "next.config.mjs",
    "next.config.cjs",
    "next.config.ts",
  ];

  for (const candidate of candidates) {
    const filePath = path.join(cwd, candidate);
    try {
      const content = await readFile(filePath, "utf8");
      return {
        exists: true,
        standalone: /\boutput\s*:\s*["'`]standalone["'`]/.test(content),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  return {
    exists: false,
    standalone: false,
  };
}

function hasPackageDependency(packageJson: BunPackageJsonLike | null, dependencyName: string): boolean {
  return hasDependency(packageJson?.dependencies, dependencyName)
    || hasDependency(packageJson?.devDependencies, dependencyName);
}

function hasDependency(dependencies: unknown, dependencyName: string): boolean {
  return Boolean(
    dependencies
      && typeof dependencies === "object"
      && dependencyName in dependencies,
  );
}

function frameworkFromUserFacingValue(value: string, annotation: string): ResolvedDeployFramework {
  switch (value.trim().toLowerCase()) {
    case "next":
    case "next.js":
    case "nextjs":
      return {
        key: "nextjs",
        buildType: "nextjs",
        displayName: "Next.js",
        annotation,
      };
    case "hono":
      return {
        key: "hono",
        buildType: "bun",
        displayName: "Hono",
        annotation,
      };
    case "tanstack":
    case "tanstack-start":
    case "@tanstack/start":
      return {
        key: "tanstack-start",
        buildType: "tanstack-start",
        displayName: "TanStack Start",
        annotation,
      };
    default:
      throw frameworkNotDetectedError(undefined, value);
  }
}

function frameworkNotDetectedError(cwd: string | undefined, requestedFramework?: string): CliError {
  const supported = "Next.js, Hono, TanStack Start";
  const directory = cwd ? ` in ${formatDeployDirectory(cwd)}` : "";

  return new CliError({
    code: "FRAMEWORK_NOT_DETECTED",
    domain: "app",
    summary: requestedFramework
      ? `Unsupported framework "${requestedFramework}"`
      : `Cannot detect a supported framework${directory}`,
    why: `Supported Beta frameworks: ${supported}.`,
    fix: "Add one of these frameworks as a dependency, or pass --framework <nextjs|hono|tanstack-start>.",
    exitCode: 2,
    nextSteps: [
      "prisma-cli app deploy --framework nextjs",
      "prisma-cli app deploy --framework hono",
      "prisma-cli app deploy --framework tanstack-start",
    ],
  });
}

async function maybeRenderDeploySetupBlock(
  context: CommandContext,
  details: {
    firstDeploy: boolean;
    workspaceName: string;
    projectName: string;
    projectAnnotation: string;
    branchName: string;
    branchAnnotation: string;
    appName: string;
    appAnnotation: string;
    framework: ResolvedDeployFramework;
    runtime: ResolvedDeployRuntime;
  },
): Promise<void> {
  if (context.flags.json || context.flags.quiet) {
    return;
  }

  const directory = formatDeployDirectory(context.runtime.cwd);
  if (!details.firstDeploy) {
    context.output.stderr.write(`Deploying ${directory} to ${details.projectName} / ${details.branchName} / ${details.appName}\n\n`);
    return;
  }

  const title = `Setting up your local directory ${formatLocalDirectory(context.runtime.cwd, context.runtime.env)}`;
  const rows = details.firstDeploy
    ? [
        { label: "Workspace", value: details.workspaceName },
        { label: "Project", value: details.projectName, origin: details.projectAnnotation },
        { label: "Branch", value: details.branchName, origin: details.branchAnnotation },
        { label: "App", value: details.appName, origin: details.appAnnotation },
        { label: "Framework", value: details.framework.displayName, origin: details.framework.annotation },
        { label: "Runtime", value: `HTTP ${details.runtime.port}`, origin: details.runtime.annotation },
      ]
    : [];
  const lines = [title, "", ...renderDeployOutputRows(context.ui, rows), ""];

  context.output.stderr.write(`${lines.join("\n")}\n`);
}

function maybeRenderLocalPinBound(context: CommandContext, projectName: string): void {
  if (context.flags.json || context.flags.quiet) {
    return;
  }

  context.output.stderr.write(`This directory is now linked to project ${projectName}.\n\n`);
}

async function maybeCustomizeDeploySettings(
  context: CommandContext,
  options: {
    framework: ResolvedDeployFramework;
    runtime: ResolvedDeployRuntime;
    firstDeploy: boolean;
    explicitFramework: boolean;
    explicitBuildType: boolean;
    explicitHttpPort: boolean;
  },
): Promise<{ framework: ResolvedDeployFramework; runtime: ResolvedDeployRuntime }> {
  if (
    !options.firstDeploy
    || context.flags.yes
    || options.explicitFramework
    || options.explicitBuildType
    || options.explicitHttpPort
    || !canPrompt(context)
  ) {
    return {
      framework: options.framework,
      runtime: options.runtime,
    };
  }

  const shouldCustomize = await confirmPrompt({
    input: context.runtime.stdin,
    output: context.runtime.stderr,
    message: "Customize settings?",
    initialValue: false,
  });

  if (!shouldCustomize) {
    return {
      framework: options.framework,
      runtime: options.runtime,
    };
  }

  const frameworkKey = await selectPrompt<DeployFramework>({
    input: context.runtime.stdin,
    output: context.runtime.stderr,
    message: `Framework (${options.framework.displayName})`,
    choices: DEPLOY_FRAMEWORKS.map((framework) => ({
      label: frameworkDisplayName(framework),
      value: framework,
    })),
  });
  const framework = frameworkFromUserFacingValue(frameworkKey, "set by you");
  const requestedPort = await textPrompt({
    input: context.runtime.stdin,
    output: context.runtime.stderr,
    message: `HTTP port (${options.runtime.port})`,
    placeholder: String(options.runtime.port),
    validate: validateDeployHttpPortText,
  });
  const runtime = {
    port: requestedPort.trim() ? parseDeployHttpPort(requestedPort) : options.runtime.port,
    annotation: "set by you",
  };
  const changedRows = [
    framework.key !== options.framework.key
      ? { label: "Framework", value: framework.displayName, annotation: framework.annotation }
      : null,
    runtime.port !== options.runtime.port
      ? { label: "Runtime", value: `HTTP ${runtime.port}`, annotation: runtime.annotation }
      : null,
  ].filter((row): row is { label: string; value: string; annotation: string } => Boolean(row));

  if (changedRows.length > 0 && !context.flags.quiet && !context.flags.json) {
    context.output.stderr.write(`${renderDeployOutputRows(context.ui, changedRows.map((row) => ({
      label: row.label,
      value: row.value,
      origin: row.annotation,
    }))).join("\n")}\n\n`);
  }

  return {
    framework,
    runtime,
  };
}

function annotationForProjectResolution(resolution: ProjectResolution): string {
  switch (resolution.projectSource) {
    case "explicit":
      return "set by --project";
    case "env":
      return `from ${PRISMA_PROJECT_ID_ENV_VAR}`;
    case "local-pin":
      return "from local pin";
    case "created":
      return resolution.targetNameSource === "directory-name"
        ? "created from directory name"
        : "created from package.json";
    case "package-name":
    case "directory-name":
      return "linked to existing project";
    case "platform-mapping":
    case "remembered-local":
      return "linked to existing project";
    case "prompt":
      return "selected by you";
  }
}

function frameworkDisplayName(framework: DeployFramework): string {
  switch (framework) {
    case "nextjs":
      return "Next.js";
    case "hono":
      return "Hono";
    case "tanstack-start":
      return "TanStack Start";
  }
}

function validateDeployHttpPortText(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  try {
    parseDeployHttpPort(value);
    return undefined;
  } catch (error) {
    return error instanceof CliError ? error.summary : String(error);
  }
}

function formatDeployDirectory(cwd: string): string {
  const basename = path.basename(cwd);
  return basename ? `./${basename}` : ".";
}

function formatLocalDirectory(cwd: string, env: NodeJS.ProcessEnv): string {
  const resolved = path.resolve(cwd);
  const home = env.HOME ? path.resolve(env.HOME) : null;

  if (home && (resolved === home || resolved.startsWith(`${home}${path.sep}`))) {
    const relative = path.relative(home, resolved);
    return relative ? `~/${relative}` : "~";
  }

  return resolved;
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

  return { http: parseDeployHttpPort(requestedPort) };
}

function parseDeployHttpPort(requestedPort: string): number {
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

  return port;
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

function appDeployFailedError(error: unknown, progress: PreviewDeployProgressState): CliError {
  const why = error instanceof Error ? error.message : String(error);
  const debug = formatDebugDetails(error);

  if (progress.buildStarted && !progress.buildCompleted) {
    return new CliError({
      code: "BUILD_FAILED",
      domain: "app",
      summary: "Build failed locally.",
      why,
      fix: "Inspect the build output above, fix the error, and redeploy.",
      debug,
      meta: { phase: "build" },
      humanLines: [
        "Build failed locally.",
        "",
        `✗ Built       ${why}`,
        "",
        "Fix: Inspect the build output above, fix the error, and redeploy.",
      ],
      exitCode: 1,
      nextSteps: [],
    });
  }

  if (!progress.buildStarted) {
    return deployFailedError("App deploy failed", error, ["prisma-cli app deploy"]);
  }

  const phaseHeadline = progress.containerLive
    ? "The deployment started, but the app is not ready yet."
    : "Deploy failed after the build completed.";
  const recoveryLines = progress.versionId
    ? ["See what happened", `prisma-cli app logs --deployment ${progress.versionId}`]
    : ["Fix", "Retry the command, or rerun with --trace for more detailed diagnostics."];
  const urlLines = progress.deploymentUrl
    ? ["", "URL", progress.deploymentUrl]
    : [];
  const humanLines = progress.containerLive
    ? [
        phaseHeadline,
        "",
        "This is usually a missing env var, a failed DB connection,",
        "or a crash on startup.",
        "",
        ...recoveryLines,
        ...urlLines,
      ]
    : [
        phaseHeadline,
        "",
        progress.uploadCompleted
          ? "The artifact uploaded, but the deployment did not start."
          : progress.archiveReady
            ? "The app built locally, but the artifact did not finish uploading."
            : "The app built locally, but the deployment did not start.",
        "",
        ...recoveryLines,
      ];
  const fix = progress.versionId
    ? `Inspect logs with prisma-cli app logs --deployment ${progress.versionId}.`
    : "Retry the command, or rerun with --trace for more detailed diagnostics.";

  return new CliError({
    code: "DEPLOY_FAILED",
    domain: "app",
    summary: phaseHeadline,
    why,
    fix,
    debug,
    meta: {
      phase: progress.containerLive ? "runtime_ready" : "deploy",
      deploymentId: progress.versionId,
      deploymentUrl: progress.deploymentUrl,
    },
    humanLines,
    exitCode: 1,
    nextSteps: [],
  });
}

function localResolutionPinStaleError(): CliError {
  return new CliError({
    code: "LOCAL_STATE_STALE",
    domain: "project",
    summary: "Local project binding is stale",
    why: `The target recorded in ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH} is no longer available in the selected workspace.`,
    fix: `Delete ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH} and re-run to re-bootstrap.`,
    meta: {
      pinPath: LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
    },
    exitCode: 1,
    nextSteps: ["prisma-cli app deploy"],
  });
}

function readDeployEnvOverride(context: CommandContext, name: string): string | undefined {
  const value = context.runtime.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * `app deploy` falls into "create a new project on first deploy" when no
 * existing project matches the package.json name (or the cwd basename as a
 * fallback). When the create call fails the user often doesn't realise the
 * CLI was attempting to create a project at all — they thought the deploy
 * would find an existing project. Surface that context, and recommend the
 * explicit `--project` flag as the unambiguous way out.
 */
function createProjectOnFirstDeployError(options: {
  error: unknown;
  inferredName: string;
  workspaceName: string;
}): CliError {
  const { error, inferredName, workspaceName } = options;
  const status = extractHttpStatus(error);
  const errorMessage = error instanceof Error ? error.message : String(error);
  const inferredContext = `No existing project matched the package.json name \`${inferredName}\`, so the CLI attempted to create one.`;
  const nextSteps = [
    "prisma-cli project list",
    "prisma-cli app deploy --project <id-or-name>",
  ];

  if (status === 401 || status === 403) {
    return new CliError({
      code: "AUTH_FORBIDDEN",
      domain: "auth",
      summary: "Could not create a new project for this deploy",
      why: `${inferredContext} The platform rejected the create (HTTP ${status}).`,
      fix: `Pass --project <id-or-name> to deploy into an existing project, or grant the service token project-create permission on workspace \`${workspaceName}\`.`,
      debug: formatDebugDetails(error),
      exitCode: 1,
      nextSteps,
    });
  }

  return new CliError({
    code: "DEPLOY_FAILED",
    domain: "app",
    summary: "Could not create a new project for this deploy",
    why: `${inferredContext} ${errorMessage}`.trim(),
    fix: "Pass --project <id-or-name> to deploy into an existing project, or retry after addressing the platform error above.",
    debug: formatDebugDetails(error),
    exitCode: 1,
    nextSteps,
  });
}

function extractHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as { statusCode?: unknown; status?: unknown; message?: unknown };
  if (typeof candidate.statusCode === "number") {
    return candidate.statusCode;
  }
  if (typeof candidate.status === "number") {
    return candidate.status;
  }

  // The compute-sdk re-throws AuthenticationError / ApiError as plain
  // Error instances whose `message` carries the "(HTTP <code>)" suffix.
  // Match that suffix as a last resort so this UX still triggers for
  // service tokens running through that path.
  if (typeof candidate.message === "string") {
    const match = /\(HTTP (\d{3})\)/.exec(candidate.message);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }

  return null;
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

function findAppsByName(apps: PreviewAppRecord[], name: string): PreviewAppRecord[] {
  return apps.filter((app) => app.name === name);
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
