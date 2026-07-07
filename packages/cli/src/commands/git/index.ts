import { Command } from "commander";

import {
  runGitAccountConnect,
  runGitAccountList,
  runGitConnect,
  runGitDisconnect,
} from "../../controllers/project";
import {
  renderGitAccountConnect,
  renderGitAccountList,
  renderGitConnect,
  renderGitDisconnect,
  serializeGitAccountConnect,
  serializeGitAccountList,
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
  git.addCommand(createGitAccountCommand(runtime));

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

function createGitAccountCommand(runtime: CliRuntime): Command {
  const account = attachCommandDescriptor(
    configureRuntimeCommand(new Command("account"), runtime),
    "git.account",
  );

  addCompactGlobalFlags(account);

  account.addCommand(createGitAccountListCommand(runtime));
  account.addCommand(createGitAccountConnectCommand(runtime));

  return account;
}

function createGitAccountListCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("list"), runtime),
    "git.account.list",
  );

  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<GitAccountsResult>(
      runtime,
      "git.account.list",
      options as Record<string, unknown>,
      (context) => runGitAccountList(context),
      {
        renderHuman: (context, descriptor, result) =>
          renderGitAccountList(context, descriptor, result),
        renderJson: (result) => serializeGitAccountList(result),
      },
    );
  });

  return command;
}

function createGitAccountConnectCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("connect"), runtime),
    "git.account.connect",
  );

  command.argument(
    "[account]",
    "GitHub account login or numeric installation id",
  );
  addGlobalFlags(command);

  command.action(async (account: string | undefined, options) => {
    await runCommand<GitConnectAccountResult>(
      runtime,
      "git.account.connect",
      options as Record<string, unknown>,
      (context) => runGitAccountConnect(context, account),
      {
        renderHuman: (context, descriptor, result) =>
          renderGitAccountConnect(context, descriptor, result),
        renderJson: (result) => serializeGitAccountConnect(result),
      },
    );
  });

  return command;
}
