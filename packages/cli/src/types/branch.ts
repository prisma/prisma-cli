import type { AuthWorkspace } from "./auth";
import type { ProjectResolution, ProjectSummary } from "./project";

export type BranchRole = "preview" | "production";
export type BranchKind = BranchRole;

export interface BranchVariableGroup {
  id: string;
  name: string;
  class: string;
}

export interface BranchSummary {
  id: string;
  name: string;
  role: BranchRole;
  /** @deprecated Use variableGroup.name instead. */
  envMap: BranchRole;
  variableGroup: string;
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
