import { defineCommand, flag, positional } from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import type { DeployProgress, PortMapping } from "@prisma/compute-sdk";
import type { AppProvider } from "../../lib/app/app-provider";
import {
  COMPUTE_CONFIG_FILENAME,
  computeConfigErrorToCliError,
  inferComputeTargetFromCwd,
  type LoadedComputeConfig,
  loadComputeConfig,
  mergeComputeDeployInputs,
} from "../../lib/app/compute-config";
import {
  describeDeployAllFailure,
  type PlannedDeployTarget,
  perAppInputsForDeployAll,
  planAppDeploy,
} from "../../lib/app/deploy-plan";
import { envVarNames, parseEnvInputs } from "../../lib/app/env-vars";
import {
  LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
  readLocalResolutionPin,
} from "../../lib/project/local-pin";
import type { ProjectCandidate } from "../../lib/project/resolution";
import { sortProjects } from "../../lib/project/resolution";
import { bindProjectToDirectory } from "../../lib/project/setup";
import type { CommandContext as LegacyCommandContext } from "../../shell/runtime";
import { maybeSetupBranchDatabase } from "./branch-database";
import {
  assertExclusiveProjectInputs,
  assertSupportedEntrypoint,
  customizationChoices,
  FRAMEWORK_KEYS,
  frameworkFromUserFacingValue,
  inspectLegacyBuildSettings,
  normalizeRegionInput,
  parseHttpPort,
  projectSetupSuggestion,
  type ResolvedDeployFramework,
  type ResolvedDeployProjectContext,
  type ResolvedDeployRuntime,
  resolveDeployBranch,
  resolveDeployBuildSettings,
  resolveDeployEntrypoint,
  resolveDeployFramework,
  resolveDeployProjectContext,
  resolveDeployRuntime,
  resolveDeployServiceSelection,
  resolveServiceDirectory,
} from "./deploy-target";
import {
  adviceAction,
  fromLegacyCliError,
  localResolutionPinStaleError,
  prodDeployRequiresFlagError,
  projectSetupRequiredError,
  runCommandAction,
  serviceDeployFailedError,
  userCancelledError,
} from "./errors";
import { deployAllPresentations, deployPresentations } from "./presentation";
import type { ServiceDeployAllResult, ServiceDeployResult } from "./results";
import type { ServiceContext } from "./target";
import {
  listServices,
  openServiceStateStore,
  PRISMA_PROJECT_ID_ENV_VAR,
  PRISMA_SERVICE_ID_ENV_VAR,
  readServiceEnvOverride,
  requireWorkspace,
  resolveComputeTarget,
  serviceProvider,
} from "./target";

/** Every supported framework serves HTTP on this port unless overridden. */
const DEFAULT_HTTP_PORT = 3000;

interface DeployInputs {
  serviceName: string | undefined;
  projectRef: string | undefined;
  createProjectName: string | undefined;
  branchName: string | undefined;
  framework: string | undefined;
  entrypoint: string | undefined;
  httpPort: string | undefined;
  region: string | undefined;
  envAssignments: string[];
  prod: boolean;
  noPromote: boolean;
  db: boolean | undefined;
  configTarget: string | undefined;
}

/** The deploy progress facts the failure message needs. */
interface DeployProgressState {
  buildStarted: boolean;
  buildCompleted: boolean;
  archiveReady: boolean;
  uploadCompleted: boolean;
  deploymentId: string | null;
  containerLive: boolean;
  deploymentUrl: string | null;
}

/**
 * Maps the compute SDK's deploy callbacks onto engine events: one step per
 * phase (build, archive, upload, deploy, promote), `status` events for the
 * deployment's own transitions, and `endpoint` events for the deployment and
 * live URLs.
 */
