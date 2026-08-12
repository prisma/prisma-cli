import type { AppDomainDnsRecord, AppDomainStatus } from "../../types/app";
import type { AuthWorkspace } from "../../types/auth";
import type { BranchKind } from "../../types/branch";
import type { ProjectSummary } from "../../types/project";

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

export interface ServiceDeploymentListResult {
  projectId: string;
  service: ServiceSummary | null;
  deployments: ServiceDeploymentSummary[];
}

export interface ServiceDeploymentShowResult {
  service: ServiceSummary | null;
  deployment: ServiceDeploymentSummary;
}

export interface ServiceOpenResult {
  projectId: string;
  service: ServiceSummary;
  url: string;
  opened: boolean;
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
