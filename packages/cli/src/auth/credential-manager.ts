import fs from "node:fs/promises";
import path from "node:path";
import type {
  ActiveAccessTokenOptions,
  ActiveCredential,
  Credential,
  CredentialManager,
  CredentialRefresher,
  Session,
  StoredSessions,
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

export interface FileCredentialManagerOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetchWorkspaceName?: FetchWorkspaceName;
  readonly refreshCredential?: CredentialRefresher;
  readonly debugWrite?: (text: string) => void;
}

/** Which credential this process acts as, decided at the first
 *  activeCredential() read. The decision is what is pinned; the
 *  material behind it is re-read on every call. */
type Pin =
  | { readonly kind: "unresolved" }
  | { readonly kind: "environment" }
  | { readonly kind: "session"; readonly workspaceId: string }
  | { readonly kind: "none" };

type ResolvedPin = Exclude<Pin, { readonly kind: "unresolved" }>;

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
        expiresAt: claimedExpiresAt(rotated.accessToken) ?? expiresAt,
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
 * workspace id; which credential this process acts as is pinned once;
 * every mutation takes a short file lock, re-reads, applies its slice,
 * and writes atomically. Reads never write and take no lock.
 */
export class FileCredentialManager implements CredentialManager {
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #filePath: string;
  readonly #debug: DebugLog;
  readonly #fetchWorkspaceName: FetchWorkspaceName | undefined;
  readonly #refreshCredential: CredentialRefresher | undefined;
  #pin: Pin = { kind: "unresolved" };
  /** Built for one pinned credential. Every mutation that moves the
   *  pin discards it, so a command that mutates and then reaches for
   *  ctx.api cannot be handed storage for the credential it used to be
   *  acting as. */
  #activeStorage: TokenStorage | undefined;
  #refreshLock: Promise<unknown> = Promise.resolve();

  constructor(options: FileCredentialManagerOptions) {
    this.#env = options.env;
    this.#filePath = resolveStateFilePath(options.env).filePath;
    this.#debug = makeDebugLog(options.env, options.debugWrite);
    this.#fetchWorkspaceName = options.fetchWorkspaceName;
    this.#refreshCredential = options.refreshCredential;
    this.#debug(`state file ${this.#filePath}`);
  }

  get stateFilePath(): string {
    return this.#filePath;
  }

  async activeCredential(): Promise<ActiveCredential | null> {
    const pin = await this.#resolvePin();

    if (pin.kind === "environment") {
      return environmentCredential(this.#requireEnvironmentToken());
    }
    const state = await readCredentialState(this.#filePath);
    if (pin.kind === "none") {
      if (state.sessions.length > 0) {
        throw credentialsRequiredError("sessions-held-none-selected");
      }
      return null;
    }
    const record = state.sessions.find(
      (session) => session.workspaceId === pin.workspaceId,
    );
    if (record === undefined) {
      throw credentialsRequiredError("session-ended");
    }
    return storedCredential(record);
  }

  async sessions(): Promise<StoredSessions> {
    const state = await readCredentialState(this.#filePath);
    return {
      sessions: state.sessions.map((record) => toSession(record)),
      selectedWorkspaceId: resolvedMarker(state) ?? undefined,
    };
  }

  async createSession(
    credential: Credential,
    workspaceId: string,
  ): Promise<Session> {
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
      this.#repin({ kind: "session", workspaceId });
    }

    const name = await this.#lookUpWorkspaceName(credential, workspaceId);
    if (name === undefined) return created;

    return this.#mutate((state) => {
      const record = state.sessions.find(
        (session) => session.workspaceId === workspaceId,
      );
      if (record === undefined) return { result: created };
      const named: StoredSession = { ...record, name };
      const next: CredentialState = {
        ...state,
        sessions: state.sessions.map((session) =>
          session.workspaceId === workspaceId ? named : session,
        ),
      };
      return { state: next, result: toSession(named) };
    });
  }

  async selectSession(workspaceId: string): Promise<Session> {
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
      this.#repin({ kind: "session", workspaceId });
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

    if (this.#pin.kind === "session" && this.#pin.workspaceId === workspaceId) {
      this.#repin({ kind: "none" });
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
      this.#repin({ kind: "none" });
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
    options?: ActiveAccessTokenOptions,
  ): Promise<string | null> {
    const credential = await this.activeCredential();
    if (credential === null) {
      return null;
    }
    const storage = await this.activeCredentialStorage();
    return readActiveAccessToken(storage, this.#refreshCredential, options);
  }

  /** §11.2: which storage is chosen once, when the pin resolves. Each
   *  has exactly one source of truth — the file, or process memory. */
  #buildActiveStorage(): TokenStorage {
    const pin = this.#pin;
    if (pin.kind === "environment") {
      return memoryBackedStorage(
        {
          token: this.#requireEnvironmentToken(),
          refreshToken: undefined,
          expiresAt: undefined,
        },
        (fn) => this.#withRefreshLock(fn),
      );
    }
    if (pin.kind === "session") {
      return this.#fileBackedStorage(pin.workspaceId);
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
            token: tokens.accessToken,
            ...(tokens.refreshToken === undefined
              ? {}
              : { refreshToken: tokens.refreshToken }),
            ...expiresAtSlice(tokens.accessToken, expiresAt),
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

      withRefreshLock: (fn) => this.#withRefreshLock(fn),
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

  async #resolvePin(): Promise<ResolvedPin> {
    const pinned = this.#pin;
    if (pinned.kind !== "unresolved") return pinned;

    if (this.#environmentToken() !== undefined) {
      this.#debug("pinned to the environment credential");
      return this.#pinTo({ kind: "environment" });
    }
    const state = await readCredentialState(this.#filePath);
    const selected = resolvedMarker(state);
    this.#debug(`pinned to session ${selected ?? "(none)"}`);
    return this.#pinTo(
      selected === null
        ? { kind: "none" }
        : { kind: "session", workspaceId: selected },
    );
  }

  #pinTo(pin: ResolvedPin): ResolvedPin {
    this.#pin = pin;
    return pin;
  }

  /** Moves the pin after a mutation, discarding storage built for the
   *  credential this process was acting as before. */
  #repin(pin: ResolvedPin): void {
    this.#pin = pin;
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

function toSession(record: StoredSession): Session {
  return {
    workspaceId: record.workspaceId,
    workspaceName: record.name,
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
    identity: claimedIdentity(record.token),
    origin: { source: "stored" },
  };
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
