import type { CommandContext } from "@prisma/cli-engine";
import { LocalStateStore } from "../../adapters/local-state";
import {
  type AppProvider,
  type AppRecord,
  createAppProvider,
  type DomainRecord,
} from "../../lib/app/app-provider";
import {
  COMPUTE_CONFIG_FILENAME,
  ComputeConfigTargetRequiredError,
  type ComputeDeployTarget,
  computeConfigErrorToCliError,
  inferComputeTargetFromCwd,
  type LoadedComputeConfig,
  loadComputeConfig,
  selectComputeDeployTarget,
} from "../../lib/app/compute-config";
import { resolveReadBranch } from "../../lib/app/read-branch";
import { readLocalGitBranch } from "../../lib/git/local-branch";
import {
  type ProjectCandidate,
  projectResolutionErrorToCliError,
  resolveProjectTarget,
  sortProjects,
} from "../../lib/project/resolution";
import type { CommandContext as LegacyCommandContext } from "../../shell/runtime";
import { resolveStateDir } from "../../state-dir";
import type { AuthWorkspace } from "../../types/auth";
import type { BranchKind } from "../../types/branch";
import type { ProjectResolution, ProjectSummary } from "../../types/project";
import {
  branchNotDeployableError,
  configTargetRequiresConfigError,
  deployFailedError,
  domainCommandError,
  domainHostnameInvalidError,
  domainNotFoundError,
  domainTargetRequiredError,
  fromLegacyCliError,
  projectNotFoundError,
  runCommandAction,
  selectedServiceMissingError,
  serviceSelectionInvalidError,
  workspaceRequiredError,
} from "./errors";
import type {
  ServiceDeploymentSummary,
  ServiceDomainSummary,
  ServiceDomainTarget,
  ServiceSummary,
} from "./results";

const PRISMA_PROJECT_ID_ENV_VAR = "PRISMA_PROJECT_ID";
const PRISMA_SERVICE_ID_ENV_VAR = "PRISMA_SERVICE_ID";

export type ServiceContext = Pick<
  CommandContext,
  | "api"
  | "env"
  | "cwd"
  | "signal"
  | "prompt"
  | "report"
  | "openUrl"
  | "activeCredential"
>;

export interface ResolvedServiceProjectContext {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  branch: {
    id: string | null;
    name: string;
    kind: BranchKind;
  };
  resolution: ProjectResolution;
}

export async function openServiceStateStore(
  ctx: ServiceContext,
): Promise<LocalStateStore> {
  const stateDir = await resolveStateDir({
    env: ctx.env,
    cwd: ctx.cwd,
    signal: ctx.signal,
  });
  return new LocalStateStore(stateDir, ctx.signal);
}

/** The workspace the run is acting as, from the credential the engine
 *  is authenticating with. A workspace with no name shows its id
 *  instead: the id is the only other identifier the user can act on,
 *  and every display of this name needs a non-empty string. A
 *  credential that names no workspace at all — an environment token
 *  whose claims carry none — cannot scope these commands, so it is the
 *  same failure as having no credential. */
export async function requireWorkspace(
  ctx: ServiceContext,
): Promise<AuthWorkspace> {
  const credential = await ctx.activeCredential();
  if (!credential?.workspaceId) {
    throw workspaceRequiredError();
  }
  return {
    id: credential.workspaceId,
    name: credential.workspaceName ?? credential.workspaceId,
  };
}

function readServiceEnvOverride(
  ctx: ServiceContext,
  name: string,
): string | undefined {
  const value = ctx.env[name]?.trim();
  return value ? value : undefined;
}

/** The narrow slice of the legacy shell context the reused resolution
 *  operations actually read (cwd + signal). */
function legacyResolutionContext(ctx: ServiceContext): LegacyCommandContext {
  return {
    runtime: { cwd: ctx.cwd, signal: ctx.signal },
  } as unknown as LegacyCommandContext;
}

async function resolveComputeTarget(
  ctx: ServiceContext,
  configTarget: string | undefined,
  commandName: string,
  options?: {
    targetOptional?: boolean;
  },
): Promise<{
  config: LoadedComputeConfig | null;
  target: ComputeDeployTarget | null;
}> {
  const loaded = await loadComputeConfig(ctx.cwd, ctx.signal);
  if (loaded.isErr()) {
    throw fromLegacyCliError(
      computeConfigErrorToCliError(loaded.error, commandName),
    );
  }
  const config = loaded.value;
  if (!config) {
    if (configTarget) {
      throw configTargetRequiresConfigError(
        configTarget,
        COMPUTE_CONFIG_FILENAME,
      );
    }
    return { config: null, target: null };
  }

  const requestedTarget =
    configTarget ?? inferComputeTargetFromCwd(config, ctx.cwd);
  const selected = selectComputeDeployTarget(config, requestedTarget);
  if (selected.isErr()) {
    if (
      options?.targetOptional &&
      selected.error instanceof ComputeConfigTargetRequiredError
    ) {
      return { config, target: null };
    }
    throw fromLegacyCliError(
      computeConfigErrorToCliError(selected.error, commandName),
    );
  }

  return { config, target: selected.value };
}

