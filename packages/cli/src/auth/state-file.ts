// biome-ignore-all lint/performance/noAwaitInLoops: Lock acquisition retries must run sequentially.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import { defaultAuthFilePath } from "./client";
import { adoptLegacyState } from "./legacy-state";

export const STATE_FILE_ENV_VAR = "PRISMA_AUTH_FILE";
export const DEPRECATED_STATE_FILE_ENV_VAR = "PRISMA_COMPUTE_AUTH_FILE";
export const STATE_VERSION = 1;

const FILE_MODE = 0o600;
const LOCK_STALE_MS = 5_000;
const LOCK_RETRY_MS = 10;
const LOCK_WAIT_TIMEOUT_MS = 10_000;

export interface StoredSession {
  readonly workspaceId: string;
  readonly name?: string;
  readonly token: string;
  readonly refreshToken?: string;
  readonly expiresAt?: string;
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
  if (env.PRISMA_NEXT_DEBUG !== "1") return () => {};
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
  return {
    workspaceId: session.workspaceId,
    ...(typeof session.name === "string" && session.name.length > 0
      ? { name: session.name }
      : {}),
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

/** Temp file in the same directory, fsync, rename, mode 0600 — a reader
 *  only ever sees a complete state. */
export async function writeCredentialState(
  filePath: string,
  state: CredentialState,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  const handle = await fs.open(tempPath, "wx", FILE_MODE);
  try {
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
  await fs.chmod(filePath, FILE_MODE).catch(() => {});
}

class StateLockTimeoutError extends CliStructuredError {
  constructor(lockPath: string) {
    super(
      "CLI.CREDENTIALS_LOCKED",
      "Another prisma process is still updating your credentials.",
      {
        why: `The credentials lock at ${lockPath} was held for longer than ${LOCK_WAIT_TIMEOUT_MS}ms.`,
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
  const lockPath = `${filePath}.lock`;
  const lockId = await acquireStateLock(lockPath, debug);
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
): Promise<string> {
  const lockId = randomUUID();
  const startedAt = Date.now();
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  while (true) {
    if (await tryCreateStateLock(lockPath, lockId)) return lockId;

    if (await takeOverStaleStateLock(lockPath, debug)) continue;

    if (Date.now() - startedAt >= LOCK_WAIT_TIMEOUT_MS) {
      throw new StateLockTimeoutError(lockPath);
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
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

async function takeOverStaleStateLock(
  lockPath: string,
  debug: DebugLog,
): Promise<boolean> {
  const stats = await fs.stat(lockPath).catch(() => null);
  if (!stats) return true;
  if (Date.now() - stats.mtimeMs <= LOCK_STALE_MS) return false;

  debug(`lock taken over from a crashed holder ${lockPath}`);
  await fs.unlink(lockPath).catch(() => {});
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