function deployProgressReporter(
  ctx: ServiceContext,
  state: DeployProgressState,
): DeployProgress {
  const started = (step: string) => ctx.report({ kind: "step-started", step });
  const finished = (step: string, data?: unknown) =>
    ctx.report({
      kind: "step-finished",
      step,
      outcome: "ok",
      ...(data === undefined ? {} : { data }),
    });

  return {
    onBuildStart() {
      state.buildStarted = true;
      started("build");
    },
    onBuildComplete() {
      state.buildCompleted = true;
      finished("build");
    },
    onArchiveCreating() {
      started("archive");
    },
    onArchiveReady(sizeBytes) {
      state.archiveReady = true;
      finished("archive", { byteLength: sizeBytes });
    },
    onDeploymentCreated(deploymentId) {
      state.deploymentId = deploymentId;
      ctx.report({
        kind: "status",
        subject: deploymentId,
        status: "created",
      });
    },
    onUploadStart() {
      started("upload");
    },
    onUploadComplete() {
      state.uploadCompleted = true;
      finished("upload");
    },
    onStartRequested() {
      started("deploy");
    },
    onStatusChange(status) {
      ctx.report({
        kind: "status",
        subject: state.deploymentId ?? "deployment",
        status,
      });
    },
    onRunning(deploymentUrl) {
      state.containerLive = true;
      state.deploymentUrl = deploymentUrl;
      finished("deploy");
      if (deploymentUrl) {
        ctx.report({
          kind: "endpoint",
          name: "deployment",
          url: deploymentUrl,
        });
      }
    },
    onPromoteStart() {
      started("promote");
    },
    onPromoted(appEndpointDomain) {
      finished("promote");
      if (appEndpointDomain) {
        ctx.report({
          kind: "endpoint",
          name: "live",
          url: `https://${appEndpointDomain}`,
        });
      }
    },
    onPromoteFailed(error) {
      ctx.report({
        kind: "step-finished",
        step: "promote",
        outcome: "failed",
      });
      if (error) {
        ctx.report({
          kind: "message",
          severity: "warn",
          text: `Promotion failed: ${error.message}`,
        });
      }
    },
  };
}

/**
 * Production protection: the first production deploy of a service goes
 * through, every later one needs `--prod` AND explicit consent. `--yes`
 * cannot grant it, and a non-interactive run settles with the engine's
 * consent-required error.
 */
async function enforceProductionDeploy(
  ctx: ServiceContext,
  provider: AppProvider,
  options: {
    serviceId: string | undefined;
    serviceName: string;
    branchKind: "production" | "preview";
    prod: boolean;
  },
): Promise<{ firstProductionDeploy: boolean }> {
  if (options.branchKind !== "production") {
    return { firstProductionDeploy: false };
  }

  const announceFirst = () => {
    ctx.report({
      kind: "message",
      severity: "info",
      text: `First deploy of "${options.serviceName}" — promoting to production.`,
    });
  };

  if (!options.serviceId) {
    announceFirst();
    return { firstProductionDeploy: true };
  }

  const deploymentsResult = await provider
    .listDeployments(options.serviceId, { signal: ctx.signal })
    .catch((error) => {
      throw new CliStructuredError(
        "SERVICE.DEPLOY_FAILED",
        "Failed to inspect production deployments",
        {
          why: error instanceof Error ? error.message : String(error),
          nextActions: [
            runCommandAction("List deployments", "service list-deploys"),
          ],
          cause: error,
        },
      );
    });
  const currentLive =
    (deploymentsResult.app.liveDeploymentId
      ? deploymentsResult.deployments.find(
          (deployment) =>
            deployment.id === deploymentsResult.app.liveDeploymentId,
        )
      : undefined) ??
    deploymentsResult.deployments.find(
      (deployment) => deployment.live === true,
    ) ??
    deploymentsResult.deployments[0] ??
    null;

  if (!currentLive) {
    announceFirst();
    return { firstProductionDeploy: true };
  }

  if (!options.prod) {
    throw prodDeployRequiresFlagError();
  }

  const granted = await ctx.prompt.consent(
    `Deploy to production and replace the live deployment ${currentLive.id} of "${options.serviceName}"?`,
    { token: options.serviceName },
  );
  // A token consent resolves to true or throws; this guard only fires if
  // that contract ever loosens.
  if (!granted) {
    throw userCancelledError("Production deploy cancelled");
  }
  return { firstProductionDeploy: false };
}

