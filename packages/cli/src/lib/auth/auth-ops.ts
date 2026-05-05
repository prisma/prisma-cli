import { FileTokenStorage } from "../../adapters/token-storage";
import type { AuthStateResult } from "../../types/auth";
import { requireComputeAuth } from "./guard";
import { login } from "./login";

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function performLogin(env: NodeJS.ProcessEnv): Promise<void> {
  await login({ tokenStorage: new FileTokenStorage(env), env });
}

export async function readAuthState(env: NodeJS.ProcessEnv): Promise<AuthStateResult> {
  const tokenStorage = new FileTokenStorage(env);
  const tokens = await tokenStorage.getTokens();

  if (!tokens) {
    return {
      authenticated: false,
      provider: null,
      user: null,
      workspace: null,
      linkedProjectId: null,
    };
  }

  const claims = decodeJwtPayload(tokens.accessToken);

  const client = await requireComputeAuth(env);
  let workspaceId = tokens.workspaceId;
  let workspaceName = tokens.workspaceId;

  if (client) {
    try {
      const { data } = await client.GET("/v1/workspaces/{id}", {
        params: { path: { id: tokens.workspaceId } },
      });
      if (data?.data?.id) {
        workspaceId = data.data.id;
      }
      if (data?.data?.name) {
        workspaceName = data.data.name;
      }
    } catch {
      // fall through — use workspaceId as name
    }
  }

  return {
    authenticated: true,
    provider: null,
    user: {
      id: (claims.sub as string) ?? "",
      name: (claims.name as string) ?? "",
      email: (claims.email as string) ?? "",
    },
    workspace: {
      id: workspaceId,
      name: workspaceName,
    },
    linkedProjectId: null,
  };
}

export async function performLogout(env: NodeJS.ProcessEnv): Promise<void> {
  await new FileTokenStorage(env).clearTokens();
}
