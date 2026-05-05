export type AuthProviderId = "github" | "google";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export interface AuthWorkspace {
  id: string;
  name: string;
}

export interface AuthStateResult {
  authenticated: boolean;
  provider: AuthProviderId | null;
  user: AuthUser | null;
  workspace: AuthWorkspace | null;
  linkedProjectId: string | null;
}
