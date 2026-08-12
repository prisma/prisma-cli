import { SERVICE_TOKEN_ENV_VAR } from "@prisma/cli-engine";
import { workspaceSwitchUnavailableError } from "../auth/errors";
import {
  performLogin,
  performLogout,
  readAuthState,
  storeLegacyCredential,
} from "../auth/operations";
import {
  listAuthWorkspaces,
  logoutAuthWorkspace,
  switchAuthWorkspace,
  type WorkspaceOperationContext,
} from "../auth/workspaces";
import { resolvePrismaCliPackageCommand } from "../lib/agent/cli-command";
import { PRISMA_AGENT_INSTALL_ARGS } from "../lib/agent/constants";
import {
  isLikelyProjectDirectory,
  readPrismaAgentSetupStatus,
  resolvePrismaAgentSetupCwd,
  shouldOfferPrismaAgentSetup,
} from "../lib/agent/setup-status";
import { authRequiredError, usageError } from "../shell/errors";
import type { CommandSuccess } from "../shell/output";
import { type CommandContext, canPrompt } from "../shell/runtime";
import type {
  AuthStateResult,
  AuthWorkspaceListResult,
  AuthWorkspaceLogoutResult,
  AuthWorkspaceUseResult,
} from "../types/auth";
import { createSelectPromptPort } from "./select-prompt-port";

export interface AuthLoginCommandOptions {
  provider?: string;
  user?: string;
  workspace?: string;
}

export interface AuthLogoutCommandOptions {
  workspace?: string;
}

function workspaceOperationContext(
  context: CommandContext,
): WorkspaceOperationContext {
  return { env: context.runtime.env, signal: context.runtime.signal };
}

export async function runAuthLogin(
  context: CommandContext,
): Promise<CommandSuccess<AuthStateResult>> {
  const credential = await performLogin(
    context.runtime.env,
    context.runtime.signal,
  );
  await storeLegacyCredential(
    context.runtime.env,
    credential,
    context.runtime.signal,
  );
  let result = await readAuthState(context.runtime.env, context.runtime.signal);

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
  await performLogout(context.runtime.env, context.runtime.signal);
  const result = await readAuthState(
    context.runtime.env,
    context.runtime.signal,
  );

  return createAuthSuccess("auth.logout", result, ["prisma-cli auth login"]);
}

export async function runAuthWhoAmI(
  context: CommandContext,
): Promise<CommandSuccess<AuthStateResult>> {
  const result = await readAuthState(
    context.runtime.env,
    context.runtime.signal,
  );

  return createAuthSuccess(
    "auth.whoami",
    result,
    result.authenticated ? [] : ["prisma-cli auth login"],
  );
}

export async function runAuthWorkspaceList(
  context: CommandContext,
): Promise<CommandSuccess<AuthWorkspaceListResult>> {
  const result = await listAuthWorkspaces(workspaceOperationContext(context));

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

  const result = await switchAuthWorkspace(
    workspaceOperationContext(context),
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

  const result = await logoutAuthWorkspace(
    workspaceOperationContext(context),
    workspaceRef,
  );

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

  const credential = await performLogin(
    context.runtime.env,
    context.runtime.signal,
  );
  await storeLegacyCredential(
    context.runtime.env,
    credential,
    context.runtime.signal,
  );
  return readAuthState(context.runtime.env, context.runtime.signal);
}

async function selectWorkspaceSession(
  context: CommandContext,
): Promise<string> {
  if (context.runtime.env[SERVICE_TOKEN_ENV_VAR] !== undefined) {
    throw workspaceSwitchUnavailableError();
  }

  const result = await listAuthWorkspaces(workspaceOperationContext(context));
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
