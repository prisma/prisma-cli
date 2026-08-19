import fs from "node:fs/promises";
import path from "node:path";
import type {
  ActiveAccessTokenOptions,
  ActiveCredential,
  Credential,
  CredentialIdentity,
  CredentialManager,
  CredentialRefresher,
  Session,
  TokenStorage,
} from "@prisma/cli-engine";
import {
  claimedExpiresAt,
  claimedIdentity,
  credentialsRequiredError,
  credentialWorkspaceId,
  credentialWorkspaceMismatchError,
  noSessionForWorkspaceError,
  readActiveAccessToken,
} from "@prisma/cli-engine";
import { environmentServiceToken } from "./service-token";
import {
  type CredentialState,
  type DebugLog,
  EMPTY_STATE,
  makeDebugLog,
  readCredentialState,
  resolveStateFilePath,
  type StoredSession,
  type StoredSessionUser,
  withRefreshFileLock,
  withStateLock,
  writeCredentialState,
} from "./state-file";
import { getAuthContextFilePath } from "./token-storage";

type Tokens = NonNullable<Awaited<ReturnType<TokenStorage["getTokens"]>>>;

type RefreshLock = <T>(fn: () => Promise<T>) => Promise<T>;

/** The SDK's Tokens requires a workspace id, so an environment
 *  credential whose claims name no workspace is given this instead. It
 *  never leaves the manager, and it is never the empty string. */
const NO_WORKSPACE_CLAIMED = "(no workspace)";

/** Looks the workspace's name up with the credential that was just
 *  minted. Best-effort: the manager treats any failure as "no name". */
export type FetchWorkspaceName = (
  credential: Credential,
  workspaceId: string,
) => Promise<string | undefined>;

/** Looks up safe account metadata for the credential that was just minted.
 *  Best-effort: a failed lookup never prevents the session from being saved. */
export type FetchSessionIdentity = (
  credential: Credential,
  workspaceId: string,
) => Promise<CredentialIdentity | undefined>;

export type AccountSession = Session & {
  readonly identity: CredentialIdentity | undefined;
};

export interface AccountStoredSessions {
  readonly sessions: readonly AccountSession[];
  readonly selectedWorkspaceId: string | undefined;
}

interface AccountAwareCredentialManager extends CredentialManager {
  enrichSessions(): Promise<AccountStoredSessions>;
}

/** Session display metadata is a CLI concern, not part of the shared engine
 *  contract. FileCredentialManager provides it; other managers degrade to the
 *  standard local session shape without inventing an account identity. */
export async function sessionsForDisplay(
  manager: CredentialManager,
): Promise<AccountStoredSessions> {
  if (isAccountAwareCredentialManager(manager)) {
    return manager.enrichSessions();
  }
  const stored = await manager.sessions();
  return {
    sessions: stored.sessions.map(asAccountSession),
    selectedWorkspaceId: stored.selectedWorkspaceId,
  };
}

export function sessionIdentity(
  session: Session,
): CredentialIdentity | undefined {
  return normalizedIdentity(
    Reflect.get(session, "identity") as CredentialIdentity | undefined,
  );
}

function isAccountAwareCredentialManager(
  manager: CredentialManager,
): manager is AccountAwareCredentialManager {
  return typeof Reflect.get(manager, "enrichSessions") === "function";
}

function asAccountSession(session: Session): AccountSession {
  return { ...session, identity: sessionIdentity(session) };
}

export interface FileCredentialManagerOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetchWorkspaceName?: FetchWorkspaceName;
  readonly fetchSessionIdentity?: FetchSessionIdentity;
  readonly refreshCredential?: CredentialRefresher;
  readonly debugWrite?: (text: string) => void;
}

/** Which credential this process acts as, decided at the first
 *  activeCredential() read. The decision is what is held; the
 *  material behind it is re-read on every call. */
type ActingAs =
  | { readonly kind: "unresolved" }
  | { readonly kind: "environment" }
  | { readonly kind: "session"; readonly workspaceId: string }
  | { readonly kind: "none" };

type ResolvedActingAs = Exclude<ActingAs, { readonly kind: "unresolved" }>;

