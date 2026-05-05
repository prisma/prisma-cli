import { Command } from "commander";

import { runBranchList, runBranchShow, runBranchUse } from "../../controllers/branch";
import { renderBranchList, renderBranchShow, renderBranchUse, serializeBranchList, serializeBranchShow } from "../../presenters/branch";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { addGlobalFlags } from "../../shell/global-flags";
import { runCommand } from "../../shell/command-runner";
import { configureRuntimeCommand, type CliRuntime } from "../../shell/runtime";
import type { BranchListResult, BranchShowResult } from "../../types/branch";

export function createBranchCommand(runtime: CliRuntime): Command {
  const branch = attachCommandDescriptor(configureRuntimeCommand(new Command("branch"), runtime), "branch");

  branch.addCommand(createBranchListCommand(runtime));
  branch.addCommand(createBranchShowCommand(runtime));
  branch.addCommand(createBranchUseCommand(runtime));

  return branch;
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

function createBranchShowCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(configureRuntimeCommand(new Command("show"), runtime), "branch.show");

  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<BranchShowResult>(
      runtime,
      "branch.show",
      options as Record<string, unknown>,
      (context) => runBranchShow(context),
      {
        renderHuman: (context, descriptor, result) => renderBranchShow(context, descriptor, result),
        renderJson: (result) => serializeBranchShow(result),
      },
    );
  });

  return command;
}

function createBranchUseCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(configureRuntimeCommand(new Command("use"), runtime), "branch.use");

  command.argument("[name]", "Branch name");
  addGlobalFlags(command);

  command.action(async (branchName: string | undefined, options) => {
    await runCommand<BranchShowResult>(
      runtime,
      "branch.use",
      options as Record<string, unknown>,
      (context) => runBranchUse(context, branchName),
      {
        renderHuman: (context, descriptor, result) => renderBranchUse(context, descriptor, result),
        renderJson: (result) => serializeBranchShow(result),
      },
    );
  });

  return command;
}
