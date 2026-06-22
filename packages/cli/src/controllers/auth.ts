import {
  createManagementApiSdk,
  type TokenStorage,
  type Tokens,
} from "@prisma/management-api-sdk";
import {
  FileTokenStorage,
  type StoredAuthWorkspace,
  WorkspaceSelectionError,
} from "../adapters/token-storage";
import {
  performLogin,
  performLogout,
  readAuthState,
} from "../lib/auth/auth-ops";
import {
  CLIENT_ID,
  getApiBaseUrl,
  SERVICE_TOKEN_ENV_VAR,
} from "../lib/auth/client";
import {
  authRequiredError,
  usageError,
  workspaceAmbiguousError,
  workspaceNotAuthenticatedError,
  workspaceSwitchUnavailableError,
} from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import { type CommandContext, canPrompt } from "../shell/runtime";
import type {
  AuthStateResult,
  AuthWorkspace,
  AuthWorkspaceListResult,
  AuthWorkspaceLogoutResult,
  AuthWorkspaceUseResult,
} from "../types/auth";
import { createAuthUseCases } from "../use-cases/auth";
import type { LoginSelection, SelectPromptPort } from "../use-cases/contracts";
import { createCliUseCaseGateways } from "../use-cases/create-cli-gateways";
import { createSelectPromptPort } from "./select-prompt-port";

export interface AuthLoginCommandOptions {
  provider?: string;
  user?: string;
  workspace?: string;
}

export interface AuthLogoutCommandOptions {
  workspace?: string;
}

function isRealMode(context: CommandContext): boolean {
  return (
    !context.runtime.fixturePath &&
    !context.runtime.env.PRISMA_CLI_MOCK_FIXTURE_PATH
  );
}

export async function runAuthLogin(
  context: CommandContext,
  options: AuthLoginCommandOptions,
): Promise<CommandSuccess<AuthStateResult>> {
  let result: AuthStateResult;

  if (isRealMode(context)) {
    await performLogin(context.runtime.env, context.runtime.signal);
    result = await readAuthState(context.runtime.env, context.runtime.signal);
  } else {
    const useCases = createAuthUseCases(createCliUseCaseGateways(context));
    result = await loginWithSelectionFlow(context, useCases, options);
  }

  return createAuthSuccess("auth.login", result, [
    "prisma-cli auth whoami",
    "prisma-cli project list",
  ]);
}

export async function runAuthLogout(
  context: CommandContext,
): Promise<CommandSuccess<AuthStateResult>> {
  let result: AuthStateResult;

  if (isRealMode(context)) {
    await performLogout(context.runtime.env, context.runtime.signal);
    result = await readAuthState(context.runtime.env, context.runtime.signal);
  } else {
    const useCases = createAuthUseCases(createCliUseCaseGateways(context));
    result = await useCases.logout();
  }

  return createAuthSuccess("auth.logout", result, ["prisma-cli auth login"]);
}

export async function runAuthWhoAmI(
  context: CommandContext,
): Promise<CommandSuccess<AuthStateResult>> {
  let result: AuthStateResult;

  if (isRealMode(context)) {
    result = await readAuthState(context.runtime.env, context.runtime.signal);
  } else {
    const useCases = createAuthUseCases(createCliUseCaseGateways(context));
    result = await useCases.whoami();
  }

  return createAuthSuccess(
    "auth.whoami",
    result,
    result.authenticated ? [] : ["prisma-cli auth login"],
  );
}

export async function runAuthWorkspaceList(
  context: CommandContext,
): Promise<CommandSuccess<AuthWorkspaceListResult>> {
  const result = isRealMode(context)
    ? await listRealAuthWorkspaces(context)
    : await createAuthUseCases(
        createCliUseCaseGateways(context),
      ).listWorkspaces();

  return {
    command: "auth.workspace.list",
    result,
    warnings: [],
    nextSteps: result.workspaces.length === 0 ? ["prisma-cli auth login"] : [],
  };
}

export async function runAuthWorkspaceUse(
  context: CommandContext,
  workspaceRef: string | undefined,
): Promise<CommandSuccess<AuthWorkspaceUseResult>> {
  const trimmedWorkspaceRef = workspaceRef?.trim();
  const selectedWorkspaceRef = trimmedWorkspaceRef
    ? trimmedWorkspaceRef
    : await selectWorkspaceSession(context);

  const result = isRealMode(context)
    ? await useRealAuthWorkspace(context, selectedWorkspaceRef)
    : await createAuthUseCases(createCliUseCaseGateways(context)).useWorkspace(
        selectedWorkspaceRef,
      );

  return {
    command: "auth.workspace.use",
    result,
    warnings: [],
    nextSteps: ["prisma-cli auth whoami", "prisma-cli project list"],
  };
}

