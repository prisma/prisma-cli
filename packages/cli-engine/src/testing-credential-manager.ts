import { Buffer } from "node:buffer";
import {
  credentialsRequiredError,
  environmentSessionMutationError,
  noSessionForWorkspaceError,
} from "./credential-errors";
import type {
  Credential,
  CredentialManager,
  Session,
} from "./credential-manager";
import type { TokenStorage } from "./management-api";

const SERVICE_TOKEN_ENV_VAR = "PRISMA_SERVICE_TOKEN";

/** A stored session with its credential material, as seeded into and
 *  read back from the test credential manager. */
export interface TestSessionRecord {
  readonly workspaceId: string;
  readonly workspaceName: string | undefined;
  readonly credential: Credential;
}

export interface TestCredentialManagerSeed {
  /** Stored sessions, mirroring the state file's records. */
  readonly sessions?: readonly TestSessionRecord[];
  /** The file's current marker. */
  readonly currentWorkspaceId?: string;
  /** Convenience seed: runs createSession's real claims derivation.
   *  The token must be a JWT with `workspace_id` (use mintTestJwt). */
  readonly credential?: Credential;
  /** Composes the ephemeral env session (PRISMA_SERVICE_TOKEN). The
   *  token must be a JWT with `workspace_id` (use mintTestJwt). */
  readonly environmentToken?: string;
}

/** The whole stored state, readable back after a run. */
export interface TestCredentialManagerState {
  readonly sessions: readonly TestSessionRecord[];
  readonly currentWorkspaceId: string | null;
}

/** Mints an unsigned JWT whose payload is exactly `claims` — the
 *  harness's claim source (`sub`, `workspace_id`, `exp`, `email`). */
