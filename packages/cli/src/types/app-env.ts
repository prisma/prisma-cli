export interface EnvScopeDescriptor {
  kind: "role";
  role: "production" | "preview";
}

export interface EnvVariableMetadata {
  id: string;
  key: string;
  scope: EnvScopeDescriptor;
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
