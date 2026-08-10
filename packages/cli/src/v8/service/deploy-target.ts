import { access } from "node:fs/promises";
import path from "node:path";
import {
  COMPUTE_REGIONS,
  type ComputeFramework,
  ENTRYPOINT_BUILD_TYPES,
  FRAMEWORKS,
  type FrameworkBuildType,
  frameworkFromAlias,
  isConfigBackedBuildType,
} from "@prisma/compute-sdk/config";
import { detectComputeAppFromDirectory } from "@prisma/compute-sdk/config/directory";
import type { AppProvider, AppRecord } from "../../lib/app/app-provider";
import {
  type AppBuildSettings,
  type AppBuildSettingsResolution,
  detectLegacyBuildSettings,
  PRISMA_APP_CONFIG_FILENAME,
  resolveConfiguredAppBuildSettings,
  resolveInferredAppBuildSettings,
} from "../../lib/app/build";
import {
  readBunPackageEntrypoint,
  readBunPackageJson,
} from "../../lib/app/bun-project";
import {
  COMPUTE_CONFIG_FILENAME,
  type ComputeDeployTarget,
  computeTargetAppDir,
  type LoadedComputeConfig,
  type MergedDeployInput,
} from "../../lib/app/compute-config";
import { readLocalGitBranch } from "../../lib/git/local-branch";
import {
  LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
  type LocalResolutionPinReadResult,
} from "../../lib/project/local-pin";
import {
  type InferredTargetName,
  inferTargetName,
  projectNotFoundError as legacyProjectNotFoundError,
  localProjectWorkspaceMismatchError,
  type ProjectCandidate,
  sortProjects,
} from "../../lib/project/resolution";
import {
  formatCommandArgument,
  projectCreateFailedError,
  projectSetupNameRequiredError,
  resolveProjectForSetup,
  toProjectSummary,
  validateProjectSetupNameText,
} from "../../lib/project/setup";
import { CliError } from "../../shell/errors";
import type { AuthWorkspace } from "../../types/auth";
import type { ProjectResolution, ProjectSummary } from "../../types/project";
import {
  adviceAction,
  buildSettingsMigrationRequiredError,
  buildSettingsUnsupportedError,
  computeConfigInvalidError,
  deployEntrypointUnsupportedError,
  deployFrameworkNotDetectedError,
  deployServiceEnvMissingError,
  fromLegacyCliError,
  httpPortInvalidError,
  localResolutionPinStaleError,
  projectInputsAmbiguousError,
  projectNameInvalidError,
  regionInvalidError,
  regionMismatchError,
  runCommandAction,
  userCancelledError,
} from "./errors";
import type { ServiceContext } from "./target";
import { PRISMA_PROJECT_ID_ENV_VAR, toBranchKind } from "./target";

const COMPUTE_REGION_IDS = new Set<string>(COMPUTE_REGIONS);

export interface ResolvedDeployBranch {
  name: string;
  annotation: string;
}

export interface ResolvedDeployFramework {
  key: string;
  buildType: FrameworkBuildType;
  displayName: string;
  annotation: string;
}

export interface ResolvedDeployRuntime {
  port: number;
  annotation: string;
}

export interface ResolvedDeployProjectContext {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  branch: { id: string | null; name: string; kind: "production" | "preview" };
  resolution: ProjectResolution;
  localPinAction?: "created" | "linked";
}

export function assertExclusiveProjectInputs(options: {
  projectRef: string | undefined;
  createProjectName: string | undefined;
  envProjectId: string | undefined;
}): void {
  const provided = [
    options.projectRef ? "--project" : null,
    options.createProjectName ? "--create-project" : null,
    options.envProjectId ? PRISMA_PROJECT_ID_ENV_VAR : null,
  ].filter((value): value is string => Boolean(value));
  if (provided.length > 1) {
    throw projectInputsAmbiguousError(provided);
  }
}

export async function resolveDeployBranch(
  ctx: ServiceContext,
  explicitBranchName: string | undefined,
): Promise<ResolvedDeployBranch> {
  if (explicitBranchName) {
    return { name: explicitBranchName, annotation: "set by --branch" };
  }
  const gitBranch = await readLocalGitBranch(ctx.cwd, ctx.signal);
  return gitBranch
    ? { name: gitBranch, annotation: "from local Git branch" }
    : { name: "main", annotation: "default" };
}