/**
 * Compute-config context for service management commands: the project
 * directory (where `.prisma/local.json` lives) and the config-selected
 * service name, which ranks below `--service` but above the remembered
 * selection.
 */
export async function resolveComputeManagementContext(
  ctx: ServiceContext,
  configTarget: string | undefined,
  commandName: string,
): Promise<{ projectDir: string; configServiceName: string | undefined }> {
  const compute = await resolveComputeTarget(ctx, configTarget, commandName, {
    targetOptional: true,
  });
  return {
    projectDir: compute.config?.configDir ?? ctx.cwd,
    configServiceName: compute.target?.name ?? compute.target?.key ?? undefined,
  };
}

interface ResolvedReadBranchRequest {
  name: string;
  explicit: boolean;
}

async function resolveRequestedBranch(
  ctx: ServiceContext,
  explicitBranchName: string | undefined,
): Promise<ResolvedReadBranchRequest> {
  if (explicitBranchName) {
    return { name: explicitBranchName, explicit: true };
  }
  const gitBranch = await readLocalGitBranch(ctx.cwd, ctx.signal);
  return { name: gitBranch ?? "main", explicit: false };
}

export function toBranchKind(name: string): BranchKind {
  return name === "production" || name === "main" ? "production" : "preview";
}

/** The same listing `controllers/project.ts#listRealWorkspaceProjects`
 *  performs, on ctx.api — duplicated here so the v8 tree does not drag
 *  the legacy controller import graph (child-process git adapters). */
