import { Command, Option } from "commander";

import { runAuthLogin, runAuthLogout, runAuthWhoAmI, type AuthLoginCommandOptions } from "../../controllers/auth";
import { renderAuthSuccess } from "../../presenters/auth";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { addGlobalFlags } from "../../shell/global-flags";
import { runCommand } from "../../shell/command-runner";
import { configureRuntimeCommand, type CliRuntime } from "../../shell/runtime";
import type { AuthStateResult } from "../../types/auth";

export function createAuthCommand(runtime: CliRuntime): Command {
  const auth = attachCommandDescriptor(configureRuntimeCommand(new Command("auth"), runtime), "auth");

  auth.addCommand(createAuthLoginCommand(runtime));
  auth.addCommand(createAuthLogoutCommand(runtime));
  auth.addCommand(createAuthWhoAmICommand(runtime));

  return auth;
}

function createAuthLoginCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(configureRuntimeCommand(new Command("login"), runtime), "auth.login");

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
  const command = attachCommandDescriptor(configureRuntimeCommand(new Command("logout"), runtime), "auth.logout");

  addGlobalFlags(command);

  command.action(async (options) => {
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
  const command = attachCommandDescriptor(configureRuntimeCommand(new Command("whoami"), runtime), "auth.whoami");

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
