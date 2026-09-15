// biome-ignore-all lint/performance/noAwaitInLoops: Lock acquisition retries must run sequentially.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import { defaultAuthFilePath } from "./client";
import {
  adoptLegacyState,
  legacyTokensMirror,
  syncLegacyContext,
} from "./legacy-state";

export const STATE_FILE_ENV_VAR = "PRISMA_AUTH_FILE";
export const DEPRECATED_STATE_FILE_ENV_VAR = "PRISMA_COMPUTE_AUTH_FILE";
export const STATE_VERSION = 1;

const FILE_MODE = 0o600;
const LOCK_STALE_MS = 5_000;
const LOCK_RETRY_MS = 10;
const LOCK_WAIT_TIMEOUT_MS = 10_000;
// The refresh lock is held across the token-endpoint exchange (a
// network call bounded at 10s), so its budgets are network-sized.
const REFRESH_LOCK_STALE_MS = 30_000;
const REFRESH_LOCK_RETRY_MS = 100;
const REFRESH_LOCK_WAIT_TIMEOUT_MS = 30_000;

interface LockTimings {
  readonly staleMs: number;
  readonly retryMs: number;
  readonly waitTimeoutMs: number;
}

const STATE_LOCK_TIMINGS: LockTimings = {
  staleMs: LOCK_STALE_MS,
  retryMs: LOCK_RETRY_MS,
  waitTimeoutMs: LOCK_WAIT_TIMEOUT_MS,
};

const REFRESH_LOCK_TIMINGS: LockTimings = {
  staleMs: REFRESH_LOCK_STALE_MS,
  retryMs: REFRESH_LOCK_RETRY_MS,
  waitTimeoutMs: REFRESH_LOCK_WAIT_TIMEOUT_MS,
};

export interface StoredSession {
  readonly workspaceId: string;
  readonly name?: string;
  /** Safe account metadata captured during login. Token material remains the
   *  source of authentication; this is only for identifying local sessions. */
  readonly user?: StoredSessionUser;
  readonly token: string;
  readonly refreshToken?: string;
  readonly expiresAt?: string;
}

export interface StoredSessionUser {
  readonly id?: string;
  readonly email?: string;
  readonly name?: string;
}

export interface CredentialState {
  readonly version: number;
  readonly sessions: readonly StoredSession[];
  readonly currentWorkspaceId: string | null;
}

export const EMPTY_STATE: CredentialState = {
  version: STATE_VERSION,
  sessions: [],
  currentWorkspaceId: null,
};

export type DebugLog = (message: string) => void;

export function makeDebugLog(
  env: Readonly<Record<string, string | undefined>>,
  write: (text: string) => void = (text) => {
    process.stderr.write(text);
  },
): DebugLog {
  if (env.PRISMA_DEBUG !== "1") return () => {};
  return (message) => {
    write(`prisma auth: ${message}\n`);
  };
}

export interface ResolvedStateFile {
  readonly filePath: string;
  readonly fromDeprecatedEnvVar: boolean;
}

export function resolveStateFilePath(
  env: Readonly<Record<string, string | undefined>>,
): ResolvedStateFile {
  const configured = env[STATE_FILE_ENV_VAR];
  if (configured?.trim()) {
    return { filePath: path.resolve(configured), fromDeprecatedEnvVar: false };
  }

  const deprecated = env[DEPRECATED_STATE_FILE_ENV_VAR];
  if (deprecated?.trim()) {
    return { filePath: path.resolve(deprecated), fromDeprecatedEnvVar: true };
  }

  return { filePath: defaultAuthFilePath(env), fromDeprecatedEnvVar: false };
}

export function credentialsUnreadableError(
  filePath: string,
  cause: unknown,
): CliStructuredError {
  return new CliStructuredError(
    "CLI.CREDENTIALS_UNREADABLE",
    "Your stored credentials could not be read.",
    {
      why: `The credentials file at ${filePath} exists but could not be read.`,
      nextActions: [
        {
          kind: "user-choice",
          label: "Check the file's permissions, then run the command again.",
        },
      ],
      cause,
    },
  );
}

/**
 * The stored state: the new format as written, the legacy store adopted
 * (§7 — a pure read that writes nothing), or empty. Reads take no lock:
 * writes rename a complete file into place.
 */
