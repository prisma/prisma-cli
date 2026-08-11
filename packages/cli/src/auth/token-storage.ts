// biome-ignore-all lint/performance/noAwaitInLoops: Lock acquisition retries must run sequentially.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CredentialsStore } from "@prisma/credentials-store";
import type { TokenStorage, Tokens } from "@prisma/management-api-sdk";
import { sameWorkspaceId } from "../lib/workspace-id";
import { getAuthFilePath } from "./client";

interface StoredCredential {
  workspaceId?: unknown;
  token?: unknown;
  refreshToken?: unknown;
}

export interface StoredAuthWorkspace {
  id: string;
  name: string;
  credentialWorkspaceId: string;
  active: boolean;
  lastSeenAt: string | null;
}

export interface StoredAuthWorkspaceLogout {
  workspace: StoredAuthWorkspace;
  wasActive: boolean;
  activeWorkspace: StoredAuthWorkspace | null;
}

interface AuthContextWorkspace {
  id?: unknown;
  name?: unknown;
  lastSeenAt?: unknown;
}

interface AuthContextState {
  activeWorkspaceId: string | null;
  workspaces: Record<string, AuthContextWorkspace>;
}

interface AuthContextReadResult {
  exists: boolean;
  state: AuthContextState;
}

export interface FileTokenStorageOptions {
  activateOnSetTokens?: boolean;
  lockSetTokens?: boolean;
  lockRetryMs?: number;
  lockStaleMs?: number;
  lockWaitTimeoutMs?: number;
  /**
   * Pin this storage view to one workspace's credentials. getTokens then
   * ignores the active-workspace pointer, so an SDK built on a pinned view
   * authenticates (and refreshes) as that workspace without touching the
   * user's selected workspace.
   */
  pinnedWorkspaceId?: string;
}

const REFRESH_LOCK_RETRY_MS = 100;
const REFRESH_LOCK_STALE_MS = 30_000;
const REFRESH_LOCK_WAIT_TIMEOUT_MS = 25_000;

const EMPTY_AUTH_CONTEXT: AuthContextState = {
  activeWorkspaceId: null,
  workspaces: {},
};
const UNKNOWN_WORKSPACE_NAME = "Unknown workspace";

export function getAuthContextFilePath(authFilePath: string): string {
  const extension = path.extname(authFilePath);
  if (!extension) {
    return `${authFilePath}.context.json`;
  }

  return `${authFilePath.slice(0, -extension.length)}.context${extension}`;
}

function findLatestValidTokens(
  allCredentials: StoredCredential[],
): Tokens | null {
  for (let i = allCredentials.length - 1; i >= 0; i -= 1) {
    const credential = allCredentials[i];
    if (!credential) continue;

    if (
      typeof credential.workspaceId !== "string" ||
      credential.workspaceId.length === 0 ||
      typeof credential.token !== "string" ||
      credential.token.length === 0 ||
      typeof credential.refreshToken !== "string" ||
      credential.refreshToken.length === 0
    ) {
      continue;
    }

    return {
      workspaceId: credential.workspaceId,
      accessToken: credential.token,
      refreshToken: credential.refreshToken,
    };
  }
  return null;
}

function storedCredentialToTokens(
  credential: StoredCredential | undefined,
): Tokens | null {
  if (!credential) return null;

  if (
    typeof credential.workspaceId !== "string" ||
    credential.workspaceId.length === 0 ||
    typeof credential.token !== "string" ||
    credential.token.length === 0 ||
    typeof credential.refreshToken !== "string" ||
    credential.refreshToken.length === 0
  ) {
    return null;
  }

  return {
    workspaceId: credential.workspaceId,
    accessToken: credential.token,
    refreshToken: credential.refreshToken,
  };
}

function findTokensForWorkspace(
  allCredentials: StoredCredential[],
  workspaceId: string,
): Tokens | null {
  return (
    storedCredentialToTokens(
      allCredentials.find(
        (credential) => credential?.workspaceId === workspaceId,
      ),
    ) ?? null
  );
}