export async function runAuthWorkspaceLogout(
  context: CommandContext,
  workspaceRef: string | undefined,
): Promise<CommandSuccess<AuthWorkspaceLogoutResult>> {
  if (!workspaceRef?.trim()) {
    throw usageError(
      "Workspace required",
      "auth workspace logout needs a workspace id or cached workspace name.",
      "Pass a workspace from prisma-cli auth workspace list.",
      ["prisma-cli auth workspace list"],
      "auth",
    );
  }

  const result = isRealMode(context)
    ? await logoutRealAuthWorkspace(context, workspaceRef)
    : await createAuthUseCases(
        createCliUseCaseGateways(context),
      ).logoutWorkspace(workspaceRef);

  return {
    command: "auth.workspace.logout",
    result,
    warnings: [],
    nextSteps: result.activeWorkspace
      ? ["prisma-cli auth workspace list"]
      : [
          "prisma-cli auth workspace list",
          "prisma-cli auth workspace use <id>",
        ],
  };
}

export async function requireAuthenticatedAuthState(
  context: CommandContext,
): Promise<AuthStateResult> {
  if (isRealMode(context)) {
    const current = await readAuthState(
      context.runtime.env,
      context.runtime.signal,
    );
    if (current.authenticated) {
      return current;
    }

    if (!canPrompt(context)) {
      throw authRequiredError();
    }

    await performLogin(context.runtime.env, context.runtime.signal);
    return readAuthState(context.runtime.env, context.runtime.signal);
  }

  const useCases = createAuthUseCases(createCliUseCaseGateways(context));
  const current = await useCases.whoami();

  if (current.authenticated) {
    return current;
  }

  if (!canPrompt(context)) {
    throw authRequiredError();
  }

  return loginWithSelectionFlow(context, useCases, {});
}

