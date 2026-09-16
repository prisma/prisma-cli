import { createManagementApiClient } from "@prisma/management-api-sdk";
import type {
  FetchSessionIdentity,
  FetchWorkspaceName,
} from "./credential-manager";

const METADATA_LOOKUP_TIMEOUT_MS = 3_000;

/** Resolve the human workspace name with the workspace-bound credential that
 *  was just minted. The credential manager treats this as best-effort. */
export function fetchWorkspaceName(apiBaseUrl: string): FetchWorkspaceName {
  return async (credential, workspaceId) => {
    const client = createManagementApiClient({
      baseUrl: apiBaseUrl,
      token: credential.token,
    });
    const { data } = await client.GET("/v1/workspaces/{id}", {
      params: { path: { id: workspaceId } },
      signal: AbortSignal.timeout(METADATA_LOOKUP_TIMEOUT_MS),
    });
    const name = data?.data?.name;
    return typeof name === "string" && name.trim().length > 0
      ? name.trim()
      : undefined;
  };
}

/** OAuth tokens do not necessarily carry an email; /v1/me identifies the user. */
export function fetchSessionIdentity(apiBaseUrl: string): FetchSessionIdentity {
  return async (credential) => {
    const client = createManagementApiClient({
      baseUrl: apiBaseUrl,
      token: credential.token,
    });
    const { data } = await client.GET("/v1/me", {
      signal: AbortSignal.timeout(METADATA_LOOKUP_TIMEOUT_MS),
    });
    const user = data?.data?.user;
    if (!user) return undefined;
    return {
      userId: user.id ?? undefined,
      email: user.email ?? undefined,
      name: user.name ?? undefined,
    };
  };
}
