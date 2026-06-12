import { Command } from "commander";

import {
  runProjectCreate,
  runProjectLink,
  runProjectList,
  runProjectShow,
} from "../../controllers/project";
import {
  renderProjectList,
  renderProjectSetup,
  renderProjectShow,
  serializeProjectList,
  serializeProjectSetup,
  serializeProjectShow,
} from "../../presenters/project";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { runCommand } from "../../shell/command-runner";
import {
  addCompactGlobalFlags,
  addGlobalFlags,
} from "../../shell/global-flags";
import { type CliRuntime, configureRuntimeCommand } from "../../shell/runtime";
import type {
  ProjectListResult,
  ProjectSetupResult,
  ProjectShowResult,
} from "../../types/project";
import { createEnvCommand } from "../env";

export function createProjectCommand(runtime: CliRuntime): Command {
  const project = attachCommandDescriptor(
    configureRuntimeCommand(new Command("project"), runtime),
    "project",
  );

  addCompactGlobalFlags(project);

  project.addCommand(createProjectListCommand(runtime));
  project.addCommand(createProjectShowCommand(runtime));
  project.addCommand(createProjectCreateCommand(runtime));
  project.addCommand(createProjectLinkCommand(runtime));
  project.addCommand(createEnvCommand(runtime));

  return project;
}

function createProjectCreateCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("create"), runtime),
    "project.create",
  );

  command.argument("<name>", "Project name");
  addGlobalFlags(command);

  command.action(async (name, options) => {
    await runCommand<ProjectSetupResult>(
      runtime,
      "project.create",
      options as Record<string, unknown>,
      (context) => runProjectCreate(context, String(name)),
      {
        renderHuman: (context, descriptor, result) =>
          renderProjectSetup(context, descriptor, result),
        renderJson: (result) => serializeProjectSetup(result),
      },
    );
  });

  return command;
}

function createProjectLinkCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("link"), runtime),
    "project.link",
  );

  command.argument("[id-or-name]", "Project id or name");
  addGlobalFlags(command);

  command.action(async (projectRef, options) => {
    await runCommand<ProjectSetupResult>(
      runtime,
      "project.link",
      options as Record<string, unknown>,
      (context) =>
        runProjectLink(
          context,
          typeof projectRef === "string" ? projectRef : undefined,
        ),
      {
        renderHuman: (context, descriptor, result) =>
          renderProjectSetup(context, descriptor, result),
        renderJson: (result) => serializeProjectSetup(result),
      },
    );
  });

  return command;
}

function createProjectListCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("list"), runtime),
    "project.list",
  );

  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<ProjectListResult>(
      runtime,
      "project.list",
      options as Record<string, unknown>,
      (context) => runProjectList(context),
      {
        renderHuman: (context, descriptor, result) =>
          renderProjectList(context, descriptor, result),
        renderJson: (result) => serializeProjectList(result),
      },
    );
  });

  return command;
}

function createProjectShowCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("show"), runtime),
    "project.show",
  );

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
        renderHuman: (context, descriptor, result) =>
          renderProjectShow(context, descriptor, result),
        renderJson: (result) => serializeProjectShow(result),
      },
    );
  });

  return command;
}
