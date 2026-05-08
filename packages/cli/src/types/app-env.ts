export type AppEnvScopeDescriptor =
  | { kind: "class"; class: "production" | "preview" }
  | { kind: "branch"; name: string; id: string };

export interface AppEnvVariableMetadata {
  id: string;
  key: string;
  scope: AppEnvScopeDescriptor;
  isManagedBySystem: boolean;
  updatedAt: string;
}

export interface AppEnvSetResult {
  projectId: string;
  scope: AppEnvScopeDescriptor;
  variable: AppEnvVariableMetadata;
  /**
   * `true` when the value of an existing variable was replaced;
   * `false` when a new variable was created. Surfaced in JSON output
   * so automation can distinguish create vs. replace without parsing
   * stderr.
   */
  replaced: boolean;
}

export interface AppEnvListResult {
  projectId: string;
  scope: AppEnvScopeDescriptor;
  variables: AppEnvVariableMetadata[];
}

export interface AppEnvUnsetResult {
  projectId: string;
  scope: AppEnvScopeDescriptor;
  key: string;
}
