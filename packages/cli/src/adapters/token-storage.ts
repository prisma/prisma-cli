import { CredentialsStore } from "@prisma/credentials-store";
import type { TokenStorage, Tokens } from "@prisma/management-api-sdk";
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

export class FileTokenStorage implements TokenStorage {
  private readonly credentialsStore: CredentialsStore;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.credentialsStore = new CredentialsStore(getAuthFilePath(env));
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
}
