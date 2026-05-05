import { Command } from "commander";

import { runProjectLink, runProjectList, runProjectShow } from "../../controllers/project";
import {
  renderProjectLink,
  renderProjectList,
  renderProjectShow,
  serializeProjectList,
} from "../../presenters/project";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { addGlobalFlags } from "../../shell/global-flags";
import { runCommand } from "../../shell/command-runner";
import { configureRuntimeCommand, type CliRuntime } from "../../shell/runtime";
import type { ProjectListResult, ProjectShowResult } from "../../types/project";

export function createProjectCommand(runtime: CliRuntime): Command {
  const project = attachCommandDescriptor(configureRuntimeCommand(new Command("project"), runtime), "project");

  project.addCommand(createProjectListCommand(runtime));
  project.addCommand(createProjectShowCommand(runtime));
  project.addCommand(createProjectLinkCommand(runtime));

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

  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<ProjectShowResult>(
      runtime,
      "project.show",
      options as Record<string, unknown>,
      (context) => runProjectShow(context),
      {
        renderHuman: (context, descriptor, result) => renderProjectShow(context, descriptor, result),
      },
    );
  });

  return command;
}

function createProjectLinkCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(configureRuntimeCommand(new Command("link"), runtime), "project.link");

  command.argument("[project]", "Project id");

  addGlobalFlags(command);

  command.action(async (projectId: string | undefined, options) => {
    await runCommand<ProjectShowResult>(
      runtime,
      "project.link",
      options as Record<string, unknown>,
      (context) => runProjectLink(context, projectId),
      {
        renderHuman: (context, descriptor, result) => renderProjectLink(context, descriptor, result),
      },
    );
  });

  return command;
}
