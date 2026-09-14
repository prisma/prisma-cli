import type { AuthWorkspace } from "./auth";
import type { ProjectResolution, ProjectSummary } from "./project";

export interface DatabaseResolvedContext {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  resolution: ProjectResolution;
}

export interface DatabaseSummary {
  id: string;
  name: string;
  projectId: string;
  branchId: string | null;
  branchName: string | null;
  region: string | null;
  status: string | null;
  isDefault: boolean | null;
  createdAt: string | null;
}

export interface DatabaseConnectionSummary {
  id: string;
  name: string;
  databaseId: string;
  createdAt: string | null;
}

export interface DatabaseListResult {
  projectId: string;
  projectName: string;
  branchName: string | null;
  verboseContext?: DatabaseResolvedContext;
  databases: DatabaseSummary[];
}

export interface DatabaseShowResult {
  projectId: string;
  projectName: string;
  verboseContext?: DatabaseResolvedContext;
  database: DatabaseSummary;
  connections: DatabaseConnectionSummary[];
}

export interface DatabaseCreateResult {
  projectId: string;
  projectName: string;
  verboseContext?: DatabaseResolvedContext;
  database: DatabaseSummary;
  connection: DatabaseConnectionSummary;
  connectionString: string;
}

export interface DatabaseDeleteResult {
  projectId: string;
  projectName: string;
  verboseContext?: DatabaseResolvedContext;
  database: DatabaseSummary;
}

export interface DatabaseConnectionListResult {
  projectId: string;
  projectName: string;
  verboseContext?: DatabaseResolvedContext;
  database: DatabaseSummary;
  connections: DatabaseConnectionSummary[];
}

export interface DatabaseConnectionCreateResult {
  projectId: string;
  projectName: string;
  verboseContext?: DatabaseResolvedContext;
  database: DatabaseSummary;
  connection: DatabaseConnectionSummary;
  connectionString: string;
}

export interface DatabaseConnectionDeleteResult {
  connection: {
    id: string;
  };
}

export interface DatabaseUsagePeriod {
  start: string | null;
  end: string | null;
}

/** `used` is null when the API did not report the metric. Zero is a real
 *  measurement and must stay distinguishable from silence, so neither a
 *  count nor a unit may be filled in by the CLI. */
export interface DatabaseUsageMetric {
  used: number | null;
  unit: string | null;
}

export interface DatabaseUsageMetrics {
  operations: DatabaseUsageMetric;
  storage: DatabaseUsageMetric;
}

export interface DatabaseUsageResult {
  projectId: string;
  projectName: string;
  verboseContext?: DatabaseResolvedContext;
  database: DatabaseSummary;
  period: DatabaseUsagePeriod;
  metrics: DatabaseUsageMetrics;
  generatedAt: string | null;
}

export interface DatabaseBackupSummary {
  id: string;
  backupType: string;
  status: string;
  size: number | null;
  createdAt: string;
}

export interface DatabaseBackupListResult {
  projectId: string;
  projectName: string;
  verboseContext?: DatabaseResolvedContext;
  database: DatabaseSummary;
  backups: DatabaseBackupSummary[];
  retentionDays: number | null;
  hasMore: boolean;
}

export interface DatabaseRestoreResult {
  projectId: string;
  projectName: string;
  verboseContext?: DatabaseResolvedContext;
  database: DatabaseSummary;
  source: {
    databaseId: string;
    backupId: string;
  };
}

export interface DatabaseConnectionRotateResult {
  connection: DatabaseConnectionSummary;
  database: {
    id: string;
    name: string;
  } | null;
  connectionString: string;
}
