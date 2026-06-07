import { CredentialsStore } from "@prisma/credentials-store";
import type { TokenStorage, Tokens } from "@prisma/management-api-sdk";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getAuthFilePath } from "../lib/auth/client";

interface StoredCredential {
  workspaceId?: unknown;
  token?: unknown;
  refreshToken?: unknown;
}

function findLatestValidTokens(allCredentials: StoredCredential[]): Tokens | null {
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
  private readonly lockFilePath: string;
  private currentRefreshLockId: string | null = null;

  constructor(env: NodeJS.ProcessEnv = process.env, private readonly signal?: AbortSignal) {
    const authFilePath = getAuthFilePath(env);
    this.credentialsStore = new CredentialsStore(authFilePath);
    this.lockFilePath = `${authFilePath}.lock`;
    process.on("exit", () => {
      if (this.currentRefreshLockId) {
        try {
          fs.unlinkSync(this.lockFilePath);
        } catch {
          // Best-effort cleanup
        }
      }
    });
  }

  async getTokens(): Promise<Tokens | null> {
    this.signal?.throwIfAborted();
    try {
      // CredentialsStore does not accept AbortSignal; check immediately before and after the boundary.
      const all = await this.credentialsStore.getCredentials();
      this.signal?.throwIfAborted();
      return findLatestValidTokens(all as StoredCredential[]);
    } catch (error) {
      if (this.signal?.aborted) throw this.signal.reason;
      return null;
    }
  }

  async setTokens(tokens: Tokens): Promise<void> {
    this.signal?.throwIfAborted();
    // CredentialsStore does not accept AbortSignal; check immediately before and after the boundary.
    await this.credentialsStore.storeCredentials({
      workspaceId: tokens.workspaceId,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
    this.signal?.throwIfAborted();
  }

  async clearTokens(): Promise<void> {
    this.signal?.throwIfAborted();
    const all = await this.credentialsStore.getCredentials();
    this.signal?.throwIfAborted();
    const tokens = findLatestValidTokens(all as StoredCredential[]);
    if (!tokens) return;
    // CredentialsStore does not accept AbortSignal; check immediately before and after the boundary.
    await this.credentialsStore.deleteCredentials(tokens.workspaceId);
    this.signal?.throwIfAborted();
  }

  async clearTokensIfCurrent(tokens: Tokens): Promise<void> {
    this.signal?.throwIfAborted();
    const current = await this.getTokens();
    if (!tokensEqual(current, tokens)) return;
    await this.clearTokens();
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
    this.signal?.throwIfAborted();
    // mkdir does not accept AbortSignal; check before the filesystem boundary.
    await fsp.mkdir(path.dirname(this.lockFilePath), { recursive: true });

    while (true) {
      this.signal?.throwIfAborted();
      let lockFileCreated = false;
      try {
        // open does not accept AbortSignal; check before the filesystem boundary.
        const handle = await fsp.open(this.lockFilePath, "wx");
        lockFileCreated = true;
        try {
          this.signal?.throwIfAborted();
          await handle.writeFile(lockId, { encoding: "utf8" });
          this.signal?.throwIfAborted();
        } finally {
          await handle.close();
        }
        this.currentRefreshLockId = lockId;
        return lockId;
      } catch (error) {
        if (lockFileCreated) {
          await fsp.unlink(this.lockFilePath).catch(() => undefined);
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw error;

        const staleLockId = await this.getStaleRefreshLockId();
        if (staleLockId) {
          await this.releaseRefreshLock(staleLockId);
          continue;
        }

        await sleep(100, this.signal);
      }
    }
  }

  private async getStaleRefreshLockId(): Promise<string | null> {
    this.signal?.throwIfAborted();
    const lockId = await fsp.readFile(this.lockFilePath, { encoding: "utf8", signal: this.signal }).catch((error) => {
      if (this.signal?.aborted) throw error;
      return null;
    });
    if (lockId === null) return null;

    this.signal?.throwIfAborted();
    // stat does not accept AbortSignal; check before and after the filesystem boundary.
    const stats = await fsp.stat(this.lockFilePath).catch(() => null);
    this.signal?.throwIfAborted();
    if (!stats) return null;
    return Date.now() - stats.mtimeMs > 30_000 ? lockId : null;
  }

  private async releaseRefreshLock(lockId: string): Promise<void> {
    const currentLockId = await fsp.readFile(this.lockFilePath, { encoding: "utf8" }).catch(() => null);
    if (currentLockId !== lockId) return;
    // unlink does not accept AbortSignal; refresh-lock cleanup must run even after cancellation.
    await fsp.unlink(this.lockFilePath).catch(() => {});
    this.currentRefreshLockId = null;
  }
}
