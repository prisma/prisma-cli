import path from "node:path";
import type { PortMapping, StreamRecord } from "@prisma/compute-sdk";
import {
  ApiError,
  CancelledError,
  ComputeClient,
  streamLogs,
} from "@prisma/compute-sdk";
import type { ManagementApiClient } from "@prisma/management-api-sdk";
import type { BranchKind } from "../../types/branch";
import { envVarNames } from "./env-vars";
import {
  createBranchDatabase,
  createEnvironmentVariable,
  deleteBranchDatabase,
  deleteEnvironmentVariable,
  listEnvironmentVariables,
  type PreviewBranchDatabaseRecord,
  type PreviewEnvironmentVariableRecord,
  updateEnvironmentVariable,
} from "./preview-branch-database";
import type { PreviewBuildSettings, PreviewBuildType } from "./preview-build";
import { PreviewBuildStrategy } from "./preview-build";

export interface PreviewAppRecord {
  id: string;
  name: string;
  region: string | null;
  branchId?: string | null;
  liveDeploymentId: string | null;
  liveUrl: string | null;
}

export interface PreviewProjectRecord {
  id: string;
  name: string;
}

export interface PreviewBranchRecord {
  id: string;
  name: string;
  role: BranchKind;
}

export type {
  PreviewBranchDatabaseRecord,
  PreviewEnvironmentVariableRecord,
} from "./preview-branch-database";

export interface PreviewDeploymentRecord {
  id: string;
  status: string;
  createdAt: string;
  url: string | null;
  live: boolean | null;
}

export interface PreviewDeployRecord {
  projectId: string;
  app: PreviewAppRecord;
  deployment: {
    id: string;
    status: string;
    url: string | null;
  };
}

export interface PreviewEnvRecord {
  projectId: string;
  app: PreviewAppRecord;
  deployment: PreviewDeploymentRecord;
  variables: string[];
}

export interface PreviewShownDeploymentRecord {
  app: PreviewAppRecord | null;
  deployment: PreviewDeploymentRecord;
}

export interface PreviewRemovedAppRecord {
  id: string;
  name: string;
}

export type PreviewDomainStatus =
  | "pending_dns"
  | "verifying"
  | "verified_routing_blocked"
  | "provisioning_tls"
  | "active"
  | "failed"
  | "removing";

export interface PreviewDomainDnsRecord {
  type: string;
  name: string;
  value: string;
  ttl: number | null;
}

export interface PreviewDomainRecord {
  id: string;
  type: "custom-domain";
  url: string;
  hostname: string;
  computeServiceId: string;
  status: PreviewDomainStatus;
  foundryStatus: string;
  failureReason: string | null;
  failureCategory: "dns" | "acme" | "storage" | "unknown" | null;
  certExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  dnsRecords: PreviewDomainDnsRecord[];
}

export class PreviewDomainApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly hint: string | null;

  constructor(options: {
    summary: string;
    status: number;
    message: string;
    code?: string | null;
    hint?: string | null;
  }) {
    super(
      `${options.summary}: ${options.message}${options.hint ? ` ${options.hint}` : ""}`,
    );
    this.name = "PreviewDomainApiError";
    this.status = options.status;
    this.code = options.code ?? null;
    this.hint = options.hint ?? null;
  }
}

