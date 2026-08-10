export { claimedWorkspaceId, decodeClaims } from "./claims";
export {
  CLIENT_ID,
  DEFAULT_REDIRECT_URI,
  getApiBaseUrl,
  getAuthBaseUrl,
  SERVICE_TOKEN_ENV_VAR,
} from "./client";
export {
  type FetchWorkspaceName,
  FileCredentialManager,
} from "./credential-manager";
export { makeGetCredentials } from "./credentials";
export {
  workspaceAmbiguousError,
  workspaceNotAuthenticatedError,
  workspaceSwitchUnavailableError,
} from "./errors";
export { authenticatedManagementApiClient } from "./guard";
export {
  EmptyServiceTokenError,
  isEmptyServiceTokenError,
  performLogin,
  performLogout,
  readAuthState,
  storeLegacyCredential,
} from "./operations";
export {
  RecipientSessionInvalidError,
  type RecipientWorkspaceSession,
  resolveRecipientWorkspaceSession,
} from "./recipient";
export {
  environmentServiceToken,
  environmentSessionInForce,
} from "./service-token";
export {
  DEPRECATED_STATE_FILE_ENV_VAR,
  resolveStateFilePath,
  STATE_FILE_ENV_VAR,
} from "./state-file";
export {
  FileTokenStorage,
  type StoredAuthWorkspace,
  WorkspaceSelectionError,
} from "./token-storage";
export { fetchWorkspaceName } from "./workspace-name";
export {
  listAuthWorkspaces,
  logoutAuthWorkspace,
  switchAuthWorkspace,
  type WorkspaceOperationContext,
} from "./workspaces";
