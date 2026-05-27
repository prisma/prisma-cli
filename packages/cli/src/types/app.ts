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
  durationMs: number;
  localPin?: {
    path: string;
    written: boolean;
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

export type AppDomainStatus =
  | "pending_dns"
  | "verifying"
  | "verified_routing_blocked"
  | "provisioning_tls"
  | "active"
  | "failed"
  | "removing";

export type AppDomainFailureCategory = "dns" | "acme" | "storage" | "unknown" | null;

export interface AppDomainDnsRecord {
  type: string;
  name: string;
  value: string;
  ttl: number | null;
}

export interface AppDomainSummary {
  id: string;
  type: "custom-domain";
  url: string;
  hostname: string;
  computeServiceId: string;
  status: AppDomainStatus;
  foundryStatus: string;
  failureReason: string | null;
  failureCategory: AppDomainFailureCategory;
  certExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  dnsRecords: AppDomainDnsRecord[];
}

export interface AppDomainTarget {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  branch: {
    name: string;
    kind: BranchKind;
  };
  app: AppSummary;
}

export interface AppDomainAddResult extends AppDomainTarget {
  domain: AppDomainSummary;
  existing: boolean;
}

export interface AppDomainShowResult extends AppDomainTarget {
  domain: AppDomainSummary;
}

export interface AppDomainRemoveResult extends AppDomainTarget {
  hostname: string;
  removed: true;
}

export interface AppDomainRetryResult extends AppDomainTarget {
  domain: AppDomainSummary;
}
