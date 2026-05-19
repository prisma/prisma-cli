import { Command } from "commander";

import {
  runProjectConnectRepo,
  runProjectDisconnectRepo,
  runProjectList,
  runProjectShow,
} from "../../controllers/project";
import {
  renderProjectConnectRepo,
  renderProjectDisconnectRepo,
  renderProjectList,
  renderProjectShow,
  serializeProjectList,
  serializeProjectShow,
} from "../../presenters/project";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { addCompactGlobalFlags, addGlobalFlags } from "../../shell/global-flags";
import { runCommand } from "../../shell/command-runner";
import { configureRuntimeCommand, type CliRuntime } from "../../shell/runtime";
import type {
  ProjectListResult,
  ProjectRepositoryConnectionResult,
  ProjectShowResult,
} from "../../types/project";
import { createEnvCommand } from "../env";

export function createProjectCommand(runtime: CliRuntime): Command {
  const project = attachCommandDescriptor(configureRuntimeCommand(new Command("project"), runtime), "project");

  addCompactGlobalFlags(project);

  project.addCommand(createProjectListCommand(runtime));
  project.addCommand(createProjectShowCommand(runtime));
  project.addCommand(createProjectConnectRepoCommand(runtime));
  project.addCommand(createProjectDisconnectRepoCommand(runtime));
  project.addCommand(createEnvCommand(runtime));

  return project;
}

function createProjectListCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(configureRuntimeCommand(new Command("list"), runtime), "project.list");

  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<ProjectListResult>(
      runtime,
      "project.list",
      options as Record<string, unknown>,
      (context) => runProjectList(context),
      {
        renderHuman: (context, descriptor, result) => renderProjectList(context, descriptor, result),
        renderJson: (result) => serializeProjectList(result),
      },
    );
  });

  return command;
}

function createProjectShowCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(configureRuntimeCommand(new Command("show"), runtime), "project.show");

  command.option("--project <id-or-name>", "Project id or name");
  addGlobalFlags(command);

  command.action(async (options) => {
    const projectRef = (options as { project?: string }).project;

    await runCommand<ProjectShowResult>(
      runtime,
      "project.show",
      options as Record<string, unknown>,
      (context) => runProjectShow(context, projectRef),
      {
        renderHuman: (context, descriptor, result) => renderProjectShow(context, descriptor, result),
        renderJson: (result) => serializeProjectShow(result),
      },
    );
  });

  return command;
}

function createProjectConnectRepoCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(configureRuntimeCommand(new Command("connect-repo"), runtime), "project.connect-repo");

  command.argument("[git-url]", "GitHub repository URL");
  command.option("--project <id-or-name>", "Project id or name");
  addGlobalFlags(command);

  command.action(async (gitUrl: string | undefined, options) => {
    await runCommand<ProjectRepositoryConnectionResult>(
      runtime,
      "project.connect-repo",
      options as Record<string, unknown>,
      (context) => runProjectConnectRepo(context, gitUrl, {
        project: typeof options.project === "string" ? options.project : undefined,
      }),
      {
        renderHuman: (context, descriptor, result) => renderProjectConnectRepo(context, descriptor, result),
      },
    );
  });

  return command;
}

function createProjectDisconnectRepoCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(configureRuntimeCommand(new Command("disconnect-repo"), runtime), "project.disconnect-repo");

  command.option("--project <id-or-name>", "Project id or name");
  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<ProjectRepositoryConnectionResult>(
      runtime,
      "project.disconnect-repo",
      options as Record<string, unknown>,
      (context) => runProjectDisconnectRepo(context, {
        project: typeof options.project === "string" ? options.project : undefined,
      }),
      {
        renderHuman: (context, descriptor, result) => renderProjectDisconnectRepo(context, descriptor, result),
      },
    );
  });

  return command;
}