async function listRealAuthWorkspaces(
  context: CommandContext,
): Promise<AuthWorkspaceListResult> {
  const rawServiceToken = context.runtime.env[SERVICE_TOKEN_ENV_VAR];
  const storage = new FileTokenStorage(
    context.runtime.env,
    context.runtime.signal,
  );
  const localWorkspaces = await hydrateLocalAuthWorkspaces(
    context,
    storage,
    await storage.listWorkspaces(),
  );

  if (rawServiceToken !== undefined) {
    const authState = await readAuthState(
      context.runtime.env,
      context.runtime.signal,
    );
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

async function useRealAuthWorkspace(
  context: CommandContext,
  workspaceRef: string,
): Promise<AuthWorkspaceUseResult> {
  if (context.runtime.env[SERVICE_TOKEN_ENV_VAR] !== undefined) {
    throw workspaceSwitchUnavailableError();
  }

  const storage = new FileTokenStorage(
    context.runtime.env,
    context.runtime.signal,
  );
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

async function logoutRealAuthWorkspace(
  context: CommandContext,
  workspaceRef: string,
): Promise<AuthWorkspaceLogoutResult> {
  const storage = new FileTokenStorage(
    context.runtime.env,
    context.runtime.signal,
  );
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

async function selectWorkspaceSession(
  context: CommandContext,
): Promise<string> {
  const realMode = isRealMode(context);
  if (realMode && context.runtime.env[SERVICE_TOKEN_ENV_VAR] !== undefined) {
    throw workspaceSwitchUnavailableError();
  }

  const result = realMode
    ? await listRealAuthWorkspaces(context)
    : await createAuthUseCases(
        createCliUseCaseGateways(context),
      ).listWorkspaces();
  const workspaces = result.workspaces.filter(
    (workspace) => workspace.switchable,
  );

  if (workspaces.length === 0) {
    throw usageError(
      "No authenticated workspaces",
      "There are no local OAuth workspace sessions to select.",
      "Run prisma-cli auth login and authorize a workspace.",
      ["prisma-cli auth login"],
      "auth",
    );
  }

  if (workspaces.length === 1) {
    return workspaces[0].id;
  }

  if (!canPrompt(context)) {
    throw usageError(
      "Interactive workspace selection unavailable",
      "auth workspace use needs an interactive terminal when no workspace is provided and more than one workspace is available.",
      "Run prisma-cli auth workspace use <id-or-name> with a workspace from prisma-cli auth workspace list.",
      ["prisma-cli auth workspace list"],
      "auth",
    );
  }

  const prompt = createSelectPromptPort(context);
  const selected = await prompt.select({
    message: "Select a workspace",
    choices: workspaces.map((workspace) => ({
      label: `${workspace.name} (${workspace.id})${workspace.active ? " active" : ""}`,
      value: workspace,
    })),
  });

  return selected.id;
}

async function hydrateLocalAuthWorkspaces(
  context: CommandContext,
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

    const resolved = await resolveOAuthWorkspaceMetadata(
      context,
      tokens,
    );
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
  context: CommandContext,
  storage: FileTokenStorage,
  tokens: Tokens,
  resolved: { id: string; name: string },
): Promise<void> {
  try {
    await storage.rememberWorkspace(tokens.workspaceId, resolved);
  } catch {
    context.runtime.signal?.throwIfAborted();
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
  context: CommandContext,
  tokens: Tokens,
): Promise<{ id: string; name: string } | null> {
  const refreshStorage = new FileTokenStorage(
    context.runtime.env,
    context.runtime.signal,
    { activateOnSetTokens: false },
  );
  const tokenStorage = createSingleWorkspaceTokenStorage(refreshStorage, tokens);
  const sdk = createManagementApiSdk({
    clientId: CLIENT_ID,
    redirectUri: "http://localhost:0/auth/callback",
    tokenStorage,
    apiBaseUrl: getApiBaseUrl(context.runtime.env),
  });

  try {
    const { data } = await sdk.client.GET("/v1/workspaces/{id}", {
      params: { path: { id: tokens.workspaceId } },
      signal: context.runtime.signal,
    });
    const id = stringOrNull(data?.data?.id) ?? tokens.workspaceId;
    const name = stringOrNull(data?.data?.name) ?? id;

    if (id === tokens.workspaceId && name === tokens.workspaceId) {
      return null;
    }

    return { id, name };
  } catch {
    context.runtime.signal?.throwIfAborted();
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

async function loginWithSelectionFlow(
  context: CommandContext,
  useCases: ReturnType<typeof createAuthUseCases>,
  options: AuthLoginCommandOptions,
): Promise<AuthStateResult> {
  const prompt = canPrompt(context) ? createSelectPromptPort(context) : null;
  const selection = await resolveLoginSelection(useCases, prompt, options);
  return useCases.login(selection);
}

async function resolveLoginSelection(
  useCases: ReturnType<typeof createAuthUseCases>,
  prompt: SelectPromptPort | null,
  options: AuthLoginCommandOptions,
): Promise<LoginSelection> {
  const provider = options.provider
    ? (await useCases.resolveProvider(options.provider)).id
    : (await selectProvider(useCases, prompt)).id;
  const user = options.user
    ? await useCases.resolveUserForProvider(provider, options.user)
    : await selectUser(useCases, prompt, provider);
  const workspace = options.workspace
    ? await useCases.resolveWorkspaceForUser(user.id, options.workspace)
    : await selectWorkspace(useCases, prompt, user.id);

  return {
    provider,
    userId: user.id,
    workspaceId: workspace.id,
  };
}

async function selectProvider(
  useCases: ReturnType<typeof createAuthUseCases>,
  prompt: SelectPromptPort | null,
) {
  if (!prompt) {
    throw nonInteractiveLoginError(
      "Re-run prisma-cli auth login in a TTY, or provide --provider and --user, and --workspace when required.",
    );
  }

  const providers = await useCases.listProviders();
  return prompt.select({
    message: "Select a provider",
    choices: providers.map((provider) => ({
      label: provider.name,
      value: provider,
    })),
  });
}

async function selectUser(
  useCases: ReturnType<typeof createAuthUseCases>,
  prompt: SelectPromptPort | null,
  provider: LoginSelection["provider"],
) {
  const users = await useCases.listUsersForProvider(provider);

  if (!prompt) {
    throw nonInteractiveLoginError(
      "Re-run prisma-cli auth login in a TTY, or provide --provider and --user, and --workspace when required.",
    );
  }

  return prompt.select({
    message: "Select a user",
    choices: users.map((user) => ({
      label: `${user.name} <${user.email}>`,
      value: user,
    })),
  });
}

async function selectWorkspace(
  useCases: ReturnType<typeof createAuthUseCases>,
  prompt: SelectPromptPort | null,
  userId: string,
) {
  const workspaces = await useCases.listWorkspacesForUser(userId);

  if (workspaces.length === 1) {
    return workspaces[0];
  }

  if (!prompt) {
    throw usageError(
      "Login requires explicit selectors in non-interactive mode",
      "The selected mock user belongs to more than one workspace and the shell cannot prompt in the current mode.",
      "Re-run prisma-cli auth login in a TTY, or provide --workspace.",
      ["prisma-cli auth login"],
      "auth",
    );
  }

  return prompt.select({
    message: "Select a workspace",
    choices: workspaces.map((workspace) => ({
      label: `${workspace.name} (${workspace.id})`,
      value: workspace,
    })),
  });
}

function nonInteractiveLoginError(fix: string) {
  return usageError(
    "Login requires explicit selectors in non-interactive mode",
    "The fixture mode cannot prompt in the current mode.",
    fix,
    ["prisma-cli auth login"],
    "auth",
  );
}

function createAuthSuccess(
  command: "auth.login" | "auth.logout" | "auth.whoami",
  result: AuthStateResult,
  nextSteps: string[],
): CommandSuccess<AuthStateResult> {
  return {
    command,
    result,
    warnings: [],
    nextSteps,
  };
}