export function mintTestJwt(claims: Readonly<Record<string, unknown>>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(claims)}.test-signature`;
}

function decodeJwtClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length < 2) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function claimedWorkspaceId(token: string): string | undefined {
  const claims = decodeJwtClaims(token);
  const workspaceId = claims?.workspace_id;
  return typeof workspaceId === "string" ? workspaceId : undefined;
}

function claimedExpiresAt(token: string): Date | undefined {
  const exp = decodeJwtClaims(token)?.exp;
  return typeof exp === "number" ? new Date(exp * 1000) : undefined;
}

type Pin =
  | { readonly kind: "unpinned" }
  | { readonly kind: "environment" }
  | { readonly kind: "marker"; readonly workspaceId: string | null };

/**
 * The harness's mutable in-memory CredentialManager: the same
 * interface commands see, with the whole stored state readable back
 * after a run, and the design's process-pinning semantics —
 * currentSession() is fixed at its first read; only this manager's
 * own mutations move it. No persistence, no locking — those belong to
 * the real manager and its own tests.
 */
export class TestCredentialManager implements CredentialManager {
  private storedSessions: TestSessionRecord[];
  private markedWorkspaceId: string | null;
  private readonly environmentToken: string | undefined;
  private pin: Pin = { kind: "unpinned" };

  constructor(seed: TestCredentialManagerSeed) {
    this.storedSessions = [...(seed.sessions ?? [])];
    this.markedWorkspaceId = seed.currentWorkspaceId ?? null;
    this.environmentToken = seed.environmentToken;
    if (seed.credential !== undefined) {
      const workspaceId = claimedWorkspaceId(seed.credential.token);
      if (workspaceId === undefined) {
        throw new Error(
          "@prisma/cli-engine/testing: the `credential` seed runs createSession's claims derivation — the token must be a JWT with `workspace_id` (use mintTestJwt)",
        );
      }
      this.applyCreateSession(seed.credential, workspaceId);
    }
  }

  state(): TestCredentialManagerState {
    return {
      sessions: [...this.storedSessions],
      currentWorkspaceId: this.markedWorkspaceId,
    };
  }

  /** Applies a write as ANOTHER process would: the stored state
   *  changes, but this process's pinned session does not move. */
  overwriteStoredState(state: {
    readonly sessions?: readonly TestSessionRecord[];
    readonly currentWorkspaceId?: string | null;
  }): void {
    if (state.sessions !== undefined) {
      this.storedSessions = [...state.sessions];
    }
    if (state.currentWorkspaceId !== undefined) {
      this.markedWorkspaceId = state.currentWorkspaceId;
    }
  }

  async currentSession(): Promise<Session | null> {
    if (this.pin.kind === "unpinned") {
      this.pin =
        this.environmentToken !== undefined
          ? { kind: "environment" }
          : { kind: "marker", workspaceId: this.resolvedMarker() };
      return this.pinnedSession(true);
    }
    return this.pinnedSession(false);
  }

  async sessions(): Promise<readonly Session[]> {
    return this.storedSessions.map((record) => this.asSession(record));
  }

  async createSession(
    credential: Credential,
    workspaceId: string,
  ): Promise<Session> {
    return this.applyCreateSession(credential, workspaceId);
  }

  async useSession(session: Session): Promise<Session> {
    this.refuseUnderEnvironmentSession();
    const record = this.validatedWorkspaceReference(session);
    this.markedWorkspaceId = record.workspaceId;
    this.pin = { kind: "marker", workspaceId: record.workspaceId };
    return this.asSession(record);
  }

  async endSession(session: Session): Promise<void> {
    this.refuseUnderEnvironmentSession();
    const record = this.validatedWorkspaceReference(session);
    this.storedSessions = this.storedSessions.filter(
      (stored) => stored.workspaceId !== record.workspaceId,
    );
    if (this.markedWorkspaceId === record.workspaceId) {
      this.markedWorkspaceId = null;
    }
    if (
      this.pin.kind === "marker" &&
      this.pin.workspaceId === record.workspaceId
    ) {
      this.pin = { kind: "marker", workspaceId: null };
    }
  }

  async endAllSessions(): Promise<void> {
    if (this.environmentToken !== undefined) {
      if (this.storedSessions.length === 0) {
        return;
      }
      throw environmentSessionMutationError({
        envVar: SERVICE_TOKEN_ENV_VAR,
        storedSessionsExist: true,
      });
    }
    this.storedSessions = [];
    this.markedWorkspaceId = null;
    this.pin = { kind: "marker", workspaceId: null };
  }

  tokenStorage(workspaceId: string): TokenStorage {
    const boundRecord = (): TestSessionRecord | undefined =>
      this.storedSessions.find((record) => record.workspaceId === workspaceId);
    return {
      getTokens: async () => {
        const record = boundRecord();
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
        const record = boundRecord();
        if (record === undefined) {
          throw new Error(
            "@prisma/cli-engine/testing: the session this rotation belongs to has ended — a refresh write must not resurrect it",
          );
        }
        const claimed = claimedWorkspaceId(tokens.accessToken);
        if (claimed !== undefined && claimed !== workspaceId) {
          throw new Error(
            "@prisma/cli-engine/testing: a refreshed token's workspace_id claim disagrees with the bound workspace — refresh cannot re-scope",
          );
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
        this.removeRecordAndMarker(workspaceId);
      },
      clearTokensIfCurrent: async (tokens) => {
        const record = boundRecord();
        if (
          record === undefined ||
          tokens.workspaceId !== workspaceId ||
          tokens.accessToken !== record.credential.token ||
          tokens.refreshToken !== record.credential.refreshToken
        ) {
          return;
        }
        this.removeRecordAndMarker(workspaceId);
      },
      withRefreshLock: (fn) => fn(),
    };
  }

  private removeRecordAndMarker(workspaceId: string): void {
    this.storedSessions = this.storedSessions.filter(
      (stored) => stored.workspaceId !== workspaceId,
    );
    if (this.markedWorkspaceId === workspaceId) {
      this.markedWorkspaceId = null;
    }
  }

  /** The marker the first read pins: a marker naming no record (the
   *  migration none-current case) pins as none. */
  private resolvedMarker(): string | null {
    if (
      this.markedWorkspaceId !== null &&
      this.storedSessions.some(
        (record) => record.workspaceId === this.markedWorkspaceId,
      )
    ) {
      return this.markedWorkspaceId;
    }
    return null;
  }

  private pinnedSession(justPinned: boolean): Session | null {
    if (this.pin.kind === "environment") {
      return this.environmentSession();
    }
    if (this.pin.kind === "unpinned" || this.pin.workspaceId === null) {
      if (this.storedSessions.length > 0) {
        throw credentialsRequiredError("sessions-held-none-current");
      }
      return null;
    }
    const pinnedWorkspaceId = this.pin.workspaceId;
    const record = this.storedSessions.find(
      (stored) => stored.workspaceId === pinnedWorkspaceId,
    );
    if (record === undefined) {
      if (justPinned) {
        throw new Error(
          "@prisma/cli-engine/testing: the pin resolved to a workspace with no record",
        );
      }
      throw credentialsRequiredError("session-ended");
    }
    return this.asSession(record);
  }

  private environmentSession(): Session {
    const token = this.environmentToken;
    if (token === undefined) {
      throw new Error(
        "@prisma/cli-engine/testing: no environment token is seeded",
      );
    }
    const workspaceId = claimedWorkspaceId(token);
    if (workspaceId === undefined) {
      throw new Error(
        "@prisma/cli-engine/testing: the `environmentToken` seed must be a JWT with `workspace_id` (use mintTestJwt)",
      );
    }
    return {
      workspaceId,
      workspaceName: undefined,
      expiresAt: claimedExpiresAt(token),
      source: "environment",
      current: true,
    };
  }

  private asSession(record: TestSessionRecord): Session {
    return {
      workspaceId: record.workspaceId,
      workspaceName: record.workspaceName,
      expiresAt: record.credential.expiresAt,
      source: "stored",
      current: record.workspaceId === this.markedWorkspaceId,
    };
  }

  private applyCreateSession(
    credential: Credential,
    workspaceId: string,
  ): Session {
    const claimed = claimedWorkspaceId(credential.token);
    if (claimed !== undefined && claimed !== workspaceId) {
      throw new Error(
        "@prisma/cli-engine/testing: createSession's workspaceId argument disagrees with the credential's workspace_id claim",
      );
    }
    const existing = this.storedSessions.find(
      (stored) => stored.workspaceId === workspaceId,
    );
    const record: TestSessionRecord = {
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
    this.markedWorkspaceId = workspaceId;
    if (this.environmentToken === undefined) {
      this.pin = { kind: "marker", workspaceId };
    }
    return this.asSession(record);
  }

  private refuseUnderEnvironmentSession(): void {
    if (this.environmentToken !== undefined) {
      throw environmentSessionMutationError({
        envVar: SERVICE_TOKEN_ENV_VAR,
        storedSessionsExist: this.storedSessions.length > 0,
      });
    }
  }

  private validatedWorkspaceReference(session: Session): TestSessionRecord {
    if (session.source === "environment") {
      throw noSessionForWorkspaceError(session.workspaceId);
    }
    const record = this.storedSessions.find(
      (stored) => stored.workspaceId === session.workspaceId,
    );
    if (record === undefined) {
      throw noSessionForWorkspaceError(session.workspaceId);
    }
    return record;
  }
}
