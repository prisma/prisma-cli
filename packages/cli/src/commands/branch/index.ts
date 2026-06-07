import { Command } from "commander";

import { runBranchList, runBranchCreate, runBranchDelete, runBranchRename } from "../../controllers/branch";
import { renderBranchList, renderBranchCreate, renderBranchDelete, renderBranchRename, serializeBranchList, serializeBranchCreate, serializeBranchDelete, serializeBranchRename } from "../../presenters/branch";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { addCompactGlobalFlags, addGlobalFlags } from "../../shell/global-flags";
import { runCommand } from "../../shell/command-runner";
import { configureRuntimeCommand, type CliRuntime } from "../../shell/runtime";
import type { BranchListResult, BranchCreateResult, BranchDeleteResult, BranchRenameResult } from "../../types/branch";

export function createBranchCommand(runtime: CliRuntime): Command {
  const branch = attachCommandDescriptor(configureRuntimeCommand(new Command("branch"), runtime), "branch");

  addCompactGlobalFlags(branch);

  branch.addCommand(createBranchListCommand(runtime));
  branch.addCommand(createBranchCreateCommand(runtime));
  branch.addCommand(createBranchDeleteCommand(runtime));
  branch.addCommand(createBranchRenameCommand(runtime));

  return branch;
}

function createBranchCreateCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(configureRuntimeCommand(new Command("create"), runtime), "branch.create");

  command.argument("<name>", "Branch name");
  addGlobalFlags(command);

  command.action(async (name, options) => {
    await runCommand<BranchCreateResult>(
      runtime,
      "branch.create",
      options as Record<string, unknown>,
      (context) => runBranchCreate(context, String(name)),
      {
        renderHuman: (context, descriptor, result) => renderBranchCreate(context, descriptor, result),
        renderJson: (result) => serializeBranchCreate(result),
      },
    );
  });

  return command;
}

function createBranchDeleteCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(configureRuntimeCommand(new Command("delete"), runtime), "branch.delete");

  command.argument("<name>", "Branch name");
  addGlobalFlags(command);

  command.action(async (name, options) => {
    await runCommand<BranchDeleteResult>(
      runtime,
      "branch.delete",
      options as Record<string, unknown>,
      (context) => runBranchDelete(context, String(name)),
      {
        renderHuman: (context, descriptor, result) => renderBranchDelete(context, descriptor, result),
        renderJson: (result) => serializeBranchDelete(result),
      },
    );
  });

  return command;
}

function createBranchRenameCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(configureRuntimeCommand(new Command("rename"), runtime), "branch.rename");

  command.argument("<old-name>", "Current branch name");
  command.argument("<new-name>", "New branch name");
  addGlobalFlags(command);

  command.action(async (oldName, newName, options) => {
    await runCommand<BranchRenameResult>(
      runtime,
      "branch.rename",
      options as Record<string, unknown>,
      (context) => runBranchRename(context, String(oldName), String(newName)),
      {
        renderHuman: (context, descriptor, result) => renderBranchRename(context, descriptor, result),
        renderJson: (result) => serializeBranchRename(result),
      },
    );
  });

  return command;
}

function createBranchListCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(configureRuntimeCommand(new Command("list"), runtime), "branch.list");

  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<BranchListResult>(
      runtime,
      "branch.list",
      options as Record<string, unknown>,
      (context) => runBranchList(context),
      {
        renderHuman: (context, descriptor, result) => renderBranchList(context, descriptor, result),
        renderJson: (result) => serializeBranchList(result),
      },
    );
  });

  return command;
}
