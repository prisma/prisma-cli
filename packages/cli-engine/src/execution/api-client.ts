import {
  authServiceError,
  credentialRejectedError,
  credentialsRequiredError,
} from "../credential-errors";
import {
  type ActiveCredential,
  type CredentialManager,
  SERVICE_TOKEN_ENV_VAR,
  type StoredSessions,
} from "../credential-manager";
import type { ManagementApiClient, TokenStorage } from "../management-api";
import { CliStructuredError } from "../protocol";
import { type DebugLog, makeDebugLog } from "./debug";
import type { Invocation } from "./engine";

/** What the last refresh attempt threw, if it threw. The mapping below
 *  identifies a failure as coming from the refresh path by finding this
 *  exact error in the cause chain of the request failure. */
interface RefreshProbe {
  failure: unknown;
}

/** What the client authenticates as, resolved when it is constructed.
 *  The failure mapping asks this credential and its storage what
 *  happened rather than remembering a binding of its own. */
interface PinnedCredential {
  readonly active: ActiveCredential;
  readonly storage: TokenStorage;
}

/**
 * ctx.api: the ENGINE constructs and owns the management API client —
 * ONE client for the active credential, once per run (process pinning
 * makes the memoization correct). Nothing resolves until the first
 * method CALL, so a run that never issues a request never pays for —
 * or depends on — the SDK module load. The client is always the SDK's
 * refreshing one over the storage the manager hands out, whatever the
 * credential's origin: a credential refreshes if it has a refresh
 * token. Every request failure passes through the engine-side mapping
 * below. The returned client is a Proxy whose method wrappers await
 * the lazy construction before applying the call — every client method
 * is async, so the deferral is invisible to callers.
 */
