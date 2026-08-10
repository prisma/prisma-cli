import type { Credential } from "@prisma/cli-engine";
import { claimedExpiresAt, claimedWorkspaceId } from "@prisma/cli-engine";
import type {
  ManagementApiClient,
  TokenStorage,
  Tokens,
} from "@prisma/management-api-sdk";
import type { AuthStateResult } from "../types/auth";
import { SERVICE_TOKEN_ENV_VAR } from "./client";
import { authenticatedManagementApiClient } from "./guard";
import { AuthError, login } from "./login";
import { FileTokenStorage } from "./token-storage";

const WORKSPACE_SUB_PREFIX = "workspace:";

/** Thrown when PRISMA_SERVICE_TOKEN is set to an empty/blank value. */
export class EmptyServiceTokenError extends Error {
  readonly code = "EMPTY_SERVICE_TOKEN";

  constructor() {
    super(
      `${SERVICE_TOKEN_ENV_VAR} is set but empty. Provide a valid token or unset the variable.`,
    );
    this.name = "EmptyServiceTokenError";
  }
}

/** Matches by the code discriminator, not instanceof, so the check
 *  survives duplicate module instances. */
export function isEmptyServiceTokenError(
  error: unknown,
): error is EmptyServiceTokenError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "EMPTY_SERVICE_TOKEN"
  );
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    return JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function emailFromClaims(claims: Record<string, unknown>): string | null {
  const email = claims.email;
  return typeof email === "string" && email.trim().length > 0
    ? email.trim()
    : null;
}