/**
 * The memory-backed storage, for a credential with no home record: a
 * free function closing over one local variable. It is never given the
 * state file's path, so no method of it — clearTokens included — can
 * reach the stored sessions, and an environment credential whose
 * workspace matches a stored session cannot delete that session.
 */
function memoryBackedStorage(
  credential: Credential,
  withRefreshLock: RefreshLock,
): TokenStorage {
  let tokens: Tokens | null = {
    workspaceId:
      credentialWorkspaceId(credential.token) ?? NO_WORKSPACE_CLAIMED,
    accessToken: credential.token,
    refreshToken: credential.refreshToken,
    expiresAt: claimedExpiresAt(credential.token) ?? credential.expiresAt,
  };
  return {
    getTokens: async () => tokens,
    setTokens: async (rotated, expiresAt) => {
      tokens = {
        ...rotated,
        expiresAt:
          claimedExpiresAt(rotated.accessToken) ??
          expiresAt ??
          tokens?.expiresAt,
      };
    },
    clearTokens: async () => {
      tokens = null;
    },
    withRefreshLock,
  };
}

/**
 * The credential manager over one state file. Sessions are keyed by
 * workspace id; which credential this process acts as is decided once;
 * every mutation takes a short file lock, re-reads, applies its slice,
 * and writes atomically. Reads never write and take no lock.
 */
export class FileCredentialManager implements CredentialManager {
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #filePath: string;
  readonly #debug: DebugLog;
  readonly #fetchWorkspaceName: FetchWorkspaceName | undefined;
  readonly #fetchSessionIdentity: FetchSessionIdentity | undefined;
  readonly #refreshCredential: CredentialRefresher | undefined;
  #actingAs: ActingAs = { kind: "unresolved" };
  /** Built for the credential the process acts as. Every mutation that
   *  changes that discards it, so a command that mutates and then
   *  reaches for ctx.api cannot be handed storage for the credential it
   *  used to be acting as. */
  #activeStorage: TokenStorage | undefined;
  #refreshLock: Promise<unknown> = Promise.resolve();

  constructor(options: FileCredentialManagerOptions) {
    this.#env = options.env;
    this.#filePath = resolveStateFilePath(options.env).filePath;
    this.#debug = makeDebugLog(options.env, options.debugWrite);
    this.#fetchWorkspaceName = options.fetchWorkspaceName;
    this.#fetchSessionIdentity = options.fetchSessionIdentity;
    this.#refreshCredential = options.refreshCredential;
    this.#debug(`state file ${this.#filePath}`);
  }

  get stateFilePath(): string {
    return this.#filePath;
  }

