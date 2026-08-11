/**
 * A complete CredentialManager whose state lives in memory rather than
 * in a file. It implements the same rules as the file-backed one — the
 * pinned decision, upsert by workspace, idempotent removal, in-process
 * single-flight refresh, and the two token storages — and adds a seed
 * and a state read-back. Tests are what it is mostly used for, which is
 * why it ships from the ./testing subpath alongside the JWT minter that
 * produces tokens to seed it, but nothing about it is a stub.
 *
 * One rule it cannot carry: the blank-PRISMA_SERVICE_TOKEN refusal
 * belongs to the file-backed manager, which reads the variable. This
 * one is handed a credential, so a blank value has no representation
 * here. That rule is covered end to end through the real environment
 * in the CLI's own tests.
 */
import { Buffer } from "node:buffer";
import {
  credentialsRequiredError,
  credentialWorkspaceMismatchError,
  noSessionForWorkspaceError,
} from "./credential-errors";
import type {
  ActiveCredential,
  Credential,
  CredentialIdentity,
  CredentialManager,
  Session,
  StoredSessions,
} from "./credential-manager";
import type { TokenStorage } from "./management-api";
import {
  claimedExpiresAt,
  claimedIdentity,
  credentialWorkspaceId,
} from "./token-claims";

type Tokens = NonNullable<Awaited<ReturnType<TokenStorage["getTokens"]>>>;

/** The SDK's Tokens requires a workspace id, so an environment
 *  credential whose claims name no workspace is given this instead. It
 *  never leaves the manager, and it is never the empty string. */
const NO_WORKSPACE_CLAIMED = "(no workspace)";

/** A stored session with its credential material — what the manager
 *  holds, seeded in and read back out. Mirrors the state file's
 *  records. */
export interface SessionRecord {
  readonly workspaceId: string;
  readonly workspaceName: string | undefined;
  readonly credential: Credential;
}

export interface InMemoryCredentialManagerSeed {
  /** Stored sessions, mirroring the state file's records. */
  readonly sessions?: readonly SessionRecord[];
  /** The stored selection — the workspace whose session is used where
   *  a session is needed. */
  readonly selectedWorkspaceId?: string;
  /** Convenience seed: runs createSession's real claims derivation.
   *  The token must be a JWT with `workspace_id` (use mintTestJwt). */
  readonly credential?: Credential;
  /** The credential PRISMA_SERVICE_TOKEN supplies. Its token may carry
   *  no `workspace_id` claim, and it may carry a refresh token. */
  readonly environmentCredential?: Credential;
}

/** The whole stored state, readable back after a run. */
export interface InMemoryCredentialManagerState {
  readonly sessions: readonly SessionRecord[];
  readonly selectedWorkspaceId: string | undefined;
}

/** Mints an unsigned JWT whose payload is exactly `claims` — the
 *  harness's claim source (`sub`, `workspace_id`, `exp`, `email`). */