async function listWorkspaceProjects(
  ctx: ServiceContext,
  workspace: AuthWorkspace,
): Promise<ProjectCandidate[]> {
  const { data } = await ctx.api.GET("/v1/projects", { signal: ctx.signal });
  return sortProjects(
    (data?.data ?? [])
      .filter((project) => project.workspace.id === workspace.id)
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

export async function resolveServiceProjectContext(
  ctx: ServiceContext,
  explicitProject: string | undefined,
  options: {
    commandName: string;
    projectDir?: string;
    branchName?: string;
    envProjectId?: string;
  },
): Promise<ResolvedServiceProjectContext> {
  const workspace = await requireWorkspace(ctx);
  const resolvedResult = await resolveProjectTarget({
    context: legacyResolutionContext(ctx),
    workspace,
    ...(explicitProject !== undefined ? { explicitProject } : {}),
    ...(options.envProjectId !== undefined
      ? { envProjectId: options.envProjectId }
      : {}),
    ...(options.projectDir !== undefined
      ? { projectDir: options.projectDir }
      : {}),
    listProjects: () => listWorkspaceProjects(ctx, workspace),
    commandName: options.commandName,
  });
  if (resolvedResult.isErr()) {
    throw fromLegacyCliError(
      projectResolutionErrorToCliError(resolvedResult.error),
    );
  }
  const resolved = resolvedResult.value;
  const requested = await resolveRequestedBranch(ctx, options.branchName);

  const remoteBranch = requested.explicit
    ? null
    : await resolveReadBranch(ctx.api, {
        projectId: resolved.project.id,
        branchName: requested.name,
        signal: ctx.signal,
      });

  return {
    workspace: resolved.workspace,
    project: resolved.project,
    resolution: resolved.resolution,
    branch: remoteBranch ?? {
      id: null,
      name: requested.name,
      kind: toBranchKind(requested.name),
    },
  };
}

export function serviceProvider(ctx: ServiceContext): AppProvider {
  return createAppProvider(ctx.api);
}

function sortServices(services: AppRecord[]): AppRecord[] {
  return services
    .slice()
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
}

function isMissingProjectError(error: unknown): boolean {
  return error instanceof Error && error.message === "Resource Not Found";
}

async function listServices(
  ctx: ServiceContext,
  provider: AppProvider,
  projectId: string,
  branchName?: string,
): Promise<AppRecord[]> {
  return provider
    .listApps(projectId, {
      ...(branchName !== undefined ? { branchName } : {}),
      signal: ctx.signal,
    })
    .then(sortServices)
    .catch((error) => {
      if (isMissingProjectError(error)) {
        throw projectNotFoundError(projectId);
      }
      throw deployFailedError("Failed to list services", error, [
        runCommandAction("Inspect the project", "project show"),
      ]);
    });
}

/**
 * The service picker: an explicit name must exist; otherwise the saved
 * selection is reused when still valid; otherwise the engine prompt
 * selects interactively (non-interactive contexts settle with the
 * engine's structural prompt failure).
 */
export async function resolveExistingServiceSelection(
  ctx: ServiceContext,
  stateStore: LocalStateStore,
  projectId: string,
  services: AppRecord[],
  explicitServiceName: string | undefined,
): Promise<AppRecord | null> {
  if (explicitServiceName) {
    const matched = services.find(
      (service) => service.name === explicitServiceName,
    );
    if (!matched) {
      throw serviceSelectionInvalidError(explicitServiceName, projectId);
    }
    return matched;
  }

  const savedSelection = await stateStore.readSelectedApp(projectId);
  if (savedSelection) {
    const matched =
      services.find((service) => service.id === savedSelection.id) ??
      services.find((service) => service.name === savedSelection.name);
    if (matched) {
      return matched;
    }
  }

  if (services.length === 0) {
    return null;
  }

  const selectedId = await ctx.prompt.select(
    "Select a service",
    sortServices(services).map((service) => ({
      value: service.id,
      label: service.name,
    })),
  );
  return services.find((service) => service.id === selectedId) ?? null;
}

export async function rememberSelectedService(
  stateStore: LocalStateStore,
  projectId: string,
  service: Pick<AppRecord, "id" | "name">,
): Promise<void> {
  await stateStore.setSelectedApp(projectId, {
    id: service.id,
    name: service.name,
  });
}

export async function resolveCurrentLiveDeploymentId(
  stateStore: LocalStateStore,
  projectId: string,
  service: Pick<AppRecord, "id" | "liveDeploymentId">,
  deployments: ServiceDeploymentSummary[],
): Promise<string | null> {
  if (
    service.liveDeploymentId &&
    deployments.some((deployment) => deployment.id === service.liveDeploymentId)
  ) {
    return service.liveDeploymentId;
  }

  const providerLiveDeployment = deployments.find(
    (deployment) => deployment.live === true,
  );
  if (providerLiveDeployment) {
    return providerLiveDeployment.id;
  }

  const knownLiveDeploymentId = await stateStore.readKnownLiveDeployment(
    projectId,
    service.id,
  );
  if (
    knownLiveDeploymentId &&
    deployments.some((deployment) => deployment.id === knownLiveDeploymentId)
  ) {
    return knownLiveDeploymentId;
  }

  return null;
}

export function applyLiveDeploymentHint(
  deployments: ServiceDeploymentSummary[],
  currentLiveDeploymentId: string | null,
): ServiceDeploymentSummary[] {
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

export function sortDeploymentsNewestFirst(
  deployments: ServiceDeploymentSummary[],
): ServiceDeploymentSummary[] {
  return deployments
    .slice()
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id),
    );
}

export function toServiceSummary(
  service: Pick<AppRecord, "id" | "name">,
): ServiceSummary {
  return { id: service.id, name: service.name };
}

export function toServiceDomainSummary(
  domain: DomainRecord,
): ServiceDomainSummary {
  return {
    id: domain.id,
    type: domain.type,
    url: domain.url,
    hostname: domain.hostname,
    serviceId: domain.appId,
    status: domain.status,
    foundryStatus: domain.foundryStatus,
    failureReason: domain.failureReason,
    failureCategory: domain.failureCategory,
    certExpiresAt: domain.certExpiresAt,
    createdAt: domain.createdAt,
    updatedAt: domain.updatedAt,
    dnsRecords: domain.dnsRecords.map((record) => ({
      type: record.type,
      name: record.name,
      value: record.value,
      ttl: record.ttl,
    })),
  };
}

export function normalizeDomainHostname(hostname: string): string {
  const normalized = hostname.trim().replace(/\.$/, "").toLowerCase();
  if (!isValidDomainHostname(normalized)) {
    throw domainHostnameInvalidError(hostname);
  }
  return normalized;
}

function isValidDomainHostname(hostname: string): boolean {
  if (hostname.length < 1 || hostname.length > 253) {
    return false;
  }
  if (
    hostname.includes("://") ||
    hostname.includes("/") ||
    hostname.includes(":") ||
    hostname.startsWith("*.")
  ) {
    return false;
  }
  const labels = hostname.split(".");
  if (labels.length < 2) {
    return false;
  }
  return labels.every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
  );
}

