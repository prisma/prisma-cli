import { Command } from "commander";

import { runGitConnect, runGitDisconnect } from "../../controllers/project";
import { renderGitConnect, renderGitDisconnect } from "../../presenters/project";
import { runCommand } from "../../shell/command-runner";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { addCompactGlobalFlags, addGlobalFlags } from "../../shell/global-flags";
import { configureRuntimeCommand, type CliRuntime } from "../../shell/runtime";
import type { ProjectRepositoryConnectionResult } from "../../types/project";

export function createGitCommand(runtime: CliRuntime): Command {
  const git = attachCommandDescriptor(configureRuntimeCommand(new Command("git"), runtime), "git");

  addCompactGlobalFlags(git);

  git.addCommand(createGitConnectCommand(runtime));
  git.addCommand(createGitDisconnectCommand(runtime));

  return git;
}

function createGitConnectCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(configureRuntimeCommand(new Command("connect"), runtime), "git.connect");

  command.argument("[git-url]", "GitHub repository URL");
  command.option("--project <id-or-name>", "Project id or name");
  addGlobalFlags(command);

  command.action(async (gitUrl: string | undefined, options) => {
    await runCommand<ProjectRepositoryConnectionResult>(
      runtime,
      "git.connect",
      options as Record<string, unknown>,
      (context) => runGitConnect(context, gitUrl, {
        project: typeof options.project === "string" ? options.project : undefined,
      }),
      {
        renderHuman: (context, descriptor, result) => renderGitConnect(context, descriptor, result),
      },
    );
  });

  return command;
}

function createGitDisconnectCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(configureRuntimeCommand(new Command("disconnect"), runtime), "git.disconnect");

  command.option("--project <id-or-name>", "Project id or name");
  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<ProjectRepositoryConnectionResult>(
      runtime,
      "git.disconnect",
      options as Record<string, unknown>,
      (context) => runGitDisconnect(context, {
        project: typeof options.project === "string" ? options.project : undefined,
      }),
      {
        renderHuman: (context, descriptor, result) => renderGitDisconnect(context, descriptor, result),
      },
    );
  });

  return command;
}
