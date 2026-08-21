import type { AuthWorkspace } from "./auth";

export interface ProjectSummary {
  id: string;
  name: string;
  url?: string;
  defaultRegion?: string | null;
}

export type ProjectSource =
  | "explicit"
  | "local-pin"
  | "platform-mapping"
  | "created"
  | "prompt"
  | "unbound";

export interface ProjectResolution {
  projectSource: ProjectSource;
  targetName?: string | null;
  targetNameSource?:
    | "explicit"
    | "local-pin"
    | "package-name"
    | "directory-name"
    | "platform-mapping"
    | "prompt";
}

export interface ProjectLocalBindingState {
  status: "linked" | "not-linked" | "invalid";
}

export interface ProjectListResult {
  workspace: AuthWorkspace;
  projects: ProjectSummary[];
  localBinding?: ProjectLocalBindingState;
}

export interface ProjectSetupSuggestion {
  suggestedProjectName: string;
  suggestedProjectNameSource: "package-name" | "directory-name";
  candidates: ProjectSummary[];
  recoveryCommands: string[];
}

export interface BoundProjectShowResult {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  resolution: ProjectResolution;
}

export interface UnboundProjectShowResult extends ProjectSetupSuggestion {
  workspace: AuthWorkspace;
  project: null;
  localBinding: {
    status: "not-linked";
  };
  resolution: ProjectResolution & {
    projectSource: "unbound";
  };
}

export type ProjectShowResult =
  | BoundProjectShowResult
  | UnboundProjectShowResult;

export interface ProjectSetupResult {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  directory: string;
  localPin: {
    path: string;
    written: true;
  };
  action: "created" | "linked";
}

export interface ProjectRenameResult {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  previousName: string;
}

export interface ProjectDeleteResult {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  localPin: {
    cleared: boolean;
  };
}

export interface ProjectTransferResult {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  recipient: {
    workspaceId: string | null;
    workspaceName: string | null;
    source: "workspace-session" | "recipient-token";
  };
  localPin: {
    action: "rewritten" | "cleared" | "none";
  };
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

export interface ProjectRepositoryConnectionResult
  extends BoundProjectShowResult {
  repositoryConnection: GitRepositoryConnection;
}