/**
 * First-deploy settings customization: an opt-in confirm, then framework and
 * port. Every prompt here is defaultable, so a non-interactive run keeps the
 * detected settings instead of failing.
 */
async function maybeCustomizeDeploySettings(
  ctx: ServiceContext,
  options: {
    framework: ResolvedDeployFramework;
    runtime: ResolvedDeployRuntime;
    firstDeploy: boolean;
    explicitFramework: boolean;
    explicitEntrypoint: boolean;
    explicitHttpPort: boolean;
  },
): Promise<{
  framework: ResolvedDeployFramework;
  runtime: ResolvedDeployRuntime;
}> {
  if (
    !options.firstDeploy ||
    options.explicitFramework ||
    options.explicitEntrypoint ||
    options.explicitHttpPort
  ) {
    return { framework: options.framework, runtime: options.runtime };
  }

  ctx.report({
    kind: "message",
    severity: "info",
    text: `Detected ${options.framework.displayName} on HTTP ${options.runtime.port}`,
  });
  const customize = await ctx.prompt.confirm("Customize build settings?", {
    default: false,
  });
  if (!customize) {
    return { framework: options.framework, runtime: options.runtime };
  }

  const frameworkKey = await ctx.prompt.select(
    `Framework (${options.framework.displayName})`,
    customizationChoices(),
    { default: options.framework.key },
  );
  const framework = frameworkFromUserFacingValue(frameworkKey, "set by you");
  const portText = await ctx.prompt.text(
    `HTTP port (${options.runtime.port})`,
    {
      placeholder: String(options.runtime.port),
      default: String(options.runtime.port),
    },
  );
  return {
    framework,
    runtime: {
      port: portText.trim() ? parseHttpPort(portText) : options.runtime.port,
      annotation: "set by you",
    },
  };
}

/** The narrow slice of the legacy shell context `bindProjectToDirectory`
 *  reads (cwd + signal). */
function legacyBindContext(ctx: ServiceContext): LegacyCommandContext {
  return {
    runtime: { cwd: ctx.cwd, signal: ctx.signal },
  } as unknown as LegacyCommandContext;
}

async function listWorkspaceProjects(
  ctx: ServiceContext,
  workspaceId: string,
): Promise<ProjectCandidate[]> {
  const { data } = await ctx.api.GET("/v1/projects", { signal: ctx.signal });
  return sortProjects(
    (data?.data ?? [])
      .filter((project) => project.workspace.id === workspaceId)
      .map((project) => ({
        id: project.id,
        name: project.name,
        ...("url" in project && typeof project.url === "string"
          ? { url: project.url }
          : {}),
        ...("defaultRegion" in project
          ? { defaultRegion: project.defaultRegion }
          : {}),
        slug:
          "slug" in project && typeof project.slug === "string"
            ? project.slug
            : null,
        workspace: {
          id: project.workspace.id,
          name: project.workspace.name,
        },
      })),
  );
}

