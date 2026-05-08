import { Command, Option } from "commander";

import { runAppEnvList, runAppEnvSet, runAppEnvUnset } from "../../controllers/app-env";
import {
  renderAppEnvList,
  renderAppEnvSet,
  renderAppEnvUnset,
  serializeAppEnvList,
  serializeAppEnvSet,
  serializeAppEnvUnset,
} from "../../presenters/app-env";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { runCommand } from "../../shell/command-runner";
import { addGlobalFlags } from "../../shell/global-flags";
import { configureRuntimeCommand, type CliRuntime } from "../../shell/runtime";
import type {
  AppEnvListResult,
  AppEnvSetResult,
  AppEnvUnsetResult,
} from "../../types/app-env";

export function createEnvCommand(runtime: CliRuntime): Command {
  const env = attachCommandDescriptor(
    configureRuntimeCommand(new Command("env"), runtime),
    "app.env",
  );

  env.description("Manage environment variables for the linked project.");
  env.addCommand(createEnvSetCommand(runtime));
  env.addCommand(createEnvListCommand(runtime));
  env.addCommand(createEnvUnsetCommand(runtime));

  return env;
}

function createEnvSetCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("set"), runtime),
    "app.env.set",
  );

  command
    .argument("<assignment>", "Variable assignment in KEY=VALUE form")
    .addOption(
      new Option(
        "--class <class>",
        "Project template scope (production or preview); mutually exclusive with --branch",
      ).choices(["production", "preview"]),
    )
    .addOption(
      new Option(
        "--branch <name>",
        "Branch override scope; mutually exclusive with --class",
      ),
    );
  addGlobalFlags(command);

  command.action(async (assignment: string, options) => {
    const className = (options as { class?: string }).class;
    const branchName = (options as { branch?: string }).branch;

    await runCommand<AppEnvSetResult>(
      runtime,
      "app.env.set",
      options as Record<string, unknown>,
      (context) => runAppEnvSet(context, assignment, { className, branchName }),
      {
        renderHuman: (context, descriptor, result) => renderAppEnvSet(context, descriptor, result),
        renderJson: (result) => serializeAppEnvSet(result),
      },
    );
  });

  return command;
}

function createEnvListCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("list"), runtime),
    "app.env.list",
  );

  command
    .addOption(
      new Option(
        "--class <class>",
        "Project template scope; mutually exclusive with --branch",
      ).choices(["production", "preview"]),
    )
    .addOption(
      new Option(
        "--branch <name>",
        "Branch override scope; mutually exclusive with --class",
      ),
    );
  addGlobalFlags(command);

  command.action(async (options) => {
    const className = (options as { class?: string }).class;
    const branchName = (options as { branch?: string }).branch;

    await runCommand<AppEnvListResult>(
      runtime,
      "app.env.list",
      options as Record<string, unknown>,
      (context) => runAppEnvList(context, { className, branchName }),
      {
        renderHuman: (context, descriptor, result) => renderAppEnvList(context, descriptor, result),
        renderJson: (result) => serializeAppEnvList(result),
      },
    );
  });

  return command;
}

function createEnvUnsetCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("unset"), runtime),
    "app.env.unset",
  );

  command
    .argument("<key>", "Variable key to remove")
    .addOption(
      new Option(
        "--class <class>",
        "Project template scope; mutually exclusive with --branch",
      ).choices(["production", "preview"]),
    )
    .addOption(
      new Option(
        "--branch <name>",
        "Branch override scope; mutually exclusive with --class",
      ),
    );
  addGlobalFlags(command);

  command.action(async (key: string, options) => {
    const className = (options as { class?: string }).class;
    const branchName = (options as { branch?: string }).branch;

    await runCommand<AppEnvUnsetResult>(
      runtime,
      "app.env.unset",
      options as Record<string, unknown>,
      (context) => runAppEnvUnset(context, key, { className, branchName }),
      {
        renderHuman: (context, descriptor, result) => renderAppEnvUnset(context, descriptor, result),
        renderJson: (result) => serializeAppEnvUnset(result),
      },
    );
  });

  return command;
}
