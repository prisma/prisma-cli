import { createManagementApiSdk } from "@prisma/management-api-sdk";

import {
  CLIENT_ID,
  FileTokenStorage,
  getApiBaseUrl,
  type StoredAuthWorkspace,
} from "../../auth";

export interface RecipientWorkspaceSession {
  workspace: StoredAuthWorkspace;
  accessToken: string;
}

export class RecipientSessionInvalidError extends Error {
  constructor(readonly workspaceRef: string) {
    super(
      `The stored session for workspace "${workspaceRef}" could not be validated.`,
    );
    this.name = "RecipientSessionInvalidError";
  }
}

/**
 * Resolve a locally stored OAuth workspace session and return a validated
 * access token for it, refreshing through the SDK when the stored token has
 * expired. The active workspace pointer is never touched.
 *
 * Throws WorkspaceSelectionError when the ref does not match exactly one
 * stored session, and RecipientSessionInvalidError when the session cannot
 * be validated or refreshed.
 */
export async function resolveRecipientWorkspaceSession(
  workspaceRef: string,
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<RecipientWorkspaceSession> {
  const storage = new FileTokenStorage(env, signal);
  const workspace = await storage.resolveWorkspace(workspaceRef);

  const pinnedStorage = new FileTokenStorage(env, signal, {
    activateOnSetTokens: false,
    // createManagementApiSdk wraps refresh writes in withRefreshLock; see
    // requireComputeAuth for why setTokens must not re-acquire the lock.
    lockSetTokens: false,
    pinnedWorkspaceId: workspace.credentialWorkspaceId,
  });

  const sdk = createManagementApiSdk({
    clientId: CLIENT_ID,
    redirectUri: "http://localhost:0/auth/callback",
    tokenStorage: pinnedStorage,
    apiBaseUrl: getApiBaseUrl(env),
  });

  // A cheap authenticated call proves the session works and triggers the
  // SDK's refresh flow when the stored access token has expired.
  const probe = await sdk.client.GET("/v1/workspaces", { signal });
  if (probe.error) {
    throw new RecipientSessionInvalidError(workspaceRef);
  }

  const tokens = await pinnedStorage.getTokens();
  if (!tokens) {
    throw new RecipientSessionInvalidError(workspaceRef);
  }

  return { workspace, accessToken: tokens.accessToken };
}
