import {
  createManagementApiSdk,
  type TokenStorage,
  type Tokens,
} from "@prisma/management-api-sdk";
import type {
  AuthWorkspace,
  AuthWorkspaceListResult,
  AuthWorkspaceLogoutResult,
  AuthWorkspaceUseResult,
} from "../types/auth";
import { CLIENT_ID, getApiBaseUrl, SERVICE_TOKEN_ENV_VAR } from "./client";
import {
  workspaceAmbiguousError,
  workspaceNotAuthenticatedError,
  workspaceSwitchUnavailableError,
} from "./errors";
import { readAuthState } from "./operations";
import {
  FileTokenStorage,
  type StoredAuthWorkspace,
  WorkspaceSelectionError,
} from "./token-storage";

/** The exact context surface the workspace operations read. */
export interface WorkspaceOperationContext {
  readonly env: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
}

export async function listAuthWorkspaces(
  context: WorkspaceOperationContext,
): Promise<AuthWorkspaceListResult> {
  const rawServiceToken = context.env[SERVICE_TOKEN_ENV_VAR];
  const storage = new FileTokenStorage(context.env, context.signal);
  const localWorkspaces = await hydrateLocalAuthWorkspaces(
    context,
    storage,
    await storage.listWorkspaces(),
  );

  if (rawServiceToken !== undefined) {
    const authState = await readAuthState(context.env, context.signal);
    return {
      authSource: authState.authenticated ? "service_token" : "none",
      activeWorkspace: authState.workspace,
      workspaces: [
        ...(authState.workspace
          ? [
              {
                ...authState.workspace,
                credentialWorkspaceId: null,
                active: true,
                source: "service_token" as const,
                switchable: false,
                lastSeenAt: null,
              },
            ]
          : []),
        ...localWorkspaces.map((workspace) => ({
          ...toAuthWorkspace(workspace),
          credentialWorkspaceId: workspace.credentialWorkspaceId,
          active: false,
          source: "oauth" as const,
          switchable: false,
          lastSeenAt: workspace.lastSeenAt,
        })),
      ],
    };
  }

  const active = localWorkspaces.find((workspace) => workspace.active) ?? null;
  return {
    authSource: localWorkspaces.length > 0 ? "oauth" : "none",
    activeWorkspace: active ? toAuthWorkspace(active) : null,
    workspaces: localWorkspaces.map((workspace) => ({
      ...toAuthWorkspace(workspace),
      credentialWorkspaceId: workspace.credentialWorkspaceId,
      active: workspace.active,
      source: "oauth" as const,
      switchable: true,
      lastSeenAt: workspace.lastSeenAt,
    })),
  };
}

export async function switchAuthWorkspace(
  context: WorkspaceOperationContext,
  workspaceRef: string,
): Promise<AuthWorkspaceUseResult> {
  if (context.env[SERVICE_TOKEN_ENV_VAR] !== undefined) {
    throw workspaceSwitchUnavailableError();
  }

  const storage = new FileTokenStorage(context.env, context.signal);
  await hydrateLocalAuthWorkspaces(
    context,
    storage,
    await storage.listWorkspaces(),
  );

  try {
    const result = await storage.useWorkspace(workspaceRef);
    return {
      previousWorkspace: result.previous
        ? toAuthWorkspace(result.previous)
        : null,
      workspace: toAuthWorkspace(result.selected),
    };
  } catch (error) {
    if (error instanceof WorkspaceSelectionError) {
      if (error.reason === "ambiguous") {
        throw workspaceAmbiguousError(
          error.workspaceRef ?? workspaceRef,
          error.matches.map((match) => ({
            id: match.id,
            name: match.name,
            credentialWorkspaceId: match.credentialWorkspaceId,
          })),
        );
      }

      throw workspaceNotAuthenticatedError(error.workspaceRef ?? workspaceRef);
    }

    throw error;
  }
}

