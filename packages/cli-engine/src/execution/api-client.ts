import {
  authServiceError,
  credentialsRequiredError,
  emptyServiceTokenError,
  serviceTokenRejectedError,
} from "../credential-errors";
import type { CredentialManager, Session } from "../credential-manager";
import type { ManagementApiClient, TokenStorage } from "../management-api";
import { CliStructuredError } from "../protocol";
import { type DebugLog, makeDebugLog } from "./debug";
import type { Invocation } from "./engine";

const SERVICE_TOKEN_ENV_VAR = "PRISMA_SERVICE_TOKEN";

type ClientBinding =
  | { readonly source: "stored"; readonly workspaceId: string }
  | { readonly source: "environment" };

/** What the last refresh attempt threw, if it threw. The mapping below
 *  identifies a failure as coming from the refresh path by finding this
 *  exact error in the cause chain of the request failure. */
interface RefreshProbe {
  failure: unknown;
}

/**
 * ctx.api: the ENGINE constructs and owns the management API client —
 * the pinned session's client, once per run (process pinning makes
 * the memoization correct). Nothing resolves until the first method
 * CALL, so a run that never issues a request never pays for — or
 * depends on — the SDK module load. A stored session gets the SDK's
 * refreshing path over the manager's TokenStorage view; an env
 * session gets the SDK's static-token path with its error mapping at
 * the call site. Every request failure passes through the engine-side
 * mapping below. The returned client is a Proxy whose method wrappers
 * await the lazy construction before applying the call — every client
 * method is async, so the deferral is invisible to callers.
 */
export function buildManagementApiClient(
  invocation: Invocation,
): ManagementApiClient {
  const debug = makeDebugLog(invocation.runtime);
  const probe: RefreshProbe = { failure: undefined };
  let binding: ClientBinding | undefined;
  let clientPromise: Promise<ManagementApiClient> | undefined;
  const resolveClient = (): Promise<ManagementApiClient> => {
    clientPromise ??= constructClient(invocation, debug, probe).then(
      (constructed) => {
        binding = constructed.binding;
        return constructed.client;
      },
    );
    return clientPromise;
  };

  return new Proxy({} as ManagementApiClient, {
    get(_target, property) {
      // Symbol probes and thenable checks (`await client`, promise
      // adoption) must not look like callable API methods.
      if (typeof property === "symbol" || property === "then") {
        return undefined;
      }
      return async (...args: unknown[]): Promise<unknown> => {
        try {
          const client = await resolveClient();
          const value: unknown = Reflect.get(client, property);
          if (typeof value !== "function") {
            throw new TypeError(
              `@prisma/cli-engine: ctx.api.${property} is not a function`,
            );
          }
          const result: unknown = await (Reflect.apply(
            value,
            client,
            args,
          ) as Promise<unknown>);
          if (binding?.source === "environment" && responseWas401(result)) {
            throw serviceTokenRejectedError({ envVar: SERVICE_TOKEN_ENV_VAR });
          }
          return result;
        } catch (cause) {
          throw await mapRequestFailure(
            invocation,
            debug,
            probe,
            binding,
            cause,
          );
        }
      };
    },
  });
}

async function constructClient(
  invocation: Invocation,
  debug: DebugLog,
  probe: RefreshProbe,
): Promise<{
  readonly client: ManagementApiClient;
  readonly binding: ClientBinding;
}> {
  const manager = invocation.runtime.credentialManager;
  if (manager === undefined) {
    throw credentialsRequiredError();
  }
  const session = await manager.currentSession();
  if (session === null) {
    throw credentialsRequiredError();
  }
  const config = invocation.runtime.managementApiClientConfig;
  if (config === undefined) {
    throw new Error(
      "@prisma/cli-engine: ctx.api requires Runtime.managementApiClientConfig when a credentialManager is wired",
    );
  }
  if (session.source === "environment") {
    const token = invocation.runtime.env[SERVICE_TOKEN_ENV_VAR];
    if (token === undefined) {
      throw credentialsRequiredError();
    }
    if (token.trim() === "") {
      throw emptyServiceTokenError({ envVar: SERVICE_TOKEN_ENV_VAR });
    }
    const { createManagementApiClient } = await import(
      "@prisma/management-api-sdk"
    );
    return {
      client: createManagementApiClient({
        baseUrl: config.apiBaseUrl,
        token,
      }),
      binding: { source: "environment" },
    };
  }
  const { createManagementApiSdk } = await import("@prisma/management-api-sdk");
  const sdk = createManagementApiSdk({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    apiBaseUrl: config.apiBaseUrl,
    authBaseUrl: config.authBaseUrl,
    tokenStorage: observedTokenStorage(
      manager.tokenStorage(session.workspaceId),
      session.workspaceId,
      debug,
      probe,
    ),
  });
  return {
    client: sdk.client,
    binding: { source: "stored", workspaceId: session.workspaceId },
  };
}

/**
 * The manager's view, with the refresh path observed. The SDK enters
 * withRefreshLock only from its refresh routine, so it marks both the
 * debug valve's "refresh attempted" line and the boundary whose throws
 * count as refresh-path failures.
 */
