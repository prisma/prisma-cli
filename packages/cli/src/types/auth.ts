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
