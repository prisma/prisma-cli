import { Command, Option } from "commander";

import {
  type AuthLoginCommandOptions,
  type AuthLogoutCommandOptions,
  runAuthLogin,
  runAuthLogout,
  runAuthWhoAmI,
  runAuthWorkspaceList,
  runAuthWorkspaceLogout,
  runAuthWorkspaceUse,
} from "../../controllers/auth";
import {
  renderAuthSuccess,
  renderAuthWorkspaceList,
  renderAuthWorkspaceLogout,
  renderAuthWorkspaceUse,
  serializeAuthWorkspaceList,
  serializeAuthWorkspaceLogout,
  serializeAuthWorkspaceUse,
} from "../../presenters/auth";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { runCommand } from "../../shell/command-runner";
import {
  addCompactGlobalFlags,
  addGlobalFlags,
} from "../../shell/global-flags";
import { type CliRuntime, configureRuntimeCommand } from "../../shell/runtime";
import type {
  AuthStateResult,
  AuthWorkspaceListResult,
  AuthWorkspaceLogoutResult,
  AuthWorkspaceUseResult,
} from "../../types/auth";

export function createAuthCommand(runtime: CliRuntime): Command {
  const auth = attachCommandDescriptor(
    configureRuntimeCommand(new Command("auth"), runtime),
    "auth",
  );

  addCompactGlobalFlags(auth);

  auth.addCommand(createAuthLoginCommand(runtime));
  auth.addCommand(createAuthLogoutCommand(runtime));
  auth.addCommand(createAuthWhoAmICommand(runtime));
  auth.addCommand(createAuthWorkspaceCommand(runtime));

  return auth;
}

function createAuthLoginCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("login"), runtime),
    "auth.login",
  );

  command
    .addOption(new Option("--provider <provider>").hideHelp())
    .addOption(new Option("--user <id>").hideHelp())
    .addOption(new Option("--workspace <id>").hideHelp());

  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<AuthStateResult>(
      runtime,
      "auth.login",
      options as Record<string, unknown>,
      (context) => runAuthLogin(context, options as AuthLoginCommandOptions),
      {
        renderHuman: (context, descriptor, result) =>
          renderAuthSuccess(context, descriptor, "auth.login", result),
      },
    );
  });

  return command;
}

function createAuthLogoutCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("logout"), runtime),
    "auth.logout",
  );

  command.addOption(
    new Option(
      "--workspace <id-or-name>",
      "Remove one stored OAuth workspace session",
    ),
  );

  addGlobalFlags(command);

  command.action(async (options) => {
    const logoutOptions = options as AuthLogoutCommandOptions;
    if (logoutOptions.workspace?.trim()) {
      await runCommand<AuthWorkspaceLogoutResult>(
        runtime,
        "auth.workspace.logout",
        options as Record<string, unknown>,
        (context) => runAuthWorkspaceLogout(context, logoutOptions.workspace),
        {
          renderHuman: (context, descriptor, result) =>
            renderAuthWorkspaceLogout(context, descriptor, result),
          renderJson: (result) => serializeAuthWorkspaceLogout(result),
        },
      );
      return;
    }

    await runCommand<AuthStateResult>(
      runtime,
      "auth.logout",
      options as Record<string, unknown>,
      (context) => runAuthLogout(context),
      {
        renderHuman: (context, descriptor, result) =>
          renderAuthSuccess(context, descriptor, "auth.logout", result),
      },
    );
  });

  return command;
}

function createAuthWhoAmICommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("whoami"), runtime),
    "auth.whoami",
  );

  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<AuthStateResult>(
      runtime,
      "auth.whoami",
      options as Record<string, unknown>,
      (context) => runAuthWhoAmI(context),
      {
        renderHuman: (context, descriptor, result) =>
          renderAuthSuccess(context, descriptor, "auth.whoami", result),
      },
    );
  });

  return command;
}

function createAuthWorkspaceCommand(runtime: CliRuntime): Command {
  const workspace = attachCommandDescriptor(
    configureRuntimeCommand(new Command("workspace"), runtime),
    "auth.workspace",
  );

  addCompactGlobalFlags(workspace);

  workspace.addCommand(createAuthWorkspaceListCommand(runtime));
  workspace.addCommand(createAuthWorkspaceUseCommand(runtime));
  workspace.addCommand(createAuthWorkspaceLogoutCommand(runtime));

  return workspace;
}

function createAuthWorkspaceListCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("list"), runtime),
    "auth.workspace.list",
  );

  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<AuthWorkspaceListResult>(
      runtime,
      "auth.workspace.list",
      options as Record<string, unknown>,
      (context) => runAuthWorkspaceList(context),
      {
        renderHuman: (context, descriptor, result) =>
          renderAuthWorkspaceList(context, descriptor, result),
        renderJson: (result) => serializeAuthWorkspaceList(result),
      },
    );
  });

  return command;
}

function createAuthWorkspaceLogoutCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("logout"), runtime),
    "auth.workspace.logout",
  );

  command.argument("<id-or-name>", "Workspace id or exact name");
  addGlobalFlags(command);

  command.action(async (workspaceRef, options) => {
    await runCommand<AuthWorkspaceLogoutResult>(
      runtime,
      "auth.workspace.logout",
      options as Record<string, unknown>,
      (context) =>
        runAuthWorkspaceLogout(
          context,
          typeof workspaceRef === "string" ? workspaceRef : undefined,
        ),
      {
        renderHuman: (context, descriptor, result) =>
          renderAuthWorkspaceLogout(context, descriptor, result),
        renderJson: (result) => serializeAuthWorkspaceLogout(result),
      },
    );
  });

  return command;
}

function createAuthWorkspaceUseCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("use"), runtime),
    "auth.workspace.use",
  );

  command.argument("[id-or-name]", "Workspace id or exact name");
  addGlobalFlags(command);

  command.action(async (workspaceRef, options) => {
    await runCommand<AuthWorkspaceUseResult>(
      runtime,
      "auth.workspace.use",
      options as Record<string, unknown>,
      (context) =>
        runAuthWorkspaceUse(
          context,
          typeof workspaceRef === "string" ? workspaceRef : undefined,
        ),
      {
        renderHuman: (context, descriptor, result) =>
          renderAuthWorkspaceUse(context, descriptor, result),
        renderJson: (result) => serializeAuthWorkspaceUse(result),
      },
    );
  });

  return command;
}