function tokensEqual(a: Tokens | null, b: Tokens | null): boolean {
  return (
    a?.workspaceId === b?.workspaceId &&
    a?.accessToken === b?.accessToken &&
    a?.refreshToken === b?.refreshToken
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason);
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class FileTokenStorage implements TokenStorage {
  private readonly credentialsStore: CredentialsStore;
  private readonly authFilePath: string;
  private readonly contextFilePath: string;
  private readonly lockFilePath: string;

  constructor(
    env: NodeJS.ProcessEnv = process.env,
    private readonly signal?: AbortSignal,
    private readonly options: FileTokenStorageOptions = {},
  ) {
    const authFilePath = getAuthFilePath(env);
    this.authFilePath = authFilePath;
    this.contextFilePath = getAuthContextFilePath(authFilePath);
    this.credentialsStore = new CredentialsStore(authFilePath);
    this.lockFilePath = `${authFilePath}.lock`;
  }

  async getTokens(): Promise<Tokens | null> {
    this.signal?.throwIfAborted();
    try {
      // CredentialsStore does not accept AbortSignal; check immediately before and after the boundary.
      const credentials = await this.readCredentialsFromDisk();

      if (this.options.pinnedWorkspaceId) {
        return findTokensForWorkspace(
          credentials,
          this.options.pinnedWorkspaceId,
        );
      }

      const context = await this.readAuthContext();

      if (context.state.activeWorkspaceId) {
        return findTokensForWorkspace(
          credentials,
          context.state.activeWorkspaceId,
        );
      }

      const latest = findLatestValidTokens(credentials);
      if (!latest) return null;

      if (!context.exists) {
        await this.setActiveWorkspaceId(latest.workspaceId);
        return latest;
      }

      // A context file with no active workspace is an explicit local signed-out
      // state, usually after logging out the active workspace. Do not fall back
      // to another cached workspace without an explicit `auth workspace use`.
      return null;
    } catch (_error) {
      if (this.signal?.aborted) throw this.signal.reason;
      return null;
    }
  }

  async setTokens(tokens: Tokens): Promise<void> {
    // The management-api-sdk calls setTokens from inside withRefreshLock during
    // refresh. That path must pass lockSetTokens:false, otherwise setTokens
    // would wait on the lock it already owns and eventually time out.
    if (this.options.lockSetTokens === false) {
      await this.setTokensUnlocked(tokens);
      return;
    }

    await this.withRefreshLock(() => this.setTokensUnlocked(tokens));
  }

  private async setTokensUnlocked(tokens: Tokens): Promise<void> {
    this.signal?.throwIfAborted();
    // CredentialsStore does not accept AbortSignal; check immediately before and after the boundary.
    await this.credentialsStore.storeCredentials({
      workspaceId: tokens.workspaceId,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
    this.signal?.throwIfAborted();
    await this.rememberWorkspaceUnlocked(tokens.workspaceId, {
      id: tokens.workspaceId,
      name: tokens.workspaceId,
    });
    await this.maybeActivateWorkspaceId(tokens.workspaceId);
  }

  async clearTokens(): Promise<void> {
    await this.withRefreshLock(() => this.clearTokensUnlocked());
  }

  private async clearTokensUnlocked(): Promise<void> {
    this.signal?.throwIfAborted();
    // Logout clears every OAuth grant in the local auth file. SDK refresh
    // failures use clearTokensIfCurrent below, which stays workspace-scoped.
    // CredentialsStore exposes workspace-scoped deletion only, so full logout
    // writes the store's empty on-disk shape directly.
    await fs.mkdir(path.dirname(this.authFilePath), { recursive: true });
    this.signal?.throwIfAborted();
    await fs.writeFile(
      this.authFilePath,
      `${JSON.stringify({ tokens: [] }, null, 2)}\n`,
      { encoding: "utf8", signal: this.signal },
    );
    await this.clearAuthContext();
    await this.credentialsStore.reloadCredentialsFromDisk();
    this.signal?.throwIfAborted();
  }

  async clearTokensIfCurrent(tokens: Tokens): Promise<void> {
    this.signal?.throwIfAborted();
    const current = await this.getTokens();
    if (!tokensEqual(current, tokens)) return;
    await this.credentialsStore.deleteCredentials(tokens.workspaceId);
    // Preserve the active pointer so a refresh failure for the selected
    // workspace does not silently move commands to another cached workspace.
    await this.removeRememberedWorkspace(tokens.workspaceId, {
      preserveActivePointer: true,
    });
    this.signal?.throwIfAborted();
  }

  async listWorkspaces(): Promise<StoredAuthWorkspace[]> {
    this.signal?.throwIfAborted();
    const credentials = await this.readCredentialsFromDisk();
    const context = await this.ensureMigratedAuthContext(credentials);

    return this.workspacesFromState(credentials, context);
  }

  private workspacesFromState(
    credentials: StoredCredential[],
    context: AuthContextReadResult,
  ): StoredAuthWorkspace[] {
    return credentials
      .map((credential) => storedCredentialToTokens(credential))
      .filter((tokens): tokens is Tokens => tokens !== null)
      .map((tokens) => {
        const cached = context.state.workspaces[tokens.workspaceId];
        const id =
          typeof cached?.id === "string" && cached.id.trim().length > 0
            ? cached.id.trim()
            : tokens.workspaceId;
        const name =
          typeof cached?.name === "string" && cached.name.trim().length > 0
            ? workspaceDisplayName(cached.name.trim(), tokens.workspaceId)
            : UNKNOWN_WORKSPACE_NAME;
        const lastSeenAt =
          typeof cached?.lastSeenAt === "string" &&
          cached.lastSeenAt.trim().length > 0
            ? cached.lastSeenAt.trim()
            : null;

        return {
          id,
          name,
          credentialWorkspaceId: tokens.workspaceId,
          active: context.state.activeWorkspaceId === tokens.workspaceId,
          lastSeenAt,
        };
      });
  }

  async listWorkspaceTokens(): Promise<Tokens[]> {
    this.signal?.throwIfAborted();
    const credentials = await this.readCredentialsFromDisk();
    return credentials
      .map((credential) => storedCredentialToTokens(credential))
      .filter((tokens): tokens is Tokens => tokens !== null);
  }

  async useWorkspace(workspaceRef: string): Promise<{
    previous: StoredAuthWorkspace | null;
    selected: StoredAuthWorkspace;
  }> {
    return this.withRefreshLock(() => this.useWorkspaceUnlocked(workspaceRef));
  }

  /**
   * Resolve a workspace ref (id, credential workspace id, or cached name)
   * against the locally stored sessions without changing the active
   * workspace. Read-only counterpart of useWorkspace: it reads the auth
   * context as-is and never runs the legacy-state migration, so it writes
   * nothing.
   */
  async resolveWorkspace(workspaceRef: string): Promise<StoredAuthWorkspace> {
    const ref = workspaceRef.trim();
    if (!ref) {
      throw new WorkspaceSelectionError("missing");
    }

    this.signal?.throwIfAborted();
    const credentials = await this.readCredentialsFromDisk();
    const context = await this.readAuthContext();
    const workspaces = this.workspacesFromState(credentials, context);
    const matches = workspaces.filter((workspace) =>
      workspaceMatchesRef(workspace, ref),
    );

    if (matches.length === 0) {
      throw new WorkspaceSelectionError("not-found", ref);
    }

    if (matches.length > 1) {
      throw new WorkspaceSelectionError("ambiguous", ref, matches);
    }

    return matches[0];
  }

  private async useWorkspaceUnlocked(workspaceRef: string): Promise<{
    previous: StoredAuthWorkspace | null;
    selected: StoredAuthWorkspace;
  }> {
    const ref = workspaceRef.trim();
    if (!ref) {
      throw new WorkspaceSelectionError("missing");
    }

    const workspaces = await this.listWorkspaces();
    const context = await this.readAuthContext();
    const previous =
      workspaces.find(
        (workspace) =>
          workspace.credentialWorkspaceId === context.state.activeWorkspaceId,
      ) ?? null;
    const matches = workspaces.filter((workspace) =>
      workspaceMatchesRef(workspace, ref),
    );

    if (matches.length === 0) {
      throw new WorkspaceSelectionError("not-found", ref);
    }

    if (matches.length > 1) {
      throw new WorkspaceSelectionError("ambiguous", ref, matches);
    }

    const selected = matches[0];
    await this.setActiveWorkspaceId(selected.credentialWorkspaceId);
    return { previous, selected };
  }

  async logoutWorkspace(
    workspaceRef: string,
  ): Promise<StoredAuthWorkspaceLogout> {
    return this.withRefreshLock(() =>
      this.logoutWorkspaceUnlocked(workspaceRef),
    );
  }

  private async logoutWorkspaceUnlocked(
    workspaceRef: string,
  ): Promise<StoredAuthWorkspaceLogout> {
    const ref = workspaceRef.trim();
    if (!ref) {
      throw new WorkspaceSelectionError("missing");
    }

    const workspaces = await this.listWorkspaces();
    const context = await this.readAuthContext();
    const matches = workspaces.filter((workspace) =>
      workspaceMatchesRef(workspace, ref),
    );

    if (matches.length === 0) {
      throw new WorkspaceSelectionError("not-found", ref);
    }

    if (matches.length > 1) {
      throw new WorkspaceSelectionError("ambiguous", ref, matches);
    }

    const workspace = matches[0];
    const wasActive =
      context.state.activeWorkspaceId === workspace.credentialWorkspaceId;

    await this.credentialsStore.deleteCredentials(
      workspace.credentialWorkspaceId,
    );
    this.signal?.throwIfAborted();

    const remainingWorkspaces = workspaces.filter(
      (candidate) =>
        candidate.credentialWorkspaceId !== workspace.credentialWorkspaceId,
    );

    if (remainingWorkspaces.length === 0) {
      await this.clearAuthContext();
      return { workspace, wasActive, activeWorkspace: null };
    }

    delete context.state.workspaces[workspace.credentialWorkspaceId];
    if (wasActive) {
      context.state.activeWorkspaceId = null;
    }
    await this.writeAuthContext(context.state);

    const activeWorkspace =
      context.state.activeWorkspaceId === null
        ? null
        : (remainingWorkspaces.find(
            (candidate) =>
              candidate.credentialWorkspaceId ===
              context.state.activeWorkspaceId,
          ) ?? null);

    return { workspace, wasActive, activeWorkspace };
  }

  async rememberWorkspace(
    credentialWorkspaceId: string,
    workspace: { id: string; name: string },
  ): Promise<void> {
    await this.withRefreshLock(() =>
      this.rememberWorkspaceUnlocked(credentialWorkspaceId, workspace),
    );
  }

  private async rememberWorkspaceUnlocked(
    credentialWorkspaceId: string,
    workspace: { id: string; name: string },
  ): Promise<void> {
    const context = await this.readAuthContext();
    context.state.workspaces[credentialWorkspaceId] = {
      id: workspace.id,
      name: workspace.name,
      lastSeenAt: new Date().toISOString(),
    };
    await this.writeAuthContext(context.state);
  }

  async withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockId = await this.acquireRefreshLock();
    try {
      return await fn();
    } finally {
      await this.releaseRefreshLock(lockId);
    }
  }

  private async acquireRefreshLock(): Promise<string> {
    const lockId = randomUUID();
    const startedAt = Date.now();
    const retryMs = this.options.lockRetryMs ?? REFRESH_LOCK_RETRY_MS;
    const waitTimeoutMs =
      this.options.lockWaitTimeoutMs ?? REFRESH_LOCK_WAIT_TIMEOUT_MS;
    this.signal?.throwIfAborted();
    // mkdir does not accept AbortSignal; check before the filesystem boundary.
    await fs.mkdir(path.dirname(this.lockFilePath), { recursive: true });

    while (true) {
      this.signal?.throwIfAborted();
      if (await this.tryCreateRefreshLock(lockId)) {
        return lockId;
      }

      if (await this.releaseStaleRefreshLock()) continue;

      this.throwIfRefreshLockWaitTimedOut(startedAt, waitTimeoutMs);
      await sleep(retryMs, this.signal);
    }
  }

  private async tryCreateRefreshLock(lockId: string): Promise<boolean> {
    let lockFileCreated = false;
    try {
      // open does not accept AbortSignal; check before the filesystem boundary.
      const handle = await fs.open(this.lockFilePath, "wx");
      lockFileCreated = true;
      try {
        this.signal?.throwIfAborted();
        await handle.writeFile(lockId, { encoding: "utf8" });
        this.signal?.throwIfAborted();
      } finally {
        await handle.close();
      }
      return true;
    } catch (error) {
      if (lockFileCreated) {
        await fs.unlink(this.lockFilePath).catch(() => undefined);
      }
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return false;
      throw error;
    }
  }

  private async releaseStaleRefreshLock(): Promise<boolean> {
    const staleLockId = await this.getStaleRefreshLockId();
    if (!staleLockId) return false;

    await this.releaseRefreshLock(staleLockId);
    return true;
  }

  private throwIfRefreshLockWaitTimedOut(
    startedAt: number,
    waitTimeoutMs: number,
  ): void {
    if (Date.now() - startedAt < waitTimeoutMs) return;
    throw new RefreshLockTimeoutError(this.lockFilePath, waitTimeoutMs);
  }

  private async getStaleRefreshLockId(): Promise<string | null> {
    this.signal?.throwIfAborted();
    const lockId = await fs
      .readFile(this.lockFilePath, { encoding: "utf8", signal: this.signal })
      .catch((error) => {
        if (this.signal?.aborted) throw error;
        return null;
      });
    if (lockId === null) return null;

    this.signal?.throwIfAborted();
    // stat does not accept AbortSignal; check before and after the filesystem boundary.
    const stats = await fs.stat(this.lockFilePath).catch(() => null);
    this.signal?.throwIfAborted();
    if (!stats) return null;
    const staleMs = this.options.lockStaleMs ?? REFRESH_LOCK_STALE_MS;
    return Date.now() - stats.mtimeMs > staleMs ? lockId : null;
  }

  private async releaseRefreshLock(lockId: string): Promise<void> {
    const currentLockId = await fs
      .readFile(this.lockFilePath, { encoding: "utf8" })
      .catch(() => null);
    if (currentLockId !== lockId) return;
    // unlink does not accept AbortSignal; refresh-lock cleanup must run even after cancellation.
    await fs.unlink(this.lockFilePath).catch(() => {});
  }

  private async readCredentialsFromDisk(): Promise<StoredCredential[]> {
    this.signal?.throwIfAborted();
    await this.credentialsStore.reloadCredentialsFromDisk();
    this.signal?.throwIfAborted();
    return (await this.credentialsStore.getCredentials()) as StoredCredential[];
  }

  private async ensureMigratedAuthContext(
    credentials: StoredCredential[],
  ): Promise<AuthContextReadResult> {
    const context = await this.readAuthContext();
    if (context.state.activeWorkspaceId || context.exists) {
      return context;
    }

    const latest = findLatestValidTokens(credentials);
    if (!latest) {
      return context;
    }

    context.state.activeWorkspaceId = latest.workspaceId;
    context.state.workspaces[latest.workspaceId] ??= {
      id: latest.workspaceId,
      name: latest.workspaceId,
      lastSeenAt: new Date().toISOString(),
    };
    await this.writeAuthContext(context.state);
    return { exists: true, state: context.state };
  }

  private async setActiveWorkspaceId(workspaceId: string): Promise<void> {
    const context = await this.readAuthContext();
    context.state.activeWorkspaceId = workspaceId;
    context.state.workspaces[workspaceId] ??= {
      id: workspaceId,
      name: workspaceId,
      lastSeenAt: new Date().toISOString(),
    };
    await this.writeAuthContext(context.state);
  }

  private async maybeActivateWorkspaceId(workspaceId: string): Promise<void> {
    // A pinned view is a per-workspace read/refresh surface; its token writes
    // must never move the user's workspace selection, even when no active
    // workspace is set.
    if (this.options.pinnedWorkspaceId) {
      return;
    }

    const context = await this.readAuthContext();
    if (
      this.options.activateOnSetTokens === false &&
      context.exists &&
      context.state.activeWorkspaceId &&
      context.state.activeWorkspaceId !== workspaceId
    ) {
      return;
    }

    context.state.activeWorkspaceId = workspaceId;
    context.state.workspaces[workspaceId] ??= {
      id: workspaceId,
      name: workspaceId,
      lastSeenAt: new Date().toISOString(),
    };
    await this.writeAuthContext(context.state);
  }

  private async removeRememberedWorkspace(
    workspaceId: string,
    options: { preserveActivePointer: boolean },
  ): Promise<void> {
    const context = await this.readAuthContext();
    delete context.state.workspaces[workspaceId];
    if (
      !options.preserveActivePointer &&
      context.state.activeWorkspaceId === workspaceId
    ) {
      context.state.activeWorkspaceId = null;
    }
    await this.writeAuthContext(context.state);
  }

  private async readAuthContext(): Promise<AuthContextReadResult> {
    this.signal?.throwIfAborted();
    const raw = await fs
      .readFile(this.contextFilePath, {
        encoding: "utf8",
        signal: this.signal,
      })
      .catch((error) => {
        if (this.signal?.aborted) throw error;
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      });

    if (raw === null) {
      return { exists: false, state: structuredClone(EMPTY_AUTH_CONTEXT) };
    }

    try {
      const parsed = JSON.parse(raw) as Partial<AuthContextState>;
      return {
        exists: true,
        state: {
          activeWorkspaceId:
            typeof parsed.activeWorkspaceId === "string" &&
            parsed.activeWorkspaceId.trim().length > 0
              ? parsed.activeWorkspaceId.trim()
              : null,
          workspaces:
            parsed.workspaces &&
            typeof parsed.workspaces === "object" &&
            !Array.isArray(parsed.workspaces)
              ? parsed.workspaces
              : {},
        },
      };
    } catch {
      return { exists: false, state: structuredClone(EMPTY_AUTH_CONTEXT) };
    }
  }

  private async writeAuthContext(state: AuthContextState): Promise<void> {
    this.signal?.throwIfAborted();
    await fs.mkdir(path.dirname(this.contextFilePath), { recursive: true });
    this.signal?.throwIfAborted();
    await fs.writeFile(
      this.contextFilePath,
      `${JSON.stringify(state, null, 2)}\n`,
      { encoding: "utf8", signal: this.signal },
    );
    this.signal?.throwIfAborted();
  }

  private async clearAuthContext(): Promise<void> {
    await fs.unlink(this.contextFilePath).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    });
  }
}

export class WorkspaceSelectionError extends Error {
  constructor(
    readonly reason: "missing" | "not-found" | "ambiguous",
    readonly workspaceRef?: string,
    readonly matches: StoredAuthWorkspace[] = [],
  ) {
    super(reason);
    this.name = "WorkspaceSelectionError";
  }
}

export class RefreshLockTimeoutError extends Error {
  constructor(lockFilePath: string, waitTimeoutMs: number) {
    super(
      `Timed out waiting ${waitTimeoutMs}ms for auth refresh lock at ${lockFilePath}`,
    );
    this.name = "RefreshLockTimeoutError";
  }
}

function workspaceMatchesRef(
  workspace: StoredAuthWorkspace,
  ref: string,
): boolean {
  return (
    sameWorkspaceId(workspace.credentialWorkspaceId, ref) ||
    sameWorkspaceId(workspace.id, ref) ||
    workspace.name.toLowerCase() === ref.toLowerCase()
  );
}

function workspaceDisplayName(name: string, credentialWorkspaceId: string) {
  return name === credentialWorkspaceId ? UNKNOWN_WORKSPACE_NAME : name;
}
