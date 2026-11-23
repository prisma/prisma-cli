// biome-ignore-all lint/performance/noAwaitInLoops: API pagination walks pages in order.
// biome-ignore-all lint/performance/useTopLevelRegex: Existing hostname normalization regexes are kept inline for readability.
// biome-ignore-all lint/style/noNestedTernary: Existing app resolution expression is intentionally compact.
import type { StreamRecord } from "@prisma/compute-sdk";
import {
  ApiError,
  CancelledError,
  ComputeClient,
  streamLogs,
} from "@prisma/compute-sdk";
import type { ManagementApiClient, paths } from "@prisma/management-api-sdk";
import type { BranchKind } from "../../types/branch";
import { type ApiErrorBody, apiErrorDetail } from "../management-api-error";
import {
  type BranchDatabaseRecord,
  createBranchDatabase,
  createEnvironmentVariable,
  deleteBranchDatabase,
  deleteEnvironmentVariable,
  type EnvironmentVariableRecord,
  listEnvironmentVariables,
  updateEnvironmentVariable,
} from "./branch-database-api";
import { envVarNames } from "./env-vars";

export interface AppRecord {
  id: string;
  name: string;
  region: string | null;
  branchId?: string | null;
  liveDeploymentId: string | null;
  liveUrl: string | null;
}

export interface ProjectRecord {
  id: string;
  name: string;
  defaultRegion?: string;
}

export interface BranchRecord {
  id: string;
  name: string;
  role: BranchKind;
}

export type {
  BranchDatabaseRecord,
  EnvironmentVariableRecord,
} from "./branch-database-api";

export interface DeploymentRecord {
  id: string;
  status: string;
  createdAt: string;
  url: string | null;
  live: boolean | null;
}

export interface EnvRecord {
  projectId: string;
  app: AppRecord;
  deployment: DeploymentRecord;
  variables: string[];
}

export interface ShownDeploymentRecord {
  app: AppRecord | null;
  deployment: DeploymentRecord;
}

export interface RemovedAppRecord {
  id: string;
  name: string;
}

export type DomainStatus = "pending" | "active";

export type DomainState =
  | "not_verified"
  | "no_service"
  | "no_live_deployment"
  | "update_failed"
  | "in_use_elsewhere"
  | "waiting_for_dns"
  | "provisioning_certificate"
  | "certificate_failed"
  | "updating"
  | "active";

export type DomainCondition =
  | "ownershipVerified"
  | "servicePresent"
  | "liveDeployment"
  | "dnsPointsAtSwitchboard"
  | "customDomainBound"
  | "certificateActive";

export type DomainConditionValue = "met" | "unmet" | "unknown";

export interface DomainDnsRecord {
  condition: "ownershipVerified" | "dnsPointsAtSwitchboard";
  type: "TXT" | "CNAME";
  name: string;
  value: string;
  ttl: number;
}

export interface DomainHolder {
  workspaceId: string | null;
  projectId: string | null;
  serviceId: string | null;
  message: string | null;
}

/** A hostname on a service, as the Management API's RoutingUrl reports it. */
export interface DomainRecord {
  id: string;
  type: "routingUrl";
  hostname: string;
  appId: string | null;
  status: DomainStatus;
  state: DomainState;
  conditions: Record<DomainCondition, DomainConditionValue>;
  firstUnmetCondition: DomainCondition | null;
  failureReason: string | null;
  syncError: string | null;
  dnsDetail: string | null;
  certExpiresAt: string | null;
  ownershipExpiresAt: string | null;
  heldBy: DomainHolder | null;
  setupUrl: string | null;
  createdAt: string;
  updatedAt: string;
  dnsRecords: DomainDnsRecord[];
}

