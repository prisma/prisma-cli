export { CLIENT_ID, getApiBaseUrl, SERVICE_TOKEN_ENV_VAR } from "./client";
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
} from "./operations";
export {
  RecipientSessionInvalidError,
  type RecipientWorkspaceSession,
  resolveRecipientWorkspaceSession,
} from "./recipient";
export {
  FileTokenStorage,
  type StoredAuthWorkspace,
  WorkspaceSelectionError,
} from "./token-storage";
export {
  listAuthWorkspaces,
  logoutAuthWorkspace,
  switchAuthWorkspace,
  type WorkspaceOperationContext,
} from "./workspaces";