export function buildManagementApiClient(
  invocation: Invocation,
): ManagementApiClient {
  const debug = makeDebugLog(invocation.runtime);
  const probe: RefreshProbe = { failure: undefined };
  let pinned: PinnedCredential | undefined;
  let clientPromise: Promise<ManagementApiClient> | undefined;
  const resolveClient = (): Promise<ManagementApiClient> => {
    clientPromise ??= constructClient(invocation, debug, probe).then(
      (constructed) => {
        pinned = constructed.pinned;
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
          return await (Reflect.apply(value, client, args) as Promise<unknown>);
        } catch (cause) {
          throw await mapRequestFailure(
            invocation,
            debug,
            probe,
            pinned,
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
  readonly pinned: PinnedCredential;
}> {
  const manager = invocation.runtime.credentialManager;
  if (manager === undefined) {
    throw credentialsRequiredError();
  }
  const active = await manager.activeCredential();
  if (active === null) {
    throw credentialsRequiredError();
  }
  const config = invocation.runtime.managementApiClientConfig;
  if (config === undefined) {
    throw new Error(
      "@prisma/cli-engine: ctx.api requires Runtime.managementApiClientConfig when a credentialManager is wired",
    );
  }
  const storage = observedTokenStorage(
    await manager.activeCredentialStorage(),
    active,
    debug,
    probe,
  );
  const { createManagementApiSdk } = await import("@prisma/management-api-sdk");
  const sdk = createManagementApiSdk({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    apiBaseUrl: config.apiBaseUrl,
    authBaseUrl: config.authBaseUrl,
    tokenStorage: storage,
  });
  return { client: sdk.client, pinned: { active, storage } };
}

/**
 * The manager's storage, with the refresh path observed. The SDK enters
 * withRefreshLock only from its refresh routine, so it marks both the
 * debug valve's "refresh attempted" line and the boundary whose throws
 * count as refresh-path failures.
 */
function observedTokenStorage(
  storage: TokenStorage,
  active: ActiveCredential,
  debug: DebugLog,
  probe: RefreshProbe,
): TokenStorage {
  const label = active.workspaceId ?? "(no workspace)";
  const observedRefresh = async <T>(fn: () => Promise<T>): Promise<T> => {
    debug(`refresh attempted for session ${label}`);
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

/**
 * The engine-side request-failure mapping. A structured error raised
 * inside the pipeline (the SDK wraps non-SDK errors into
 * FetchError(cause), so the cause chain is walked for BOTH AuthError
 * and CLI structured errors) is rethrown unwrapped so it settles as
 * itself. An SDK AuthError is discriminated by STATE, never by message
 * parsing: refreshTokenInvalid === true (the SDK's definitive
 * invalid_grant signal, already cleared by compare-and-clear) maps to
 * the expired CLI.CREDENTIALS_REQUIRED; a refresh the SDK refused
 * because the token set carries no refresh token maps to the
 * credential-rejected error, since that credential could never have
 * been renewed; any other AuthError triggers a re-read of the stored
 * state for the credential's own workspace — that session gone means
 * the session-ended CLI.CREDENTIALS_REQUIRED, otherwise the failure was
 * the auth service's and nothing was cleared. A failure that came out
 * of the refresh path without being an AuthError (the SDK throws a
 * plain Error when a rotated token will not decode) is transient too:
 * nothing was cleared, and signing in again is not the fix.
 */
async function mapRequestFailure(
  invocation: Invocation,
  debug: DebugLog,
  probe: RefreshProbe,
  pinned: PinnedCredential | undefined,
  cause: unknown,
): Promise<unknown> {
  // Before anything else: a CLI structured error raised inside the
  // request pipeline — including one the manager raised from a
  // rotation write — is already the honest answer and must surface as
  // itself rather than being folded into the transient error.
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
      )} error=${endpointVerdict(authError.message)}`,
    );
  }
  const manager = invocation.runtime.credentialManager;
  if (manager === undefined || pinned === undefined) {
    return authError.refreshTokenInvalid === true
      ? credentialsRequiredError("expired")
      : authServiceError();
  }
  // "Expired" and "ended" are both statements about a stored session,
  // so neither can be true of a credential that has no home record.
  // Today the uniform refresh path cannot reach here with one — an
  // environment credential carries no refresh token — but §11.2 keeps
  // that path deliberately, so the discrimination travels with it.
  const homeRecord = hasHomeRecord(pinned.active);
  if (authError.refreshTokenInvalid === true) {
    return homeRecord
      ? credentialsRequiredError("expired")
      : credentialRejectedError(pinned.active.origin, SERVICE_TOKEN_ENV_VAR);
  }
  if (cameFromRefresh && (await couldNeverHaveBeenRenewed(pinned.storage))) {
    return credentialRejectedError(pinned.active.origin, SERVICE_TOKEN_ENV_VAR);
  }
  // Everything left is the auth service failing transiently. Only a
  // stored session can additionally have been ended underneath us.
  return homeRecord
    ? mapAgainstStoredState(manager, pinned.active, cause)
    : authServiceError();
}

/** Whether this credential is backed by a stored session. The origin
 *  is the only thing that answers it, which is why the credential-
 *  rejected error is allowed to read it (§11.1). */
function hasHomeRecord(active: ActiveCredential): boolean {
  return active.origin.source === "stored";
}

/**
 * A 401 that could never have been renewed: the SDK refused to reach
 * the token endpoint at all because the token set carries no refresh
 * token. Read from the storage's own state — never from the SDK's
 * message.
 */
async function couldNeverHaveBeenRenewed(
  storage: TokenStorage,
): Promise<boolean> {
  try {
    const tokens = await storage.getTokens();
    return tokens !== null && !tokens.refreshToken;
  } catch {
    return false;
  }
}

async function mapAgainstStoredState(
  manager: CredentialManager,
  active: ActiveCredential,
  cause: unknown,
): Promise<unknown> {
  const workspaceId = active.workspaceId;
  if (workspaceId === undefined) {
    return authServiceError();
  }
  let stored: StoredSessions;
  try {
    stored = await manager.sessions();
  } catch (stateCause) {
    return CliStructuredError.is(stateCause) ? stateCause : cause;
  }
  const sessionGone = !stored.sessions.some(
    (session) => session.workspaceId === workspaceId,
  );
  if (sessionGone) {
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

/**
 * The endpoint's verdict, without its free text. The SDK builds a
 * refresh AuthError's message either as `<error>: <error_description>`
 * from the token endpoint's body or as one of its own fixed strings
 * (which carry the HTTP status). Only the part before the description
 * is logged: the description is text the auth service chose, and the
 * debug valve must never become a way for it to reach a log.
 */
function endpointVerdict(message: string): string {
  const description = message.indexOf(": ");
  return description === -1 ? message : message.slice(0, description);
}
