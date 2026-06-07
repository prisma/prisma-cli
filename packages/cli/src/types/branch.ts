import type { AuthWorkspace } from "./auth";
import type { ProjectResolution, ProjectSummary } from "./project";

export type BranchRole = "preview" | "production";
export type BranchKind = BranchRole;

export interface BranchSummary {
  id: string;
  name: string;
  role: BranchRole;
  envMap: BranchRole;
}

export interface BranchListResult {
  projectId: string;
  projectName: string;
  verboseContext?: {
    workspace: AuthWorkspace;
    project: ProjectSummary;
    resolution: ProjectResolution;
  };
  branches: BranchSummary[];
}

export interface BranchCreateResult {
  projectId: string;
  projectName: string;
  verboseContext?: {
    workspace: AuthWorkspace;
    project: ProjectSummary;
    resolution: ProjectResolution;
  };
  branch: BranchSummary;
}

export interface BranchDeleteResult {
  projectId: string;
  projectName: string;
  branchName: string;
}

export interface BranchRenameResult {
  projectId: string;
  projectName: string;
  verboseContext?: {
    workspace: AuthWorkspace;
    project: ProjectSummary;
    resolution: ProjectResolution;
  };
  branch: BranchSummary;
}
