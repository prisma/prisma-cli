import type {
  ManagementApiClient as SdkClient,
  TokenStorage as SdkTokenStorage,
} from "@prisma/management-api-sdk";

type SdkTokens = NonNullable<Awaited<ReturnType<SdkTokenStorage["getTokens"]>>>;

type StoredTokens = SdkTokens & {
  /** The explicit OAuth lifetime when the access token has no exp claim. */
  readonly expiresAt?: Date;
};

/**
 * The SDK's typed client, re-exported so consumers never import
 * @prisma/management-api-sdk directly.
 */
export type ManagementApiClient = SdkClient;

/**
 * The SDK's token-storage contract plus the explicit OAuth expiry the
 * credential manager persists for opaque access tokens. The extra data and
 * optional setTokens argument are structurally compatible with the SDK, which
 * ignores expiry and continues to call setTokens with one argument.
 */
export type TokenStorage = Omit<SdkTokenStorage, "getTokens" | "setTokens"> & {
  getTokens(): Promise<StoredTokens | null>;
  setTokens(tokens: SdkTokens, expiresAt?: Date): Promise<void>;
};

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
      /** Absolute lifetime reported by the OAuth token endpoint. */
      readonly expiresAt: Date;
    }
  | { readonly kind: "invalid" };

export type CredentialRefresher = (request: {
  readonly refreshToken: string;
  readonly signal: AbortSignal;
}) => Promise<CredentialRefreshResult>;
