import {
  authServiceError,
  credentialsRequiredError,
} from "../credential-errors";
import type { Session } from "../credential-manager";
import type { ManagementApiClient } from "../management-api";
import { CliStructuredError } from "../protocol";
import type { Invocation } from "./engine";

/**
 * ctx.api: a thin lazy proxy over the credential manager's
 * apiClient(). Nothing resolves until the first method CALL, so a run
 * that never issues a request never touches the manager. Every request
 * failure passes through the engine-side error mapping below; the
 * returned client is a Proxy whose method wrappers await the lazy
 * resolution before applying the call — every client method is async,
 * so the deferral is invisible to callers.
 */
export function buildManagementApiClient(
  invocation: Invocation,
): ManagementApiClient {
  let clientPromise: Promise<ManagementApiClient> | undefined;
  const resolveClient = (): Promise<ManagementApiClient> => {
    clientPromise ??= resolveManagerClient(invocation);
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
        resolveClient()
          .then((client) => {
            const value: unknown = Reflect.get(client, property);
            if (typeof value !== "function") {
              throw new TypeError(
                `@prisma/cli-engine: ctx.api.${property} is not a function`,
              );
            }
            return Reflect.apply(value, client, args) as Promise<unknown>;
          })
          .catch(async (cause: unknown) => {
            throw await mapRequestFailure(invocation, cause);
          });
    },
  });
}

async function resolveManagerClient(
  invocation: Invocation,
): Promise<ManagementApiClient> {
  const manager = invocation.runtime.credentialManager;
  if (manager === undefined) {
    throw credentialsRequiredError();
  }
  return manager.apiClient();
}

/**
 * The engine-side request-failure mapping. A structured error raised
 * inside the pipeline is rethrown unwrapped so it settles as itself.
 * An SDK AuthError is discriminated by STATE, never by message
 * parsing: refreshTokenInvalid === true (the SDK's definitive
 * invalid_grant signal, already cleared by compare-and-clear) maps to
 * the expired CLI.CREDENTIALS_REQUIRED; any other AuthError triggers a
 * re-read of the manager's state — the bound grant gone means the
 * grant-removed CLI.CREDENTIALS_REQUIRED, otherwise the failure was
 * the auth service's and nothing was cleared.
 */
async function mapRequestFailure(
  invocation: Invocation,
  cause: unknown,
): Promise<unknown> {
  const structured = structuredCause(cause);
  if (structured !== undefined) {
    return structured;
  }
  const authError = sdkAuthErrorInCauseChain(cause);
  if (authError === undefined) {
    return cause;
  }
  if (authError.refreshTokenInvalid === true) {
    return credentialsRequiredError("expired");
  }
  const manager = invocation.runtime.credentialManager;
  if (manager === undefined) {
    return credentialsRequiredError();
  }
  let session: Session | null;
  try {
    session = await manager.session();
  } catch (stateCause) {
    return CliStructuredError.is(stateCause) ? stateCause : cause;
  }
  if (session === null) {
    return credentialsRequiredError("grant-removed");
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
): { readonly refreshTokenInvalid: unknown } | undefined {
  for (const current of causeChain(error)) {
    if (current.name === "AuthError") {
      return current as Error & { readonly refreshTokenInvalid: unknown };
    }
  }
  return undefined;
}