async function deploySingleService(
  ctx: ServiceContext,
  inputs: DeployInputs,
  preloadedConfig: LoadedComputeConfig | null,
): Promise<{ result: ServiceDeployResult; diagnostics: Diagnostic[] }> {
  const envProjectId = readServiceEnvOverride(ctx, PRISMA_PROJECT_ID_ENV_VAR);
  const envServiceId = readServiceEnvOverride(ctx, PRISMA_SERVICE_ID_ENV_VAR);
  assertExclusiveProjectInputs({
    projectRef: inputs.projectRef,
    createProjectName: inputs.createProjectName,
    envProjectId,
  });

  const compute = await resolveComputeTarget(
    ctx,
    inputs.configTarget,
    "deploy",
    {
      preloaded: preloadedConfig,
    },
  );
  const merged = mergeComputeDeployInputs({
    cli: {
      ...(inputs.framework !== undefined
        ? { framework: inputs.framework }
        : {}),
      ...(inputs.entrypoint !== undefined
        ? { entrypoint: inputs.entrypoint }
        : {}),
      ...(inputs.httpPort !== undefined ? { httpPort: inputs.httpPort } : {}),
      ...(inputs.region !== undefined ? { region: inputs.region } : {}),
      ...(inputs.envAssignments.length > 0
        ? { envInputs: inputs.envAssignments }
        : {}),
    },
    target: compute.target,
    configFilename:
      compute.config?.relativeConfigPath ?? COMPUTE_CONFIG_FILENAME,
  });

  const serviceDir = await resolveServiceDirectory(ctx, compute);
  // The compute config marks the project root: the Project binding and other
  // repo-level concerns live next to the config, not wherever deploy ran.
  const projectDir = compute.config?.configDir ?? ctx.cwd;

  const skipLocalPin = Boolean(
    envProjectId || inputs.projectRef || inputs.createProjectName,
  );
  const localPinRead = skipLocalPin
    ? null
    : await readLocalResolutionPin(projectDir, ctx.signal);
  if (localPinRead?.isErr()) {
    // An unreadable or malformed pin is reported as a stale binding; an
    // aborted read is the signal firing and propagates as-is.
    ctx.signal.throwIfAborted();
    throw localResolutionPinStaleError(LOCAL_RESOLUTION_PIN_RELATIVE_PATH);
  }
  const localPin = localPinRead?.isOk()
    ? localPinRead.value
    : ({ kind: "missing" } as const);

  const branch = await resolveDeployBranch(ctx, inputs.branchName);
  if (merged.httpPort) {
    parseHttpPort(merged.httpPort.value);
  }
  const deployRegion = normalizeRegionInput(merged.region);
  if (merged.framework?.value) {
    assertSupportedEntrypoint(
      frameworkFromUserFacingValue(merged.framework.value, "set by --framework")
        .buildType,
      merged.entrypoint?.value,
    );
  }

  const workspace = await requireWorkspace(ctx);
  const provider = serviceProvider(ctx);
  const projects = await listWorkspaceProjects(ctx, workspace.id);

  let target: ResolvedDeployProjectContext;
  try {
    target = await resolveDeployProjectContext(
      ctx,
      provider,
      workspace,
      projects,
      {
        explicitProject: inputs.projectRef,
        createProjectName: inputs.createProjectName,
        createProjectRegion: deployRegion?.value,
        envProjectId,
        localPin,
        branch,
      },
    );
  } catch (error) {
    throw await asProjectSetupRequired(ctx, error, projects);
  }
  const projectId = target.project.id;

  let localPinResult: { path: string; written: true } | undefined;
  if (target.localPinAction) {
    const bound = await bindProjectToDirectory(
      legacyBindContext(ctx),
      workspace,
      target.project,
      target.localPinAction,
      projectDir,
    );
    if (bound.isErr()) {
      throw new CliStructuredError(
        "SERVICE.LOCAL_STATE_WRITE_FAILED",
        "Could not write the local Project binding",
        {
          why: String(bound.error),
          nextActions: [
            adviceAction(
              "Check write permissions for the .prisma directory, then rerun deploy.",
            ),
          ],
          cause: bound.error,
        },
      );
    }
    localPinResult = bound.value.localPin;
    ctx.report({
      kind: "message",
      severity: "info",
      text: `Linked "${bound.value.directory}" to Project "${target.project.name}" (saved ${bound.value.localPin.path})`,
    });
  }

  let framework = await resolveDeployFramework(ctx, {
    requestedFramework: merged.framework?.value,
    requestedFrameworkAnnotation: merged.framework?.annotation,
    entrypoint: merged.entrypoint?.value,
    entrypointAnnotation: merged.entrypoint?.annotation,
    serviceDir,
  });
  let runtime = resolveDeployRuntime(
    merged.httpPort?.value,
    merged.httpPort?.annotation,
    framework,
    DEFAULT_HTTP_PORT,
  );
  assertSupportedEntrypoint(framework.buildType, merged.entrypoint?.value);

  const envVars = toOptionalEnvVars(
    // Config env file paths resolve from the config directory; --env flag
    // paths resolve from where the command ran.
    await parseEnvInputs(
      merged.envInputsFromConfig ? projectDir : ctx.cwd,
      merged.envInputs,
      { commandName: "deploy" },
    ).catch((error) => {
      throw fromLegacyCliError(error);
    }),
  );

  const services = await listServices(
    ctx,
    provider,
    projectId,
    target.branch.name,
  );
  const selected = await resolveDeployServiceSelection(
    ctx,
    projectId,
    services,
    {
      explicitServiceName: inputs.serviceName,
      explicitServiceId: envServiceId,
      configServiceName: merged.configAppName,
      requestedRegion: deployRegion,
      firstDeploy: Boolean(target.localPinAction),
      inferName: () => projectSetupSuggestion(serviceDir, ctx.signal),
      envVarName: PRISMA_SERVICE_ID_ENV_VAR,
    },
  );

  ctx.report({
    kind: "message",
    severity: "info",
    text: `Deploying to ${target.project.name} / ${target.branch.name} / ${selected.displayName}`,
  });

  const customized = await maybeCustomizeDeploySettings(ctx, {
    framework,
    runtime,
    firstDeploy: selected.firstDeploy,
    explicitFramework: Boolean(merged.framework),
    explicitEntrypoint: Boolean(merged.entrypoint),
    explicitHttpPort: Boolean(merged.httpPort),
  });
  framework = customized.framework;
  runtime = customized.runtime;

  // A promotionless deploy never replaces the live deployment, so the
  // production protection does not apply.
  const production = inputs.noPromote
    ? { firstProductionDeploy: false }
    : await enforceProductionDeploy(ctx, provider, {
        serviceId: selected.serviceId,
        serviceName: selected.displayName,
        branchKind: target.branch.kind,
        prod: inputs.prod,
      });

  // Customization can switch to a framework that derives its entrypoint from
  // build output, so --entry is validated again after it.
  const buildType = framework.buildType;
  assertSupportedEntrypoint(buildType, merged.entrypoint?.value);
  const entrypoint = await resolveDeployEntrypoint(
    serviceDir,
    framework,
    merged.entrypoint?.value,
    ctx.signal,
  );
  const buildSettings = await resolveDeployBuildSettings({
    compute,
    serviceDir,
    buildType,
    signal: ctx.signal,
  });
  const legacySettingsAdvice = await inspectLegacyBuildSettings(
    serviceDir,
    buildSettings.settings,
    ctx.signal,
  );

  const branchDatabase = await maybeSetupBranchDatabase(
    ctx,
    provider,
    projectId,
    requireRemoteBranch(target),
    {
      db: inputs.db,
      providedEnvVars: envVars,
      firstProductionDeploy: production.firstProductionDeploy,
      projectDir,
    },
  );

  const progressState: DeployProgressState = {
    buildStarted: false,
    buildCompleted: false,
    archiveReady: false,
    uploadCompleted: false,
    deploymentId: null,
    containerLive: false,
    deploymentUrl: null,
  };
  const portMapping: PortMapping = { http: runtime.port };
  const startedAt = Date.now();
  const deployed = await provider
    .deployApp({
      cwd: serviceDir,
      projectId,
      branchName: target.branch.name,
      ...(selected.serviceId !== undefined
        ? { appId: selected.serviceId }
        : {}),
      ...(selected.serviceName !== undefined
        ? { appName: selected.serviceName }
        : {}),
      ...(selected.region !== undefined ? { region: selected.region } : {}),
      ...(entrypoint !== undefined ? { entrypoint } : {}),
      buildType,
      buildSettings: buildSettings.settings,
      portMapping,
      ...(envVars !== undefined ? { envVars } : {}),
      skipPromote: inputs.noPromote,
      signal: ctx.signal,
      progress: deployProgressReporter(ctx, progressState),
    })
    .catch((error) => {
      throw serviceDeployFailedError(error, progressState);
    });
  const durationMs = Date.now() - startedAt;

  const stateStore = await openServiceStateStore(ctx);
  await stateStore.setSelectedApp(projectId, {
    id: deployed.app.id,
    name: deployed.app.name,
  });
  // With --no-promote the live deployment is unchanged, so the actually-live
  // id is cached (never the un-promoted candidate).
  const knownLiveDeploymentId = deployed.promoted
    ? deployed.deployment.id
    : deployed.app.liveDeploymentId;
  if (knownLiveDeploymentId) {
    await stateStore.setKnownLiveDeployment(
      projectId,
      deployed.app.id,
      knownLiveDeploymentId,
    );
  }

  const result: ServiceDeployResult = {
    workspace: target.workspace,
    project: target.project,
    branch: target.branch,
    resolution: target.resolution,
    ...(branchDatabase.result ? { branchDatabase: branchDatabase.result } : {}),
    service: { id: deployed.app.id, name: deployed.app.name },
    deployment: deployed.deployment,
    promoted: deployed.promoted,
    deploySettings: {
      config: {
        // The compute config in effect, even when it has no build block, so
        // `path: null` means "no config loaded" rather than "no build-settings
        // block".
        path: compute.config?.relativeConfigPath ?? null,
        status: buildSettings.status,
      },
      buildCommand: {
        value: buildSettings.settings.buildCommand,
        source: buildSettings.settings.buildCommandSource,
      },
      outputDirectory: {
        value: buildSettings.settings.outputDirectory,
        source: buildSettings.settings.outputDirectorySource,
      },
      framework: {
        key: framework.key,
        buildType,
        name: framework.displayName,
        source: framework.annotation,
      },
      entrypoint: entrypoint ?? buildSettings.settings.entrypoint ?? null,
      httpPort: runtime.port,
      region: deployed.app.region ?? selected.region ?? null,
      regionSource: deployRegion?.annotation ?? null,
      envVars: envVarNames(envVars),
    },
    durationMs,
    ...(localPinResult ? { localPin: localPinResult } : {}),
  };

  return {
    result,
    diagnostics: [
      ...legacySettingsAdvice.map(
        (summary): Diagnostic => ({
          code: "SERVICE.BUILD_SETTINGS_LEGACY",
          severity: "warn",
          summary,
          nextActions: [],
        }),
      ),
      ...branchDatabase.diagnostics,
    ],
  };
}

