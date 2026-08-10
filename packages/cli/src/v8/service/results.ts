import type { AppDomainDnsRecord, AppDomainStatus } from "../../types/app";
import type { AuthWorkspace } from "../../types/auth";
import type { BranchKind } from "../../types/branch";
import type { ProjectResolution, ProjectSummary } from "../../types/project";

export interface ServiceSummary {
  id: string;
  name: string;
}

export interface ServiceDeploymentSummary {
  id: string;
  status: string;
  url: string | null;
  createdAt: string;
  live: boolean | null;
}

export interface ServiceShowResult {
  projectId: string;
  service: ServiceSummary | null;
  liveDeployment: ServiceDeploymentSummary | null;
  liveUrl: string | null;
  recentDeployments: ServiceDeploymentSummary[];
}

export interface ServiceListDeploysResult {
  projectId: string;
  service: ServiceSummary | null;
  deployments: ServiceDeploymentSummary[];
}

export interface ServiceShowDeployResult {
  service: ServiceSummary | null;
  deployment: ServiceDeploymentSummary;
}

export interface ServiceOpenResult {
  projectId: string;
  service: ServiceSummary;
  url: string;
  opened: boolean;
}

export interface ServiceBuildResult {
  directory: string;
  entrypoint: string | null;
  buildType:
    | "bun"
    | "nextjs"
    | "nuxt"
    | "astro"
    | "nestjs"
    | "tanstack-start"
    | "custom";
}

export interface ServiceBranchDatabaseResult {
  status: "created" | "skipped";
  reason?: string;
  database?: { id: string; name: string };
  envVars: string[];
}

export interface ServiceDeploySettings {
  config: {
    /** The compute config path when it owns the build settings. */
    path: string | null;
    status: "config" | "inferred";
  };
  buildCommand: { value: string | null; source: string | null };
  outputDirectory: { value: string; source: string | null };
  framework: {
    key: string;
    buildType: ServiceBuildResult["buildType"];
    name: string;
    source: string;
  };
  entrypoint: string | null;
  httpPort: number;
  region: string | null;
  regionSource: string | null;
  envVars: string[];
}

export interface ServiceDeployResult {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  branch: { id: string | null; name: string; kind: BranchKind };
  resolution: ProjectResolution;
  branchDatabase?: ServiceBranchDatabaseResult;
  service: ServiceSummary;
  deployment: {
    id: string;
    status: string;
    url: string | null;
    live: boolean;
  };
  /** Whether the new deployment was promoted to live. False for --no-promote. */
  promoted: boolean;
  deploySettings: ServiceDeploySettings;
  durationMs: number;
  localPin?: { path: string; written: boolean };
}

export interface ServiceDeployAllResult {
  /** One full deploy per config target, in declaration order. */
  deployments: Array<{ target: string; result: ServiceDeployResult }>;
}

export interface ServicePromoteResult {
  projectId: string;
  service: ServiceSummary;
  deployment: ServiceDeploymentSummary;
}

export interface ServiceRollbackResult extends ServicePromoteResult {
  previousLiveDeploymentId: string | null;
}

export interface ServiceRemoveResult {
  projectId: string;
  service: ServiceSummary;
  removed: true;
}

export interface ServiceDomainSummary {
  id: string;
  type: "custom-domain";
  url: string;
  hostname: string;
  serviceId: string;
  status: AppDomainStatus;
  foundryStatus: string;
  failureReason: string | null;
  failureCategory: "dns" | "acme" | "storage" | "unknown" | null;
  certExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  dnsRecords: AppDomainDnsRecord[];
}

export interface ServiceDomainTarget {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  branch: {
    name: string;
    kind: BranchKind;
  };
  service: ServiceSummary;
}

export interface ServiceDomainAddResult extends ServiceDomainTarget {
  domain: ServiceDomainSummary;
  existing: boolean;
}

export interface ServiceDomainShowResult extends ServiceDomainTarget {
  domain: ServiceDomainSummary;
}

export interface ServiceDomainRemoveResult extends ServiceDomainTarget {
  hostname: string;
  removed: true;
}

export interface ServiceDomainRetryResult extends ServiceDomainTarget {
  domain: ServiceDomainSummary;
}

export interface ServiceDomainWaitResult extends ServiceDomainTarget {
  hostname: string;
  status: AppDomainStatus;
  liveUrl: string;
}