export function mintTestJwt(claims: Readonly<Record<string, unknown>>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(claims)}.test-signature`;
}

function asSession(record: SessionRecord): Session {
  return {
    workspaceId: record.workspaceId,
    workspaceName: record.workspaceName,
    expiresAt: record.credential.expiresAt,
  };
}

function storedActiveCredential(record: SessionRecord): ActiveCredential {
  return {
    workspaceId: record.workspaceId,
    workspaceName: record.workspaceName,
    expiresAt: record.credential.expiresAt,
    identity: claimedIdentity(record.credential.token),
    origin: { source: "stored" },
  };
}

function environmentActiveCredential(credential: Credential): ActiveCredential {
  return {
    workspaceId: credentialWorkspaceId(credential.token),
    workspaceName: undefined,
    expiresAt: claimedExpiresAt(credential.token) ?? credential.expiresAt,
    identity: claimedIdentity(credential.token),
    origin: { source: "environment" },
  };
}

/**
 * The memory-backed storage, for a credential with no home record: a
 * free function closing over one local variable, so no method of it —
 * clearTokens included — can reach the stored sessions. An environment
 * credential whose workspace matches a stored session therefore cannot
 * delete that session.
 */
function memoryBackedStorage(
  credential: Credential,
  singleFlight: <T>(fn: () => Promise<T>) => Promise<T>,
): TokenStorage {
  let tokens: Tokens | null = {
    workspaceId:
      credentialWorkspaceId(credential.token) ?? NO_WORKSPACE_CLAIMED,
    accessToken: credential.token,
    refreshToken: credential.refreshToken,
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

/** Which credential this process acts as, decided once. */
type Pin =
  | { readonly kind: "unresolved" }
  | { readonly kind: "environment" }
  | { readonly kind: "session"; readonly workspaceId: string }
  | { readonly kind: "none" };

/**
 * The harness's mutable in-memory CredentialManager: the same
 * interface commands see, with the whole stored state readable back
 * after a run, and the design's process pinning — which credential
 * this process acts as is fixed at the first activeCredential() read,
 * while the material behind it is re-read on every call. No
 * persistence, no locking — those belong to the real manager and its
 * own tests.
 */
export class InMemoryCredentialManager implements CredentialManager {
  /** §6 requires the refresh hook to serialise within a process. The
   *  file-backed manager runs this same queue; a harness that let two
   *  refreshes through would pass a test production would fail. */
  #refreshLock: Promise<unknown> = Promise.resolve();
  private storedSessions: SessionRecord[];
  private selection: string | undefined;
  private readonly environmentCredential: Credential | undefined;
  private pin: Pin = { kind: "unresolved" };
  private activeStorage: TokenStorage | undefined;

  constructor(seed: InMemoryCredentialManagerSeed) {
    this.storedSessions = [...(seed.sessions ?? [])];
    this.selection = seed.selectedWorkspaceId;
    this.environmentCredential = seed.environmentCredential;
    if (seed.credential !== undefined) {
      const workspaceId = credentialWorkspaceId(seed.credential.token);
      if (workspaceId === undefined) {
        throw new Error(
          "@prisma/cli-engine/testing: the `credential` seed runs createSession's claims derivation — the token must be a JWT with `workspace_id` (use mintTestJwt)",
        );
      }
      this.applyCreateSession(seed.credential, workspaceId);
    }
  }

  #singleFlight<T>(fn: () => Promise<T>): Promise<T> {
    const queued = this.#refreshLock.then(fn, fn);
    this.#refreshLock = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  state(): InMemoryCredentialManagerState {
    return {
      sessions: [...this.storedSessions],
      selectedWorkspaceId: this.selection,
    };
  }

  /** Applies a write as ANOTHER process would: the stored state
   *  changes, but this process's pinned decision does not move. */
  overwriteStoredState(state: {
    readonly sessions?: readonly SessionRecord[];
    readonly selectedWorkspaceId?: string | undefined;
  }): void {
    if (state.sessions !== undefined) {
      this.storedSessions = [...state.sessions];
    }
    if ("selectedWorkspaceId" in state) {
      this.selection = state.selectedWorkspaceId;
    }
  }

  async activeCredential(): Promise<ActiveCredential | null> {
    if (this.pin.kind === "unresolved") {
      this.pin = this.resolvePin();
      return this.credentialForPin(true);
    }
    return this.credentialForPin(false);
  }

  async sessions(): Promise<StoredSessions> {
    return {
      sessions: this.storedSessions.map((record) => asSession(record)),
      selectedWorkspaceId: this.resolvedSelection(),
    };
  }

  async createSession(
    credential: Credential,
    workspaceId: string,
  ): Promise<Session> {
    return this.applyCreateSession(credential, workspaceId);
  }

  async selectSession(workspaceId: string): Promise<Session> {
    const record = this.storedSessions.find(
      (stored) => stored.workspaceId === workspaceId,
    );
    if (record === undefined) {
      throw noSessionForWorkspaceError(workspaceId);
    }
    this.selection = workspaceId;
    if (this.environmentCredential === undefined) {
      this.pin = { kind: "session", workspaceId };
    }
    return asSession(record);
  }

  async endSession(workspaceId: string): Promise<void> {
    this.removeRecord(workspaceId);
    if (this.pin.kind === "session" && this.pin.workspaceId === workspaceId) {
      this.pin = { kind: "none" };
    }
  }

  async endAllSessions(): Promise<void> {
    this.storedSessions = [];
    this.selection = undefined;
    if (this.environmentCredential === undefined) {
      this.pin = { kind: "none" };
    }
  }

  async activeCredentialStorage(): Promise<TokenStorage> {
    this.activeStorage ??= this.buildActiveStorage();
    return this.activeStorage;
  }

  private buildActiveStorage(): TokenStorage {
    const pin = this.pin;
    if (pin.kind === "environment") {
      return memoryBackedStorage(this.requireEnvironmentCredential(), (fn) =>
        this.#singleFlight(fn),
      );
    }
    if (pin.kind === "session") {
      return this.storedSessionStorage(pin.workspaceId);
    }
    throw new Error(
      "@prisma/cli-engine/testing: activeCredentialStorage() is only valid once activeCredential() has returned non-null",
    );
  }

  /** The file-backed storage's analogue: the record is read afresh on
   *  every call, never snapshotted. */
  private storedSessionStorage(workspaceId: string): TokenStorage {
    const pinnedRecord = (): SessionRecord | undefined =>
      this.storedSessions.find((record) => record.workspaceId === workspaceId);
    return {
      getTokens: async () => {
        const record = pinnedRecord();
        if (record === undefined) {
          return null;
        }
        return {
          workspaceId,
          accessToken: record.credential.token,
          refreshToken: record.credential.refreshToken,
        };
      },
      setTokens: async (tokens) => {
        const record = pinnedRecord();
        if (record === undefined) {
          // The same structured error the real manager raises, so a
          // test of "the session ended mid-rotation" exercises the
          // production mapping rather than a harness-only shape.
          throw credentialsRequiredError("session-ended");
        }
        const claimed = credentialWorkspaceId(tokens.accessToken);
        if (claimed !== undefined && claimed !== workspaceId) {
          throw credentialWorkspaceMismatchError(workspaceId);
        }
        this.storedSessions = this.storedSessions.map((stored) =>
          stored.workspaceId === workspaceId
            ? {
                ...stored,
                credential: {
                  token: tokens.accessToken,
                  refreshToken: tokens.refreshToken,
                  expiresAt: claimedExpiresAt(tokens.accessToken),
                },
              }
            : stored,
        );
      },
      clearTokens: async () => {
        this.removeRecord(workspaceId);
      },
      clearTokensIfCurrent: async (tokens) => {
        const record = pinnedRecord();
        if (
          record === undefined ||
          tokens.workspaceId !== workspaceId ||
          tokens.accessToken !== record.credential.token ||
          tokens.refreshToken !== record.credential.refreshToken
        ) {
          return;
        }
        this.removeRecord(workspaceId);
      },
      withRefreshLock: (fn) => this.#singleFlight(fn),
    };
  }

  private removeRecord(workspaceId: string): void {
    this.storedSessions = this.storedSessions.filter(
      (stored) => stored.workspaceId !== workspaceId,
    );
    if (this.selection === workspaceId) {
      this.selection = undefined;
    }
  }

  private resolvePin(): Pin {
    if (this.environmentCredential !== undefined) {
      return { kind: "environment" };
    }
    const selected = this.resolvedSelection();
    return selected === undefined
      ? { kind: "none" }
      : { kind: "session", workspaceId: selected };
  }

  /** The selection the manager will admit to: one that names a stored
   *  session, or none. A dangling selection never escapes. */
  private resolvedSelection(): string | undefined {
    const selected = this.selection;
    return selected !== undefined &&
      this.storedSessions.some((record) => record.workspaceId === selected)
      ? selected
      : undefined;
  }

  private credentialForPin(justResolved: boolean): ActiveCredential | null {
    const pin = this.pin;
    if (pin.kind === "environment") {
      return environmentActiveCredential(this.requireEnvironmentCredential());
    }
    if (pin.kind === "session") {
      const record = this.storedSessions.find(
        (stored) => stored.workspaceId === pin.workspaceId,
      );
      if (record === undefined) {
        if (justResolved) {
          throw new Error(
            "@prisma/cli-engine/testing: the pin resolved to a workspace with no record",
          );
        }
        throw credentialsRequiredError("session-ended");
      }
      return storedActiveCredential(record);
    }
    if (this.storedSessions.length > 0) {
      throw credentialsRequiredError("sessions-held-none-selected");
    }
    return null;
  }

  private requireEnvironmentCredential(): Credential {
    const credential = this.environmentCredential;
    if (credential === undefined) {
      throw new Error(
        "@prisma/cli-engine/testing: no environment credential is seeded",
      );
    }
    return credential;
  }

  private applyCreateSession(
    credential: Credential,
    workspaceId: string,
  ): Session {
    const claimed = credentialWorkspaceId(credential.token);
    if (claimed !== undefined && claimed !== workspaceId) {
      throw credentialWorkspaceMismatchError(workspaceId);
    }
    const existing = this.storedSessions.find(
      (stored) => stored.workspaceId === workspaceId,
    );
    const record: SessionRecord = {
      workspaceId,
      workspaceName: existing?.workspaceName,
      credential: {
        token: credential.token,
        refreshToken: credential.refreshToken,
        expiresAt: claimedExpiresAt(credential.token) ?? credential.expiresAt,
      },
    };
    this.storedSessions = [
      ...this.storedSessions.filter(
        (stored) => stored.workspaceId !== workspaceId,
      ),
      record,
    ];
    this.selection = workspaceId;
    if (this.environmentCredential === undefined) {
      this.pin = { kind: "session", workspaceId };
    }
    return asSession(record);
  }
}
