import { createManagementApiClient } from "@prisma/management-api-sdk";
import type {
  FetchSessionIdentity,
  FetchWorkspaceName,
} from "./credential-manager";

const IDENTITY_LOOKUP_TIMEOUT_MS = 3_000;

function clientFor(apiBaseUrl: string, token: string) {
  return createManagementApiClient({ baseUrl: apiBaseUrl, token });
}

/** Resolve the human workspace name with the workspace-bound credential that
 *  was just minted. The credential manager treats this as best-effort. */
export function fetchWorkspaceName(apiBaseUrl: string): FetchWorkspaceName {
  return async (credential, workspaceId) => {
    const { data } = await clientFor(apiBaseUrl, credential.token).GET(
      "/v1/workspaces/{id}",
      { params: { path: { id: workspaceId } } },
    );
    const name = data?.data?.name;
    return typeof name === "string" && name.trim().length > 0
      ? name.trim()
      : undefined;
  };
}

/** Resolve safe account metadata once at login. OAuth access tokens do not
 *  necessarily carry an email, so claims alone cannot distinguish sessions
 *  authorized by different Prisma accounts. */
export function fetchSessionIdentity(apiBaseUrl: string): FetchSessionIdentity {
  return async (credential) => {
    const { data } = await clientFor(apiBaseUrl, credential.token).GET(
      "/v1/me",
      { signal: AbortSignal.timeout(IDENTITY_LOOKUP_TIMEOUT_MS) },
    );
    const user = data?.data?.user;
    if (!user) return undefined;
    return {
      userId: user.id ?? undefined,
      email: user.email ?? undefined,
      name: user.name ?? undefined,
    };
  };
}