export interface PreviewAppProvider {
  createProject(options: {
    name: string;
    signal?: AbortSignal;
  }): Promise<PreviewProjectRecord>;
  resolveBranch(
    projectId: string,
    options: { branchName: string; signal?: AbortSignal },
  ): Promise<PreviewBranchRecord>;
  createBranchDatabase(options: {
    projectId: string;
    branchId: string;
    branchName: string;
    signal?: AbortSignal;
  }): Promise<PreviewBranchDatabaseRecord>;
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
  }): Promise<PreviewEnvironmentVariableRecord[]>;
  createEnvironmentVariable(options: {
    projectId: string;
    branchId?: string;
    className: "production" | "preview";
    key: string;
    value: string;
    signal?: AbortSignal;
  }): Promise<PreviewEnvironmentVariableRecord>;
  updateEnvironmentVariable(options: {
    envVarId: string;
    value: string;
    signal?: AbortSignal;
  }): Promise<PreviewEnvironmentVariableRecord>;
  deleteEnvironmentVariable(options: {
    envVarId: string;
    signal?: AbortSignal;
  }): Promise<void>;
  listApps(
    projectId: string,
    options?: { branchName?: string; signal?: AbortSignal },
  ): Promise<PreviewAppRecord[]>;
  removeApp(
    appId: string,
    options?: { signal?: AbortSignal },
  ): Promise<PreviewRemovedAppRecord>;
  listDomains(
    appId: string,
    options?: { signal?: AbortSignal },
  ): Promise<PreviewDomainRecord[]>;
  addDomain(options: {
    appId: string;
    hostname: string;
    signal?: AbortSignal;
  }): Promise<{ domain: PreviewDomainRecord; existing: boolean }>;
  showDomain(
    domainId: string,
    options?: { signal?: AbortSignal },
  ): Promise<PreviewDomainRecord>;
  removeDomain(
    domainId: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  retryDomain(
    domainId: string,
    options?: { signal?: AbortSignal },
  ): Promise<PreviewDomainRecord>;
  promoteDeployment(options: {
    appId: string;
    deploymentId: string;
    signal?: AbortSignal;
    progress?: unknown;
  }): Promise<void>;
  deployApp(options: {
    cwd: string;
    projectId: string;
    branchName?: string;
    appId?: string;
    appName?: string;
    region?: string;
    entrypoint?: string;
    buildType?: PreviewBuildType;
    buildSettings?: PreviewBuildSettings;
    portMapping?: PortMapping;
    envVars?: Record<string, string>;
    interaction?: unknown;
    signal?: AbortSignal;
    progress?: unknown;
  }): Promise<PreviewDeployRecord>;
  updateAppEnv(options: {
    appId: string;
    envVars: Record<string, string>;
    signal?: AbortSignal;
    progress?: unknown;
    promoteProgress?: unknown;
  }): Promise<PreviewEnvRecord>;
  listAppEnvNames(options: {
    appId: string;
    deploymentId: string;
    signal?: AbortSignal;
  }): Promise<PreviewEnvRecord>;
  listDeployments(
    appId: string,
    options?: { signal?: AbortSignal },
  ): Promise<{
    app: PreviewAppRecord;
    deployments: PreviewDeploymentRecord[];
  }>;
  showDeployment(
    deploymentId: string,
    options?: { signal?: AbortSignal },
  ): Promise<PreviewShownDeploymentRecord | null>;
  streamDeploymentLogs(options: {
    deploymentId: string;
    signal?: AbortSignal;
    onRecord(record: StreamRecord): void;
  }): Promise<void>;
}

