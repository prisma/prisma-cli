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

export interface AppResolvedContext {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  branch: {
    id: string | null;
    name: string;
    kind: BranchKind;
  };
  resolution: ProjectResolution;
}

export interface AppDeploySettings {
  config: {
    /** The compute config path when it owns the build settings. */
    path: string | null;
    status: "config" | "inferred";
  };
  buildCommand: {
    value: string | null;
    source: string | null;
  };
  outputDirectory: {
    value: string;
    source: string | null;
  };
  framework: {
    key: string;
    buildType: AppBuildResult["buildType"];
    name: string;
    source: string;
  };
  entrypoint: string | null;
  httpPort: number;
  region: string | null;
  /** Annotation from the deploy input that produced region (e.g. "set by --region"). Null when the server assigned the region with no explicit input. */
  regionSource: string | null;
  envVars: string[];
}

export interface AppDeployResult {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  branch: {
    id: string | null;
    name: string;
    kind: BranchKind;
  };
  resolution: ProjectResolution;
  branchDatabase?: {
    status: "created" | "skipped";
    reason?: string;
    database?: {
      id: string;
      name: string;
    };
    envVars: string[];
  };
  app: AppSummary;
  deployment: {
    id: string;
    status: string;
    url: string | null;
    live: boolean;
  };
  /** Whether the new deployment was promoted to live. False for --no-promote. */
  promoted: boolean;
  deploySettings: AppDeploySettings;
  durationMs: number;
  localPin?: {
    path: string;
    written: boolean;
  };
}

export interface AppDeployAllResult {
  /** Aggregate of one full deploy per config target, in declaration order. */
  deployments: Array<{
    target: string;
    result: AppDeployResult;
  }>;
}

export interface AppListDeploysResult {
  projectId: string;
  verboseContext?: AppResolvedContext;
  app: AppSummary | null;
  deployments: AppDeploymentSummary[];
}

export interface AppShowResult {
  projectId: string;
  verboseContext?: AppResolvedContext;
  app: AppSummary | null;
  liveDeployment: AppDeploymentSummary | null;
  liveUrl: string | null;
  recentDeployments: AppDeploymentSummary[];
}

export interface AppBuildResult {
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

export interface AppShowDeployResult {
  app: AppSummary | null;
  deployment: AppDeploymentSummary;
}

export interface AppOpenResult {
  projectId: string;
  verboseContext?: AppResolvedContext;
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

export interface AppPromoteResult {
  projectId: string;
  verboseContext?: AppResolvedContext;
  app: AppSummary;
  deployment: AppDeploymentSummary;
}

export interface AppRollbackResult {
  projectId: string;
  verboseContext?: AppResolvedContext;
  app: AppSummary;
  deployment: AppDeploymentSummary;
  previousLiveDeploymentId: string | null;
}

export type AppDomainStatus =
  | "pending_dns"
  | "verifying"
  | "verified_routing_blocked"
  | "provisioning_tls"
  | "active"
  | "failed"
  | "removing";

export type AppDomainFailureCategory =
  | "dns"
  | "acme"
  | "storage"
  | "unknown"
  | null;

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
  appId: string;
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

export interface AppDomainRetryResult extends AppDomainTarget {
  domain: AppDomainSummary;
}