  async activeCredential(): Promise<ActiveCredential | null> {
    const actingAs = await this.#resolveActingAs();

    if (actingAs.kind === "environment") {
      return environmentCredential(this.#requireEnvironmentToken());
    }
    const state = await readCredentialState(this.#filePath);
    if (actingAs.kind === "none") {
      if (state.sessions.length > 0) {
        throw credentialsRequiredError("sessions-held-none-selected");
      }
      return null;
    }
    const record = state.sessions.find(
      (session) => session.workspaceId === actingAs.workspaceId,
    );
    if (record === undefined) {
      throw credentialsRequiredError("session-ended");
    }
    return storedCredential(record);
  }

  async sessions(): Promise<AccountStoredSessions> {
    const state = await readCredentialState(this.#filePath);
    return storedSessions(state);
  }

  async enrichSessions(): Promise<AccountStoredSessions> {
    if (this.#fetchSessionIdentity === undefined) return this.sessions();
    const state = await readCredentialState(this.#filePath);
    const candidates = state.sessions.filter(
      (session) => session.user === undefined,
    );
    if (candidates.length === 0) return storedSessions(state);

    const fetched = await Promise.all(
      candidates.map(async (session) => ({
        workspaceId: session.workspaceId,
        token: session.token,
        identity: await this.#lookUpSessionIdentity(
          storedSessionCredential(session),
          session.workspaceId,
        ),
      })),
    );
    const byWorkspaceId = new Map(
      fetched
        .filter(
          (
            result,
          ): result is typeof result & { identity: CredentialIdentity } =>
            result.identity !== undefined,
        )
        .map((result) => [result.workspaceId, result] as const),
    );
    if (byWorkspaceId.size === 0) return this.sessions();

    return this.#mutate((current) => {
      let changed = false;
      const sessions = current.sessions.map((session) => {
        const fetchedSession = byWorkspaceId.get(session.workspaceId);
        if (
          session.user !== undefined ||
          fetchedSession === undefined ||
          fetchedSession.token !== session.token
        ) {
          return session;
        }
        changed = true;
        return { ...session, user: storedUser(fetchedSession.identity) };
      });
      if (!changed) return { result: storedSessions(current) };
      const next = { ...current, sessions };
      return { state: next, result: storedSessions(next) };
    });
  }

  async createSession(
    credential: Credential,
    workspaceId: string,
  ): Promise<AccountSession> {
    const environmentInForce = this.#environmentToken() !== undefined;
    const claimed = credentialWorkspaceId(credential.token);
    if (claimed !== undefined && claimed !== workspaceId) {
      throw credentialWorkspaceMismatchError(workspaceId);
    }

    const created = await this.#mutate((state) => {
      const existing = state.sessions.find(
        (session) => session.workspaceId === workspaceId,
      );
      const record: StoredSession = {
        workspaceId,
        ...(existing?.name === undefined ? {} : { name: existing.name }),
        token: credential.token,
        ...(credential.refreshToken === undefined
          ? {}
          : { refreshToken: credential.refreshToken }),
        ...expiresAtSlice(credential.token, credential.expiresAt),
      };
      const next: CredentialState = {
        ...state,
        sessions: [
          ...state.sessions.filter(
            (session) => session.workspaceId !== workspaceId,
          ),
          record,
        ],
        currentWorkspaceId: workspaceId,
      };
      return { state: next, result: toSession(record) };
    });

    if (!environmentInForce) {
      this.#actAs({ kind: "session", workspaceId });
    }

    const [name, identity] = await Promise.all([
      this.#lookUpWorkspaceName(credential, workspaceId),
      this.#lookUpSessionIdentity(credential, workspaceId),
    ]);
    if (name === undefined && identity === undefined) return created;

    return this.#mutate((state) => {
      const record = state.sessions.find(
        (session) => session.workspaceId === workspaceId,
      );
      // Lookups happen outside the lock. Do not attach their result to a
      // credential that another process saved for this workspace meanwhile.
      if (record === undefined || record.token !== credential.token) {
        return { result: created };
      }
      const enriched: StoredSession = {
        ...record,
        ...(name === undefined ? {} : { name }),
        ...(identity === undefined ? {} : { user: storedUser(identity) }),
      };
      const next: CredentialState = {
        ...state,
        sessions: state.sessions.map((session) =>
          session.workspaceId === workspaceId ? enriched : session,
        ),
      };
      return { state: next, result: toSession(enriched) };
    });
  }

  async selectSession(workspaceId: string): Promise<AccountSession> {
    const environmentInForce = this.#environmentToken() !== undefined;

    const selected = await this.#mutate((state) => {
      const record = requireRecord(state, workspaceId);
      const next: CredentialState = {
        ...state,
        currentWorkspaceId: workspaceId,
      };
      return { state: next, result: toSession(record) };
    });
    if (!environmentInForce) {
      this.#actAs({ kind: "session", workspaceId });
    }
    return selected;
  }

  /** Idempotent (§11.8): a workspace with no session is already in the
   *  state this asks for, so the slice writes nothing and succeeds. */
  async endSession(workspaceId: string): Promise<void> {
    this.#refuseBlankEnvironmentToken();

    await this.#mutate((state) =>
      state.sessions.some((session) => session.workspaceId === workspaceId)
        ? { state: withoutRecord(state, workspaceId), result: undefined }
        : { result: undefined },
    );

    if (
      this.#actingAs.kind === "session" &&
      this.#actingAs.workspaceId === workspaceId
    ) {
      this.#actAs({ kind: "none" });
    }
  }

  async endAllSessions(): Promise<void> {
    const environmentInForce = this.#environmentToken() !== undefined;

    await this.#mutate((state) =>
      state.sessions.length === 0 && state.currentWorkspaceId === null
        ? { result: undefined }
        : { state: EMPTY_STATE, result: undefined },
    );
    await this.#reapLegacyContextFile();
    await this.#reapOrphanedWrites();
    if (!environmentInForce) {
      this.#actAs({ kind: "none" });
    }
  }

  async activeCredentialStorage(): Promise<TokenStorage> {
    this.#activeStorage ??= this.#buildActiveStorage();
    return this.#activeStorage;
  }

  /** The delegated path's read: the active credential's access token,
   *  fresh on every call, never the refresh token. Null when there is
   *  no active credential to read — storage exists only once
   *  activeCredential() has returned non-null. */
  async activeAccessToken(
    options: ActiveAccessTokenOptions,
  ): Promise<string | null> {
    const credential = await this.activeCredential();
    if (credential === null) {
      return null;
    }
    const storage = await this.activeCredentialStorage();
    return readActiveAccessToken(storage, this.#refreshCredential, options);
  }

  /** §11.2: which storage is chosen once, when the acting-as decision
   *  resolves. Each
   *  has exactly one source of truth — the file, or process memory. */
  #buildActiveStorage(): TokenStorage {
    const actingAs = this.#actingAs;
    if (actingAs.kind === "environment") {
      return memoryBackedStorage(
        {
          token: this.#requireEnvironmentToken(),
          refreshToken: undefined,
          expiresAt: undefined,
        },
        (fn) => this.#withRefreshLock(fn),
      );
    }
    if (actingAs.kind === "session") {
      return this.#fileBackedStorage(actingAs.workspaceId);
    }
    throw new Error(
      "@prisma/cli: activeCredentialStorage() is only valid once activeCredential() has returned non-null",
    );
  }

  /**
   * The file-backed storage, for a credential with a home record.
   * getTokens re-reads the file on EVERY call with no memory layer in
   * front: that is what lets this process see a pair another process
   * already rotated to, skip the exchange, and retry.
   */
  #fileBackedStorage(workspaceId: string): TokenStorage {
    return {
      getTokens: async () => {
        const state = await readCredentialState(this.#filePath);
        const record = state.sessions.find(
          (session) => session.workspaceId === workspaceId,
        );
        if (record === undefined) return null;
        return {
          workspaceId,
          accessToken: record.token,
          ...(record.refreshToken === undefined
            ? {}
            : { refreshToken: record.refreshToken }),
          ...(record.expiresAt === undefined
            ? {}
            : { expiresAt: new Date(record.expiresAt) }),
        };
      },

      setTokens: async (tokens, expiresAt) => {
        this.#debug(`rotation write for session ${workspaceId}`);
        const claimed = credentialWorkspaceId(tokens.accessToken);
        if (claimed !== undefined && claimed !== workspaceId) {
          throw credentialWorkspaceMismatchError(workspaceId);
        }
        await this.#mutate((state) => {
          const record = state.sessions.find(
            (session) => session.workspaceId === workspaceId,
          );
          if (record === undefined) {
            throw credentialsRequiredError("session-ended");
          }
          const rotated: StoredSession = {
            workspaceId: record.workspaceId,
            ...(record.name === undefined ? {} : { name: record.name }),
            ...storedUserSlice(record.user),
            token: tokens.accessToken,
            ...(tokens.refreshToken === undefined
              ? {}
              : { refreshToken: tokens.refreshToken }),
            // An SDK-driven rotation passes no expiry; keep the record's
            // rather than erase the one the proactive refresher stored.
            ...expiresAtSlice(
              tokens.accessToken,
              expiresAt ??
                (record.expiresAt === undefined
                  ? undefined
                  : new Date(record.expiresAt)),
            ),
          };
          return {
            state: {
              ...state,
              sessions: state.sessions.map((session) =>
                session.workspaceId === workspaceId ? rotated : session,
              ),
            },
            result: undefined,
          };
        });
      },

      clearTokens: async () => {
        this.#debug(`clearing session ${workspaceId}`);
        await this.#mutate((state) => ({
          state: withoutRecord(state, workspaceId),
          result: undefined,
        }));
      },

      clearTokensIfCurrent: async (tokens) => {
        this.#debug(
          `clearing session ${workspaceId} if its pair still matches`,
        );
        await this.#mutate((state) => {
          const record = state.sessions.find(
            (session) => session.workspaceId === workspaceId,
          );
          const matches =
            record !== undefined &&
            tokens.workspaceId === workspaceId &&
            tokens.accessToken === record.token &&
            tokens.refreshToken === record.refreshToken;
          if (!matches) return { result: undefined };
          return {
            state: withoutRecord(state, workspaceId),
            result: undefined,
          };
        });
      },

      // The whole read → exchange → write sequence holds the
      // cross-process refresh lock, so two processes never spend the
      // same refresh token; the in-process chain serialises callers
      // within this process first.
      withRefreshLock: (fn) =>
        this.#withRefreshLock(() =>
          withRefreshFileLock(this.#filePath, this.#debug, fn),
        ),
    };
  }

  #withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#refreshLock.then(fn, fn);
    this.#refreshLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #resolveActingAs(): Promise<ResolvedActingAs> {
    const decided = this.#actingAs;
    if (decided.kind !== "unresolved") return decided;

    if (this.#environmentToken() !== undefined) {
      this.#debug("acting as the environment credential");
      this.#actingAs = { kind: "environment" };
      return { kind: "environment" };
    }
    const state = await readCredentialState(this.#filePath);
    const selected = resolvedMarker(state);
    this.#debug(`acting as session ${selected ?? "(none)"}`);
    const resolved: ResolvedActingAs =
      selected === null
        ? { kind: "none" }
        : { kind: "session", workspaceId: selected };
    this.#actingAs = resolved;
    return resolved;
  }

  /** Changes which credential the process acts as after a mutation,
   *  discarding storage built for the previous one. */
  #actAs(next: ResolvedActingAs): void {
    this.#actingAs = next;
    this.#activeStorage = undefined;
  }

  #environmentToken(): string | undefined {
    return environmentServiceToken(this.#env);
  }

  #requireEnvironmentToken(): string {
    const token = this.#environmentToken();
    if (token === undefined) {
      throw credentialsRequiredError();
    }
    return token;
  }

  /** A blank env token is an error state everywhere the environment
   *  credential would be consulted, including the mutations that no
   *  longer care whether a valid one is set. */
  /** A blank PRISMA_SERVICE_TOKEN is an error state everywhere the
   *  environment credential would be consulted, including the two
   *  mutations that do not otherwise read it. Reading is what raises;
   *  the value is deliberately unused. */
  #refuseBlankEnvironmentToken(): void {
    void this.#environmentToken();
  }

  /** endAllSessions clears everything, including the legacy context
   *  sidecar, which survives a store that was already empty. */
  async #reapLegacyContextFile(): Promise<void> {
    await fs.unlink(getAuthContextFilePath(this.#filePath)).catch(() => {});
  }

  /** A write that died between creating its temp file and renaming it
   *  leaves a full copy of the state, tokens and all. Someone running
   *  `auth logout` to revoke local access must not be left holding a
   *  working refresh token in an orphan. Writes take the lock and last
   *  milliseconds, so anything still here is one. */
  async #reapOrphanedWrites(): Promise<void> {
    const directory = path.dirname(this.#filePath);
    const prefix = `${path.basename(this.#filePath)}.`;
    const entries = await fs.readdir(directory).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".tmp"))
        .map((entry) => fs.unlink(path.join(directory, entry)).catch(() => {})),
    );
  }

  async #lookUpWorkspaceName(
    credential: Credential,
    workspaceId: string,
  ): Promise<string | undefined> {
    if (this.#fetchWorkspaceName === undefined) return undefined;
    try {
      const name = await this.#fetchWorkspaceName(credential, workspaceId);
      return name?.trim() ? name.trim() : undefined;
    } catch {
      return undefined;
    }
  }

  async #lookUpSessionIdentity(
    credential: Credential,
    workspaceId: string,
  ): Promise<CredentialIdentity | undefined> {
    if (this.#fetchSessionIdentity === undefined) return undefined;
    try {
      return normalizedIdentity(
        await this.#fetchSessionIdentity(credential, workspaceId),
      );
    } catch {
      return undefined;
    }
  }

  /** One mutation: the short lock, a fresh read, one slice, one atomic
   *  write. A slice that returns no state writes nothing. */
  async #mutate<T>(
    apply: (state: CredentialState) => {
      readonly state?: CredentialState;
      readonly result: T;
    },
  ): Promise<T> {
    return withStateLock(this.#filePath, this.#debug, async () => {
      const state = await readCredentialState(this.#filePath);
      const applied = apply(state);
      if (applied.state !== undefined) {
        await writeCredentialState(this.#filePath, applied.state);
      }
      return applied.result;
    });
  }
}

