import fs from "node:fs/promises";
import type {
  Credential,
  CredentialManager,
  Session,
  TokenStorage,
} from "@prisma/cli-engine";
import {
  credentialsRequiredError,
  emptyServiceTokenError,
  environmentSessionMutationError,
  noSessionForWorkspaceError,
} from "@prisma/cli-engine";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import {
  claimedExpiresAt,
  claimedWorkspaceId,
  serviceTokenWorkspaceId,
} from "./claims";
import { SERVICE_TOKEN_ENV_VAR } from "./client";
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

/** Looks the workspace's name up with the credential that was just
 *  minted. Best-effort: the manager treats any failure as "no name". */
export type FetchWorkspaceName = (
  credential: Credential,
  workspaceId: string,
) => Promise<string | undefined>;

export interface FileCredentialManagerOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetchWorkspaceName?: FetchWorkspaceName;
  readonly debugWrite?: (text: string) => void;
}

type Pin =
  | { readonly kind: "unpinned" }
  | { readonly kind: "environment" }
  | { readonly kind: "marker"; readonly workspaceId: string | null };

function credentialWorkspaceMismatchError(
  workspaceId: string,
): CliStructuredError {
  return new CliStructuredError(
    "AUTH.CREDENTIAL_WORKSPACE_MISMATCH",
    "That credential belongs to a different workspace.",
    {
      why: `The token's workspace_id claim does not name workspace '${workspaceId}'.`,
      nextActions: [
        {
          kind: "run-command",
          label: "Sign in again and pick the workspace you want",
          command: "prisma auth login",
        },
      ],
    },
  );
}

/**
 * The credential manager over one state file. Sessions are keyed by
 * workspace id; the current session is pinned once per process; every
 * mutation takes a short file lock, re-reads, applies its slice, and
 * writes atomically. Reads never write and take no lock.
 */
export class FileCredentialManager implements CredentialManager {
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #filePath: string;
  readonly #debug: DebugLog;
  readonly #fetchWorkspaceName: FetchWorkspaceName | undefined;
  #pin: Pin = { kind: "unpinned" };
  #refreshLock: Promise<unknown> = Promise.resolve();

  constructor(options: FileCredentialManagerOptions) {
    this.#env = options.env;
    this.#filePath = resolveStateFilePath(options.env).filePath;
    this.#debug = makeDebugLog(options.env, options.debugWrite);
    this.#fetchWorkspaceName = options.fetchWorkspaceName;
    this.#debug(`state file ${this.#filePath}`);
  }

  get stateFilePath(): string {
    return this.#filePath;
  }

  async currentSession(): Promise<Session | null> {
    const environmentToken = this.#environmentToken();
    if (this.#pin.kind === "unpinned") {
      if (environmentToken !== undefined) {
        this.#pin = { kind: "environment" };
        this.#debug("pinned to the environment session");
      } else {
        const state = await readCredentialState(this.#filePath);
        this.#pin = { kind: "marker", workspaceId: resolvedMarker(state) };
        this.#debug(`pinned to session ${this.#pin.workspaceId ?? "(none)"}`);
      }
    }

    if (this.#pin.kind === "environment") {
      return this.#environmentSession();
    }
    const pinnedWorkspaceId = this.#pin.workspaceId;
    const state = await readCredentialState(this.#filePath);
    if (pinnedWorkspaceId === null) {
      if (state.sessions.length > 0) {
        throw credentialsRequiredError("sessions-held-none-current");
      }
      return null;
    }
    const record = state.sessions.find(
      (session) => session.workspaceId === pinnedWorkspaceId,
    );
    if (record === undefined) {
      throw credentialsRequiredError("session-ended");
    }
    return toSession(record, state);
  }

  async sessions(): Promise<readonly Session[]> {
    const state = await readCredentialState(this.#filePath);
    return state.sessions.map((record) => toSession(record, state));
  }

  async createSession(
    credential: Credential,
    workspaceId: string,
  ): Promise<Session> {
    const claimed = claimedWorkspaceId(credential.token);
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
      return { state: next, result: toSession(record, next) };
    });

    if (this.#pin.kind !== "environment") {
      this.#pin = { kind: "marker", workspaceId };
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
      return { state: next, result: toSession(named, next) };
    });
  }

