export type BranchRole = "preview" | "production";

export interface BranchSummary {
  id: string;
  name: string;
  role: BranchRole;
  envMap: BranchRole;
}

export interface BranchListResult {
  projectId: string;
  projectName: string;
  branches: BranchSummary[];
}
