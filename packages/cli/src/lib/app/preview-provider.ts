import path from "node:path";

import { ApiError, ComputeClient } from "@prisma/compute-sdk";
import type { PortMapping } from "@prisma/compute-sdk";
import type { ManagementApiClient } from "@prisma/management-api-sdk";

import { envVarNames } from "./env-vars";
import { PreviewBuildStrategy } from "./preview-build";
import type { PreviewBuildType } from "./preview-build";

export interface PreviewAppRecord {
  id: string;
  name: string;
  region: string | null;
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
  listApps(projectId: string): Promise<PreviewAppRecord[]>;
  removeApp(appId: string): Promise<PreviewRemovedAppRecord>;
  promoteDeployment(options: {
    appId: string;
    deploymentId: string;
    progress?: unknown;
  }): Promise<void>;
  deployApp(options: {
    cwd: string;
    projectId: string;
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
}

export function createPreviewAppProvider(client: ManagementApiClient): PreviewAppProvider {
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

    async listApps(projectId) {
      const servicesResult = await sdk.listServices({ projectId });
      if (servicesResult.isErr()) {
        throw new Error(servicesResult.error.message);
      }

      const serviceDetails = await Promise.all(
        servicesResult.value.map(async (service) => {
          const detailResult = await sdk.showService({ serviceId: service.id });
          return detailResult.isOk()
            ? detailResult.value
            : {
                id: service.id,
                name: service.name,
                region: service.region,
                latestVersionId: null,
                serviceEndpointDomain: undefined,
              };
        }),
      );

      return serviceDetails.map((service) => ({
        id: service.id,
        name: service.name,
        region: service.region ?? null,
        liveDeploymentId: service.latestVersionId ?? null,
        liveUrl: toAbsoluteUrl(service.serviceEndpointDomain ?? null),
      }));
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
      const deployResult = await sdk.deploy({
        strategy: new PreviewBuildStrategy({
          appPath: path.resolve(options.cwd),
          entrypoint: options.entrypoint,
          buildType: options.buildType,
        }),
        projectId: options.projectId,
        serviceId: options.appId,
        serviceName: options.appName,
        region: options.region,
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
  };
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
