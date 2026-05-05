import type { AuthWorkspace } from "./auth";

export interface ProjectSummary {
  id: string;
  name: string;
}

export interface ProjectListResult {
  workspace: AuthWorkspace;
  linkedProjectId: string | null;
  projects: ProjectSummary[];
}

export interface ProjectShowResult {
  linkedProjectId: string | null;
  workspace: AuthWorkspace | null;
  project: ProjectSummary | null;
}
