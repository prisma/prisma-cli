import { Command } from "commander";

import { runVersion } from "../../controllers/version";
import { renderVersionSuccess } from "../../presenters/version";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { runCommand } from "../../shell/command-runner";
import { addGlobalFlags } from "../../shell/global-flags";
import { type CliRuntime, configureRuntimeCommand } from "../../shell/runtime";
import type { VersionResult } from "../../types/version";

export function createVersionCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("version"), runtime),
    "version",
  );

  addGlobalFlags(command);

  command.action(async (options) => {
    await runCommand<VersionResult>(
      runtime,
      "version",
      options as Record<string, unknown>,
      (context) => runVersion(context),
      {
        renderHuman: (context, descriptor, result) =>
          renderVersionSuccess(context, descriptor, result),
      },
    );
  });

  return command;
}
