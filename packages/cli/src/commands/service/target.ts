import type { CommandContext } from "@prisma/cli-engine";
import {
  type AppProvider,
  type AppRecord,
  createAppProvider,
  type DeploymentRecord,
  type DomainRecord,
} from "../../lib/app/app-provider";
import { resolveReadBranch } from "../../lib/app/read-branch";
import { projectApiError } from "../../lib/project/provider";
import {
  type ProjectCandidate,
  type ProjectResolutionContext,
  projectResolutionErrorToCliError,
  resolveProjectTarget,
  sortProjects,
} from "../../lib/project/resolution";
import type { AuthWorkspace } from "../../types/auth";
import type { BranchKind } from "../../types/branch";
import type { ProjectResolution, ProjectSummary } from "../../types/project";
import {
  branchNotDeployableError,
  branchValueEmptyError,
  deployFailedError,
  deploymentDetachedError,
  deploymentNotFoundError,
  domainCommandError,
  domainHostnameInvalidError,
  domainNotFoundError,
  fromLegacyCliError,
  projectNotFoundError,
  runCommandAction,
  selectedServiceMissingError,
  serviceSelectionInvalidError,
  serviceTargetRequiredError,
  workspaceRequiredError,
} from "./errors";
import type {
  ServiceDeploymentSummary,
  ServiceDomainSummary,
  ServiceDomainTarget,
  ServiceListEntry,
  ServiceSummary,
} from "./results";

/** A hostname's optional root dot, and one DNS label. */
const TRAILING_DOT = /\.$/;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
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

/** What project resolution reads: where the command was invoked, and
 *  the run's abort signal. */
function resolutionContext(ctx: ServiceContext): ProjectResolutionContext {
  return { runtime: { cwd: ctx.cwd, signal: ctx.signal } };
}

export function toBranchKind(name: string): BranchKind {
  return name === "production" || name === "main" ? "production" : "preview";
}

/**
 * The same listing `controllers/project.ts#listRealWorkspaceProjects`
 * performs, on ctx.api — duplicated here so this CLI does not drag
 * the legacy controller import graph (child-process git adapters).
 *
 * No workspace filter, and no workspace parameter that could invite one
 * back: the credential is issued for one workspace and the API answers
 * within it. The filter this function used to carry compared the
 * credential's bare workspace id against the API's `wksp_`-prefixed one
 * and so discarded every project, every time — which made every service
 * command report the pinned project as missing. #144 removed it from
 * the legacy listing this mirrors; the copy here was written from the
 * version that still had it.
 *
 * A refused request is raised, not read as an empty workspace. Without
 * that, a 401, 403 or 500 becomes "no projects", the caller finds the
 * pinned project missing, and the user is told their local binding is
 * stale — sent to re-link a project that was never the problem. That is
 * the same wrong recovery path the missing filter produced.
 */
