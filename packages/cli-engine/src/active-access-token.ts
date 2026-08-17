import {
  authServiceError,
  credentialsRequiredError,
} from "./credential-errors";
import type { ActiveAccessTokenOptions } from "./credential-manager";
import type { CredentialRefresher, TokenStorage } from "./management-api";
import { CliStructuredError } from "./protocol";
import { claimedExpiresAt } from "./token-claims";

type Tokens = NonNullable<Awaited<ReturnType<TokenStorage["getTokens"]>>>;

/** Shared implementation used by every CredentialManager. */
export async function readActiveAccessToken(
  storage: TokenStorage,
  refreshCredential: CredentialRefresher | undefined,
  options: ActiveAccessTokenOptions,
): Promise<string | null> {
  const runLocked = storage.withRefreshLock ?? (async (fn) => fn());
  try {
    return await runLocked(async () => {
      // A waiter always re-reads inside the lock so a rotation that won the
      // race is used without exchanging the old refresh token again.
      const current = await storage.getTokens();
      if (current === null) return null;
      if (!expiresSoon(current.accessToken, options, current.expiresAt)) {
        return current.accessToken;
      }
      if (!current.refreshToken) {
        throw credentialsRequiredError("expiring-soon");
      }
      if (refreshCredential === undefined) {
        throw new Error(
          "@prisma/cli-engine: delegated OAuth refresh requires Runtime.refreshCredential",
        );
      }
      const refreshed = await refreshCredential({
        refreshToken: current.refreshToken,
        signal: options.signal,
      });
      if (refreshed.kind === "invalid") {
        await clearCurrentTokens(storage, current);
        throw credentialsRequiredError("expired");
      }
      // Persist before judging the new pair: the server has already
      // invalidated the old refresh token, so discarding the rotation
      // would strand a dead refresh token in storage.
      await storage.setTokens(
        {
          workspaceId: current.workspaceId,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
        },
        refreshed.expiresAt,
      );
      if (expiresSoon(refreshed.accessToken, options, refreshed.expiresAt)) {
        throw new Error("the OAuth endpoint returned a short-lived token");
      }
      return refreshed.accessToken;
    });
  } catch (cause) {
    if (CliStructuredError.is(cause) || options.signal.aborted) throw cause;
    throw authServiceError();
  }
}

function expiresSoon(
  token: string,
  options: ActiveAccessTokenOptions,
  fallbackExpiresAt?: Date,
): boolean {
  const expiresAt = claimedExpiresAt(token) ?? fallbackExpiresAt;
  return (
    expiresAt !== undefined &&
    expiresAt.getTime() - options.now.getTime() <= options.minimumValidityMs
  );
}

async function clearCurrentTokens(
  storage: TokenStorage,
  current: Tokens,
): Promise<void> {
  if (storage.clearTokensIfCurrent !== undefined) {
    await storage.clearTokensIfCurrent(current);
    return;
  }
  await storage.clearTokens();
}