export class DomainApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly hint: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(options: {
    summary: string;
    status: number;
    message: string;
    code?: string | null;
    hint?: string | null;
    retryAfterSeconds?: number | null;
  }) {
    super(
      `${options.summary}: ${options.message}${options.hint ? ` ${options.hint}` : ""}`,
    );
    this.name = "DomainApiError";
    this.status = options.status;
    this.code = options.code ?? null;
    this.hint = options.hint ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export interface AppProvider {
  createProject(options: {
    name: string;
    region?: string;
    signal?: AbortSignal;
  }): Promise<ProjectRecord>;
  resolveBranch(
    projectId: string,
    options: { branchName: string; signal?: AbortSignal },
  ): Promise<BranchRecord>;
  createBranchDatabase(options: {
    projectId: string;
    branchId: string;
    branchName: string;
    signal?: AbortSignal;
  }): Promise<BranchDatabaseRecord>;
  deleteBranchDatabase(options: {
    databaseId: string;
    signal?: AbortSignal;
  }): Promise<void>;
  listEnvironmentVariables(options: {
    projectId: string;
    className?: "production" | "preview";
    key?: string;
    branchId?: string;
    signal?: AbortSignal;
  }): Promise<EnvironmentVariableRecord[]>;
  createEnvironmentVariable(options: {
    projectId: string;
    branchId?: string;
    className: "production" | "preview";
    key: string;
    value: string;
    signal?: AbortSignal;
  }): Promise<EnvironmentVariableRecord>;
  updateEnvironmentVariable(options: {
    envVarId: string;
    value: string;
    signal?: AbortSignal;
  }): Promise<EnvironmentVariableRecord>;
  deleteEnvironmentVariable(options: {
    envVarId: string;
    signal?: AbortSignal;
  }): Promise<void>;
  listApps(
    projectId: string,
    options?: { branchName?: string; signal?: AbortSignal },
  ): Promise<AppRecord[]>;
  createApp(options: {
    projectId: string;
    branchName: string;
    name: string;
    region?: string;
    signal?: AbortSignal;
  }): Promise<{ service: AppRecord; existing: boolean }>;
  removeApp(
    appId: string,
    options?: { signal?: AbortSignal; progress?: unknown },
  ): Promise<RemovedAppRecord>;
  listDomains(
    appId: string,
    options?: { signal?: AbortSignal },
  ): Promise<DomainRecord[]>;
  addDomain(options: {
    appId: string;
    hostname: string;
    signal?: AbortSignal;
  }): Promise<{ domain: DomainRecord; existing: boolean }>;
  showDomain(
    domainId: string,
    options?: { signal?: AbortSignal },
  ): Promise<DomainRecord>;
  removeDomain(
    domainId: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  checkDomain(
    domainId: string,
    options?: { signal?: AbortSignal },
  ): Promise<DomainRecord>;
  promoteDeployment(options: {
    appId: string;
    deploymentId: string;
    signal?: AbortSignal;
    progress?: unknown;
  }): Promise<void>;
  startDeployment(options: {
    deploymentId: string;
    signal?: AbortSignal;
  }): Promise<void>;
  stopDeployment(options: {
    deploymentId: string;
    signal?: AbortSignal;
  }): Promise<void>;
  deleteDeployment(options: {
    deploymentId: string;
    signal?: AbortSignal;
  }): Promise<void>;
  /** One deployment's own record. Unlike `showDeployment` this does not
   *  hunt for the owning service, so it is the cheap re-read for a
   *  caller that already knows which service it is acting on. */
  readDeployment(options: {
    deploymentId: string;
    signal?: AbortSignal;
  }): Promise<DeploymentRecord>;
  updateAppEnv(options: {
    appId: string;
    envVars: Record<string, string>;
    signal?: AbortSignal;
    progress?: unknown;
    promoteProgress?: unknown;
  }): Promise<EnvRecord>;
  listAppEnvNames(options: {
    appId: string;
    deploymentId: string;
    signal?: AbortSignal;
  }): Promise<EnvRecord>;
  listDeployments(
    appId: string,
    options?: { signal?: AbortSignal },
  ): Promise<{
    app: AppRecord;
    deployments: DeploymentRecord[];
  }>;
  showDeployment(
    deploymentId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ShownDeploymentRecord | null>;
  streamDeploymentLogs(options: {
    deploymentId: string;
    signal?: AbortSignal;
    onRecord(record: StreamRecord): void;
  }): Promise<void>;
}

export function createAppProvider(
  client: ManagementApiClient,
  options?: {
    baseUrl?: string;
    getToken?: () => Promise<string>;
  },
): AppProvider {
  const sdk = new ComputeClient(client);

  return {
    async createProject(options) {
      const projectResult = await sdk.createProject({
        name: options.name,
        region: options.region,
        signal: options.signal,
      });
      if (projectResult.isErr()) {
        throw new Error(projectResult.error.message);
      }

      return {
        id: projectResult.value.id,
        name: projectResult.value.name,
        defaultRegion: projectResult.value.defaultRegion,
      };
    },

    async listApps(projectId, options) {
      return listComputeServices(client, {
        projectId,
        branchGitName: options?.branchName,
        signal: options?.signal,
      });
    },

    async createApp(options) {
      return createComputeService(client, {
        projectId: options.projectId,
        branchName: options.branchName,
        displayName: options.name,
        ...(options.region !== undefined ? { region: options.region } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
    },

    async resolveBranch(projectId, options) {
      const branch = await resolveOrCreateBranch(client, {
        projectId,
        gitName: options.branchName,
        signal: options.signal,
      });

      return {
        id: branch.id,
        name: branch.gitName,
        role: branch.role,
      };
    },

    async createBranchDatabase(options) {
      return createBranchDatabase(client, options);
    },

    async deleteBranchDatabase(options) {
      return deleteBranchDatabase(client, options);
    },

    async listEnvironmentVariables(options) {
      return listEnvironmentVariables(client, options);
    },

    async createEnvironmentVariable(options) {
      return createEnvironmentVariable(client, options);
    },

    async updateEnvironmentVariable(options) {
      return updateEnvironmentVariable(client, options);
    },

    async deleteEnvironmentVariable(options) {
      return deleteEnvironmentVariable(client, options);
    },

    async removeApp(appId, options) {
      const appResult = await sdk.showApp({
        appId,
        signal: options?.signal,
      });
      if (appResult.isErr()) {
        throw new Error(appResult.error.message);
      }

      const destroyResult = await sdk.destroyApp({
        appId,
        keepApp: false,
        timeoutSeconds: 120,
        pollIntervalMs: 2_000,
        signal: options?.signal,
        progress: options?.progress as never,
      });

      if (destroyResult.isErr()) {
        throw new Error(destroyResult.error.message);
      }

      return {
        id: appResult.value.id,
        name: appResult.value.name,
      };
    },

    async listDomains(appId, options) {
      return listServiceHostnames(client, appId, options?.signal);
    },

    async addDomain(options) {
      const existing = (
        await listServiceHostnames(client, options.appId, options.signal)
      ).filter((domain) => sameHostname(domain.hostname, options.hostname));
      const alreadyAdded = preferredDomain(existing);
      if (alreadyAdded) {
        return { domain: alreadyAdded, existing: true };
      }

      const result = await client.POST("/v1/services/{serviceId}/urls", {
        params: {
          path: { serviceId: options.appId },
        },
        body: {
          hostname: options.hostname,
        },
        signal: options.signal,
      });

      if (result.error || !result.data) {
        throw domainApiCallError(
          "Failed to add custom domain",
          result.response,
          result.error,
        );
      }

      return {
        domain: toDomainRecord(result.data.data),
        existing: false,
      };
    },

    async showDomain(domainId, options) {
      const result = await client.GET("/v1/urls/{id}", {
        params: {
          path: { id: domainId },
        },
        signal: options?.signal,
      });

      if (result.error || !result.data) {
        throw domainApiCallError(
          "Failed to show custom domain",
          result.response,
          result.error,
        );
      }

      return toDomainRecord(result.data.data);
    },

    async removeDomain(domainId, options) {
      const result = await client.DELETE("/v1/urls/{id}", {
        params: {
          path: { id: domainId },
        },
        signal: options?.signal,
      });

      if (result.error) {
        throw domainApiCallError(
          "Failed to delete custom domain",
          result.response,
          result.error,
        );
      }
    },

    async checkDomain(domainId, options) {
      const result = await client.POST("/v1/urls/{id}/check", {
        params: {
          path: { id: domainId },
        },
        signal: options?.signal,
      });

      if (result.error || !result.data) {
        throw domainApiCallError(
          "Failed to check custom domain",
          result.response,
          result.error,
        );
      }

      return toDomainRecord(result.data.data);
    },

    async promoteDeployment(options) {
      const promoteResult = await sdk.promote({
        appId: options.appId,
        deploymentId: options.deploymentId,
        timeoutSeconds: 120,
        pollIntervalMs: 2000,
        signal: options.signal,
        progress: options.progress as never,
      });

      if (promoteResult.isErr()) {
        throw new Error(promoteResult.error.message);
      }
    },

    async startDeployment(options) {
      const result = await sdk.startDeployment({
        deploymentId: options.deploymentId,
        signal: options.signal,
      });
      if (result.isErr()) {
        throw new Error(result.error.message);
      }
    },

    async stopDeployment(options) {
      const result = await sdk.stopDeployment({
        deploymentId: options.deploymentId,
        signal: options.signal,
      });
      if (result.isErr()) {
        throw new Error(result.error.message);
      }
    },

    async deleteDeployment(options) {
      const result = await sdk.deleteDeployment({
        deploymentId: options.deploymentId,
        signal: options.signal,
      });
      if (result.isErr()) {
        throw new Error(result.error.message);
      }
    },

    async readDeployment(options) {
      const result = await sdk.showDeployment({
        deploymentId: options.deploymentId,
        signal: options.signal,
      });
      if (result.isErr()) {
        throw new Error(result.error.message);
      }

      return {
        id: result.value.id,
        status: result.value.status,
        createdAt: result.value.createdAt,
        url: toAbsoluteUrl(result.value.previewDomain ?? null),
        // Liveness is the service record's to state, and this reads the
        // deployment alone.
        live: null,
      };
    },

    async updateAppEnv(options) {
      const updateResult = await sdk.updateEnv({
        appId: options.appId,
        envVars: options.envVars,
        timeoutSeconds: 120,
        pollIntervalMs: 2000,
        signal: options.signal,
        progress: options.progress as never,
      });

      if (updateResult.isErr()) {
        throw new Error(updateResult.error.message);
      }

      const promoteResult = await sdk.promote({
        appId: options.appId,
        deploymentId: updateResult.value.deploymentId,
        timeoutSeconds: 120,
        pollIntervalMs: 2000,
        signal: options.signal,
        progress: options.promoteProgress as never,
      });

      if (promoteResult.isErr()) {
        throw new Error(promoteResult.error.message);
      }

      const [serviceResult, versionResult] = await Promise.all([
        sdk.showApp({ appId: options.appId, signal: options.signal }),
        sdk.showDeployment({
          deploymentId: updateResult.value.deploymentId,
          signal: options.signal,
        }),
      ]);

      if (serviceResult.isErr()) {
        throw new Error(serviceResult.error.message);
      }

      if (versionResult.isErr()) {
        throw new Error(versionResult.error.message);
      }

      return {
        projectId: updateResult.value.projectId,
        app: {
          id: serviceResult.value.id,
          name: serviceResult.value.name,
          region: serviceResult.value.region ?? null,
          liveDeploymentId: serviceResult.value.latestDeploymentId ?? null,
          liveUrl: toAbsoluteUrl(serviceResult.value.appEndpointDomain ?? null),
        },
        deployment: {
          id: versionResult.value.id,
          status: versionResult.value.status,
          createdAt: versionResult.value.createdAt,
          url: toAbsoluteUrl(
            serviceResult.value.appEndpointDomain ??
              versionResult.value.previewDomain ??
              null,
          ),
          live: true,
        },
        variables: envVarNames(versionResult.value.envVars),
      };
    },

    async listAppEnvNames(options) {
      const [serviceResult, versionResult] = await Promise.all([
        sdk.showApp({ appId: options.appId, signal: options.signal }),
        sdk.showDeployment({
          deploymentId: options.deploymentId,
          signal: options.signal,
        }),
      ]);

      if (serviceResult.isErr()) {
        throw new Error(serviceResult.error.message);
      }

      if (versionResult.isErr()) {
        throw new Error(versionResult.error.message);
      }

      return {
        projectId: serviceResult.value.projectId,
        app: {
          id: serviceResult.value.id,
          name: serviceResult.value.name,
          region: serviceResult.value.region ?? null,
          liveDeploymentId: serviceResult.value.latestDeploymentId ?? null,
          liveUrl: toAbsoluteUrl(serviceResult.value.appEndpointDomain ?? null),
        },
        deployment: {
          id: versionResult.value.id,
          status: versionResult.value.status,
          createdAt: versionResult.value.createdAt,
          url: toAbsoluteUrl(versionResult.value.previewDomain ?? null),
          live:
            serviceResult.value.latestDeploymentId === versionResult.value.id,
        },
        variables: envVarNames(versionResult.value.envVars),
      };
    },

    async listDeployments(appId, options) {
      const [appResult, versionsResult] = await Promise.all([
        sdk.showApp({ appId, signal: options?.signal }),
        sdk.listDeployments({ appId, signal: options?.signal }),
      ]);

      if (appResult.isErr()) {
        throw new Error(appResult.error.message);
      }

      if (versionsResult.isErr()) {
        throw new Error(versionsResult.error.message);
      }

      return {
        app: {
          id: appResult.value.id,
          name: appResult.value.name,
          region: appResult.value.region ?? null,
          liveDeploymentId: appResult.value.latestDeploymentId ?? null,
          liveUrl: toAbsoluteUrl(appResult.value.appEndpointDomain ?? null),
        },
        deployments: versionsResult.value
          .slice()
          .sort((left, right) => {
            const byDate = right.createdAt.localeCompare(left.createdAt);
            return byDate !== 0 ? byDate : right.id.localeCompare(left.id);
          })
          .map((deployment) => ({
            id: deployment.id,
            status: deployment.status,
            createdAt: deployment.createdAt,
            url: toAbsoluteUrl(deployment.previewDomain ?? null),
            live: null,
          })),
      };
    },

    async showDeployment(deploymentId, options) {
      const deploymentResult = await sdk.showDeployment({
        deploymentId,
        signal: options?.signal,
      });
      if (deploymentResult.isErr()) {
        if (
          ApiError.is(deploymentResult.error) &&
          deploymentResult.error.statusCode === 404
        ) {
          return null;
        }

        throw new Error(deploymentResult.error.message);
      }

      const app = await owningService(
        sdk,
        deploymentResult.value.serviceId,
        options?.signal,
      );

      // The promoted address is the live deployment's address only. A
      // deployment that is not live is not served there, so it keeps its
      // own preview domain.
      const promotedUrl =
        app !== null && app.liveDeploymentId === deploymentResult.value.id
          ? app.liveUrl
          : null;

      return {
        app,
        deployment: {
          id: deploymentResult.value.id,
          status: deploymentResult.value.status,
          createdAt: deploymentResult.value.createdAt,
          url:
            promotedUrl ??
            toAbsoluteUrl(deploymentResult.value.previewDomain ?? null),
          live: null,
        },
      };
    },

    async streamDeploymentLogs(streamOptions) {
      if (!options?.baseUrl || !options.getToken) {
        throw new Error(
          "Log streaming requires an authenticated API base URL and token.",
        );
      }

      const result = await streamLogs(
        {
          baseUrl: options.baseUrl,
          token: await options.getToken(),
          deploymentId: streamOptions.deploymentId,
          signal: streamOptions.signal,
        },
        streamOptions.onRecord,
      );

      if (result.isErr()) {
        if (CancelledError.is(result.error)) {
          // Stopping a log stream is an expected user action, not a failed operation.
          return;
        }

        throw result.error;
      }
    },
  };
}

interface RawBranchRecord {
  id: string;
  gitName: string;
  isDefault: boolean;
  role: BranchKind;
}

interface RawAppRecord {
  id: string;
  name: string;
  region: {
    id: string;
    name?: string;
  };
  projectId: string;
  branchId: string | null;
  latestDeploymentId: string | null;
  appEndpointDomain: string | null;
}

type RawRoutingUrl =
  paths["/v1/urls/{id}"]["get"]["responses"][200]["content"]["application/json"]["data"];

async function listBranches(
  client: ManagementApiClient,
  options: {
    projectId: string;
    gitName: string;
    signal?: AbortSignal;
  },
): Promise<RawBranchRecord[]> {
  const result = await client.GET("/v1/projects/{projectId}/branches", {
    params: {
      path: { projectId: options.projectId },
      query: { gitName: options.gitName },
    },
    signal: options.signal,
  });
  if (result.error || !result.data) {
    throw apiCallError(
      "Failed to list branches",
      result.response,
      result.error,
    );
  }

  return result.data.data.map((branch) => ({
    id: branch.id,
    gitName: branch.gitName,
    isDefault: branch.isDefault,
    role: branch.role,
  }));
}

async function resolveOrCreateBranch(
  client: ManagementApiClient,
  options: {
    projectId: string;
    gitName: string;
    signal?: AbortSignal;
  },
): Promise<RawBranchRecord> {
  const existing = (await listBranches(client, options))[0];
  if (existing) {
    return existing;
  }

  const result = await client.POST("/v1/projects/{projectId}/branches", {
    params: {
      path: { projectId: options.projectId },
    },
    body: {
      gitName: options.gitName,
    },
    signal: options.signal,
  });
  if (result.error || !result.data) {
    if (result.response.status === 409) {
      const raced = (await listBranches(client, options))[0];
      if (raced) {
        return raced;
      }
    }

    throw apiCallError(
      `Failed to create branch "${options.gitName}"`,
      result.response,
      result.error,
    );
  }

  const branch = result.data.data;
  return {
    id: branch.id,
    gitName: branch.gitName,
    isDefault: branch.isDefault,
    role: branch.role,
  };
}

async function listComputeServices(
  client: ManagementApiClient,
  options: {
    projectId: string;
    branchGitName?: string;
    signal?: AbortSignal;
  },
): Promise<AppRecord[]> {
  const services: RawAppRecord[] = [];
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await client.GET("/v1/apps", {
      params: {
        query: {
          projectId: options.projectId,
          branchGitName: options.branchGitName,
          cursor,
        },
      },
      signal: options.signal,
    });
    if (result.error || !result.data) {
      throw apiCallError("Failed to list apps", result.response, result.error);
    }

    services.push(...(result.data.data as RawAppRecord[]));

    if (!result.data.pagination.hasMore || !result.data.pagination.nextCursor) {
      break;
    }
    cursor = result.data.pagination.nextCursor;
  }

  return services.map(toAppRecord);
}

async function owningService(
  sdk: ComputeClient,
  serviceId: string,
  signal?: AbortSignal,
): Promise<AppRecord | null> {
  const result = await sdk.showApp({ appId: serviceId, signal });
  if (result.isErr()) {
    // Only a deleted service reads as ownerless; any other failure is real
    // and must not be reported as a version with no service.
    if (ApiError.is(result.error) && result.error.statusCode === 404) {
      return null;
    }
    throw new Error(result.error.message);
  }
  return {
    id: result.value.id,
    name: result.value.name,
    region: result.value.region ?? null,
    liveDeploymentId: result.value.latestDeploymentId ?? null,
    liveUrl: toAbsoluteUrl(result.value.appEndpointDomain ?? null),
  };
}

function toAppRecord(service: RawAppRecord): AppRecord {
  return {
    id: service.id,
    name: service.name,
    region: service.region.id ?? null,
    branchId: service.branchId,
    liveDeploymentId: service.latestDeploymentId ?? null,
    liveUrl: toAbsoluteUrl(service.appEndpointDomain ?? null),
  };
}

/**
 * Creates a service on a branch, resolving (or creating) the branch
 * first because the create body needs its id. A name already taken on
 * the branch comes back as the existing service rather than an error:
 * the API answers 409 and the caller asked for a service by that name,
 * which already exists.
 */
async function createComputeService(
  client: ManagementApiClient,
  options: {
    projectId: string;
    branchName: string;
    displayName: string;
    region?: string;
    signal?: AbortSignal;
  },
): Promise<{ service: AppRecord; existing: boolean }> {
  const branch = await resolveOrCreateBranch(client, {
    projectId: options.projectId,
    gitName: options.branchName,
    signal: options.signal,
  });
  const result = await client.POST("/v1/apps", {
    body: {
      projectId: options.projectId,
      branchId: branch.id,
      displayName: options.displayName,
      ...(options.region ? { regionId: options.region } : {}),
    } as never,
    signal: options.signal,
  });
  if (result.error || !result.data) {
    if (result.response.status === 409) {
      const existingServices = await listComputeServices(client, {
        projectId: options.projectId,
        branchGitName: options.branchName,
        signal: options.signal,
      });
      const matched = existingServices.find(
        (service) => service.name === options.displayName,
      );
      if (matched) {
        return { service: matched, existing: true };
      }
    }

    throw apiCallError(
      `Failed to create app "${options.displayName}"`,
      result.response,
      result.error,
    );
  }

  return {
    service: toAppRecord(result.data.data as RawAppRecord),
    existing: false,
  };
}

async function listServiceHostnames(
  client: ManagementApiClient,
  serviceId: string,
  signal?: AbortSignal,
): Promise<DomainRecord[]> {
  const result = await client.GET("/v1/services/{serviceId}/urls", {
    params: {
      path: { serviceId },
    },
    signal,
  });

  if (result.error || !result.data) {
    throw domainApiCallError(
      "Failed to list custom domains",
      result.response,
      result.error,
    );
  }

  return result.data.data.map(toDomainRecord);
}

/**
 * A service can list one hostname in several entries, and at most one of
 * them holds the hostname. That one says what the hostname does; without
 * it, the oldest entry stands for the hostname.
 */
export function preferredDomain(
  entries: readonly DomainRecord[],
): DomainRecord | undefined {
  const oldestFirst = [...entries].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  return (
    oldestFirst.find((entry) => entry.state !== "in_use_elsewhere") ??
    oldestFirst[0]
  );
}

function toDomainRecord(url: RawRoutingUrl): DomainRecord {
  return {
    id: url.id,
    type: url.type,
    hostname: url.hostname,
    appId: url.serviceId,
    status: url.status,
    state: url.state,
    conditions: url.conditions,
    firstUnmetCondition: url.firstUnmetCondition,
    failureReason: url.customDomain?.failureReason ?? null,
    syncError: url.customDomainSyncError,
    dnsDetail: url.switchboardDns?.detail ?? null,
    certExpiresAt: url.customDomain?.certExpiresAt ?? null,
    ownershipExpiresAt: url.ownershipExpiry?.expiresAt ?? null,
    heldBy: url.heldBy,
    setupUrl: url.setupUrl,
    createdAt: url.createdAt,
    updatedAt: url.updatedAt,
    dnsRecords: url.records,
  };
}

function sameHostname(left: string, right: string): boolean {
  return (
    normalizeHostnameForComparison(left) ===
    normalizeHostnameForComparison(right)
  );
}

function normalizeHostnameForComparison(hostname: string): string {
  return hostname.trim().replace(/\.$/, "").toLowerCase();
}

function apiCallError(
  summary: string,
  response: Response,
  error: ApiErrorBody,
): Error {
  if (response.status === 404) {
    return new Error("Resource Not Found");
  }

  const message =
    apiErrorDetail(error).message ??
    `Management API returned HTTP ${response.status}.`;
  const hint = apiErrorDetail(error).hint
    ? ` ${apiErrorDetail(error).hint}`
    : "";
  return new Error(`${summary}: ${message}${hint}`);
}

function domainApiCallError(
  summary: string,
  response: Response,
  error: ApiErrorBody,
): DomainApiError {
  return new DomainApiError({
    summary,
    status: response.status,
    code: apiErrorDetail(error).code ?? null,
    message:
      apiErrorDetail(error).message ??
      `Management API returned HTTP ${response.status}.`,
    hint: apiErrorDetail(error).hint ?? null,
    retryAfterSeconds: retryAfterSeconds(response),
  });
}

function retryAfterSeconds(response: Response): number | null {
  const seconds = Number.parseInt(
    response.headers.get("retry-after") ?? "",
    10,
  );
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : null;
}

function toAbsoluteUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }

  return url.startsWith("https://") || url.startsWith("http://")
    ? url
    : `https://${url}`;
}