export function parseHttpPort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw httpPortInvalidError(value);
  }
  return port;
}

export function normalizeRegionInput(
  region: MergedDeployInput | undefined,
): MergedDeployInput | undefined {
  if (!region) {
    return undefined;
  }
  const value = region.value.trim();
  if (value.length === 0) {
    throw regionInvalidError(region.annotation, COMPUTE_REGIONS, true);
  }
  if (!COMPUTE_REGION_IDS.has(value)) {
    throw regionInvalidError(region.annotation, COMPUTE_REGIONS, false);
  }
  return { ...region, value };
}

export async function resolveServiceDirectory(
  ctx: ServiceContext,
  compute: {
    config: LoadedComputeConfig | null;
    target: ComputeDeployTarget | null;
  },
): Promise<string> {
  if (!compute.config || !compute.target) {
    return ctx.cwd;
  }
  const serviceDir = computeTargetAppDir(compute.config, compute.target);
  if (!compute.target.root) {
    return serviceDir;
  }

  ctx.signal.throwIfAborted();
  try {
    // access does not accept AbortSignal; check before and after the boundary.
    await access(serviceDir);
    ctx.signal.throwIfAborted();
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    throw computeConfigInvalidError({
      summary: `Service root "${compute.target.root}" does not exist`,
      why: `${compute.config.relativeConfigPath} points the selected service at "${compute.target.root}", but that directory does not exist.`,
      where: serviceDir,
      meta: { serviceRoot: compute.target.root, serviceDir },
      advice: `Fix the root path in ${compute.config.relativeConfigPath} or create the directory.`,
    });
  }
  return serviceDir;
}

/* ---------------------------------------------------------------- project */

export async function resolveDeployProjectContext(
  ctx: ServiceContext,
  provider: AppProvider,
  workspace: AuthWorkspace,
  projects: ProjectCandidate[],
  options: {
    explicitProject: string | undefined;
    createProjectName: string | undefined;
    createProjectRegion: string | undefined;
    envProjectId: string | undefined;
    localPin: LocalResolutionPinReadResult;
    branch: ResolvedDeployBranch;
  },
): Promise<ResolvedDeployProjectContext> {
  const withBranch = async (
    target: Omit<ResolvedDeployProjectContext, "branch">,
  ): Promise<ResolvedDeployProjectContext> => {
    const remoteBranch = await provider.resolveBranch(target.project.id, {
      branchName: options.branch.name,
      signal: ctx.signal,
    });
    return {
      ...target,
      branch: {
        id: remoteBranch.id,
        name: remoteBranch.name,
        kind: remoteBranch.role,
      },
    };
  };

  if (options.explicitProject) {
    let project: ProjectCandidate;
    try {
      project = resolveProjectForSetup(
        options.explicitProject,
        projects,
        workspace,
      );
    } catch (error) {
      throw asStructured(error);
    }
    return withBranch({
      workspace,
      project: toProjectSummary(project),
      resolution: {
        projectSource: "explicit",
        targetName: options.explicitProject,
        targetNameSource: "explicit",
      },
      localPinAction: "linked",
    });
  }

  if (options.createProjectName) {
    const projectName = options.createProjectName.trim();
    if (!projectName) {
      throw fromLegacyCliError(
        projectSetupNameRequiredError("service deploy --create-project"),
      );
    }
    const created = await createProjectForDeploy(
      ctx,
      provider,
      projectName,
      workspace,
      options.createProjectRegion,
    );
    return withBranch({
      workspace,
      project: toProjectSummary(created),
      resolution: {
        projectSource: "created",
        targetName: projectName,
        targetNameSource: "explicit",
      },
      localPinAction: "created",
    });
  }

  if (options.envProjectId) {
    const project = projects.find(
      (candidate) => candidate.id === options.envProjectId,
    );
    if (!project) {
      throw asStructured(
        legacyProjectNotFoundError(options.envProjectId, workspace),
      );
    }
    return withBranch({
      workspace,
      project: toProjectSummary(project),
      resolution: {
        projectSource: "env",
        targetName: options.envProjectId,
        targetNameSource: "env",
      },
    });
  }

  if (options.localPin.kind === "present") {
    const pin = options.localPin.pin;
    if (pin.workspaceId !== workspace.id) {
      throw fromLegacyCliError(
        localProjectWorkspaceMismatchError({
          pinnedWorkspaceId: pin.workspaceId,
          pinnedProjectId: pin.projectId,
          activeWorkspace: workspace,
        }),
      );
    }
    const project = projects.find(
      (candidate) => candidate.id === pin.projectId,
    );
    if (!project) {
      throw localResolutionPinStaleError(LOCAL_RESOLUTION_PIN_RELATIVE_PATH);
    }
    return withBranch({
      workspace,
      project: toProjectSummary(project),
      resolution: {
        projectSource: "local-pin",
        targetName: project.name,
        targetNameSource: "local-pin",
      },
    });
  }

  const setup = await promptForProjectSetup(
    ctx,
    provider,
    workspace,
    projects,
    options.createProjectRegion,
  );
  return withBranch(setup);
}