export async function logoutAuthWorkspace(
  context: WorkspaceOperationContext,
  workspaceRef: string,
): Promise<AuthWorkspaceLogoutResult> {
  const storage = new FileTokenStorage(context.env, context.signal);
  await hydrateLocalAuthWorkspaces(
    context,
    storage,
    await storage.listWorkspaces(),
  );

  try {
    const result = await storage.logoutWorkspace(workspaceRef);
    return {
      workspace: toAuthWorkspace(result.workspace),
      wasActive: result.wasActive,
      activeWorkspace: result.activeWorkspace
        ? toAuthWorkspace(result.activeWorkspace)
        : null,
    };
  } catch (error) {
    if (error instanceof WorkspaceSelectionError) {
      if (error.reason === "ambiguous") {
        throw workspaceAmbiguousError(
          error.workspaceRef ?? workspaceRef,
          error.matches.map((match) => ({
            id: match.id,
            name: match.name,
            credentialWorkspaceId: match.credentialWorkspaceId,
          })),
        );
      }

      throw workspaceNotAuthenticatedError(error.workspaceRef ?? workspaceRef);
    }

    throw error;
  }
}

async function hydrateLocalAuthWorkspaces(
  context: WorkspaceOperationContext,
  storage: FileTokenStorage,
  workspaces: StoredAuthWorkspace[],
): Promise<StoredAuthWorkspace[]> {
  const candidates = workspaces.filter(needsWorkspaceMetadataHydration);
  if (candidates.length === 0) return workspaces;

  const tokensByCredentialWorkspaceId = new Map(
    (await storage.listWorkspaceTokens()).map((tokens) => [
      tokens.workspaceId,
      tokens,
    ]),
  );
  let nextWorkspaces = workspaces;

  for (const workspace of candidates) {
    const tokens = tokensByCredentialWorkspaceId.get(
      workspace.credentialWorkspaceId,
    );
    if (!tokens) continue;

    const resolved = await resolveOAuthWorkspaceMetadata(context, tokens);
    if (!resolved) continue;

    await rememberResolvedWorkspaceMetadata(context, storage, tokens, resolved);
    nextWorkspaces = nextWorkspaces.map((candidate) =>
      candidate.credentialWorkspaceId === workspace.credentialWorkspaceId
        ? {
            ...candidate,
            id: resolved.id,
            name: resolved.name,
            lastSeenAt: new Date().toISOString(),
          }
        : candidate,
    );
  }

  return nextWorkspaces;
}

async function rememberResolvedWorkspaceMetadata(
  context: WorkspaceOperationContext,
  storage: FileTokenStorage,
  tokens: Tokens,
  resolved: { id: string; name: string },
): Promise<void> {
  try {
    await storage.rememberWorkspace(tokens.workspaceId, resolved);
  } catch {
    context.signal?.throwIfAborted();
  }
}

function needsWorkspaceMetadataHydration(workspace: StoredAuthWorkspace) {
  return (
    workspace.id === workspace.credentialWorkspaceId ||
    workspace.name === "Unknown workspace" ||
    workspace.name === workspace.credentialWorkspaceId
  );
}

async function resolveOAuthWorkspaceMetadata(
  context: WorkspaceOperationContext,
  tokens: Tokens,
): Promise<{ id: string; name: string } | null> {
  const refreshStorage = new FileTokenStorage(context.env, context.signal, {
    activateOnSetTokens: false,
  });
  const tokenStorage = createSingleWorkspaceTokenStorage(
    refreshStorage,
    tokens,
  );
  const sdk = createManagementApiSdk({
    clientId: CLIENT_ID,
    redirectUri: "http://localhost:0/auth/callback",
    tokenStorage,
    apiBaseUrl: getApiBaseUrl(context.env),
  });

  try {
    const { data } = await sdk.client.GET("/v1/workspaces/{id}", {
      params: { path: { id: tokens.workspaceId } },
      signal: context.signal,
    });
    const id = stringOrNull(data?.data?.id) ?? tokens.workspaceId;
    const name = stringOrNull(data?.data?.name) ?? id;

    if (id === tokens.workspaceId && name === tokens.workspaceId) {
      return null;
    }

    return { id, name };
  } catch {
    context.signal?.throwIfAborted();
    return null;
  }
}

function createSingleWorkspaceTokenStorage(
  storage: FileTokenStorage,
  initialTokens: Tokens,
): TokenStorage {
  let currentTokens: Tokens | null = initialTokens;

  return {
    getTokens: async () => currentTokens,
    setTokens: async (tokens) => {
      currentTokens = tokens;
      await storage.setTokens(tokens);
    },
    clearTokens: async () => {
      const tokens = currentTokens;
      currentTokens = null;
      if (tokens) {
        await storage.clearTokensIfCurrent(tokens);
      }
    },
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function toAuthWorkspace(workspace: StoredAuthWorkspace): AuthWorkspace {
  return {
    id: workspace.id,
    name: workspace.name,
  };
}
