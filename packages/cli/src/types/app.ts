import type { AuthWorkspace } from "./auth";
import type { BranchKind } from "./branch";
import type { ProjectResolution, ProjectSummary } from "./project";

export interface AppSummary {
  id: string;
  name: string;
}

export interface AppDeploymentSummary {
  id: string;
  status: string;
  url: string | null;
  createdAt: string;
  live: boolean | null;
}

export interface AppDeployResult {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  branch: {
    name: string;
    kind: BranchKind;
  };
  resolution: ProjectResolution;
  app: AppSummary;
  deployment: {
    id: string;
    status: string;
    url: string | null;
  };
}

export interface AppListEnvResult {
  projectId: string;
  app: AppSummary | null;
  deployment: AppDeploymentSummary | null;
  variables: string[];
}

export interface AppListDeploysResult {
  projectId: string;
  app: AppSummary | null;
  deployments: AppDeploymentSummary[];
}

export interface AppShowResult {
  projectId: string;
  app: AppSummary | null;
  liveDeployment: AppDeploymentSummary | null;
  liveUrl: string | null;
  recentDeployments: AppDeploymentSummary[];
}

export interface AppBuildResult {
  directory: string;
  entrypoint: string | null;
  buildType: "bun" | "nextjs" | "nuxt" | "astro" | "tanstack-start";
}

export interface AppShowDeployResult {
  app: AppSummary | null;
  deployment: AppDeploymentSummary;
}

export interface AppOpenResult {
  projectId: string;
  app: AppSummary;
  url: string;
  opened: boolean;
}

export interface AppRunResult {
  framework: "bun" | "nextjs";
  entrypoint: string | null;
  port: number;
  command: string;
}

export interface AppUpdateEnvResult {
  projectId: string;
  app: AppSummary;
  deployment: AppDeploymentSummary;
  variables: string[];
}

export interface AppPromoteResult {
  projectId: string;
  app: AppSummary;
  deployment: AppDeploymentSummary;
}

export interface AppRollbackResult {
  projectId: string;
  app: AppSummary;
  deployment: AppDeploymentSummary;
  previousLiveDeploymentId: string | null;
}

export interface AppRemoveResult {
  projectId: string;
  app: AppSummary;
  removed: true;
}
