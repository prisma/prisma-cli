import { Command } from "commander";

import { runBranchList } from "../../controllers/branch";
import { renderBranchList, serializeBranchList } from "../../presenters/branch";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { runCommand } from "../../shell/command-runner";
import {
  addCompactGlobalFlags,
  addGlobalFlags,
} from "../../shell/global-flags";
import { type CliRuntime, configureRuntimeCommand } from "../../shell/runtime";
import type { BranchListResult } from "../../types/branch";

export function createBranchCommand(runtime: CliRuntime): Command {
  const branch = attachCommandDescriptor(
    configureRuntimeCommand(new Command("branch"), runtime),
    "branch",
  );

  addCompactGlobalFlags(branch);

  branch.addCommand(createBranchListCommand(runtime));

  return branch;
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