function requireRemoteBranch(target: ResolvedDeployProjectContext): {
  id: string;
  name: string;
  kind: "production" | "preview";
} {
  if (!target.branch.id) {
    throw new Error(
      `Deploy branch "${target.branch.name}" was not resolved remotely.`,
    );
  }
  return {
    id: target.branch.id,
    name: target.branch.name,
    kind: target.branch.kind,
  };
}

function toOptionalEnvVars(
  envVars: Record<string, string>,
): Record<string, string> | undefined {
  return Object.keys(envVars).length > 0 ? envVars : undefined;
}

/**
 * An unlinked directory that cannot be asked which Project to use is the
 * legacy PROJECT_SETUP_REQUIRED case: the candidates and the create
 * suggestion an agent needs are reported instead of the bare prompt failure.
 */
async function asProjectSetupRequired(
  ctx: ServiceContext,
  error: unknown,
  projects: ProjectCandidate[],
): Promise<unknown> {
  if (
    CliStructuredError.is(error) &&
    (error.code === "CLI.PROMPT_REQUIRED" ||
      error.code === "CLI.PROMPT_INVALID")
  ) {
    return projectSetupRequiredError(
      projects.map((project) => ({ id: project.id, name: project.name })),
      await projectSetupSuggestion(ctx.cwd, ctx.signal),
    );
  }
  return error;
}