/** Legacy project-resolution helpers throw CliError; the engine wants the
 *  structured form. */
function asStructured(error: unknown): unknown {
  return error instanceof CliError ? fromLegacyCliError(error) : error;
}

async function createProjectForDeploy(
  ctx: ServiceContext,
  provider: AppProvider,
  projectName: string,
  workspace: AuthWorkspace,
  region: string | undefined,
): Promise<ProjectCandidate> {
  const created = await provider
    .createProject({
      name: projectName,
      ...(region !== undefined ? { region } : {}),
      signal: ctx.signal,
    })
    .catch((error) => {
      throw fromLegacyCliError(
        projectCreateFailedError(error, projectName, workspace, {
          nextSteps: [
            "prisma-cli project list",
            "prisma-cli app deploy --project <id-or-name>",
            `prisma-cli app deploy --create-project ${formatCommandArgument(projectName)}`,
          ],
          permissionFix:
            "Choose an existing Project with --project, or grant the token permission to create Projects in this workspace.",
          fallbackFix:
            "Choose an existing Project with --project, or retry after addressing the platform error above.",
        }),
      );
    });
  return {
    id: created.id,
    name: created.name,
    ...(created.defaultRegion != null
      ? { defaultRegion: created.defaultRegion }
      : {}),
    workspace,
  };
}

/**
 * The interactive Project setup for an unlinked directory. Non-interactive
 * runs never reach a choice: the engine prompt settles them with its
 * structural prompt failure, which replaces the legacy
 * PROJECT_SETUP_REQUIRED error for that case.
 */
async function promptForProjectSetup(
  ctx: ServiceContext,
  provider: AppProvider,
  workspace: AuthWorkspace,
  projects: ProjectCandidate[],
  createProjectRegion: string | undefined,
): Promise<Omit<ResolvedDeployProjectContext, "branch">> {
  const sorted = sortProjects(projects);
  const names = sorted.map((project) => project.name);
  const duplicates = new Set(
    names.filter((name, index) => names.indexOf(name) !== index),
  );
  const choice = await ctx.prompt.select(
    "Which Project should this directory use?",
    [
      { value: "__create__", label: "+ Create a new Project" },
      ...sorted.map((project) => ({
        value: project.id,
        label: duplicates.has(project.name)
          ? `${project.name} (${project.id})`
          : project.name,
      })),
      { value: "__cancel__", label: "Cancel" },
    ],
  );

  if (choice === "__cancel__") {
    throw userCancelledError("Project setup canceled");
  }

  if (choice !== "__create__") {
    const project = sorted.find((candidate) => candidate.id === choice);
    if (!project) {
      throw userCancelledError("Project setup canceled");
    }
    return {
      workspace,
      project: toProjectSummary(project),
      resolution: {
        projectSource: "prompt",
        targetName: project.name,
        targetNameSource: "prompt",
      },
      localPinAction: "linked",
    };
  }

  const suggestedName = await inferTargetName(ctx.cwd, ctx.signal);
  const rawName = await ctx.prompt.text("Project name", {
    placeholder: suggestedName.name,
    default: suggestedName.name,
  });
  const invalid = validateProjectSetupNameText(rawName, suggestedName.name);
  if (invalid) {
    throw projectNameInvalidError(invalid);
  }
  const projectName = rawName.trim() || suggestedName.name;
  const created = await createProjectForDeploy(
    ctx,
    provider,
    projectName,
    workspace,
    createProjectRegion,
  );
  return {
    workspace,
    project: toProjectSummary(created),
    resolution: {
      projectSource: "created",
      targetName: projectName,
      targetNameSource: rawName.trim() ? "prompt" : suggestedName.source,
    },
    localPinAction: "created",
  };
}

