import type { createManagementApiSdk } from "@prisma/management-api-sdk";
import type { ManagementApiClient } from "../management-api";
import { CliStructuredError } from "../protocol";
import type { Invocation } from "./engine";
import { credentialsRequiredError } from "./needs";

/* Inert placeholders: the token source is ctx.getCredentials and never
 * supplies a refresh token, so the SDK's own OAuth flow is unreachable
 * and these values are never used in a request. */
const CLIENT_ID = "";
const REDIRECT_URI = "";

export type CreateManagementApiSdk = typeof createManagementApiSdk;

/** ctx.api construction: the SDK reads tokens per request, so a token
 *  refreshed mid-run by the credentials source is picked up on the next
 *  request. A request while getCredentials() resolves undefined throws
 *  CLI.CREDENTIALS_REQUIRED.
 *
 *  The SDK module itself is loaded lazily (dynamic import, mirroring
 *  the clack renderer pattern) and only when no `createSdk` test seam
 *  is injected, so a run that never issues a request never pays for —
 *  or depends on — the SDK module load. The returned client is a Proxy
 *  whose method wrappers await the lazy construction before applying
 *  the call; every client method is async, so the deferral is
 *  invisible to callers. */
export function buildManagementApiClient(
  invocation: Invocation,
): ManagementApiClient {
  let clientPromise: Promise<ManagementApiClient> | undefined;
  const resolveClient = (): Promise<ManagementApiClient> => {
    clientPromise ??= constructClient(invocation);
    return clientPromise;
  };

  return new Proxy({} as ManagementApiClient, {
    get(_target, property) {
      // Symbol probes and thenable checks (`await client`, promise
      // adoption) must not look like callable API methods.
      if (typeof property === "symbol" || property === "then") {
        return undefined;
      }
      return (...args: unknown[]): Promise<unknown> =>
        resolveClient().then((client) => {
          const value: unknown = Reflect.get(client, property);
          if (typeof value !== "function") {
            throw new TypeError(
              `@prisma/cli-engine: ctx.api.${property} is not a function`,
            );
          }
          return Promise.resolve(Reflect.apply(value, client, args)).catch(
            (cause: unknown) => {
              throw restoreStructuredThrow(cause);
            },
          );
        });
    },
  });
}

async function constructClient(
  invocation: Invocation,
): Promise<ManagementApiClient> {
  const createSdk =
    invocation.hooks.managementApi?.createSdk ??
    (await import("@prisma/management-api-sdk")).createManagementApiSdk;
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
  return sdk.client;
}

/** The SDK wraps every request failure in its FetchError; a structured
 *  error raised inside the request pipeline (the unauthenticated
 *  CLI.CREDENTIALS_REQUIRED throw) is rethrown unwrapped so it settles
 *  as itself. The SDK's own AuthError (a 401 the SDK cannot recover
 *  from — no refresh token is ever supplied here) maps to the same
 *  shared CLI.CREDENTIALS_REQUIRED error the needs check raises. */
function restoreStructuredThrow(cause: unknown): unknown {
  const structured = structuredCause(cause);
  if (structured !== undefined) {
    return structured;
  }
  if (causeChainHasSdkAuthError(cause)) {
    return credentialsRequiredError();
  }
  return cause;
}

/** Cause chains can be cyclic (an Error whose `cause` eventually points
 *  back at itself); track visited nodes with a depth cap as a backstop
 *  so the walk always terminates. */
const CAUSE_CHAIN_DEPTH_CAP = 32;

function* causeChain(error: unknown): Generator<Error> {
  const visited = new Set<Error>();
  for (
    let current: unknown = error;
    current instanceof Error &&
    !visited.has(current) &&
    visited.size < CAUSE_CHAIN_DEPTH_CAP;
    current = current.cause
  ) {
    visited.add(current);
    yield current;
  }
}

function structuredCause(error: unknown): CliStructuredError | undefined {
  for (const current of causeChain(error)) {
    if (CliStructuredError.is(current)) {
      return current;
    }
  }
  return undefined;
}

/** Structural match (name discriminator) rather than instanceof, so a
 *  duplicate SDK module instance cannot defeat the mapping — and so
 *  this check itself never forces the SDK module to load. */
function causeChainHasSdkAuthError(error: unknown): boolean {
  for (const current of causeChain(error)) {
    if (current.name === "AuthError") {
      return true;
    }
  }
  return false;
}
