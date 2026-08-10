/**
 * A second real process for the credential manager's cross-process
 * tests: it runs one manager operation (or holds the lock) against a
 * state file and prints the result as JSON.
 */
import fs from "node:fs/promises";
import { FileCredentialManager } from "../../src/auth/credential-manager";

const [stateFilePath, command, ...args] = process.argv.slice(2);

function makeManager(env: Record<string, string | undefined> = {}) {
  return new FileCredentialManager({
    env: { PRISMA_AUTH_FILE: stateFilePath, ...env },
  });
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
      const manager = makeManager();
      const session = (await manager.sessions()).find(
        (candidate) => candidate.workspaceId === workspaceId,
      );
      if (session === undefined) throw new Error(`no session ${workspaceId}`);
      return manager.useSession(session);
    }
    case "end": {
      const [workspaceId] = args;
      const manager = makeManager();
      const session = (await manager.sessions()).find(
        (candidate) => candidate.workspaceId === workspaceId,
      );
      if (session === undefined) throw new Error(`no session ${workspaceId}`);
      await manager.endSession(session);
      return null;
    }
    case "rotate": {
      const [workspaceId, accessToken, refreshToken] = args;
      await makeManager()
        .tokenStorage(workspaceId)
        .setTokens({ workspaceId, accessToken, refreshToken });
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
        tokenStorage: makeManager().tokenStorage(workspaceId),
      });
      const { response } = await sdk.client.GET("/v1/workspaces", {});
      return { status: response.status };
    }
    case "current":
      return makeManager().currentSession();
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