function workspaceIdFromClaims(claims: Record<string, unknown>): string | null {
  const sub = claims.sub;
  if (typeof sub !== "string") return null;
  if (!sub.startsWith(WORKSPACE_SUB_PREFIX)) return null;
  const id = sub.slice(WORKSPACE_SUB_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

/** Holds the tokens the SDK writes at callback time and nothing else:
 *  minting and custody stay separate, so a login never writes through
 *  the credential manager. */
class ThrowawayTokenStorage implements TokenStorage {
  tokens: Tokens | null = null;

  async getTokens(): Promise<Tokens | null> {
    return this.tokens;
  }

  async setTokens(tokens: Tokens): Promise<void> {
    this.tokens = tokens;
  }

  async clearTokens(): Promise<void> {
    this.tokens = null;
  }
}

/** Runs the browser consent flow and RETURNS the minted credential.
 *  Storing it is the caller's job. */
export async function performLogin(
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  options?: { onVerificationUrl?: (url: string) => void },
): Promise<Credential> {
  const tokenStorage = new ThrowawayTokenStorage();
  await login({
    tokenStorage,
    env,
    signal,
    onVerificationUrl: options?.onVerificationUrl,
  });

  const tokens = tokenStorage.tokens;
  if (!tokens) {
    throw new AuthError("Sign-in finished without producing a credential.");
  }
  return {
    token: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: claimedExpiresAt(tokens.accessToken),
  };
}

/** Writes a minted credential into the legacy store, which the legacy
 *  shell still reads. Dies with the legacy shell. */
export async function storeLegacyCredential(
  env: NodeJS.ProcessEnv,
  credential: Credential,
  signal?: AbortSignal,
): Promise<void> {
  const workspaceId = claimedWorkspaceId(credential.token);
  if (workspaceId === undefined) return;

  await new FileTokenStorage(env, signal, {
    activateOnSetTokens: true,
  }).setTokens({
    workspaceId,
    accessToken: credential.token,
    ...(credential.refreshToken === undefined
      ? {}
      : { refreshToken: credential.refreshToken }),
  });
}

export async function readAuthState(
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<AuthStateResult> {
  // PRISMA_SERVICE_TOKEN is the headless / CI auth surface. When it is set, derive
  // auth state from the token itself and intentionally skip FileTokenStorage,
  // so behavior is independent of any OAuth session that happens to be stored
  // on the runner. This matches the precedence already documented on
  // `authenticatedManagementApiClient` and keeps `auth whoami` and downstream commands
  // (e.g. `app deploy`) reading the same source of truth.
  const rawServiceToken = env[SERVICE_TOKEN_ENV_VAR];
  if (rawServiceToken !== undefined) {
    const serviceToken = rawServiceToken.trim();
    if (serviceToken.length === 0) {
      throw new EmptyServiceTokenError();
    }
    return readServiceTokenAuthState(serviceToken, env, signal);
  }

  const tokenStorage = new FileTokenStorage(env, signal);
  const tokens = await tokenStorage.getTokens();

  if (!tokens) {
    return {
      authenticated: false,
      provider: null,
      user: null,
      workspace: null,
      credential: null,
    };
  }

  const client = await authenticatedManagementApiClient(env, signal);
  const currentPrincipal = await readCurrentPrincipalAuthState(client, signal);
  if (currentPrincipal) {
    if (currentPrincipal.authenticated && currentPrincipal.workspace) {
      await tokenStorage.rememberWorkspace?.(
        tokens.workspaceId,
        currentPrincipal.workspace,
      );
    }
    return currentPrincipal;
  }

  const claims = decodeJwtPayload(tokens.accessToken);
  const authState = await buildAuthState({
    workspaceIdFromCredential: tokens.workspaceId,
    claims,
    env,
    client,
    signal,
  });
  if (authState.authenticated && authState.workspace) {
    await tokenStorage.rememberWorkspace?.(
      tokens.workspaceId,
      authState.workspace,
    );
  }
  return authState;
}

async function readServiceTokenAuthState(
  token: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<AuthStateResult> {
  const client = await authenticatedManagementApiClient(env, signal);
  const currentPrincipal = await readCurrentPrincipalAuthState(client, signal);
  if (currentPrincipal) {
    return currentPrincipal;
  }

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
      credential: null,
    };
  }

  return buildAuthState({
    workspaceIdFromCredential: workspaceId,
    claims,
    env,
    client,
    signal,
  });
}

async function buildAuthState({
  workspaceIdFromCredential,
  claims,
  env,
  client,
  signal,
}: {
  workspaceIdFromCredential: string;
  claims: Record<string, unknown>;
  env: NodeJS.ProcessEnv;
  client?: ManagementApiClient | null;
  signal?: AbortSignal;
}): Promise<AuthStateResult> {
  let workspaceId = workspaceIdFromCredential;
  let workspaceName = workspaceIdFromCredential;

  client ??= await authenticatedManagementApiClient(env, signal);

  if (client) {
    try {
      const { data, response } = await client.GET("/v1/workspaces/{id}", {
        params: { path: { id: workspaceIdFromCredential } },
        signal,
      });
      // A 401 from the workspace lookup means the credential the caller
      // presented is fundamentally invalid (revoked, wrong signing key,
      // expired) - surface signed-out state instead of returning a
      // workspace shape that makes a broken token look fine. Other
      // statuses (404/5xx/network) keep the silent fallback so transient
      // lookup failures do not turn `auth whoami` into a hard error.
      if (response?.status === 401) {
        return {
          authenticated: false,
          provider: null,
          user: null,
          workspace: null,
          credential: null,
        };
      }
      if (data?.data?.id) {
        workspaceId = data.data.id;
        workspaceName = data.data.id;
      }
      if (data?.data?.name) {
        workspaceName = data.data.name;
      }
    } catch {
      signal?.throwIfAborted();
      // fall through - use workspaceId as name
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
    credential: null,
  };
}

async function readCurrentPrincipalAuthState(
  client: ManagementApiClient | null,
  signal?: AbortSignal,
): Promise<AuthStateResult | null> {
  if (!client) return null;

  try {
    const { data, response } = await client.GET("/v1/me", { signal });

    if (response?.status === 401) {
      return {
        authenticated: false,
        provider: null,
        user: null,
        workspace: null,
        credential: null,
      };
    }

    const principal = data?.data;
    if (!principal) return null;
    if (!principal.credential) return null;

    return {
      authenticated: true,
      provider: null,
      user: principal.user
        ? {
            id: principal.user.id,
            email: principal.user.email,
            name: principal.user.name,
          }
        : null,
      workspace: principal.workspace,
      credential: principal.credential,
    };
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}

export async function performLogout(
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<void> {
  await new FileTokenStorage(env, signal).clearTokens();
}