export function projectSetupSuggestion(
  cwd: string,
  signal: AbortSignal,
): Promise<InferredTargetName> {
  return inferTargetName(cwd, signal);
}

/* --------------------------------------------------------------- service */

export interface DeployServiceSelection {
  serviceId?: string;
  serviceName?: string;
  region?: string;
  displayName: string;
  annotation: string;
  firstDeploy: boolean;
}

export async function resolveDeployServiceSelection(
  ctx: ServiceContext,
  projectId: string,
  services: AppRecord[],
  options: {
    explicitServiceName: string | undefined;
    explicitServiceId: string | undefined;
    configServiceName: MergedDeployInput | undefined;
    requestedRegion: MergedDeployInput | undefined;
    firstDeploy: boolean;
    inferName: () => Promise<InferredTargetName>;
    envVarName: string;
  },
): Promise<DeployServiceSelection> {
  const newServiceRegion = options.requestedRegion?.value;

  if (options.explicitServiceName) {
    return selectByName(ctx, services, {
      name: options.explicitServiceName,
      matchedAnnotation: "set by --service",
      newAnnotation: "set by --service",
      requestedRegion: options.requestedRegion,
      newServiceRegion,
      firstDeploy: options.firstDeploy,
    });
  }

  if (options.explicitServiceId) {
    const matched = services.find(
      (service) => service.id === options.explicitServiceId,
    );
    if (!matched) {
      throw deployServiceEnvMissingError(
        options.envVarName,
        options.explicitServiceId,
        projectId,
      );
    }
    assertRegionMatches(matched, options.requestedRegion);
    return {
      serviceId: matched.id,
      displayName: matched.name,
      annotation: `from ${options.envVarName}`,
      firstDeploy: options.firstDeploy,
    };
  }

  if (options.configServiceName) {
    return selectByName(ctx, services, {
      name: options.configServiceName.value,
      matchedAnnotation: options.configServiceName.annotation,
      newAnnotation: options.configServiceName.annotation,
      requestedRegion: options.requestedRegion,
      newServiceRegion,
      firstDeploy: options.firstDeploy,
    });
  }

  const inferred = await options.inferName();
  return selectByName(ctx, services, {
    name: inferred.name,
    matchedAnnotation: "existing service on this branch",
    newAnnotation:
      inferred.source === "package-name"
        ? "created from package.json"
        : "created from directory name",
    requestedRegion: options.requestedRegion,
    newServiceRegion,
    firstDeploy: options.firstDeploy,
  });
}

async function selectByName(
  ctx: ServiceContext,
  services: AppRecord[],
  options: {
    name: string;
    matchedAnnotation: string;
    newAnnotation: string;
    requestedRegion: MergedDeployInput | undefined;
    newServiceRegion: string | undefined;
    firstDeploy: boolean;
  },
): Promise<DeployServiceSelection> {
  const matches = services.filter((service) => service.name === options.name);

  if (matches.length > 1) {
    return resolveAmbiguousService(ctx, matches, options);
  }

  const matched = matches[0];
  if (matched) {
    assertRegionMatches(matched, options.requestedRegion);
    return {
      serviceId: matched.id,
      displayName: matched.name,
      annotation: options.matchedAnnotation,
      firstDeploy: options.firstDeploy,
    };
  }

  return {
    serviceName: options.name,
    ...(options.newServiceRegion !== undefined
      ? { region: options.newServiceRegion }
      : {}),
    displayName: options.name,
    annotation: options.newAnnotation,
    firstDeploy: options.firstDeploy,
  };
}