function requireRecord(
  state: CredentialState,
  workspaceId: string,
): StoredSession {
  const record = state.sessions.find(
    (session) => session.workspaceId === workspaceId,
  );
  if (record === undefined) {
    throw noSessionForWorkspaceError(workspaceId);
  }
  return record;
}

function withoutRecord(
  state: CredentialState,
  workspaceId: string,
): CredentialState {
  return {
    ...state,
    sessions: state.sessions.filter(
      (session) => session.workspaceId !== workspaceId,
    ),
    currentWorkspaceId:
      state.currentWorkspaceId === workspaceId
        ? null
        : state.currentWorkspaceId,
  };
}

function expiresAtSlice(
  token: string,
  fallback: Date | undefined,
): { expiresAt?: string } {
  const expiresAt = claimedExpiresAt(token) ?? fallback;
  return expiresAt === undefined ? {} : { expiresAt: expiresAt.toISOString() };
}

function storedSessionCredential(record: StoredSession): Credential {
  return {
    token: record.token,
    refreshToken: record.refreshToken,
    expiresAt:
      record.expiresAt === undefined ? undefined : new Date(record.expiresAt),
  };
}

/** The selection the manager will admit to: one that names a stored
 *  session, or none. A dangling selection never escapes. */
function resolvedMarker(state: CredentialState): string | null {
  const marked = state.currentWorkspaceId;
  if (
    marked !== null &&
    state.sessions.some((session) => session.workspaceId === marked)
  ) {
    return marked;
  }
  return null;
}

