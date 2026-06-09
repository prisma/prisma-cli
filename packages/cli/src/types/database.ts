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