async function resolveAmbiguousService(
  ctx: ServiceContext,
  matches: AppRecord[],
  options: {
    name: string;
    requestedRegion: MergedDeployInput | undefined;
    newServiceRegion: string | undefined;
    firstDeploy: boolean;
  },
): Promise<DeployServiceSelection> {
  // A non-interactive run cannot choose: the engine prompt settles it with
  // its structural prompt failure, which replaces the legacy APP_AMBIGUOUS
  // error (same rule the D1 service picker follows).
  const selected = await ctx.prompt.select(
    `Multiple services are named "${options.name}"`,
    [
      ...matches
        .slice()
        .sort(
          (left, right) =>
            left.name.localeCompare(right.name) ||
            left.id.localeCompare(right.id),
        )
        .map((service) => ({
          value: service.id,
          label: `${service.name} (${service.id})`,
        })),
      {
        value: "__create__",
        label: `Create a new service named "${options.name}"`,
      },
      { value: "__cancel__", label: "Cancel" },
    ],
  );

  if (selected === "__cancel__") {
    throw userCancelledError("Service selection canceled");
  }
  if (selected === "__create__") {
    return {
      serviceName: options.name,
      ...(options.newServiceRegion !== undefined
        ? { region: options.newServiceRegion }
        : {}),
      displayName: options.name,
      annotation: "created from package.json",
      firstDeploy: options.firstDeploy,
    };
  }

  const service = matches.find((candidate) => candidate.id === selected);
  if (!service) {
    throw userCancelledError("Service selection canceled");
  }
  assertRegionMatches(service, options.requestedRegion);
  return {
    serviceId: service.id,
    displayName: service.name,
    annotation: "selected by you",
    firstDeploy: options.firstDeploy,
  };
}

function assertRegionMatches(
  service: AppRecord,
  requestedRegion: MergedDeployInput | undefined,
): void {
  if (
    requestedRegion?.annotation !== "set by --region" ||
    !service.region ||
    service.region === requestedRegion.value
  ) {
    return;
  }
  throw regionMismatchError(
    service.name,
    service.region,
    requestedRegion.value,
  );
}

/* ------------------------------------------------------- build settings */

export async function resolveDeployFramework(
  ctx: ServiceContext,
  options: {
    requestedFramework: string | undefined;
    requestedFrameworkAnnotation: string | undefined;
    entrypoint: string | undefined;
    entrypointAnnotation: string | undefined;
    serviceDir: string;
  },
): Promise<ResolvedDeployFramework> {
  if (options.requestedFramework) {
    return frameworkFromUserFacingValue(
      options.requestedFramework,
      options.requestedFrameworkAnnotation ?? "set by --framework",
    );
  }
  if (options.entrypoint) {
    return {
      key: "bun",
      buildType: "bun",
      displayName: "Bun",
      annotation: options.entrypointAnnotation ?? "set by --entry",
    };
  }

  const detected = await detectComputeAppFromDirectory({
    appPath: options.serviceDir,
    signal: ctx.signal,
  });
  if (!detected) {
    throw frameworkNotDetected(options.serviceDir);
  }
  let annotation = "detected from package.json";
  if (detected.configFile?.standaloneOutput) {
    annotation = "standalone output detected";
  } else if (detected.configFile) {
    annotation = `detected from ${path.basename(detected.configFile.path)}`;
  }
  return {
    key: detected.framework,
    buildType: detected.buildType,
    displayName: detected.frameworkName,
    annotation,
  };
}

export function frameworkFromUserFacingValue(
  value: string,
  annotation: string,
): ResolvedDeployFramework {
  const framework = frameworkFromAlias(value);
  if (!framework) {
    throw deployFrameworkNotDetectedError(
      undefined,
      supportedFrameworks(),
      value,
    );
  }
  return {
    key: framework.key,
    buildType: framework.buildType,
    displayName: framework.displayName,
    annotation,
  };
}

function frameworkNotDetected(serviceDir: string) {
  const basename = path.basename(serviceDir);
  return deployFrameworkNotDetectedError(
    basename ? `./${basename}` : ".",
    supportedFrameworks(),
  );
}

function supportedFrameworks(): { displayNames: string[]; keys: string[] } {
  return {
    displayNames: FRAMEWORKS.map((framework) => framework.displayName),
    keys: FRAMEWORKS.map((framework) => framework.key),
  };
}

export const FRAMEWORK_KEYS: readonly string[] = FRAMEWORKS.map(
  (framework) => framework.key,
);

export function resolveDeployRuntime(
  requestedHttpPort: string | undefined,
  requestedHttpPortAnnotation: string | undefined,
  framework: ResolvedDeployFramework,
  defaultPort: number,
): ResolvedDeployRuntime {
  if (requestedHttpPort) {
    return {
      port: parseHttpPort(requestedHttpPort),
      annotation: requestedHttpPortAnnotation ?? "set by --http-port",
    };
  }
  return { port: defaultPort, annotation: `${framework.displayName} default` };
}

