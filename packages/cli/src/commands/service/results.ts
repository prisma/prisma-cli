import type { AuthWorkspace } from "../../types/auth";
import type { BranchKind } from "../../types/branch";
import type { ProjectSummary } from "../../types/project";

export interface ServiceSummary {
  id: string;
  name: string;
}

export interface ServiceVersionSummary {
  id: string;
  status: string;
  url: string | null;
  createdAt: string;
  live: boolean | null;
}

/** A service as `service list` and `service create` report it. `liveUrl`
 *  is null until a version is promoted: the endpoint domain a service
 *  carries before that does not resolve. */
export interface ServiceListEntry {
  id: string;
  name: string;
  region: string | null;
  liveVersionId: string | null;
  liveUrl: string | null;
}

export interface ServiceListResult {
  projectId: string;
  projectName: string;
  branch: string;
  services: ServiceListEntry[];
}

export interface ServiceCreateResult {
  projectId: string;
  branch: string;
  service: ServiceListEntry;
  /** True when a service of that name already existed on the branch and
   *  this run returned it instead of creating a second one. */
  existing: boolean;
}

export interface ServiceShowResult {
  projectId: string;
  service: ServiceSummary;
  liveVersion: ServiceVersionSummary | null;
  liveUrl: string | null;
  recentVersions: ServiceVersionSummary[];
}

export interface ServiceVersionListResult {
  projectId: string;
  service: ServiceSummary;
  versions: ServiceVersionSummary[];
}

export interface ServiceVersionShowResult {
  service: ServiceSummary | null;
  version: ServiceVersionSummary;
}

export interface ServiceOpenResult {
  projectId: string;
  service: ServiceSummary;
  url: string;
  opened: boolean;
}

/** Targeted by version id alone, so no project is resolved. */
export interface ServicePromoteResult {
  service: ServiceSummary;
  version: ServiceVersionSummary;
}

export interface ServiceRollbackResult {
  projectId: string;
  service: ServiceSummary;
  version: ServiceVersionSummary;
  previousLiveVersionId: string | null;
}

/** What `service version start` and `stop` report. `alreadyInState`
 *  is true when the version already had the status the command asks
 *  for, so the run made no call. */
export interface ServiceVersionRunStateResult {
  service: ServiceSummary;
  version: ServiceVersionSummary;
  alreadyInState: boolean;
}

export interface ServiceVersionDeleteResult {
  service: ServiceSummary;
  versionId: string;
  deleted: true;
}

export interface ServiceDeleteResult {
  projectId: string;
  service: ServiceSummary;
  deleted: true;
}

export type ServiceDomainStatus =
  | "pending_dns"
  | "verifying"
  | "verified_routing_blocked"
  | "provisioning_tls"
  | "active"
  | "failed"
  | "removing";

export interface ServiceDomainDnsRecord {
  type: string;
  name: string;
  value: string;
  ttl: number | null;
}

export interface ServiceDomainSummary {
  id: string;
  type: "custom-domain";
  url: string;
  hostname: string;
  serviceId: string;
  status: ServiceDomainStatus;
  foundryStatus: string;
  failureReason: string | null;
  failureCategory: "dns" | "acme" | "storage" | "unknown" | null;
  certExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  dnsRecords: ServiceDomainDnsRecord[];
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

export interface ServiceDomainDeleteResult extends ServiceDomainTarget {
  hostname: string;
  deleted: true;
}

export interface ServiceDomainRetryResult extends ServiceDomainTarget {
  domain: ServiceDomainSummary;
}

export interface ServiceDomainWaitResult extends ServiceDomainTarget {
  hostname: string;
  status: ServiceDomainStatus;
  liveUrl: string;
}