/* ------------------------------------------------------------ deploy all */

async function deployAllServices(
  ctx: ServiceContext,
  config: LoadedComputeConfig,
  plannedTargets: PlannedDeployTarget[],
  inputs: DeployInputs,
): Promise<{ result: ServiceDeployAllResult; diagnostics: Diagnostic[] }> {
  const used = perAppInputsForDeployAll({
    appName: inputs.serviceName,
    framework: inputs.framework,
    entrypoint: inputs.entrypoint,
    httpPort: inputs.httpPort,
    region: inputs.region,
    envAssignments:
      inputs.envAssignments.length > 0 ? inputs.envAssignments : undefined,
    appIdEnvVar: {
      name: PRISMA_SERVICE_ID_ENV_VAR,
      value: readServiceEnvOverride(ctx, PRISMA_SERVICE_ID_ENV_VAR),
    },
  });
  if (used.length > 0) {
    const targetKeys = plannedTargets.map((target) => target.targetKey);
    throw new CliStructuredError(
      "SERVICE.DEPLOY_ALL_INPUTS_REJECTED",
      `Deploying all services does not accept ${renameServiceFlags(used).join(", ")}`,
      {
        why: `Without a target, service deploy deploys every configured service (${targetKeys.join(", ")}), so per-service inputs are ambiguous.`,
        nextActions: [
          adviceAction(
            "Pass the service target to apply per-service inputs to one service, or remove them to deploy all services.",
          ),
          ...targetKeys.map((target) =>
            runCommandAction(`Deploy ${target}`, `service deploy ${target}`),
          ),
        ],
      },
    );
  }

  const deployments: ServiceDeployAllResult["deployments"] = [];
  const diagnostics: Diagnostic[] = [];
  for (const planned of plannedTargets) {
    ctx.report({
      kind: "step-started",
      step: "target",
      id: planned.targetKey,
      data: { index: planned.index, total: planned.total },
    });
    // --create-project binds once: after the first target writes the local
    // pin, the rest resolve the Project (and its --db branch database)
    // through it.
    const targetInputs: DeployInputs = {
      ...inputs,
      configTarget: planned.targetKey,
      createProjectName: planned.bindsCreateProject
        ? inputs.createProjectName
        : undefined,
    };
    let single: Awaited<ReturnType<typeof deploySingleService>>;
    try {
      // biome-ignore lint/performance/noAwaitInLoops: deploy-all runs in order so --create-project writes the local pin before later targets resolve it.
      single = await deploySingleService(ctx, targetInputs, config);
    } catch (error) {
      ctx.report({
        kind: "step-finished",
        step: "target",
        id: planned.targetKey,
        outcome: "failed",
      });
      throw deployAllFailure(error, plannedTargets, planned.index, deployments);
    }
    ctx.report({
      kind: "step-finished",
      step: "target",
      id: planned.targetKey,
      outcome: "ok",
    });
    deployments.push({ target: planned.targetKey, result: single.result });
    diagnostics.push(...single.diagnostics);
  }

  return { result: { deployments }, diagnostics };
}

