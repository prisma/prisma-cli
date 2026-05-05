import {
  createManagementApiClient,
  createManagementApiSdk,
  type ManagementApiClient,
} from "@prisma/management-api-sdk";

import { FileTokenStorage } from "../../adapters/token-storage";
import { CLIENT_ID, getApiBaseUrl, SERVICE_TOKEN_ENV_VAR } from "./client";

/**
 * Resolve authentication and return a ManagementApiClient.
 *
 * Priority:
 *   1. PRISMA_API_TOKEN env var → service token (CI / headless)
 *   2. Stored OAuth tokens     → SDK with auto-refresh
 *
 * Returns null if not authenticated.
 */
export async function requireComputeAuth(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ManagementApiClient | null> {
  const rawToken = env[SERVICE_TOKEN_ENV_VAR];

  if (rawToken !== undefined) {
    const token = rawToken.trim();
    if (token.length === 0) {
      throw new Error(
        `${SERVICE_TOKEN_ENV_VAR} is set but empty. Provide a valid token or unset the variable.`,
      );
    }
    return createManagementApiClient({
      baseUrl: getApiBaseUrl(env),
      token,
    });
  }

  const tokenStorage = new FileTokenStorage(env);
  const tokens = await tokenStorage.getTokens();

  if (!tokens) {
    return null;
  }

  const sdk = createManagementApiSdk({
    clientId: CLIENT_ID,
    redirectUri: "http://localhost:0/auth/callback",
    tokenStorage,
    apiBaseUrl: getApiBaseUrl(env),
  });

  return sdk.client;
}
