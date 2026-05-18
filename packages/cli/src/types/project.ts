import type { AuthWorkspace } from "./auth";

export interface ProjectSummary {
  id: string;
  name: string;
}

export type ProjectSource =
  | "explicit"
  | "platform-mapping"
  | "remembered-local"
  | "package-name"
  | "created"
  | "prompt";

export interface ProjectResolution {
  projectSource: ProjectSource;
}

export interface ProjectListResult {
  workspace: AuthWorkspace;
  projects: ProjectSummary[];
}

export interface ProjectShowResult {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  resolution: ProjectResolution;
}

export interface GitRepositoryConnection {
  id: string | null;
  provider: "github";
  repoId: number | null;
  repository: {
    owner: string;
    name: string;
    fullName: string;
    url: string;
  };
  defaultBranch: string | null;
  isPrivate: boolean | null;
  status: "pending" | "active" | "archived";
  installation: {
    id: string | null;
    status: "pending" | "connected";
  };
  automation: {
    branches: boolean;
    pullRequests: boolean;
    comments: boolean;
  };
  connectedAt: string | null;
  updatedAt: string | null;
}

export interface ProjectRepositoryConnectionResult extends ProjectShowResult {
  repositoryConnection: GitRepositoryConnection | null;
}
