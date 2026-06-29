import { Command, Option } from "commander";
import { runBuildLogs } from "../../controllers/build";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { runStreamingCommand } from "../../shell/command-runner";
import {
  addCompactGlobalFlags,
  addGlobalFlags,
} from "../../shell/global-flags";
import { type CliRuntime, configureRuntimeCommand } from "../../shell/runtime";

export function createBuildCommand(runtime: CliRuntime): Command {
  const build = attachCommandDescriptor(
    configureRuntimeCommand(new Command("build"), runtime),
    "build",
  );

  addCompactGlobalFlags(build);

  build.addCommand(createLogsCommand(runtime));

  return build;
}

function createLogsCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("logs"), runtime),
    "build.logs",
  );

  command
    .argument("<buildId>", "Build id from a git-push or Console deploy")
    .addOption(
      new Option(
        "--follow",
        "Keep the connection open and stream new logs as the build runs",
      ),
    )
    .addOption(
      new Option("--cursor <cursor>", "Resume from a prior terminal cursor"),
    );
  addGlobalFlags(command);

  command.action(async (buildId: string, options) => {
    const follow = (options as { follow?: boolean }).follow;
    const cursor = (options as { cursor?: string }).cursor;

    await runStreamingCommand(
      runtime,
      "build.logs",
      options as Record<string, unknown>,
      (context) => runBuildLogs(context, buildId, { follow, cursor }),
    );
  });

  return command;
}
