import { Command, Option } from "commander";

import {
  type AgentInstallOptions,
  type AgentStatusOptions,
  runAgentInstall,
  runAgentStatus,
} from "../../controllers/agent";
import {
  renderAgentInstall,
  renderAgentStatus,
  serializeAgentInstall,
  serializeAgentStatus,
} from "../../presenters/agent";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { runCommand } from "../../shell/command-runner";
import {
  addCompactGlobalFlags,
  addGlobalFlags,
} from "../../shell/global-flags";
import { type CliRuntime, configureRuntimeCommand } from "../../shell/runtime";
import type { AgentInstallResult, AgentStatusResult } from "../../types/agent";

export function createAgentCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("agent"), runtime),
    "agent",
  );

  addCompactGlobalFlags(command);

  command.addCommand(createAgentInstallCommand(runtime));
  command.addCommand(createAgentUpdateCommand(runtime));
  command.addCommand(createAgentStatusCommand(runtime));

  return command;
}

function createAgentInstallCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("install"), runtime),
    "agent.install",
  );

  addAgentInstallOptions(command);

  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<AgentInstallResult>(
      runtime,
      "agent.install",
      options as Record<string, unknown>,
      (context) =>
        runAgentInstall(context, options as AgentInstallOptions, "install"),
      {
        renderHuman: (context, descriptor, result) =>
          renderAgentInstall(context, descriptor, result),
        renderJson: (result) => serializeAgentInstall(result),
      },
    );
  });

  return command;
}

function createAgentUpdateCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("update"), runtime),
    "agent.update",
  );

  addAgentInstallOptions(command);
  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<AgentInstallResult>(
      runtime,
      "agent.update",
      options as Record<string, unknown>,
      (context) =>
        runAgentInstall(context, options as AgentInstallOptions, "update"),
      {
        renderHuman: (context, descriptor, result) =>
          renderAgentInstall(context, descriptor, result),
        renderJson: (result) => serializeAgentInstall(result),
      },
    );
  });

  return command;
}

function createAgentStatusCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("status"), runtime),
    "agent.status",
  );

  command.addOption(
    new Option(
      "--global",
      "Check globally installed Prisma skills instead of project skills",
    ),
  );
  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<AgentStatusResult>(
      runtime,
      "agent.status",
      options as Record<string, unknown>,
      (context) => runAgentStatus(context, options as AgentStatusOptions),
      {
        renderHuman: (context, descriptor, result) =>
          renderAgentStatus(context, descriptor, result),
        renderJson: (result) => serializeAgentStatus(result),
      },
    );
  });

  return command;
}

function addAgentInstallOptions(command: Command): void {
  command
    .addOption(
      new Option(
        "--agent <agent>",
        "Agent target for Prisma skills; repeat for multiple agents",
      ).argParser(collectValues),
    )
    .addOption(
      new Option(
        "--all-agents",
        "Install Prisma skills for every agent supported by the skills CLI",
      ),
    )
    .addOption(
      new Option(
        "--skill <skill>",
        "Prisma skill to install; repeat for multiple skills",
      ).argParser(collectValues),
    )
    .addOption(
      new Option(
        "--global",
        "Install skills into the user directory instead of the project",
      ),
    )
    .addOption(
      new Option(
        "--copy",
        "Ask the skills CLI to copy files instead of symlinking them",
      ),
    )
    .addOption(new Option("--dry-run", "Show changes without writing files"));
}

function collectValues(value: string, previous: string[] | undefined) {
  return [...(previous ?? []), value];
}
