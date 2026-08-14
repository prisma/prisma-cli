import type {
  ManagementApiClient as SdkClient,
  TokenStorage as SdkTokenStorage,
} from "@prisma/management-api-sdk";

/**
 * The SDK's typed client, re-exported so consumers never import
 * @prisma/management-api-sdk directly.
 */
export type ManagementApiClient = SdkClient;

/**
 * The SDK's token-storage contract, re-exported for the same reason.
 * CredentialManager.activeCredentialStorage returns one; the engine
 * forwards it into SDK client config and reads it only to tell a
 * credential that could never be renewed from one that could.
 */
export type TokenStorage = SdkTokenStorage;

/**
 * SDK client construction config, injected by the bin beside the
 * credential manager. All four fields: the SDK's refreshing fetch
 * requires the full config even though only login paths read
 * redirectUri.
 */
export interface ManagementApiClientConfig {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
}

/**
 * The host-side OAuth exchange the engine may request before handing an
 * access-token snapshot to a child. The refresh token crosses only this
 * in-process seam; it is never added to the child's environment.
 *
 * `invalid` is the token endpoint's definitive `invalid_grant` verdict.
 * Transport failures and every other endpoint failure are thrown so the
 * engine can map them to CLI.AUTH_SERVICE_ERROR without exposing endpoint
 * response text.
 */
export type CredentialRefreshResult =
  | {
      readonly kind: "success";
      readonly accessToken: string;
      readonly refreshToken: string;
    }
  | { readonly kind: "invalid" };

export type CredentialRefresher = (request: {
  readonly refreshToken: string;
  readonly signal: AbortSignal;
}) => Promise<CredentialRefreshResult>;
