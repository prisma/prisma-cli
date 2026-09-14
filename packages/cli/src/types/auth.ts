export type AuthProviderId = "github" | "google";

export interface AuthUser {
  id?: string;
  email: string;
  name?: string | null;
}

export interface AuthWorkspace {
  id: string;
  name: string;
}

export interface AuthCredential {
  type: "oauth" | "service_token" | "management_token";
  id: string | null;
  name: string | null;
}

export interface AuthStateResult {
  authenticated: boolean;
  provider: AuthProviderId | null;
  user: AuthUser | null;
  workspace: AuthWorkspace | null;
  credential: AuthCredential | null;
}

export interface AuthWorkspaceSession {
  id: string;
  name: string;
  credentialWorkspaceId: string | null;
  active: boolean;
  source: "oauth" | "service_token";
  switchable: boolean;
  lastSeenAt: string | null;
}

export interface AuthWorkspaceListResult {
  authSource: "oauth" | "service_token" | "none";
  activeWorkspace: AuthWorkspace | null;
  workspaces: AuthWorkspaceSession[];
}

export interface AuthWorkspaceUseResult {
  previousWorkspace: AuthWorkspace | null;
  workspace: AuthWorkspace;
}

export interface AuthWorkspaceLogoutResult {
  workspace: AuthWorkspace;
  wasActive: boolean;
  activeWorkspace: AuthWorkspace | null;
}
