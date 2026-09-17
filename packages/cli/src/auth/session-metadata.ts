import { createManagementApiClient } from "@prisma/management-api-sdk";
import type { FetchSessionMetadata } from "./credential-manager";

const METADATA_LOOKUP_TIMEOUT_MS = 3_000;

export function fetchSessionMetadata(apiBaseUrl: string): FetchSessionMetadata {
  return async (credential) => {
    const client = createManagementApiClient({
      baseUrl: apiBaseUrl,
      token: credential.token,
    });
    const { data } = await client.GET("/v1/me", {
      signal: AbortSignal.timeout(METADATA_LOOKUP_TIMEOUT_MS),
    });
    if (!data) return undefined;
    const { user, workspace } = data.data;
    return {
      workspaceName: workspace?.name ?? undefined,
      user: user
        ? {
            id: user.id,
            email: user.email,
            ...(user.name ? { name: user.name } : {}),
          }
        : undefined,
    };
  };
}
