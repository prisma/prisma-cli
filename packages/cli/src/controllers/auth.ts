import {
  listRealAuthWorkspaces,
  logoutRealAuthWorkspace,
  performLogin,
  performLogout,
  readAuthState,
  SERVICE_TOKEN_ENV_VAR,
  useRealAuthWorkspace,
} from "../auth";
import { resolvePrismaCliPackageCommand } from "../lib/agent/cli-command";
import { PRISMA_AGENT_INSTALL_ARGS } from "../lib/agent/constants";
import {
  isLikelyProjectDirectory,
  readPrismaAgentSetupStatus,
  resolvePrismaAgentSetupCwd,
  shouldOfferPrismaAgentSetup,
} from "../lib/agent/setup-status";
import {
  authRequiredError,
  usageError,
  workspaceSwitchUnavailableError,
} from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import { type CommandContext, canPrompt } from "../shell/runtime";
import type {
  AuthStateResult,
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

  const agentSetupTipCommand = await resolveAgentSetupTipCommand(context);
  if (agentSetupTipCommand) {
    result = {
      ...result,
      agentSetupTip: {
        command: agentSetupTipCommand,
      },
    };
  }

  return createAuthSuccess("auth.login", result, [
    "prisma-cli auth whoami",
    "prisma-cli project list",
    ...(result.agentSetupTip ? [result.agentSetupTip.command] : []),
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

async function resolveAgentSetupTipCommand(
  context: CommandContext,
): Promise<string | null> {
  if (context.flags.json || context.flags.quiet) {
    return null;
  }

  if (context.runtime.env.CI && context.flags.interactive !== true) {
    return null;
  }

  if (!context.runtime.stderr.isTTY && context.flags.interactive !== true) {
    return null;
  }

  const setupCwd = await resolvePrismaAgentSetupCwd({
    cwd: context.runtime.cwd,
    signal: context.runtime.signal,
  });

  if (
    !(await isLikelyProjectDirectory({
      cwd: setupCwd,
      signal: context.runtime.signal,
    }))
  ) {
    return null;
  }

  const shouldOffer = shouldOfferPrismaAgentSetup(
    await readPrismaAgentSetupStatus({
      cwd: setupCwd,
      stateStore: context.stateStore,
      signal: context.runtime.signal,
    }),
  );
  if (!shouldOffer) {
    return null;
  }

  return await resolvePrismaCliPackageCommand({
    cwd: setupCwd,
    signal: context.runtime.signal,
    args: PRISMA_AGENT_INSTALL_ARGS,
  });
}
