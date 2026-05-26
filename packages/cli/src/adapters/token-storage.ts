import { CredentialsStore } from "@prisma/credentials-store";
import type { TokenStorage, Tokens } from "@prisma/management-api-sdk";
import fs from "node:fs/promises";
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FileTokenStorage implements TokenStorage {
  private readonly credentialsStore: CredentialsStore;
  private readonly lockFilePath: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const authFilePath = getAuthFilePath(env);
    this.credentialsStore = new CredentialsStore(authFilePath);
    this.lockFilePath = `${authFilePath}.lock`;
  }

  async getTokens(): Promise<Tokens | null> {
    try {
      const all = await this.credentialsStore.getCredentials();
      return findLatestValidTokens(all as StoredCredential[]);
    } catch {
      return null;
    }
  }

  async setTokens(tokens: Tokens): Promise<void> {
    await this.credentialsStore.storeCredentials({
      workspaceId: tokens.workspaceId,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  }

  async clearTokens(): Promise<void> {
    const all = await this.credentialsStore.getCredentials();
    const tokens = findLatestValidTokens(all as StoredCredential[]);
    if (!tokens) return;
    await this.credentialsStore.deleteCredentials(tokens.workspaceId);
  }

  async clearTokensIfCurrent(tokens: Tokens): Promise<void> {
    const current = await this.getTokens();
    if (!tokensEqual(current, tokens)) return;
    await this.clearTokens();
  }

  async withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireRefreshLock();
    try {
      return await fn();
    } finally {
      await fs.unlink(this.lockFilePath).catch(() => {});
    }
  }

  private async acquireRefreshLock(): Promise<void> {
    await fs.mkdir(path.dirname(this.lockFilePath), { recursive: true });

    while (true) {
      try {
        const handle = await fs.open(this.lockFilePath, "wx");
        await handle.close();
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw error;

        if (await this.isRefreshLockStale()) {
          await fs.unlink(this.lockFilePath).catch(() => {});
          continue;
        }

        await sleep(100);
      }
    }
  }

  private async isRefreshLockStale(): Promise<boolean> {
    const stats = await fs.stat(this.lockFilePath).catch(() => null);
    if (!stats) return false;
    return Date.now() - stats.mtimeMs > 30_000;
  }
}
