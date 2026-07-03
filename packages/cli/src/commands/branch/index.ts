import { Command, Option } from "commander";

import { runBranchList, runBranchRemove } from "../../controllers/branch";
import {
  renderBranchList,
  renderBranchRemove,
  serializeBranchList,
  serializeBranchRemove,
} from "../../presenters/branch";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { runCommand } from "../../shell/command-runner";
import {
  addCompactGlobalFlags,
  addGlobalFlags,
} from "../../shell/global-flags";
import { type CliRuntime, configureRuntimeCommand } from "../../shell/runtime";
import type { BranchListResult, BranchRemoveResult } from "../../types/branch";

export function createBranchCommand(runtime: CliRuntime): Command {
  const branch = attachCommandDescriptor(
    configureRuntimeCommand(new Command("branch"), runtime),
    "branch",
  );

  addCompactGlobalFlags(branch);

  branch.addCommand(createBranchListCommand(runtime));
  branch.addCommand(createBranchRemoveCommand(runtime));

  return branch;
}

function createBranchRemoveCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("remove"), runtime),
    "branch.remove",
  );

  command
    .argument("<branch>", "Branch id or git name")
    .addOption(new Option("--project <id-or-name>", "Project id or name"))
    .addOption(
      new Option("--confirm <branch-id>", "Exact branch id required to remove"),
    );
  addGlobalFlags(command);

  command.action(async (branchRef: string, options) => {
    const projectRef = (options as { project?: string }).project;
    const confirm = (options as { confirm?: string }).confirm;

    await runCommand<BranchRemoveResult>(
      runtime,
      "branch.remove",
      options as Record<string, unknown>,
      (context) => runBranchRemove(context, branchRef, { projectRef, confirm }),
      {
        renderHuman: (context, descriptor, result) =>
          renderBranchRemove(context, descriptor, result),
        renderJson: (result) => serializeBranchRemove(result),
      },
    );
  });

  return command;
}

function createBranchListCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("list"), runtime),
    "branch.list",
  );

  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<BranchListResult>(
      runtime,
      "branch.list",
      options as Record<string, unknown>,
      (context) => runBranchList(context),
      {
        renderHuman: (context, descriptor, result) =>
          renderBranchList(context, descriptor, result),
        renderJson: (result) => serializeBranchList(result),
      },
    );
  });

  return command;
}
