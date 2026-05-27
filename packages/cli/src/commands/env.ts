import { Command, Option } from "commander";

import { runEnvAdd, runEnvList, runEnvRemove, runEnvUpdate } from "../controllers/app-env";
import {
  renderEnvAdd,
  renderEnvList,
  renderEnvRm,
  renderEnvUpdate,
  serializeEnvAdd,
  serializeEnvList,
  serializeEnvRm,
  serializeEnvUpdate,
} from "../presenters/app-env";
import { attachCommandDescriptor } from "../shell/command-meta";
import { runCommand } from "../shell/command-runner";
import { addGlobalFlags } from "../shell/global-flags";
import { configureRuntimeCommand, type CliRuntime } from "../shell/runtime";
import type {
  EnvAddResult,
  EnvListResult,
  EnvRmResult,
  EnvUpdateResult,
} from "../types/app-env";

export function createEnvCommand(runtime: CliRuntime): Command {
  const env = attachCommandDescriptor(
    configureRuntimeCommand(new Command("env"), runtime),
    "project.env",
  );

  env.description("Manage environment variables for the active project");
  env.addCommand(createEnvAddCommand(runtime));
  env.addCommand(createEnvUpdateCommand(runtime));
  env.addCommand(createEnvListCommand(runtime));
  env.addCommand(createEnvRemoveCommand(runtime));

  return env;
}

function createEnvAddCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("add"), runtime),
    "project.env.add",
  );

  command
    .argument("<assignment>", "Variable assignment as KEY=VALUE or KEY from the current environment")
    .addOption(
      new Option(
        "--role <role>",
        "Project template scope (production or preview)",
      ).choices(["production", "preview"]),
    )
    .addOption(new Option("--branch <git-name>", "Preview branch override scope"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"));
  addGlobalFlags(command);

  command.action(async (assignment: string, options) => {
    const roleName = (options as { role?: string }).role;
    const branchName = (options as { branch?: string }).branch;
    const projectRef = (options as { project?: string }).project;

    await runCommand<EnvAddResult>(
      runtime,
      "project.env.add",
      options as Record<string, unknown>,
      (context) => runEnvAdd(context, assignment, { roleName, branchName, projectRef }),
      {
        renderHuman: (context, descriptor, result) => renderEnvAdd(context, descriptor, result),
        renderJson: (result) => serializeEnvAdd(result),
      },
    );
  });

  return command;
}

function createEnvUpdateCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("update"), runtime),
    "project.env.update",
  );

  command
    .argument("<assignment>", "Variable assignment as KEY=VALUE or KEY from the current environment")
    .addOption(
      new Option(
        "--role <role>",
        "Project template scope (production or preview)",
      ).choices(["production", "preview"]),
    )
    .addOption(new Option("--branch <git-name>", "Preview branch override scope"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"));
  addGlobalFlags(command);

  command.action(async (assignment: string, options) => {
    const roleName = (options as { role?: string }).role;
    const branchName = (options as { branch?: string }).branch;
    const projectRef = (options as { project?: string }).project;

    await runCommand<EnvUpdateResult>(
      runtime,
      "project.env.update",
      options as Record<string, unknown>,
      (context) => runEnvUpdate(context, assignment, { roleName, branchName, projectRef }),
      {
        renderHuman: (context, descriptor, result) => renderEnvUpdate(context, descriptor, result),
        renderJson: (result) => serializeEnvUpdate(result),
      },
    );
  });

  return command;
}

function createEnvListCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("list"), runtime),
    "project.env.list",
  );

  command
    .addOption(
      new Option(
        "--role <role>",
        "Project template scope",
      ).choices(["production", "preview"]),
    )
    .addOption(new Option("--branch <git-name>", "Preview branch resolved scope"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"));
  addGlobalFlags(command);

  command.action(async (options) => {
    const roleName = (options as { role?: string }).role;
    const branchName = (options as { branch?: string }).branch;
    const projectRef = (options as { project?: string }).project;

    await runCommand<EnvListResult>(
      runtime,
      "project.env.list",
      options as Record<string, unknown>,
      (context) => runEnvList(context, { roleName, branchName, projectRef }),
      {
        renderHuman: (context, descriptor, result) => renderEnvList(context, descriptor, result),
        renderJson: (result) => serializeEnvList(result),
      },
    );
  });

  return command;
}

function createEnvRemoveCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("remove"), runtime),
    "project.env.remove",
  );

  command
    .alias("rm")
    .argument("<key>", "Variable key to remove")
    .addOption(
      new Option(
        "--role <role>",
        "Project template scope (production or preview)",
      ).choices(["production", "preview"]),
    )
    .addOption(new Option("--branch <git-name>", "Preview branch override scope"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"));
  addGlobalFlags(command);

  command.action(async (key: string, options) => {
    const roleName = (options as { role?: string }).role;
    const branchName = (options as { branch?: string }).branch;
    const projectRef = (options as { project?: string }).project;

    await runCommand<EnvRmResult>(
      runtime,
      "project.env.remove",
      options as Record<string, unknown>,
      (context) => runEnvRemove(context, key, { roleName, branchName, projectRef }),
      {
        renderHuman: (context, descriptor, result) => renderEnvRm(context, descriptor, result),
        renderJson: (result) => serializeEnvRm(result),
      },
    );
  });

  return command;
}
