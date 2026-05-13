import { Command } from "commander";

import { runProjectList, runProjectShow } from "../../controllers/project";
import {
  renderProjectList,
  renderProjectShow,
  serializeProjectList,
  serializeProjectShow,
} from "../../presenters/project";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { addCompactGlobalFlags, addGlobalFlags } from "../../shell/global-flags";
import { runCommand } from "../../shell/command-runner";
import { configureRuntimeCommand, type CliRuntime } from "../../shell/runtime";
import type { ProjectListResult, ProjectShowResult } from "../../types/project";
import { createEnvCommand } from "../env";

export function createProjectCommand(runtime: CliRuntime): Command {
  const project = attachCommandDescriptor(configureRuntimeCommand(new Command("project"), runtime), "project");

  addCompactGlobalFlags(project);

  project.addCommand(createProjectListCommand(runtime));
  project.addCommand(createProjectShowCommand(runtime));
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
