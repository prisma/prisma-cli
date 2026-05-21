import { FileTokenStorage } from "../../adapters/token-storage";
import type { AuthStateResult } from "../../types/auth";
import { SERVICE_TOKEN_ENV_VAR } from "./client";
import { requireComputeAuth } from "./guard";
import { login } from "./login";

const WORKSPACE_SUB_PREFIX = "workspace:";

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function emailFromClaims(claims: Record<string, unknown>): string | null {
  const email = claims.email;
  return typeof email === "string" && email.trim().length > 0 ? email.trim() : null;
}

function workspaceIdFromClaims(claims: Record<string, unknown>): string | null {
  const sub = claims.sub;
  if (typeof sub !== "string") return null;
  if (!sub.startsWith(WORKSPACE_SUB_PREFIX)) return null;
  const id = sub.slice(WORKSPACE_SUB_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

export async function performLogin(env: NodeJS.ProcessEnv): Promise<void> {
  await login({ tokenStorage: new FileTokenStorage(env), env });
}

export async function readAuthState(env: NodeJS.ProcessEnv): Promise<AuthStateResult> {
  // PRISMA_API_TOKEN is the headless / CI auth surface. When it is set, derive
  // auth state from the token itself and intentionally skip FileTokenStorage,
  // so behavior is independent of any OAuth session that happens to be stored
  // on the runner. This matches the precedence already documented on
  // `requireComputeAuth` and keeps `auth whoami` and downstream commands
  // (e.g. `app deploy`) reading the same source of truth.
  const serviceToken = env[SERVICE_TOKEN_ENV_VAR]?.trim();
  if (serviceToken) {
    return readServiceTokenAuthState(serviceToken, env);
  }

  const tokenStorage = new FileTokenStorage(env);
  const tokens = await tokenStorage.getTokens();

  if (!tokens) {
    return {
      authenticated: false,
      provider: null,
      user: null,
      workspace: null,
    };
  }

  const claims = decodeJwtPayload(tokens.accessToken);
  return buildAuthState({ workspaceIdFromCredential: tokens.workspaceId, claims, env });
}

async function readServiceTokenAuthState(
  token: string,
  env: NodeJS.ProcessEnv,
): Promise<AuthStateResult> {
  const claims = decodeJwtPayload(token);
  const workspaceId = workspaceIdFromClaims(claims);

  if (!workspaceId) {
    // Token has no workspace subject we can resolve. Surface signed-out state
    // so commands that require auth produce the standard AUTH_REQUIRED error
    // with a clear path forward, rather than crashing or silently deploying
    // to an unintended target.
    return {
      authenticated: false,
      provider: null,
      user: null,
      workspace: null,
    };
  }

  return buildAuthState({ workspaceIdFromCredential: workspaceId, claims, env });
}

async function buildAuthState({
  workspaceIdFromCredential,
  claims,
  env,
}: {
  workspaceIdFromCredential: string;
  claims: Record<string, unknown>;
  env: NodeJS.ProcessEnv;
}): Promise<AuthStateResult> {
  let workspaceId = workspaceIdFromCredential;
  let workspaceName = workspaceIdFromCredential;

  const client = await requireComputeAuth(env);

  if (client) {
    try {
      const { data, response } = await client.GET("/v1/workspaces/{id}", {
        params: { path: { id: workspaceIdFromCredential } },
      });
      // A 401 from the workspace lookup means the credential the caller
      // presented is fundamentally invalid (revoked, wrong signing key,
      // expired) — surface signed-out state instead of returning a
      // workspace shape that makes a broken token look fine. Other
      // statuses (404/5xx/network) keep the silent fallback so transient
      // lookup failures do not turn `auth whoami` into a hard error.
      if (response?.status === 401) {
        return {
          authenticated: false,
          provider: null,
          user: null,
          workspace: null,
        };
      }
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

  const email = emailFromClaims(claims);
  return {
    authenticated: true,
    provider: null,
    user: email ? { email } : null,
    workspace: {
      id: workspaceId,
      name: workspaceName,
    },
  };
}

export async function performLogout(env: NodeJS.ProcessEnv): Promise<void> {
  await new FileTokenStorage(env).clearTokens();
}
