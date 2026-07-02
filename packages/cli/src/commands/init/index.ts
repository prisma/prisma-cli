import { Command, Option } from "commander";

import { runInit } from "../../controllers/init";
import { renderInit, serializeInit } from "../../presenters/init";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { runCommand } from "../../shell/command-runner";
import { addGlobalFlags } from "../../shell/global-flags";
import { type CliRuntime, configureRuntimeCommand } from "../../shell/runtime";
import type { InitResult } from "../../types/init";

export function createInitCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("init"), runtime),
    "init",
  );

  command
    .addOption(
      new Option(
        "--framework <framework>",
        "Framework override; detected when omitted",
      ),
    )
    .addOption(
      new Option(
        "--entry <path>",
        "Source entrypoint for entrypoint frameworks (Bun, Hono)",
      ),
    )
    .addOption(new Option("--http-port <port>", "HTTP port the app listens on"))
    .addOption(
      new Option(
        "--region <region>",
        "Region used when deploy creates the app",
      ),
    )
    .addOption(new Option("--name <app-name>", "App name"))
    .addOption(new Option("--link", "Link this directory to a Project"))
    .addOption(new Option("--no-link", "Skip the Project link step"))
    .addOption(
      new Option("--project <id-or-name>", "Project to link this directory to"),
    );
  addGlobalFlags(command);

  command.action(async (options) => {
    const flags = options as {
      framework?: string;
      entry?: string;
      httpPort?: string;
      region?: string;
      name?: string;
      link?: boolean;
      project?: string;
    };

    await runCommand<InitResult>(
      runtime,
      "init",
      options as Record<string, unknown>,
      (context) =>
        runInit(context, {
          framework: flags.framework,
          entry: flags.entry,
          httpPort: flags.httpPort,
          region: flags.region,
          name: flags.name,
          link: flags.link,
          project: flags.project,
        }),
      {
        renderHuman: (context, descriptor, result) =>
          renderInit(context, descriptor, result),
        renderJson: (result) => serializeInit(result),
      },
    );
  });

  return command;
}
