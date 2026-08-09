import { createManagementApiSdk } from "@prisma/management-api-sdk";
import type { ManagementApiClient } from "../management-api";
import { CliStructuredError } from "../protocol";
import type { Invocation } from "./engine";
import { credentialsRequiredError } from "./needs";

/* Copied from the shell's createManagementApiSdk call site
 * (packages/cli/src/auth/workspaces.ts). The OAuth fields are inert
 * here: the token source is ctx.getCredentials and never carries a
 * refresh token, so the SDK's own OAuth flow can never run. */
const CLIENT_ID = "cmm3lndn701oo0uefvxzo0ivw";
const REDIRECT_URI = "http://localhost:0/auth/callback";

export type CreateManagementApiSdk = typeof createManagementApiSdk;

/** ctx.api construction: the SDK reads tokens per request, so a token
 *  refreshed mid-run by the credentials source is picked up on the next
 *  request. A request while getCredentials() resolves undefined throws
 *  CLI.CREDENTIALS_REQUIRED. */
export function buildManagementApiClient(
  invocation: Invocation,
): ManagementApiClient {
  const createSdk =
    invocation.hooks.managementApi?.createSdk ?? createManagementApiSdk;
  const sdk = createSdk({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    tokenStorage: {
      getTokens: async () => {
        const credentials = await invocation.runtime.getCredentials();
        if (credentials === undefined) {
          throw credentialsRequiredError();
        }
        return { workspaceId: "", accessToken: credentials.token };
      },
      setTokens: async () => {},
      clearTokens: async () => {},
    },
    apiBaseUrl: invocation.runtime.managementApi.baseUrl,
  });
  return restoreStructuredThrows(sdk.client);
}

/** The SDK wraps every request failure in its FetchError; a structured
 *  error raised inside the request pipeline (the unauthenticated
 *  CLI.CREDENTIALS_REQUIRED throw) is rethrown unwrapped so it settles
 *  as itself. */
function restoreStructuredThrows(
  client: ManagementApiClient,
): ManagementApiClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]): unknown => {
        const result: unknown = Reflect.apply(value, target, args);
        if (result instanceof Promise) {
          return result.catch((cause: unknown) => {
            throw structuredCause(cause) ?? cause;
          });
        }
        return result;
      };
    },
  });
}

function structuredCause(error: unknown): CliStructuredError | undefined {
  for (
    let current: unknown = error;
    current instanceof Error;
    current = current.cause
  ) {
    if (CliStructuredError.is(current)) {
      return current;
    }
  }
  return undefined;
}
