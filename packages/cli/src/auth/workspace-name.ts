import { createManagementApiClient } from "@prisma/management-api-sdk";
import type { FetchWorkspaceName } from "./credential-manager";

/** The manager's injected name lookup: a static-token client over the
 *  credential just minted. The manager constructs no API client and
 *  treats any failure here as "no name". */
export function fetchWorkspaceName(apiBaseUrl: string): FetchWorkspaceName {
  return async (credential, workspaceId) => {
    const client = createManagementApiClient({
      baseUrl: apiBaseUrl,
      token: credential.token,
    });
    const { data } = await client.GET("/v1/workspaces/{id}", {
      params: { path: { id: workspaceId } },
    });
    const name = data?.data?.name;
    return typeof name === "string" && name.trim().length > 0
      ? name.trim()
      : undefined;
  };
}
