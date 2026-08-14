/**
 * The production, environment-only CredentialManager (S3, R-S3-1): for
 * hosts whose sole credential source is the inter-process protocol —
 * PRISMA_SERVICE_TOKEN plus PRISMA_WORKSPACE_ID — such as composer's
 * rebuilt CLI. It holds no stored sessions and cannot: every mutation
 * refuses with a structured error. Env is a construction input; nothing
 * here reads process.env.
 */
import { readActiveAccessToken } from "./active-access-token";
import { emptyServiceTokenError } from "./credential-errors";
import {
  type ActiveAccessTokenOptions,
  type ActiveCredential,
  type Credential,
  type CredentialManager,
  SERVICE_TOKEN_ENV_VAR,
  type Session,
  type StoredSessions,
  WORKSPACE_ID_ENV_VAR,
} from "./credential-manager";
import type { TokenStorage } from "./management-api";
import { CliStructuredError } from "./protocol";
import {
  claimedExpiresAt,
  claimedIdentity,
  credentialWorkspaceId,
} from "./token-claims";

/** The SDK's Tokens requires a workspace id; an environment credential
 *  that names none is given this instead. It never leaves the manager
 *  and is never the empty string. */
const NO_WORKSPACE_NAMED = "(no workspace)";

function sessionsUnsupportedError(): CliStructuredError {
  return new CliStructuredError(
    "AUTH.SESSIONS_UNSUPPORTED",
    "This host manages no stored workspace sessions.",
    {
      why: `Its credentials come only from ${SERVICE_TOKEN_ENV_VAR} (and ${WORKSPACE_ID_ENV_VAR}); there is nothing to create, select, or end.`,
      nextActions: [
        {
          kind: "user-choice",
          label: `Set or change ${SERVICE_TOKEN_ENV_VAR} in the environment instead.`,
        },
      ],
    },
  );
}

export class EnvironmentCredentialManager implements CredentialManager {
  readonly #env: Readonly<Record<string, string | undefined>>;
  #refreshLock: Promise<unknown> = Promise.resolve();
  #activeStorage: TokenStorage | undefined;

  constructor(spec: {
    readonly env: Readonly<Record<string, string | undefined>>;
  }) {
    this.#env = spec.env;
  }

  async activeCredential(): Promise<ActiveCredential | null> {
    const token = this.#token();
    if (token === undefined) {
      return null;
    }
    return {
      workspaceId: this.#workspaceId(token),
      workspaceName: undefined,
      expiresAt: claimedExpiresAt(token),
      identity: claimedIdentity(token),
      origin: { source: "environment" },
    };
  }

  async sessions(): Promise<StoredSessions> {
    return { sessions: [], selectedWorkspaceId: undefined };
  }

  async createSession(
    _credential: Credential,
    _workspaceId: string,
  ): Promise<Session> {
    throw sessionsUnsupportedError();
  }

  async selectSession(_workspaceId: string): Promise<Session> {
    throw sessionsUnsupportedError();
  }

  async endSession(_workspaceId: string): Promise<void> {
    throw sessionsUnsupportedError();
  }

  async endAllSessions(): Promise<void> {
    throw sessionsUnsupportedError();
  }

  async activeCredentialStorage(): Promise<TokenStorage> {
    this.#activeStorage ??= this.#buildActiveStorage();
    return this.#activeStorage;
  }

  /** The spawn path's read: the env token passes through directly. It
   *  is already a snapshot with no refresh token behind it. */
  async activeAccessToken(
    options?: ActiveAccessTokenOptions,
  ): Promise<string | null> {
    const credential = await this.activeCredential();
    if (credential === null) return null;
    return readActiveAccessToken(
      await this.activeCredentialStorage(),
      undefined,
      options,
      credential.expiresAt,
    );
  }

  #buildActiveStorage(): TokenStorage {
    const token = this.#token();
    if (token === undefined) {
      throw new Error(
        "@prisma/cli-engine: activeCredentialStorage() is only valid once activeCredential() has returned non-null",
      );
    }
    // Memory-backed, per the design's no-home-record rule: nothing any
    // method does can reach stored state, because none exists.
    let tokens: Awaited<ReturnType<TokenStorage["getTokens"]>> = {
      workspaceId: this.#workspaceId(token) ?? NO_WORKSPACE_NAMED,
      accessToken: token,
      refreshToken: undefined,
    };
    const singleFlight = <T>(fn: () => Promise<T>): Promise<T> => {
      const queued = this.#refreshLock.then(fn, fn);
      this.#refreshLock = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    };
    return {
      getTokens: async () => tokens,
      setTokens: async (rotated) => {
        tokens = rotated;
      },
      clearTokens: async () => {
        tokens = null;
      },
      withRefreshLock: (fn) => singleFlight(fn),
    };
  }

  /** The raw variable, resolved fresh on every read. Unset or missing
   *  means no credential; set-but-blank is the structured error state
   *  (a blank token authenticates nothing and would silently shadow
   *  nothing here — surface it). */
  #token(): string | undefined {
    const raw = this.#env[SERVICE_TOKEN_ENV_VAR];
    if (raw === undefined) {
      return undefined;
    }
    if (raw.trim() === "") {
      throw emptyServiceTokenError({ envVar: SERVICE_TOKEN_ENV_VAR });
    }
    return raw;
  }

  /** The credential's workspace: its own claims first (the token is
   *  authoritative about itself), the companion variable otherwise. */
  #workspaceId(token: string): string | undefined {
    const claimed = credentialWorkspaceId(token);
    if (claimed !== undefined) {
      return claimed;
    }
    const fromEnv = this.#env[WORKSPACE_ID_ENV_VAR]?.trim();
    return fromEnv === undefined || fromEnv === "" ? undefined : fromEnv;
  }
}