export function createPreviewAppProvider(
  client: ManagementApiClient,
  options?: {
    baseUrl?: string;
    getToken?: () => Promise<string>;
  },
): PreviewAppProvider {
  const sdk = new ComputeClient(client);

  return {
    async createProject(options) {
      const projectResult = await sdk.createProject({
        name: options.name,
        signal: options.signal,
      });
      if (projectResult.isErr()) {
        throw new Error(projectResult.error.message);
      }

      return {
        id: projectResult.value.id,
        name: projectResult.value.name,
      };
    },

    async listApps(projectId, options) {
      return listComputeServices(client, {
        projectId,
        branchGitName: options?.branchName,
        signal: options?.signal,
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
      const appResult = await sdk.showService({
        serviceId: appId,
        signal: options?.signal,
      });
      if (appResult.isErr()) {
        throw new Error(appResult.error.message);
      }

      const destroyResult = await sdk.destroyService({
        serviceId: appId,
        keepService: false,
        timeoutSeconds: 120,
        pollIntervalMs: 2_000,
        signal: options?.signal,
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
      return listComputeServiceDomains(client, appId, options?.signal);
    },

    async addDomain(options) {
      const result = await client.POST(
        "/v1/compute-services/{computeServiceId}/domains",
        {
          params: {
            path: { computeServiceId: options.appId },
          },
          body: {
            hostname: options.hostname,
          },
          signal: options.signal,
        },
      );

      if (result.error || !result.data) {
        if (result.response.status === 409) {
          const existing = (
            await listComputeServiceDomains(
              client,
              options.appId,
              options.signal,
            )
          ).find((domain) => sameHostname(domain.hostname, options.hostname));
          if (existing) {
            return {
              domain: existing,
              existing: true,
            };
          }
        }

        throw domainApiCallError(
          "Failed to add custom domain",
          result.response,
          result.error,
        );
      }

      return {
        domain: normalizeDomainRecord(result.data.data),
        existing: false,
      };
    },

    async showDomain(domainId, options) {
      const result = await client.GET("/v1/domains/{domainId}", {
        params: {
          path: { domainId },
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

      return normalizeDomainRecord(result.data.data);
    },

    async removeDomain(domainId, options) {
      const result = await client.DELETE("/v1/domains/{domainId}", {
        params: {
          path: { domainId },
        },
        signal: options?.signal,
      });

      if (result.error) {
        throw domainApiCallError(
          "Failed to remove custom domain",
          result.response,
          result.error,
        );
      }
    },

    async retryDomain(domainId, options) {
      const result = await client.POST("/v1/domains/{domainId}/retry", {
        params: {
          path: { domainId },
        },
        signal: options?.signal,
      });

      if (result.error || !result.data) {
        throw domainApiCallError(
          "Failed to retry custom domain",
          result.response,
          result.error,
        );
      }

      return normalizeDomainRecord(result.data.data);
    },

    async promoteDeployment(options) {
      const promoteResult = await sdk.promote({
        serviceId: options.appId,
        versionId: options.deploymentId,
        timeoutSeconds: 120,
        pollIntervalMs: 2000,
        signal: options.signal,
        progress: options.progress as never,
      });

      if (promoteResult.isErr()) {
        throw new Error(promoteResult.error.message);
      }
    },

    async deployApp(options) {
      const resolvedApp = options.appId
        ? {
            appId: options.appId,
            appName: options.appName,
            region: options.region,
          }
        : options.branchName && options.appName
          ? await createBranchApp(client, {
              projectId: options.projectId,
              branchName: options.branchName,
              appName: options.appName,
              region: options.region,
              signal: options.signal,
            })
          : {
              appId: undefined,
              appName: options.appName,
              region: options.region,
            };

      const deployResult = await sdk.deploy({
        strategy: new PreviewBuildStrategy({
          appPath: path.resolve(options.cwd),
          entrypoint: options.entrypoint,
          buildType: options.buildType,
          signal: options.signal,
          buildSettings: options.buildSettings,
        }),
        projectId: options.projectId,
        serviceId: resolvedApp.appId,
        serviceName: resolvedApp.appName,
        region: resolvedApp.region,
        portMapping: options.portMapping,
        envVars: options.envVars,
        timeoutSeconds: 120,
        pollIntervalMs: 2000,
        interaction: options.interaction as never,
        signal: options.signal,
        progress: options.progress as never,
      });

      if (deployResult.isErr()) {
        throw new Error(deployResult.error.message);
      }

      const deployed = deployResult.value;

      return {
        projectId: deployed.projectId,
        app: {
          id: deployed.serviceId,
          name: deployed.serviceName,
          region: deployed.region ?? null,
          liveDeploymentId: deployed.versionId,
          liveUrl: toAbsoluteUrl(deployed.serviceEndpointDomain ?? null),
        },
        deployment: {
          id: deployed.versionId,
          status: "running",
          url: toAbsoluteUrl(
            deployed.serviceEndpointDomain ??
              deployed.versionEndpointDomain ??
              null,
          ),
        },
      };
    },

    async updateAppEnv(options) {
      const updateResult = await sdk.updateEnv({
        serviceId: options.appId,
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
        serviceId: options.appId,
        versionId: updateResult.value.versionId,
        timeoutSeconds: 120,
        pollIntervalMs: 2000,
        signal: options.signal,
        progress: options.promoteProgress as never,
      });

      if (promoteResult.isErr()) {
        throw new Error(promoteResult.error.message);
      }

      const [serviceResult, versionResult] = await Promise.all([
        sdk.showService({ serviceId: options.appId, signal: options.signal }),
        sdk.showVersion({
          versionId: updateResult.value.versionId,
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
          liveDeploymentId: serviceResult.value.latestVersionId ?? null,
          liveUrl: toAbsoluteUrl(
            serviceResult.value.serviceEndpointDomain ?? null,
          ),
        },
        deployment: {
          id: versionResult.value.id,
          status: versionResult.value.status,
          createdAt: versionResult.value.createdAt,
          url: toAbsoluteUrl(
            serviceResult.value.serviceEndpointDomain ??
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
        sdk.showService({ serviceId: options.appId, signal: options.signal }),
        sdk.showVersion({
          versionId: options.deploymentId,
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
          liveDeploymentId: serviceResult.value.latestVersionId ?? null,
          liveUrl: toAbsoluteUrl(
            serviceResult.value.serviceEndpointDomain ?? null,
          ),
        },
        deployment: {
          id: versionResult.value.id,
          status: versionResult.value.status,
          createdAt: versionResult.value.createdAt,
          url: toAbsoluteUrl(versionResult.value.previewDomain ?? null),
          live: serviceResult.value.latestVersionId === versionResult.value.id,
        },
        variables: envVarNames(versionResult.value.envVars),
      };
    },

    async listDeployments(appId, options) {
      const [appResult, versionsResult] = await Promise.all([
        sdk.showService({ serviceId: appId, signal: options?.signal }),
        sdk.listVersions({ serviceId: appId, signal: options?.signal }),
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
          liveDeploymentId: appResult.value.latestVersionId ?? null,
          liveUrl: toAbsoluteUrl(appResult.value.serviceEndpointDomain ?? null),
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
      const deploymentResult = await sdk.showVersion({
        versionId: deploymentId,
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

      const app = await findAppForDeployment(
        sdk,
        deploymentId,
        options?.signal,
      );

      return {
        app,
        deployment: {
          id: deploymentResult.value.id,
          status: deploymentResult.value.status,
          createdAt: deploymentResult.value.createdAt,
          url: toAbsoluteUrl(deploymentResult.value.previewDomain ?? null),
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
          versionId: streamOptions.deploymentId,
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

interface RawComputeServiceRecord {
  id: string;
  name: string;
  region: {
    id: string;
    name?: string;
  };
  projectId: string;
  branchId: string | null;
  latestVersionId: string | null;
  serviceEndpointDomain: string | null;
}

interface RawApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    hint?: string;
  };
}

interface RawDomainDnsRecord {
  type?: unknown;
  name?: unknown;
  value?: unknown;
  ttl?: unknown;
}

interface RawDomainRecord {
  id: string;
  type: "custom-domain";
  url: string;
  hostname: string;
  computeServiceId: string;
  status: PreviewDomainStatus;
  foundryStatus: string;
  failureReason: string | null;
  failureCategory: "dns" | "acme" | "storage" | "unknown" | null;
  certExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  dnsRecords?: RawDomainDnsRecord[] | null;
}

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
): Promise<PreviewAppRecord[]> {
  const services: RawComputeServiceRecord[] = [];
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await client.GET("/v1/compute-services", {
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

    services.push(...(result.data.data as RawComputeServiceRecord[]));

    if (!result.data.pagination.hasMore || !result.data.pagination.nextCursor) {
      break;
    }
    cursor = result.data.pagination.nextCursor;
  }

  return services.map((service) => ({
    id: service.id,
    name: service.name,
    region: service.region.id ?? null,
    branchId: service.branchId,
    liveDeploymentId: service.latestVersionId ?? null,
    liveUrl: toAbsoluteUrl(service.serviceEndpointDomain ?? null),
  }));
}

async function listComputeServiceDomains(
  client: ManagementApiClient,
  computeServiceId: string,
  signal?: AbortSignal,
): Promise<PreviewDomainRecord[]> {
  const result = await client.GET(
    "/v1/compute-services/{computeServiceId}/domains",
    {
      params: {
        path: { computeServiceId },
      },
      signal,
    },
  );

  if (result.error || !result.data) {
    throw domainApiCallError(
      "Failed to list custom domains",
      result.response,
      result.error,
    );
  }

  return result.data.data.map((domain) => normalizeDomainRecord(domain));
}

function normalizeDomainRecord(domain: RawDomainRecord): PreviewDomainRecord {
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
    dnsRecords: normalizeDomainDnsRecords(domain.dnsRecords),
  };
}

function normalizeDomainDnsRecords(
  records: RawDomainDnsRecord[] | null | undefined,
): PreviewDomainDnsRecord[] {
  if (!Array.isArray(records)) {
    return [];
  }

  return records
    .map((record) => {
      if (
        typeof record.type !== "string" ||
        typeof record.name !== "string" ||
        typeof record.value !== "string"
      ) {
        return null;
      }

      return {
        type: record.type,
        name: record.name,
        value: record.value,
        ttl: typeof record.ttl === "number" ? record.ttl : null,
      };
    })
    .filter((record): record is PreviewDomainDnsRecord => Boolean(record));
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

async function createBranchApp(
  client: ManagementApiClient,
  options: {
    projectId: string;
    branchName: string;
    appName: string;
    region?: string;
    signal?: AbortSignal;
  },
): Promise<{ appId: string; appName: string; region: string | undefined }> {
  const branch = await resolveOrCreateBranch(client, {
    projectId: options.projectId,
    gitName: options.branchName,
    signal: options.signal,
  });
  const result = await client.POST("/v1/compute-services", {
    body: {
      projectId: options.projectId,
      branchId: branch.id,
      displayName: options.appName,
      ...(options.region ? { regionId: options.region } : {}),
    } as never,
    signal: options.signal,
  });
  if (result.error || !result.data) {
    if (result.response.status === 409) {
      const existingApps = await listComputeServices(client, {
        projectId: options.projectId,
        branchGitName: options.branchName,
        signal: options.signal,
      });
      const matched = existingApps.find((app) => app.name === options.appName);
      if (matched) {
        return {
          appId: matched.id,
          appName: matched.name,
          region: matched.region ?? options.region,
        };
      }
    }

    throw apiCallError(
      `Failed to create app "${options.appName}"`,
      result.response,
      result.error,
    );
  }

  const service = result.data.data as RawComputeServiceRecord;
  return {
    appId: service.id,
    appName: service.name,
    region: service.region.id ?? options.region,
  };
}

function apiCallError(
  summary: string,
  response: Response,
  error: RawApiErrorBody,
): Error {
  if (response.status === 404) {
    return new Error("Resource Not Found");
  }

  const message =
    error.error?.message ?? `Management API returned HTTP ${response.status}.`;
  const hint = error.error?.hint ? ` ${error.error.hint}` : "";
  return new Error(`${summary}: ${message}${hint}`);
}

function domainApiCallError(
  summary: string,
  response: Response,
  error: RawApiErrorBody,
): PreviewDomainApiError {
  return new PreviewDomainApiError({
    summary,
    status: response.status,
    code: error.error?.code ?? null,
    message:
      error.error?.message ??
      `Management API returned HTTP ${response.status}.`,
    hint: error.error?.hint ?? null,
  });
}

async function findAppForDeployment(
  sdk: ComputeClient,
  deploymentId: string,
  signal?: AbortSignal,
): Promise<PreviewAppRecord | null> {
  const projectsResult = await sdk.listProjects({ signal });
  if (projectsResult.isErr()) {
    throw new Error(projectsResult.error.message);
  }

  for (const project of projectsResult.value) {
    const servicesResult = await sdk.listServices({
      projectId: project.id,
      signal,
    });
    if (servicesResult.isErr()) {
      throw new Error(servicesResult.error.message);
    }

    for (const service of servicesResult.value) {
      const app = await findServiceAppForDeployment(
        sdk,
        service.id,
        deploymentId,
        signal,
      );
      if (app) {
        return app;
      }
    }
  }

  return null;
}

async function findServiceAppForDeployment(
  sdk: ComputeClient,
  serviceId: string,
  deploymentId: string,
  signal?: AbortSignal,
): Promise<PreviewAppRecord | null> {
  const detailResult = await sdk.showService({
    serviceId,
    signal,
  });
  if (detailResult.isErr()) {
    throw new Error(detailResult.error.message);
  }

  const app: PreviewAppRecord = {
    id: detailResult.value.id,
    name: detailResult.value.name,
    region: detailResult.value.region ?? null,
    liveDeploymentId: detailResult.value.latestVersionId ?? null,
    liveUrl: toAbsoluteUrl(detailResult.value.serviceEndpointDomain ?? null),
  };

  if (app.liveDeploymentId === deploymentId) {
    return app;
  }

  const versionsResult = await sdk.listVersions({
    serviceId,
    signal,
  });
  if (versionsResult.isErr()) {
    throw new Error(versionsResult.error.message);
  }

  return versionsResult.value.some((version) => version.id === deploymentId)
    ? app
    : null;
}

function toAbsoluteUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }

  return url.startsWith("https://") || url.startsWith("http://")
    ? url
    : `https://${url}`;
}
