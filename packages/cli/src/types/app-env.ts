import type { AuthWorkspace } from "./auth";
import type { ProjectResolution, ProjectSummary } from "./project";

export interface EnvResolvedContext {
  workspace: AuthWorkspace;
  project: ProjectSummary;
  resolution: ProjectResolution;
}

export type EnvScopeDescriptor =
  | { kind: "role"; role: "production" | "preview" }
  | { kind: "branch"; branchName: string; branchId: string }
  | { kind: "overview" };

export interface EnvListTarget {
  source: "explicit" | "local-git" | "overview";
  envMap: "production" | "preview" | "overview";
  branchName?: string;
  branchId?: string;
  branchRole?: "production" | "preview";
  branchExists?: boolean;
}

export interface EnvVariableMetadata {
  id: string;
  key: string;
  scope: EnvScopeDescriptor;
  source: string;
  isManagedBySystem: boolean;
  updatedAt: string;
}

export interface EnvPulledVariableMetadata {
  key: string;
  source: string;
  isManagedBySystem: boolean;
}

export interface EnvFileMetadata {
  path: string;
  count: number;
}

export interface EnvSingleWriteResult {
  projectId: string;
  verboseContext?: EnvResolvedContext;
  scope: EnvScopeDescriptor;
  variable: EnvVariableMetadata;
  variables?: never;
  file?: never;
}

export interface EnvFileWriteResult {
  projectId: string;
  verboseContext?: EnvResolvedContext;
  scope: EnvScopeDescriptor;
  variable?: never;
  variables: EnvVariableMetadata[];
  file: EnvFileMetadata;
}

export type EnvAddResult = EnvSingleWriteResult | EnvFileWriteResult;

export type EnvUpdateResult = EnvSingleWriteResult | EnvFileWriteResult;

export interface EnvListResult {
  projectId: string;
  verboseContext?: EnvResolvedContext;
  scope: EnvScopeDescriptor;
  target: EnvListTarget;
  variables: EnvVariableMetadata[];
}

export interface EnvPullResult {
  projectId: string;
  verboseContext?: EnvResolvedContext;
  scope: EnvScopeDescriptor;
  target: EnvListTarget;
  file: EnvFileMetadata;
  variables: EnvPulledVariableMetadata[];
}

export interface EnvRmResult {
  projectId: string;
  verboseContext?: EnvResolvedContext;
  scope: EnvScopeDescriptor;
  key: string;
}
