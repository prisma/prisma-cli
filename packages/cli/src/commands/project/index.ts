import { Command, Option } from "commander";

import {
  runProjectCreate,
  runProjectLink,
  runProjectList,
  runProjectRemove,
  runProjectRename,
  runProjectShow,
  runProjectTransfer,
} from "../../controllers/project";
import {
  renderProjectList,
  renderProjectRemove,
  renderProjectRename,
  renderProjectSetup,
  renderProjectShow,
  renderProjectTransfer,
  serializeProjectList,
  serializeProjectRemove,
  serializeProjectRename,
  serializeProjectSetup,
  serializeProjectShow,
  serializeProjectTransfer,
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
  ProjectRemoveResult,
  ProjectRenameResult,
  ProjectSetupResult,
  ProjectShowResult,
  ProjectTransferResult,
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
  project.addCommand(createProjectRenameCommand(runtime));
  project.addCommand(createProjectRemoveCommand(runtime));
  project.addCommand(createProjectTransferCommand(runtime));
  project.addCommand(createEnvCommand(runtime));

  return project;
}

function createProjectRenameCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("rename"), runtime),
    "project.rename",
  );

  command
    .argument("<name>", "New project name")
    .addOption(new Option("--project <id-or-name>", "Project id or name"));
  addGlobalFlags(command);

  command.action(async (name: string, options) => {
    const projectRef = (options as { project?: string }).project;

    await runCommand<ProjectRenameResult>(
      runtime,
      "project.rename",
      options as Record<string, unknown>,
      (context) => runProjectRename(context, name, { project: projectRef }),
      {
        renderHuman: (context, descriptor, result) =>
          renderProjectRename(context, descriptor, result),
        renderJson: (result) => serializeProjectRename(result),
      },
    );
  });

  return command;
}

function createProjectRemoveCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("remove"), runtime),
    "project.remove",
  );

  command
    .argument("<project>", "Project id or name")
    .addOption(
      new Option(
        "--confirm <project-id>",
        "Exact project id required to remove",
      ),
    );
  addGlobalFlags(command);

  command.action(async (projectRef: string, options) => {
    const confirm = (options as { confirm?: string }).confirm;

    await runCommand<ProjectRemoveResult>(
      runtime,
      "project.remove",
      options as Record<string, unknown>,
      (context) => runProjectRemove(context, projectRef, { confirm }),
      {
        renderHuman: (context, descriptor, result) =>
          renderProjectRemove(context, descriptor, result),
        renderJson: (result) => serializeProjectRemove(result),
      },
    );
  });

  return command;
}

function createProjectTransferCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("transfer"), runtime),
    "project.transfer",
  );

  command
    .argument("<project>", "Project id or name")
    .addOption(
      new Option(
        "--to-workspace <id-or-name>",
        "Locally authenticated workspace to receive the project",
      ),
    )
    .addOption(
      new Option(
        "--recipient-token <token>",
        "Access token for the receiving workspace",
      ),
    )
    .addOption(
      new Option(
        "--confirm <project-id>",
        "Exact project id required to transfer",
      ),
    );
  addGlobalFlags(command);

  command.action(async (projectRef: string, options) => {
    const toWorkspace = (options as { toWorkspace?: string }).toWorkspace;
    const recipientToken = (options as { recipientToken?: string })
      .recipientToken;
    const confirm = (options as { confirm?: string }).confirm;

    await runCommand<ProjectTransferResult>(
      runtime,
      "project.transfer",
      options as Record<string, unknown>,
      (context) =>
        runProjectTransfer(context, projectRef, {
          toWorkspace,
          recipientToken,
          confirm,
        }),
      {
        renderHuman: (context, descriptor, result) =>
          renderProjectTransfer(context, descriptor, result),
        renderJson: (result) => serializeProjectTransfer(result),
      },
    );
  });

  return command;
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
