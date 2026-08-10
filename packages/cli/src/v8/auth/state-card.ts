import type { AuthProviderId, AuthStateResult } from "../../types/auth";

export interface FieldRow {
  readonly label: string;
  readonly value: string;
}

export function providerLabel(provider: AuthProviderId): string {
  return provider === "github" ? "GitHub" : "Google";
}

export function userLabel(state: AuthStateResult): string | null {
  if (state.user?.email) {
    return state.user.email;
  }

  if (state.credential?.type === "service_token") {
    return state.credential.name
      ? `<service token: ${state.credential.name}>`
      : "<service token>";
  }

  if (state.credential?.type === "management_token") {
    return state.credential.name
      ? `<management token: ${state.credential.name}>`
      : "<management token>";
  }

  return null;
}

/** The whoami-style card rows for an auth state. */
export function authStateFieldRows(
  state: AuthStateResult,
): readonly FieldRow[] {
  if (!state.authenticated) {
    return [{ label: "status", value: "signed out" }];
  }

  const rows: FieldRow[] = [{ label: "status", value: "signed in" }];
  const user = userLabel(state);
  if (user) {
    rows.push({ label: "user", value: user });
  }
  if (state.provider) {
    rows.push({ label: "provider", value: providerLabel(state.provider) });
  }
  if (state.workspace?.name) {
    rows.push({ label: "workspace", value: state.workspace.name });
  }
  return rows;
}
