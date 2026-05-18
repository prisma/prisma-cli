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