export function assertSupportedEntrypoint(
  buildType: FrameworkBuildType | "auto",
  entrypoint: string | undefined,
): void {
  if (
    buildType !== "auto" &&
    !(ENTRYPOINT_BUILD_TYPES as readonly string[]).includes(buildType) &&
    entrypoint
  ) {
    const displayName =
      FRAMEWORKS.find((framework) => framework.buildType === buildType)
        ?.displayName ?? buildType;
    throw deployEntrypointUnsupportedError(displayName, buildType);
  }
}

export async function resolveDeployEntrypoint(
  serviceDir: string,
  framework: ResolvedDeployFramework,
  explicitEntrypoint: string | undefined,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (explicitEntrypoint || framework.buildType !== "bun") {
    return explicitEntrypoint;
  }
  const packageJson = await readBunPackageJson(serviceDir, signal);
  const packageEntrypoint = readBunPackageEntrypoint(packageJson);
  if (packageEntrypoint) {
    return packageEntrypoint;
  }
  const defaultEntrypoint = frameworkFromAlias(
    framework.key,
  )?.defaultEntrypoint;
  if (!defaultEntrypoint) {
    return undefined;
  }

  signal.throwIfAborted();
  try {
    // access does not accept AbortSignal; check before and after the boundary.
    await access(path.join(serviceDir, defaultEntrypoint));
    signal.throwIfAborted();
    return defaultEntrypoint;
  } catch (error) {
    if (signal.aborted) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    return undefined;
  }
}

export async function resolveDeployBuildSettings(options: {
  compute: {
    config: LoadedComputeConfig | null;
    target: ComputeDeployTarget | null;
  };
  serviceDir: string;
  buildType: FrameworkBuildType;
  signal: AbortSignal;
}): Promise<AppBuildSettingsResolution> {
  const { compute, serviceDir, buildType, signal } = options;

  if (compute.target?.build && !isConfigBackedBuildType(buildType)) {
    const displayName =
      FRAMEWORKS.find((framework) => framework.buildType === buildType)
        ?.displayName ?? buildType;
    throw buildSettingsUnsupportedError(displayName, buildType);
  }

  if (
    compute.config &&
    compute.target?.build &&
    isConfigBackedBuildType(buildType)
  ) {
    return resolveConfiguredAppBuildSettings({
      appPath: serviceDir,
      buildType,
      configured: compute.target.build,
      configPath: compute.config.configPath,
      signal,
    });
  }

  return resolveInferredAppBuildSettings({
    appPath: serviceDir,
    buildType,
    signal,
  });
}

/**
 * `prisma.app.json` is no longer read or written. A leftover file that
 * matches the effective settings only warns; one with custom values fails
 * with migration guidance so builds never silently change.
 */
export async function inspectLegacyBuildSettings(
  serviceDir: string,
  effective: AppBuildSettings,
  signal: AbortSignal,
): Promise<string[]> {
  const legacy = await detectLegacyBuildSettings({
    appPath: serviceDir,
    effective,
    signal,
  });

  switch (legacy.kind) {
    case "absent":
      return [];
    case "matching":
      return [
        `${PRISMA_APP_CONFIG_FILENAME} is no longer used and matches the resolved build settings. Delete it.`,
      ];
    case "invalid":
      return [
        `${PRISMA_APP_CONFIG_FILENAME} is no longer used and could not be parsed. Delete it.`,
      ];
    case "custom":
      throw buildSettingsMigrationRequiredError({
        configFilename: PRISMA_APP_CONFIG_FILENAME,
        buildBlock: [
          "build: {",
          `  command: ${legacy.buildCommand === null ? "null" : JSON.stringify(legacy.buildCommand)},`,
          `  outputDirectory: ${JSON.stringify(legacy.outputDirectory)},`,
          "}",
        ].join(" "),
        configPath: legacy.configPath,
        meta: {
          configPath: legacy.configPath,
          buildCommand: legacy.buildCommand,
          outputDirectory: legacy.outputDirectory,
        },
      });
  }
}

export function customizationChoices(): Array<{
  value: ComputeFramework;
  label: string;
}> {
  return FRAMEWORKS.map((framework) => ({
    value: framework.key,
    label: framework.displayName,
  }));
}

export {
  adviceAction,
  COMPUTE_CONFIG_FILENAME,
  runCommandAction,
  toBranchKind,
};