function observedTokenStorage(
  storage: TokenStorage,
  workspaceId: string,
  debug: DebugLog,
  probe: RefreshProbe,
): TokenStorage {
  const observedRefresh = async <T>(fn: () => Promise<T>): Promise<T> => {
    debug(`refresh attempted for session ${workspaceId}`);
    try {
      return await fn();
    } catch (failure) {
      probe.failure = failure;
      throw failure;
    }
  };
  return {
    getTokens: () => storage.getTokens(),
    setTokens: (tokens) => storage.setTokens(tokens),
    clearTokens: () => storage.clearTokens(),
    ...(storage.clearTokensIfCurrent === undefined
      ? {}
      : {
          clearTokensIfCurrent: (tokens) =>
            (
              storage.clearTokensIfCurrent as NonNullable<
                TokenStorage["clearTokensIfCurrent"]
              >
            )(tokens),
        }),
    withRefreshLock: (fn) =>
      storage.withRefreshLock === undefined
        ? observedRefresh(fn)
        : storage.withRefreshLock(() => observedRefresh(fn)),
  };
}

/** The static-token path has no error middleware, so a 401 arrives as
 *  a resolved openapi-fetch result; the call site inspects it. */
function responseWas401(result: unknown): boolean {
  if (typeof result !== "object" || result === null) {
    return false;
  }
  const response = (result as { readonly response?: unknown }).response;
  return (
    typeof response === "object" &&
    response !== null &&
    (response as { readonly status?: unknown }).status === 401
  );
}

/**
 * The engine-side request-failure mapping. A structured error raised
 * inside the pipeline (the SDK wraps non-SDK errors into
 * FetchError(cause), so the cause chain is walked for BOTH AuthError
 * and CLI structured errors) is rethrown unwrapped so it settles as
 * itself. An SDK AuthError is discriminated by STATE, never by
 * message parsing: refreshTokenInvalid === true (the SDK's definitive
 * invalid_grant signal, already cleared by compare-and-clear) maps to
 * the expired CLI.CREDENTIALS_REQUIRED; any other AuthError triggers
 * a re-read of the manager's state for the workspace the client is
 * BOUND to — that session gone means the session-ended
 * CLI.CREDENTIALS_REQUIRED, otherwise the failure was the auth
 * service's and nothing was cleared. A failure that came out of the
 * refresh path without being an AuthError (the SDK throws a plain
 * Error when a rotated token will not decode) is transient too:
 * nothing was cleared, and signing in again is not the fix.
 */
async function mapRequestFailure(
  invocation: Invocation,
  debug: DebugLog,
  probe: RefreshProbe,
  binding: ClientBinding | undefined,
  cause: unknown,
): Promise<unknown> {
  const structured = structuredCause(cause);
  if (structured !== undefined) {
    return structured;
  }
  const cameFromRefresh = refreshPathFailed(probe, cause);
  const authError = sdkAuthErrorInCauseChain(cause);
  if (authError === undefined) {
    if (!cameFromRefresh) {
      return cause;
    }
    // Only the error's type is reported: an arbitrary message can
    // carry fragments of a decoded token payload.
    debug(
      `refresh failed without an AuthError (${errorTypeOf(probe.failure)})`,
    );
    return authServiceError();
  }
  if (cameFromRefresh) {
    debug(
      `refresh failed: refreshTokenInvalid=${String(
        authError.refreshTokenInvalid === true,
      )} error=${authError.message}`,
    );
  }
  if (authError.refreshTokenInvalid === true) {
    return credentialsRequiredError("expired");
  }
  const manager = invocation.runtime.credentialManager;
  if (manager === undefined || binding?.source !== "stored") {
    return authServiceError();
  }
  return mapStoredSessionAuthFailure(manager, binding.workspaceId, cause);
}

async function mapStoredSessionAuthFailure(
  manager: CredentialManager,
  boundWorkspaceId: string,
  cause: unknown,
): Promise<unknown> {
  let sessions: readonly Session[];
  try {
    sessions = await manager.sessions();
  } catch (stateCause) {
    return CliStructuredError.is(stateCause) ? stateCause : cause;
  }
  const boundSessionGone = !sessions.some(
    (session) => session.workspaceId === boundWorkspaceId,
  );
  if (boundSessionGone) {
    return credentialsRequiredError("session-ended");
  }
  return authServiceError();
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

/** Structural match (name discriminator plus the refreshTokenInvalid
 *  field) rather than instanceof, so a duplicate SDK module instance
 *  cannot defeat the mapping — and so this check never forces the SDK
 *  module to load. */
function sdkAuthErrorInCauseChain(
  error: unknown,
): (Error & { readonly refreshTokenInvalid: unknown }) | undefined {
  for (const current of causeChain(error)) {
    if (current.name === "AuthError") {
      return current as Error & { readonly refreshTokenInvalid: unknown };
    }
  }
  return undefined;
}

/** The request failure carries the refresh attempt's own throw, so the
 *  failure arose in the refresh path rather than in the request. */
function refreshPathFailed(probe: RefreshProbe, cause: unknown): boolean {
  if (probe.failure === undefined) return false;
  if (cause === probe.failure) return true;
  for (const current of causeChain(cause)) {
    if (current === probe.failure) return true;
  }
  return false;
}

function errorTypeOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
