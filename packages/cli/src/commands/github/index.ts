import { Command } from "commander";

import {
  runGithubConnect,
  runGithubInstall,
  runGithubList,
} from "../../controllers/github";
import {
  renderGithubConnect,
  renderGithubInstall,
  renderGithubList,
  serializeGithubConnect,
  serializeGithubInstall,
  serializeGithubList,
} from "../../presenters/github";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { runCommand } from "../../shell/command-runner";
import {
  addCompactGlobalFlags,
  addGlobalFlags,
} from "../../shell/global-flags";
import { type CliRuntime, configureRuntimeCommand } from "../../shell/runtime";
import type {
  GithubConnectResult,
  GithubInstallResult,
  GithubListResult,
} from "../../types/github";

export function createGithubCommand(runtime: CliRuntime): Command {
  const github = attachCommandDescriptor(
    configureRuntimeCommand(new Command("github"), runtime),
    "github",
  );

  addCompactGlobalFlags(github);

  github.addCommand(createListCommand(runtime));
  github.addCommand(createConnectCommand(runtime));
  github.addCommand(createInstallCommand(runtime));

  return github;
}

function createListCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("list"), runtime),
    "github.list",
  );

  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<GithubListResult>(
      runtime,
      "github.list",
      options as Record<string, unknown>,
      (context) => runGithubList(context),
      {
        renderHuman: (context, descriptor, result) =>
          renderGithubList(context, descriptor, result),
        renderJson: (result) => serializeGithubList(result),
      },
    );
  });

  return command;
}

function createConnectCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("connect"), runtime),
    "github.connect",
  );

  command.argument(
    "[account]",
    "GitHub account login or numeric installation id",
  );
  addGlobalFlags(command);

  command.action(async (account: string | undefined, options) => {
    await runCommand<GithubConnectResult>(
      runtime,
      "github.connect",
      options as Record<string, unknown>,
      (context) => runGithubConnect(context, account),
      {
        renderHuman: (context, descriptor, result) =>
          renderGithubConnect(context, descriptor, result),
        renderJson: (result) => serializeGithubConnect(result),
      },
    );
  });

  return command;
}

function createInstallCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("install"), runtime),
    "github.install",
  );

  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<GithubInstallResult>(
      runtime,
      "github.install",
      options as Record<string, unknown>,
      (context) => runGithubInstall(context),
      {
        renderHuman: (context, descriptor, result) =>
          renderGithubInstall(context, descriptor, result),
        renderJson: (result) => serializeGithubInstall(result),
      },
    );
  });

  return command;
}
