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

export interface BranchRemovedResource {
  id: string;
  name: string;
}

export interface BranchRemoveResult {
  projectId: string;
  projectName: string;
  verboseContext?: {
    workspace: AuthWorkspace;
    project: ProjectSummary;
    resolution: ProjectResolution;
  };
  branch: BranchSummary;
  /** Member resources removed by --cascade; absent for plain removal. */
  removed?: {
    apps: BranchRemovedResource[];
    databases: BranchRemovedResource[];
  };
}