function storedSessions(state: CredentialState): AccountStoredSessions {
  return {
    sessions: state.sessions.map((record) => toSession(record)),
    selectedWorkspaceId: resolvedMarker(state) ?? undefined,
  };
}

function toSession(record: StoredSession): AccountSession {
  return {
    workspaceId: record.workspaceId,
    workspaceName: record.name,
    identity: storedIdentity(record),
    expiresAt:
      record.expiresAt === undefined ? undefined : new Date(record.expiresAt),
  };
}

function storedCredential(record: StoredSession): ActiveCredential {
  return {
    workspaceId: record.workspaceId,
    workspaceName: record.name,
    expiresAt:
      record.expiresAt === undefined ? undefined : new Date(record.expiresAt),
    identity: storedIdentity(record),
    origin: { source: "stored" },
  };
}

function storedIdentity(record: StoredSession): CredentialIdentity | undefined {
  const user = record.user;
  return user === undefined
    ? claimedIdentity(record.token)
    : { userId: user.id, email: user.email, name: user.name };
}

function storedUser(identity: CredentialIdentity): StoredSessionUser {
  return {
    ...(identity.userId === undefined ? {} : { id: identity.userId }),
    ...(identity.email === undefined ? {} : { email: identity.email }),
    ...(identity.name === undefined ? {} : { name: identity.name }),
  };
}

function storedUserSlice(user: StoredSessionUser | undefined): {
  user?: StoredSessionUser;
} {
  return user === undefined ? {} : { user };
}

function normalizedIdentity(
  identity: CredentialIdentity | undefined,
): CredentialIdentity | undefined {
  if (identity === undefined) return undefined;
  const userId = normalizedString(identity.userId);
  const email = normalizedString(identity.email);
  const name = normalizedString(identity.name);
  if (userId === undefined && email === undefined && name === undefined) {
    return undefined;
  }
  return { userId, email, name };
}

function normalizedString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** An environment token whose claims name no workspace reports no
 *  workspace id — never the empty string. */
function environmentCredential(token: string): ActiveCredential {
  return {
    workspaceId: credentialWorkspaceId(token),
    workspaceName: undefined,
    expiresAt: claimedExpiresAt(token),
    identity: claimedIdentity(token),
    origin: { source: "environment" },
  };
}
