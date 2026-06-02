export type EnvScopeDescriptor =
  | { kind: "role"; role: "production" | "preview" }
  | { kind: "branch"; branchName: string; branchId: string };

export interface EnvVariableMetadata {
  id: string;
  key: string;
  scope: EnvScopeDescriptor;
  source: string;
  isManagedBySystem: boolean;
  updatedAt: string;
}

export interface EnvAddResult {
  projectId: string;
  scope: EnvScopeDescriptor;
  variable: EnvVariableMetadata;
}

export interface EnvUpdateResult {
  projectId: string;
  scope: EnvScopeDescriptor;
  variable: EnvVariableMetadata;
}

export interface EnvListResult {
  projectId: string;
  scope: EnvScopeDescriptor;
  variables: EnvVariableMetadata[];
}

export interface EnvRmResult {
  projectId: string;
  scope: EnvScopeDescriptor;
  key: string;
}
