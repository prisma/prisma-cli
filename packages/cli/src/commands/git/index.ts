import { Command } from "commander";

import {
  runGitAccounts,
  runGitConnect,
  runGitConnectAccount,
  runGitDisconnect,
  runGitInstall,
} from "../../controllers/project";
import {
  renderGitAccounts,
  renderGitConnect,
  renderGitConnectAccount,
  renderGitDisconnect,
  renderGitInstall,
  serializeGitAccounts,
  serializeGitConnectAccount,
  serializeGitInstall,
} from "../../presenters/project";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { runCommand } from "../../shell/command-runner";
import {
  addCompactGlobalFlags,
  addGlobalFlags,
} from "../../shell/global-flags";
import { type CliRuntime, configureRuntimeCommand } from "../../shell/runtime";
import type {
  GitAccountsResult,
  GitConnectAccountResult,
  GitInstallResult,
  ProjectRepositoryConnectionResult,
} from "../../types/project";

export function createGitCommand(runtime: CliRuntime): Command {
  const git = attachCommandDescriptor(
    configureRuntimeCommand(new Command("git"), runtime),
    "git",
  );

  addCompactGlobalFlags(git);

  git.addCommand(createGitConnectCommand(runtime));
  git.addCommand(createGitDisconnectCommand(runtime));
  git.addCommand(createGitAccountsCommand(runtime));
  git.addCommand(createGitConnectAccountCommand(runtime));
  git.addCommand(createGitInstallCommand(runtime));

  return git;
}

function createGitConnectCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("connect"), runtime),
    "git.connect",
  );

  command.argument("[git-url]", "GitHub repository URL");
  command.option("--project <id-or-name>", "Project id or name");
  addGlobalFlags(command);

  command.action(async (gitUrl: string | undefined, options) => {
    await runCommand<ProjectRepositoryConnectionResult>(
      runtime,
      "git.connect",
      options as Record<string, unknown>,
      (context) =>
        runGitConnect(context, gitUrl, {
          project:
            typeof options.project === "string" ? options.project : undefined,
        }),
      {
        renderHuman: (context, descriptor, result) =>
          renderGitConnect(context, descriptor, result),
      },
    );
  });

  return command;
}

function createGitDisconnectCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("disconnect"), runtime),
    "git.disconnect",
  );

  command.option("--project <id-or-name>", "Project id or name");
  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<ProjectRepositoryConnectionResult>(
      runtime,
      "git.disconnect",
      options as Record<string, unknown>,
      (context) =>
        runGitDisconnect(context, {
          project:
            typeof options.project === "string" ? options.project : undefined,
        }),
      {
        renderHuman: (context, descriptor, result) =>
          renderGitDisconnect(context, descriptor, result),
      },
    );
  });

  return command;
}

function createGitAccountsCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("accounts"), runtime),
    "git.accounts",
  );

  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<GitAccountsResult>(
      runtime,
      "git.accounts",
      options as Record<string, unknown>,
      (context) => runGitAccounts(context),
      {
        renderHuman: (context, descriptor, result) =>
          renderGitAccounts(context, descriptor, result),
        renderJson: (result) => serializeGitAccounts(result),
      },
    );
  });

  return command;
}

function createGitConnectAccountCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("connect-account"), runtime),
    "git.connect-account",
  );

  command.argument(
    "[account]",
    "GitHub account login or numeric installation id",
  );
  addGlobalFlags(command);

  command.action(async (account: string | undefined, options) => {
    await runCommand<GitConnectAccountResult>(
      runtime,
      "git.connect-account",
      options as Record<string, unknown>,
      (context) => runGitConnectAccount(context, account),
      {
        renderHuman: (context, descriptor, result) =>
          renderGitConnectAccount(context, descriptor, result),
        renderJson: (result) => serializeGitConnectAccount(result),
      },
    );
  });

  return command;
}

function createGitInstallCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("install"), runtime),
    "git.install",
  );

  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<GitInstallResult>(
      runtime,
      "git.install",
      options as Record<string, unknown>,
      (context) => runGitInstall(context),
      {
        renderHuman: (context, descriptor, result) =>
          renderGitInstall(context, descriptor, result),
        renderJson: (result) => serializeGitInstall(result),
      },
    );
  });

  return command;
}