export async function readCredentialState(
  filePath: string,
): Promise<CredentialState> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_STATE;
    throw credentialsUnreadableError(filePath, error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_STATE;
  }

  if (typeof parsed !== "object" || parsed === null) return EMPTY_STATE;

  const shape = parsed as {
    sessions?: unknown;
    currentWorkspaceId?: unknown;
    version?: unknown;
  };
  if (Array.isArray(shape.sessions)) {
    return {
      version:
        typeof shape.version === "number" ? shape.version : STATE_VERSION,
      sessions: shape.sessions.filter(isStoredSession).map(normalizeSession),
      currentWorkspaceId:
        typeof shape.currentWorkspaceId === "string" &&
        shape.currentWorkspaceId.length > 0
          ? shape.currentWorkspaceId
          : null,
    };
  }

  return adoptLegacyState(parsed, filePath);
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as StoredSession;
  return (
    typeof candidate.workspaceId === "string" &&
    candidate.workspaceId.length > 0 &&
    typeof candidate.token === "string" &&
    candidate.token.length > 0
  );
}

function normalizeSession(session: StoredSession): StoredSession {
  const user = normalizeStoredSessionUser(session.user);
  return {
    workspaceId: session.workspaceId,
    ...(typeof session.name === "string" && session.name.length > 0
      ? { name: session.name }
      : {}),
    ...(user === undefined ? {} : { user }),
    token: session.token,
    ...(typeof session.refreshToken === "string" &&
    session.refreshToken.length > 0
      ? { refreshToken: session.refreshToken }
      : {}),
    ...(typeof session.expiresAt === "string" && session.expiresAt.length > 0
      ? { expiresAt: session.expiresAt }
      : {}),
  };
}

function normalizeStoredSessionUser(
  value: unknown,
): StoredSessionUser | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const id = normalizedString(candidate.id);
  const email = normalizedString(candidate.email);
  const name = normalizedString(candidate.name);
  if (id === undefined && email === undefined && name === undefined) {
    return undefined;
  }
  return {
    ...(id === undefined ? {} : { id }),
    ...(email === undefined ? {} : { email }),
    ...(name === undefined ? {} : { name }),
  };
}

function normalizedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Temp file in the same directory, fsync, rename, mode 0600 — a reader
 *  only ever sees a complete state. The written file also carries the
 *  legacy `tokens` mirror and the auth.context.json pointer stays in
 *  step, so the 3.x CLI sharing this store keeps seeing the sessions
 *  (#204). Our own reader branches on `sessions` before it ever looks
 *  at `tokens`, so the mirror is invisible to this CLI. */
export async function writeCredentialState(
  filePath: string,
  state: CredentialState,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  const payload = { ...state, tokens: legacyTokensMirror(state.sessions) };
  // The temp file holds the whole state, tokens included, so no path
  // out of here may leave one behind: a write that fails after the
  // handle is open would otherwise strand a working credential copy
  // under a name nothing later looks for.
  try {
    const handle = await fs.open(tempPath, "wx", FILE_MODE);
    try {
      await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
  await fs.chmod(filePath, FILE_MODE).catch(() => {});
  await syncLegacyContext(filePath, state.currentWorkspaceId);
}

class StateLockTimeoutError extends CliStructuredError {
  constructor(lockPath: string, waitTimeoutMs: number) {
    super(
      "CLI.CREDENTIALS_LOCKED",
      "Another prisma process is still updating your credentials.",
      {
        why: `The credentials lock at ${lockPath} was held for longer than ${waitTimeoutMs}ms.`,
        nextActions: [
          {
            kind: "user-choice",
            label: "Wait for the other command to finish, then try again.",
          },
        ],
      },
    );
  }
}

/**
 * The short advisory lock every mutation takes: acquire, re-read, apply
 * one slice, write, release. Its only job is lost-update prevention
 * between processes. No network I/O ever runs under it, so holds are
 * milliseconds and a crashed holder's lock is simply taken over after a
 * small fixed staleness threshold.
 */
export async function withStateLock<T>(
  filePath: string,
  debug: DebugLog,
  run: () => Promise<T>,
): Promise<T> {
  return withFileLock(`${filePath}.lock`, debug, STATE_LOCK_TIMINGS, run);
}

/**
 * The cross-process lock the delegated refresh holds for its whole
 * read → exchange → write sequence, so two processes never spend the
 * same refresh token. Distinct from the state lock: it IS held across
 * network I/O, so its staleness and wait budgets are larger, and it
 * uses its own lock path so short mutations are not queued behind it.
 */
export async function withRefreshFileLock<T>(
  filePath: string,
  debug: DebugLog,
  run: () => Promise<T>,
): Promise<T> {
  return withFileLock(
    `${filePath}.refresh-lock`,
    debug,
    REFRESH_LOCK_TIMINGS,
    run,
  );
}

async function withFileLock<T>(
  lockPath: string,
  debug: DebugLog,
  timings: LockTimings,
  run: () => Promise<T>,
): Promise<T> {
  const lockId = await acquireStateLock(lockPath, debug, timings);
  debug(`lock acquired ${lockPath}`);
  try {
    return await run();
  } finally {
    await releaseStateLock(lockPath, lockId);
    debug(`lock released ${lockPath}`);
  }
}

async function acquireStateLock(
  lockPath: string,
  debug: DebugLog,
  timings: LockTimings,
): Promise<string> {
  const lockId = randomUUID();
  const startedAt = Date.now();
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  while (true) {
    if (await tryCreateStateLock(lockPath, lockId)) return lockId;

    const tookOver = await takeOverStaleStateLock(lockPath, debug, timings);
    // The timeout is checked on every pass, including the ones that
    // took a lock over: a takeover that keeps appearing to succeed
    // must still end in a timeout rather than spinning.
    if (Date.now() - startedAt >= timings.waitTimeoutMs) {
      throw new StateLockTimeoutError(lockPath, timings.waitTimeoutMs);
    }
    if (!tookOver) {
      await new Promise((resolve) => setTimeout(resolve, timings.retryMs));
    }
  }
}

async function tryCreateStateLock(
  lockPath: string,
  lockId: string,
): Promise<boolean> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(lockPath, "wx", FILE_MODE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    await handle.writeFile(lockId, "utf8");
  } finally {
    await handle.close();
  }
  return true;
}

/**
 * Clear a crashed holder's lock. Removing it by RENAME is what makes
 * two waiting processes safe: only one of them can rename a given
 * path, so only one clears the corpse. Unlinking instead lets the
 * second process delete the FIRST one's freshly created lock — both
 * then run their read-modify-write at once and one update is lost,
 * which is the very thing the lock exists to prevent.
 */
async function takeOverStaleStateLock(
  lockPath: string,
  debug: DebugLog,
  timings: LockTimings,
): Promise<boolean> {
  const stale = await fs.stat(lockPath).catch(() => null);
  if (stale === null) return true;
  if (Date.now() - stale.mtimeMs <= timings.staleMs) return false;

  const takenPath = `${lockPath}.${randomUUID()}.stale`;
  try {
    await fs.rename(lockPath, takenPath);
  } catch {
    // Someone else took it over, or it was released — go round again
    // rather than reporting a takeover that did not happen.
    return false;
  }

  // Rename cannot be made conditional, so confirm afterwards that what
  // we moved aside is the corpse we examined. Two waiters release
  // together, and the slower one would otherwise rename away the lock
  // the faster one had just created — both would then believe they
  // held it and one mutation would be lost.
  const taken = await fs.stat(takenPath).catch(() => null);
  if (taken !== null && taken.mtimeMs !== stale.mtimeMs) {
    // Whoever created this owns it. `link` fails when the path is
    // occupied, so putting it back can never overwrite a third
    // process's lock.
    await fs.link(takenPath, lockPath).catch(() => {});
    await fs.unlink(takenPath).catch(() => {});
    return false;
  }

  await fs.unlink(takenPath).catch(() => {});
  debug(`lock taken over from a crashed holder ${lockPath}`);
  return true;
}

async function releaseStateLock(
  lockPath: string,
  lockId: string,
): Promise<void> {
  const holder = await fs.readFile(lockPath, "utf8").catch(() => null);
  if (holder !== lockId) return;
  await fs.unlink(lockPath).catch(() => {});
}
