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
