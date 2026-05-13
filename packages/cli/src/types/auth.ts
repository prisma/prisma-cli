export type AuthProviderId = "github" | "google";

export interface AuthUser {
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
}