function renameServiceFlags(used: string[]): string[] {
  return used.map((flagName) =>
    flagName === "--app" ? "--service" : flagName,
  );
}

function deployAllFailure(
  error: unknown,
  plannedTargets: PlannedDeployTarget[],
  failedIndex: number,
  deployments: ServiceDeployAllResult["deployments"],
): unknown {
  if (!CliStructuredError.is(error)) {
    return error;
  }
  const failure = describeDeployAllFailure({
    targetKeys: plannedTargets.map((target) => target.targetKey),
    failedIndex,
    completed: deployments.map(({ target, result }) => ({
      target,
      deploymentId: result.deployment.id,
      url: result.deployment.url,
    })),
  });
  return new CliStructuredError(error.code, error.message, {
    ...(error.why
      ? { why: `${error.why} ${failure.contextLines.join(" ")}` }
      : { why: failure.contextLines.join(" ") }),
    nextActions: error.nextActions,
    ...(error.where ? { where: error.where } : {}),
    meta: {
      ...error.meta,
      deployAll: {
        failedTarget: failure.failedTarget,
        completed: failure.completed,
        notAttempted: failure.notAttempted,
      },
    },
    cause: error,
  });
}

/* ---------------------------------------------------------------- command */

export const serviceDeployCommand = defineCommand({
  help: {
    summary: "Create a new deployment for the service",
    examples: [
      "service deploy",
      "service deploy --prod --confirm my-service",
      "service deploy --branch preview-1 --db",
    ],
  },
  args: {
    flags: {
      service: flag.string({
        brief: "Service name (created when it does not exist)",
        placeholder: "name",
      }),
      project: flag.string({
        brief: "Project id or name",
        placeholder: "id-or-name",
      }),
      createProject: flag.string({
        brief: "Create and link a Project before deploying",
        placeholder: "name",
      }),
      branch: flag.string({
        brief: "Branch to deploy (default: the local Git branch)",
        placeholder: "name",
      }),
      framework: flag.enum({
        brief: "Framework to build with",
        values: FRAMEWORK_KEYS as [string, ...string[]],
      }),
      entry: flag.string({
        brief: "Entrypoint path for Bun services",
        placeholder: "path",
      }),
      httpPort: flag.string({
        brief: "HTTP port the service listens on",
        placeholder: "port",
      }),
      region: flag.string({
        brief: "Region for a newly created service",
        placeholder: "region",
      }),
      env: flag.repeated({
        brief: "Env var assignment (NAME=value) or dotenv file path",
        placeholder: "assignment-or-file",
      }),
      db: flag.boolean({
        brief:
          "Create and wire a branch database (--no-db leaves the decision to the database-signal prompt)",
      }),
      prod: flag.boolean({
        brief: "Confirm intent to replace the live production deployment",
      }),
      noPromote: flag.boolean({
        brief: "Build a deployment without promoting it",
      }),
    },
    positionals: {
      service: positional.optionalString({
        brief:
          "Service target from prisma.compute.ts; omit it to deploy every target",
        placeholder: "service",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const inputs: DeployInputs = {
      serviceName: args.flags.service,
      projectRef: args.flags.project,
      createProjectName: args.flags.createProject,
      branchName: args.flags.branch,
      framework: args.flags.framework,
      entrypoint: args.flags.entry,
      httpPort: args.flags.httpPort,
      region: args.flags.region,
      envAssignments: [...(args.flags.env ?? [])],
      prod: args.flags.prod,
      noPromote: args.flags.noPromote,
      // The engine's boolean flag is two-state (--no-db is its negation and
      // reads the same as absent), so an explicit opt-out cannot be told
      // apart from the default: both take the signal-driven prompt path,
      // whose default answer is No. Recorded as a divergence + engine gap.
      db: args.flags.db ? true : undefined,
      configTarget: args.positionals.service,
    };

    const loaded = await loadComputeConfig(ctx.cwd, ctx.signal);
    if (loaded.isErr()) {
      throw fromLegacyCliError(
        computeConfigErrorToCliError(loaded.error, "deploy"),
      );
    }
    const config = loaded.value;
    const requestedTarget =
      inputs.configTarget ??
      (config ? inferComputeTargetFromCwd(config, ctx.cwd) : undefined);
    const plan = planAppDeploy({
      config,
      requestedTarget,
      hasCreateProject: inputs.createProjectName !== undefined,
    });

    if (plan.mode === "all" && config) {
      const all = await deployAllServices(ctx, config, plan.targets, inputs);
      return ok(
        ctx.present(
          { data: all.result, diagnostics: all.diagnostics },
          deployAllPresentations(all.result),
        ),
      );
    }

    const single = await deploySingleService(ctx, inputs, config);
    return ok(
      ctx.present(
        { data: single.result, diagnostics: single.diagnostics },
        deployPresentations(single.result),
      ),
    );
  },
});
