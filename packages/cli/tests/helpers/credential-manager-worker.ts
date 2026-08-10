/**
 * A second real process for the credential manager's cross-process
 * tests: it runs one manager operation (or holds the lock) against a
 * state file and prints the result as JSON.
 */

import fs from "node:fs/promises";
import type { TokenStorage } from "@prisma/cli-engine";
import { FileCredentialManager } from "../../src/auth/credential-manager";

const [stateFilePath, command, ...args] = process.argv.slice(2);

function makeManager(env: Record<string, string | undefined> = {}) {
  return new FileCredentialManager({
    env: { PRISMA_AUTH_FILE: stateFilePath, ...env },
  });
}

/** The engine's order: resolve the active credential, then ask for the
 *  storage behind it. The caller names the workspace it expects the
 *  selection to have pinned. */
async function storageForSelected(
  manager: FileCredentialManager,
  workspaceId: string,
): Promise<TokenStorage> {
  const active = await manager.activeCredential();
  if (active?.workspaceId !== workspaceId) {
    throw new Error(`the selected session is not ${workspaceId}`);
  }
  return manager.activeCredentialStorage();
}

async function run(): Promise<unknown> {
  switch (command) {
    case "create": {
      const [workspaceId, token, refreshToken] = args;
      return makeManager().createSession(
        { token, refreshToken, expiresAt: undefined },
        workspaceId,
      );
    }
    case "use": {
      const [workspaceId] = args;
      return makeManager().selectSession(workspaceId);
    }
    case "end": {
      const [workspaceId] = args;
      await makeManager().endSession(workspaceId);
      return null;
    }
    case "rotate": {
      const [workspaceId, accessToken, refreshToken] = args;
      const storage = await storageForSelected(makeManager(), workspaceId);
      await storage.setTokens({ workspaceId, accessToken, refreshToken });
      return null;
    }
    /** A REAL refresh: the SDK's refreshing client over the manager's
     *  TokenStorage view, against the scripted token endpoint. The
     *  first request answers 401, which drives the exchange. */
    case "refresh": {
      const [workspaceId, apiBaseUrl, authBaseUrl] = args;
      const { createManagementApiSdk } = await import(
        "@prisma/management-api-sdk"
      );
      const sdk = createManagementApiSdk({
        clientId: "test-client-id",
        redirectUri: `${apiBaseUrl}/auth/callback`,
        apiBaseUrl,
        authBaseUrl,
        tokenStorage: await storageForSelected(makeManager(), workspaceId),
      });
      const { response } = await sdk.client.GET("/v1/workspaces", {});
      return { status: response.status };
    }
    case "current":
      return makeManager().activeCredential();
    case "sessions":
      return makeManager().sessions();
    case "crash-holding-the-lock": {
      await fs.writeFile(`${stateFilePath}.lock`, "crashed-holder", "utf8");
      return null;
    }
    default:
      throw new Error(`unknown command ${command}`);
  }
}

run().then(
  (result) => {
    process.stdout.write(JSON.stringify(result ?? null));
  },
  (error: unknown) => {
    process.stderr.write(
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  },
);