export function sameDomainHostname(left: string, right: string): boolean {
  return (
    left.trim().replace(/\.$/, "").toLowerCase() ===
    right.trim().replace(/\.$/, "").toLowerCase()
  );
}

export async function resolveDomainByHostname(
  provider: AppProvider,
  serviceId: string,
  hostname: string,
  command: "add" | "show" | "remove" | "retry" | "wait",
  signal: AbortSignal,
): Promise<DomainRecord> {
  const domains = await provider
    .listDomains(serviceId, { signal })
    .catch((error) => {
      throw domainCommandError(command, error, hostname);
    });
  const matched = domains.find((domain) =>
    sameDomainHostname(domain.hostname, hostname),
  );
  if (matched) {
    return matched;
  }
  throw domainNotFoundError(hostname);
}

export interface ServiceReadState {
  provider: AppProvider;
  stateStore: LocalStateStore;
  target: ResolvedServiceProjectContext;
  projectId: string;
  selected: AppRecord | null;
}

/** The shared read flow for show / list-deploys / open: config context,
 *  project + branch resolution, service listing, and selection. */
export async function resolveServiceReadState(
  ctx: ServiceContext,
  options: {
    serviceName?: string;
    projectRef?: string;
    configTarget?: string;
    branchName?: string;
    commandName: string;
  },
): Promise<ServiceReadState> {
  const compute = await resolveComputeManagementContext(
    ctx,
    options.configTarget,
    options.commandName.replace(/^service /, ""),
  );
  const provider = serviceProvider(ctx);
  const target = await resolveServiceProjectContext(ctx, options.projectRef, {
    commandName: options.commandName,
    projectDir: compute.projectDir,
    ...(options.branchName !== undefined
      ? { branchName: options.branchName }
      : {}),
  });
  const projectId = target.project.id;
  const stateStore = await openServiceStateStore(ctx);
  const services = await listServices(
    ctx,
    provider,
    projectId,
    target.branch.name,
  );
  const selected = await resolveExistingServiceSelection(
    ctx,
    stateStore,
    projectId,
    services,
    options.serviceName ?? compute.configServiceName,
  );
  return { provider, stateStore, target, projectId, selected };
}

export interface ResolvedServiceDomainTarget {
  provider: AppProvider;
  stateStore: LocalStateStore;
  service: AppRecord;
  resultTarget: ServiceDomainTarget;
}

export async function resolveServiceDomainTarget(
  ctx: ServiceContext,
  options: {
    serviceName?: string;
    projectRef?: string;
    branchName?: string;
    configTarget?: string;
    commandName: string;
  },
): Promise<ResolvedServiceDomainTarget> {
  const compute = await resolveComputeManagementContext(
    ctx,
    options.configTarget,
    options.commandName.replace(/^service /, ""),
  );
  const branchName = options.branchName?.trim() || "production";
  if (toBranchKind(branchName) !== "production") {
    throw branchNotDeployableError(branchName);
  }

  const envProjectId = readServiceEnvOverride(ctx, PRISMA_PROJECT_ID_ENV_VAR);
  const envServiceId = readServiceEnvOverride(ctx, PRISMA_SERVICE_ID_ENV_VAR);

  const provider = serviceProvider(ctx);
  const target = await resolveServiceProjectContext(ctx, options.projectRef, {
    commandName: options.commandName,
    projectDir: compute.projectDir,
    branchName,
    ...(envProjectId !== undefined ? { envProjectId } : {}),
  });
  const projectId = target.project.id;
  const stateStore = await openServiceStateStore(ctx);
  const services = await listServices(
    ctx,
    provider,
    projectId,
    target.branch.name,
  );

  const explicitServiceName = options.serviceName ?? compute.configServiceName;
  let selectedService: AppRecord | null;
  if (envServiceId) {
    selectedService =
      services.find((service) => service.id === envServiceId) ?? null;
    if (!selectedService) {
      throw selectedServiceMissingError(
        PRISMA_SERVICE_ID_ENV_VAR,
        envServiceId,
        projectId,
      );
    }
  } else {
    selectedService = await resolveExistingServiceSelection(
      ctx,
      stateStore,
      projectId,
      services,
      explicitServiceName,
    );
  }
  if (!selectedService) {
    throw domainTargetRequiredError();
  }

  await rememberSelectedService(stateStore, projectId, selectedService);

  return {
    provider,
    stateStore,
    service: selectedService,
    resultTarget: {
      workspace: target.workspace,
      project: target.project,
      branch: {
        name: target.branch.name,
        kind: target.branch.kind,
      },
      service: toServiceSummary(selectedService),
    },
  };
}