  async useSession(session: Session): Promise<Session> {
    await this.#refuseUnderEnvironmentSession();
    const workspaceId = referencedWorkspaceId(session);

    const selected = await this.#mutate((state) => {
      const record = requireRecord(state, workspaceId);
      const next: CredentialState = {
        ...state,
        currentWorkspaceId: workspaceId,
      };
      return { state: next, result: toSession(record, next) };
    });
    this.#pin = { kind: "marker", workspaceId };
    return selected;
  }

  async endSession(session: Session): Promise<void> {
    await this.#refuseUnderEnvironmentSession();
    const workspaceId = referencedWorkspaceId(session);

    await this.#mutate((state) => {
      requireRecord(state, workspaceId);
      return { state: withoutRecord(state, workspaceId), result: undefined };
    });

    if (this.#pin.kind === "marker" && this.#pin.workspaceId === workspaceId) {
      this.#pin = { kind: "marker", workspaceId: null };
    }
  }

  async endAllSessions(): Promise<void> {
    if (this.#environmentToken() !== undefined) {
      const stored = await readCredentialState(this.#filePath);
      if (stored.sessions.length === 0) return;
      throw environmentSessionMutationError({
        envVar: SERVICE_TOKEN_ENV_VAR,
        storedSessionsExist: true,
      });
    }

    await this.#mutate(() => ({ state: EMPTY_STATE, result: undefined }));
    await fs.unlink(getAuthContextFilePath(this.#filePath)).catch(() => {});
    this.#pin = { kind: "marker", workspaceId: null };
  }

  tokenStorage(workspaceId: string): TokenStorage {
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
        };
      },

      setTokens: async (tokens) => {
        this.#debug(`rotation write for session ${workspaceId}`);
        const claimed = claimedWorkspaceId(tokens.accessToken);
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
            ...expiresAtSlice(tokens.accessToken, undefined),
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

      withRefreshLock: <T>(fn: () => Promise<T>): Promise<T> => {
        const run = this.#refreshLock.then(fn, fn);
        this.#refreshLock = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    };
  }

  #environmentToken(): string | undefined {
    const raw = this.#env[SERVICE_TOKEN_ENV_VAR];
    if (raw === undefined) return undefined;
    if (raw.trim().length === 0) {
      throw emptyServiceTokenError({ envVar: SERVICE_TOKEN_ENV_VAR });
    }
    return raw.trim();
  }

  #environmentSession(): Session {
    const token = this.#environmentToken();
    if (token === undefined) {
      throw credentialsRequiredError();
    }
    return {
      workspaceId: serviceTokenWorkspaceId(token) ?? "",
      workspaceName: undefined,
      expiresAt: claimedExpiresAt(token),
      source: "environment",
      current: true,
    };
  }

  async #refuseUnderEnvironmentSession(): Promise<void> {
    if (this.#environmentToken() === undefined) return;
    const state = await readCredentialState(this.#filePath);
    throw environmentSessionMutationError({
      envVar: SERVICE_TOKEN_ENV_VAR,
      storedSessionsExist: state.sessions.length > 0,
    });
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

function referencedWorkspaceId(session: Session): string {
  if (session.source === "environment") {
    throw noSessionForWorkspaceError(session.workspaceId);
  }
  return session.workspaceId;
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

/** The marker a first read pins: a marker naming no record pins as
 *  none. */
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

function toSession(record: StoredSession, state: CredentialState): Session {
  return {
    workspaceId: record.workspaceId,
    workspaceName: record.name,
    expiresAt:
      record.expiresAt === undefined ? undefined : new Date(record.expiresAt),
    source: "stored",
    current: state.currentWorkspaceId === record.workspaceId,
  };
}
