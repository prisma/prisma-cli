import path from "node:path";

import { ApiError, CancelledError, ComputeClient, streamLogs } from "@prisma/compute-sdk";
import type { PortMapping, StreamRecord } from "@prisma/compute-sdk";
import type { ManagementApiClient } from "@prisma/management-api-sdk";

import { envVarNames } from "./env-vars";
import { PreviewBuildStrategy } from "./preview-build";
import type { PreviewBuildType } from "./preview-build";

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

export interface PreviewAppProvider {
  createProject(options: { name: string }): Promise<PreviewProjectRecord>;
  listApps(projectId: string, options?: { branchName?: string }): Promise<PreviewAppRecord[]>;
  removeApp(appId: string): Promise<PreviewRemovedAppRecord>;
  promoteDeployment(options: {
    appId: string;
    deploymentId: string;
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
    portMapping?: PortMapping;
    envVars?: Record<string, string>;
    interaction?: unknown;
    progress?: unknown;
  }): Promise<PreviewDeployRecord>;
  updateAppEnv(options: {
    appId: string;
    envVars: Record<string, string>;
    progress?: unknown;
    promoteProgress?: unknown;
  }): Promise<PreviewEnvRecord>;
  listAppEnvNames(options: {
    appId: string;
    deploymentId: string;
  }): Promise<PreviewEnvRecord>;
  listDeployments(appId: string): Promise<{
    app: PreviewAppRecord;
    deployments: PreviewDeploymentRecord[];
  }>;
  showDeployment(deploymentId: string): Promise<PreviewShownDeploymentRecord | null>;
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
      const projectResult = await sdk.createProject({ name: options.name });
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
      });
    },

    async removeApp(appId) {
      const appResult = await sdk.showService({ serviceId: appId });
      if (appResult.isErr()) {
        throw new Error(appResult.error.message);
      }

      const destroyResult = await sdk.destroyService({
        serviceId: appId,
        keepService: false,
        timeoutSeconds: 120,
        pollIntervalMs: 2_000,
      });

      if (destroyResult.isErr()) {
        throw new Error(destroyResult.error.message);
      }

      return {
        id: appResult.value.id,
        name: appResult.value.name,
      };
    },

    async promoteDeployment(options) {
      const promoteResult = await sdk.promote({
        serviceId: options.appId,
        versionId: options.deploymentId,
        timeoutSeconds: 120,
        pollIntervalMs: 2000,
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
          url: toAbsoluteUrl(deployed.serviceEndpointDomain ?? deployed.versionEndpointDomain ?? null),
        },
      };
    },

    async updateAppEnv(options) {
      const updateResult = await sdk.updateEnv({
        serviceId: options.appId,
        envVars: options.envVars,
        timeoutSeconds: 120,
        pollIntervalMs: 2000,
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
        progress: options.promoteProgress as never,
      });

      if (promoteResult.isErr()) {
        throw new Error(promoteResult.error.message);
      }

      const [serviceResult, versionResult] = await Promise.all([
        sdk.showService({ serviceId: options.appId }),
        sdk.showVersion({ versionId: updateResult.value.versionId }),
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
          liveUrl: toAbsoluteUrl(serviceResult.value.serviceEndpointDomain ?? null),
        },
        deployment: {
          id: versionResult.value.id,
          status: versionResult.value.status,
          createdAt: versionResult.value.createdAt,
          url: toAbsoluteUrl(serviceResult.value.serviceEndpointDomain ?? versionResult.value.previewDomain ?? null),
          live: true,
        },
        variables: envVarNames(versionResult.value.envVars),
      };
    },

    async listAppEnvNames(options) {
      const [serviceResult, versionResult] = await Promise.all([
        sdk.showService({ serviceId: options.appId }),
        sdk.showVersion({ versionId: options.deploymentId }),
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
          liveUrl: toAbsoluteUrl(serviceResult.value.serviceEndpointDomain ?? null),
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

    async listDeployments(appId) {
      const [appResult, versionsResult] = await Promise.all([
        sdk.showService({ serviceId: appId }),
        sdk.listVersions({ serviceId: appId }),
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

    async showDeployment(deploymentId) {
      const deploymentResult = await sdk.showVersion({ versionId: deploymentId });
      if (deploymentResult.isErr()) {
        if (ApiError.is(deploymentResult.error) && deploymentResult.error.statusCode === 404) {
          return null;
        }

        throw new Error(deploymentResult.error.message);
      }

      const app = await findAppForDeployment(sdk, deploymentId);

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
        throw new Error("Log streaming requires an authenticated API base URL and token.");
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

async function listBranches(
  client: ManagementApiClient,
  options: {
    projectId: string;
    gitName: string;
  },
): Promise<RawBranchRecord[]> {
  const result = await client.GET("/v1/projects/{projectId}/branches", {
    params: {
      path: { projectId: options.projectId },
      query: { gitName: options.gitName },
    },
  });
  if (result.error || !result.data) {
    throw apiCallError("Failed to list branches", result.response, result.error);
  }

  return result.data.data as RawBranchRecord[];
}

async function resolveOrCreateBranch(
  client: ManagementApiClient,
  options: {
    projectId: string;
    gitName: string;
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
      isDefault: options.gitName === "main",
    },
  });
  if (result.error || !result.data) {
    if (result.response.status === 409) {
      const raced = (await listBranches(client, options))[0];
      if (raced) {
        return raced;
      }
    }

    throw apiCallError(`Failed to create branch "${options.gitName}"`, result.response, result.error);
  }

  return result.data.data as RawBranchRecord;
}

async function listComputeServices(
  client: ManagementApiClient,
  options: {
    projectId: string;
    branchGitName?: string;
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
    });
    if (result.error || !result.data) {
      throw apiCallError("Failed to list apps", result.response, result.error);
    }

    services.push(...result.data.data as RawComputeServiceRecord[]);

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

async function createBranchApp(
  client: ManagementApiClient,
  options: {
    projectId: string;
    branchName: string;
    appName: string;
    region?: string;
  },
): Promise<{ appId: string; appName: string; region: string | undefined }> {
  const branch = await resolveOrCreateBranch(client, {
    projectId: options.projectId,
    gitName: options.branchName,
  });
  const result = await client.POST("/v1/compute-services", {
    body: {
      projectId: options.projectId,
      branchId: branch.id,
      displayName: options.appName,
      ...(options.region ? { regionId: options.region } : {}),
    } as never,
  });
  if (result.error || !result.data) {
    if (result.response.status === 409) {
      const existingApps = await listComputeServices(client, {
        projectId: options.projectId,
        branchGitName: options.branchName,
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

    throw apiCallError(`Failed to create app "${options.appName}"`, result.response, result.error);
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

  const message = error.error?.message ?? `Management API returned HTTP ${response.status}.`;
  const hint = error.error?.hint ? ` ${error.error.hint}` : "";
  return new Error(`${summary}: ${message}${hint}`);
}

async function findAppForDeployment(
  sdk: ComputeClient,
  deploymentId: string,
): Promise<PreviewAppRecord | null> {
  const projectsResult = await sdk.listProjects();
  if (projectsResult.isErr()) {
    throw new Error(projectsResult.error.message);
  }

  for (const project of projectsResult.value) {
    const servicesResult = await sdk.listServices({ projectId: project.id });
    if (servicesResult.isErr()) {
      throw new Error(servicesResult.error.message);
    }

    for (const service of servicesResult.value) {
      const detailResult = await sdk.showService({ serviceId: service.id });
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

      const versionsResult = await sdk.listVersions({ serviceId: service.id });
      if (versionsResult.isErr()) {
        throw new Error(versionsResult.error.message);
      }

      if (versionsResult.value.some((version) => version.id === deploymentId)) {
        return app;
      }
    }
  }

  return null;
}

function toAbsoluteUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }

  return url.startsWith("https://") || url.startsWith("http://") ? url : `https://${url}`;
}
