export type BranchKind = "preview" | "production";

export interface LiveDeploymentSummary {
  id: string;
  status: string;
  url: string | null;
}

export interface BranchSummary {
  id: string;
  name: string;
  kind: BranchKind;
  active: boolean;
  remoteState: boolean;
}

export interface BranchDetail {
  name: string;
  kind: BranchKind;
  active: true;
  remoteState: boolean;
  liveDeployment: LiveDeploymentSummary | null;
}

export interface BranchListResult {
  projectId: string | null;
  projectName: string | null;
  activeBranch: string;
  branches: BranchSummary[];
}

export interface BranchShowResult {
  projectId: string | null;
  projectName: string | null;
  branch: BranchDetail;
}
