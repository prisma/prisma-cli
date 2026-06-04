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

export interface EnvFileMetadata {
  path: string;
  count: number;
}

export interface EnvSingleWriteResult {
  projectId: string;
  scope: EnvScopeDescriptor;
  variable: EnvVariableMetadata;
  variables?: never;
  file?: never;
}

export interface EnvFileWriteResult {
  projectId: string;
  scope: EnvScopeDescriptor;
  variable?: never;
  variables: EnvVariableMetadata[];
  file: EnvFileMetadata;
}

export type EnvAddResult = EnvSingleWriteResult | EnvFileWriteResult;

export type EnvUpdateResult = EnvSingleWriteResult | EnvFileWriteResult;

export interface EnvListResult {
  projectId: string;
  scope: EnvScopeDescriptor;
  target: EnvListTarget;
  variables: EnvVariableMetadata[];
}

export interface EnvRmResult {
  projectId: string;
  scope: EnvScopeDescriptor;
  key: string;
}
