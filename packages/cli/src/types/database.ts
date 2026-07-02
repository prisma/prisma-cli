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

export interface DatabaseRemoveResult {
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

export interface DatabaseConnectionRemoveResult {
  connection: {
    id: string;
  };
}

export interface DatabaseUsagePeriod {
  start: string;
  end: string;
}

export interface DatabaseUsageMetric {
  used: number;
  unit: string;
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
  generatedAt: string;
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