async function listWorkspaceProjects(
  ctx: ServiceContext,
): Promise<ProjectCandidate[]> {
  const { data, error, response } = await ctx.api.GET("/v1/projects", {
    signal: ctx.signal,
  });
  if (error || !data) {
    throw fromLegacyCliError(
      projectApiError("Failed to list projects", response, error),
    );
  }
  return sortProjects(
    (data.data ?? []).map((project) => ({
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

/** A blank `--branch` names no branch and must never fall through to
 *  the default-branch behavior of omitting the flag. */
function requireBranchFlagValue(branchName: string | undefined): void {
  if (branchName !== undefined && branchName.trim() === "") {
    throw branchValueEmptyError();
  }
}

export async function resolveServiceProjectContext(
  ctx: ServiceContext,
  explicitProject: string | undefined,
  options: {
    commandName: string;
    branchName?: string;
  },
): Promise<ResolvedServiceProjectContext> {
  requireBranchFlagValue(options.branchName);
  const workspace = await requireWorkspace(ctx);
  // Listed here rather than from inside `resolveProjectTarget`, which
  // runs its body in a Result generator: a throw in the callback comes
  // back as an opaque "generator body threw" instead of the API's own
  // refusal. Fetching first lets that error settle as itself.
  const projects = await listWorkspaceProjects(ctx);
  const resolvedResult = await resolveProjectTarget({
    context: resolutionContext(ctx),
    workspace,
    ...(explicitProject !== undefined ? { explicitProject } : {}),
    listProjects: () => Promise.resolve(projects),
    commandName: options.commandName,
  });
  if (resolvedResult.isErr()) {
    throw fromLegacyCliError(
      projectResolutionErrorToCliError(resolvedResult.error),
    );
  }
  const resolved = resolvedResult.value;
  const requested = options.branchName
    ? { name: options.branchName, explicit: true }
    : { name: "main", explicit: false };

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

export async function listServices(
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

export interface RequestedServiceTarget {
  kind: "name" | "id";
  value: string;
}

/** The service target the run was given, if any: the service name
 *  argument wins, then PRISMA_SERVICE_ID (a service id). */
export function requestedServiceTarget(
  ctx: ServiceContext,
  explicitServiceName: string | undefined,
): RequestedServiceTarget | null {
  if (explicitServiceName) {
    return { kind: "name", value: explicitServiceName };
  }
  const envServiceId = readServiceEnvOverride(ctx, PRISMA_SERVICE_ID_ENV_VAR);
  if (envServiceId) {
    return { kind: "id", value: envServiceId };
  }
  return null;
}

/** As `requestedServiceTarget`, but no target refuses — service
 *  commands never infer, remember, or prompt for one. */
export function requireRequestedServiceTarget(
  ctx: ServiceContext,
  explicitServiceName: string | undefined,
  commandName: string,
): RequestedServiceTarget {
  const requested = requestedServiceTarget(ctx, explicitServiceName);
  if (!requested) {
    throw serviceTargetRequiredError(commandName);
  }
  return requested;
}

export function matchRequestedService(
  requested: RequestedServiceTarget,
  services: AppRecord[],
  projectId: string,
): AppRecord {
  if (requested.kind === "name") {
    const matched = services.find(
      (service) => service.name === requested.value,
    );
    if (!matched) {
      throw serviceSelectionInvalidError(requested.value, projectId);
    }
    return matched;
  }
  const matched = services.find((service) => service.id === requested.value);
  if (!matched) {
    throw selectedServiceMissingError(
      PRISMA_SERVICE_ID_ENV_VAR,
      requested.value,
      projectId,
    );
  }
  return matched;
}

export interface DeploymentSubject {
  provider: AppProvider;
  service: AppRecord;
  deployment: DeploymentRecord;
}

/** Resolve a deployment by its globally-unique id. The id alone names
 *  the subject — no service, project, or branch parameter is consulted,
 *  the same way `service deployment show` resolves it. */
export async function resolveDeploymentSubject(
  ctx: ServiceContext,
  deploymentId: string,
): Promise<DeploymentSubject> {
  const provider = serviceProvider(ctx);
  const shown = await provider
    .showDeployment(deploymentId, { signal: ctx.signal })
    .catch((error) => {
      throw deployFailedError("Failed to show deployment", error, []);
    });
  if (!shown) {
    throw deploymentNotFoundError(deploymentId);
  }
  if (!shown.app) {
    throw deploymentDetachedError(deploymentId);
  }
  return { provider, service: shown.app, deployment: shown.deployment };
}

/** The live deployment is the one the service record names as its latest
 *  deployment. Nothing else decides it — local CLI state never does. */
export function resolveCurrentLiveDeploymentId(
  service: Pick<AppRecord, "liveDeploymentId">,
  deployments: ServiceDeploymentSummary[],
): string | null {
  if (
    service.liveDeploymentId &&
    deployments.some((deployment) => deployment.id === service.liveDeploymentId)
  ) {
    return service.liveDeploymentId;
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

/** A service record as the listing and create presenters report it. A
 *  service that names no live deployment has no URL to show: the
 *  endpoint domain it already carries does not resolve until the first
 *  promote. */
export function toServiceListEntry(service: AppRecord): ServiceListEntry {
  return {
    id: service.id,
    name: service.name,
    region: service.region,
    liveDeploymentId: service.liveDeploymentId,
    liveUrl: service.liveDeploymentId ? service.liveUrl : null,
  };
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
  const normalized = hostname.trim().replace(TRAILING_DOT, "").toLowerCase();
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
  return labels.every((label) => DNS_LABEL.test(label));
}

export function sameDomainHostname(left: string, right: string): boolean {
  return (
    left.trim().replace(TRAILING_DOT, "").toLowerCase() ===
    right.trim().replace(TRAILING_DOT, "").toLowerCase()
  );
}

export async function resolveDomainByHostname(
  provider: AppProvider,
  serviceId: string,
  hostname: string,
  command: "add" | "show" | "delete" | "retry" | "wait",
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

interface ServiceProjectState {
  provider: AppProvider;
  target: ResolvedServiceProjectContext;
  projectId: string;
}

export interface ServiceReadState extends ServiceProjectState {
  service: AppRecord;
}

/** Project + branch resolution, before the service match. */
async function resolveServiceProjectState(
  ctx: ServiceContext,
  options: {
    projectRef?: string;
    branchName?: string;
    commandName: string;
  },
): Promise<ServiceProjectState> {
  const provider = serviceProvider(ctx);
  const target = await resolveServiceProjectContext(ctx, options.projectRef, {
    commandName: options.commandName,
    ...(options.branchName !== undefined
      ? { branchName: options.branchName }
      : {}),
  });
  return { provider, target, projectId: target.project.id };
}

/** The shared read flow for every command that acts on an existing
 *  service: project + branch resolution, service listing, and the
 *  parameter-only service match. */
export async function resolveServiceReadState(
  ctx: ServiceContext,
  options: {
    serviceName?: string;
    projectRef?: string;
    branchName?: string;
    commandName: string;
  },
): Promise<ServiceReadState> {
  const requested = requireRequestedServiceTarget(
    ctx,
    options.serviceName,
    options.commandName,
  );
  const state = await resolveServiceProjectState(ctx, options);
  const services = await listServices(
    ctx,
    state.provider,
    state.projectId,
    state.target.branch.name,
  );
  const service = matchRequestedService(requested, services, state.projectId);
  return { ...state, service };
}

export interface ResolvedServiceDomainTarget {
  provider: AppProvider;
  service: AppRecord;
  resultTarget: ServiceDomainTarget;
}

export async function resolveServiceDomainTarget(
  ctx: ServiceContext,
  options: {
    serviceName?: string;
    projectRef?: string;
    branchName?: string;
    commandName: string;
  },
): Promise<ResolvedServiceDomainTarget> {
  requireBranchFlagValue(options.branchName);
  const branchName = options.branchName?.trim() ?? "production";
  if (toBranchKind(branchName) !== "production") {
    throw branchNotDeployableError(branchName);
  }

  const requested = requireRequestedServiceTarget(
    ctx,
    options.serviceName,
    options.commandName,
  );

  const provider = serviceProvider(ctx);
  const target = await resolveServiceProjectContext(ctx, options.projectRef, {
    commandName: options.commandName,
    branchName,
  });
  const projectId = target.project.id;
  const services = await listServices(
    ctx,
    provider,
    projectId,
    target.branch.name,
  );
  const service = matchRequestedService(requested, services, projectId);

  return {
    provider,
    service,
    resultTarget: {
      workspace: target.workspace,
      project: target.project,
      branch: {
        name: target.branch.name,
        kind: target.branch.kind,
      },
      service: toServiceSummary(service),
    },
  };
}
