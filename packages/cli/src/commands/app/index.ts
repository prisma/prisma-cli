import { Command, Option } from "commander";

import {
  runAppBuild,
  runAppDeploy,
  runAppListEnv,
  runAppListDeploys,
  runAppLogs,
  runAppOpen,
  runAppPromote,
  runAppRemove,
  runAppRollback,
  runAppShow,
  runAppRun,
  runAppShowDeploy,
  runAppUpdateEnv,
} from "../../controllers/app";
import {
  renderAppBuild,
  renderAppDeploy,
  renderAppListEnv,
  renderAppListDeploys,
  renderAppOpen,
  renderAppPromote,
  renderAppRemove,
  renderAppRollback,
  renderAppShow,
  renderAppRun,
  renderAppShowDeploy,
  renderAppUpdateEnv,
  serializeAppBuild,
  serializeAppDeploy,
  serializeAppListEnv,
  serializeAppListDeploys,
  serializeAppOpen,
  serializeAppPromote,
  serializeAppRemove,
  serializeAppRollback,
  serializeAppShow,
  serializeAppRun,
  serializeAppShowDeploy,
  serializeAppUpdateEnv,
} from "../../presenters/app";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { addCompactGlobalFlags, addGlobalFlags } from "../../shell/global-flags";
import { runCommand, runStreamingCommand } from "../../shell/command-runner";
import { configureRuntimeCommand, type CliRuntime } from "../../shell/runtime";
import { PREVIEW_BUILD_TYPES } from "../../lib/app/preview-build";
import type {
  AppBuildResult,
  AppDeployResult,
  AppListEnvResult,
  AppListDeploysResult,
  AppOpenResult,
  AppPromoteResult,
  AppRemoveResult,
  AppRollbackResult,
  AppShowResult,
  AppRunResult,
  AppShowDeployResult,
  AppUpdateEnvResult,
} from "../../types/app";

export function createAppCommand(runtime: CliRuntime): Command {
  const app = attachCommandDescriptor(configureRuntimeCommand(new Command("app"), runtime), "app");

  addCompactGlobalFlags(app);

  app.addCommand(createBuildCommand(runtime));
  app.addCommand(createRunCommand(runtime));
  app.addCommand(createDeployCommand(runtime));
  app.addCommand(createUpdateEnvCommand(runtime));
  app.addCommand(createListEnvCommand(runtime));
  app.addCommand(createShowCommand(runtime));
  app.addCommand(createOpenCommand(runtime));
  app.addCommand(createLogsCommand(runtime));
  app.addCommand(createListDeploysCommand(runtime));
  app.addCommand(createShowDeployCommand(runtime));
  app.addCommand(createPromoteCommand(runtime));
  app.addCommand(createRollbackCommand(runtime));
  app.addCommand(createRemoveCommand(runtime));

  return app;
}

function createBuildCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("build"), runtime),
    "app.build",
  );

  command
    .addOption(new Option("--entry <path>", "Entrypoint path for Bun or auto builds"))
    .addOption(
      new Option("--build-type <type>", "Local build type")
        .choices([...PREVIEW_BUILD_TYPES])
        .default("auto"),
    );
  addGlobalFlags(command);

  command.action(async (options) => {
    const entry = (options as { entry?: string }).entry;
    const buildType = (options as { buildType?: string }).buildType;

    await runCommand<AppBuildResult>(
      runtime,
      "app.build",
      options as Record<string, unknown>,
      (context) => runAppBuild(context, entry, buildType),
      {
        renderHuman: (context, descriptor, result) => renderAppBuild(context, descriptor, result),
        renderJson: (result) => serializeAppBuild(result),
      },
    );
  });

  return command;
}

function createRunCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("run"), runtime),
    "app.run",
  );

  command
    .addOption(new Option("--entry <path>", "Entrypoint path for Bun or auto runs"))
    .addOption(
      new Option("--build-type <type>", "Local framework type")
        .choices(["auto", "bun", "nextjs"])
        .default("auto"),
    )
    .addOption(new Option("--port <port>", "Local port"));
  addGlobalFlags(command);

  command.action(async (options) => {
    const entry = (options as { entry?: string }).entry;
    const buildType = (options as { buildType?: string }).buildType;
    const port = (options as { port?: string }).port;

    await runCommand<AppRunResult>(
      runtime,
      "app.run",
      options as Record<string, unknown>,
      (context) => runAppRun(context, entry, buildType, port),
      {
        renderHuman: (context, descriptor, result) => renderAppRun(context, descriptor, result),
        renderJson: (result) => serializeAppRun(result),
      },
    );
  });

  return command;
}

function createDeployCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("deploy"), runtime),
    "app.deploy",
  );

  command
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"))
    .addOption(new Option("--branch <name>", "Branch name"))
    .addOption(
      new Option("--framework <name>", "Framework to deploy")
        .choices(["nextjs", "hono", "tanstack-start"]),
    )
    .addOption(new Option("--entry <path>", "Entrypoint path for Bun or auto deploys"))
    .addOption(
      new Option("--build-type <type>", "Legacy deploy build type")
        .choices([...PREVIEW_BUILD_TYPES])
        .default("auto")
        .hideHelp(),
    )
    .addOption(new Option("--http-port <port>", "HTTP port override for the deployed app"))
    .addOption(
      new Option("--env <name=value>", "Environment variable")
        .argParser(collectRepeatableValues),
    )
    .addOption(new Option("--prod", "Confirm intent to deploy to production"));
  addGlobalFlags(command);

  command.action(async (options) => {
    const appName = (options as { app?: string }).app;
    const entry = (options as { entry?: string }).entry;
    const buildType = (options as { buildType?: string }).buildType;
    const branchName = (options as { branch?: string }).branch;
    const framework = (options as { framework?: string }).framework;
    const httpPort = (options as { httpPort?: string }).httpPort;
    const envAssignments = (options as { env?: string[] }).env;
    const projectRef = (options as { project?: string }).project;
    const prod = (options as { prod?: boolean }).prod;

    await runCommand<AppDeployResult>(
      runtime,
      "app.deploy",
      options as Record<string, unknown>,
      (context) => runAppDeploy(context, appName, {
        projectRef,
        branchName,
        entrypoint: entry,
        buildType,
        framework,
        httpPort,
        envAssignments,
        prod: prod === true,
      }),
      {
        renderHuman: (context, descriptor, result) => renderAppDeploy(context, descriptor, result),
        renderJson: (result) => serializeAppDeploy(result),
      },
    );
  });

  return command;
}

function createUpdateEnvCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("update-env"), runtime),
    "app.update-env",
  );

  command
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"))
    .addOption(
      new Option("--env <name=value>", "Environment variable")
        .argParser(collectRepeatableValues),
    );
  addGlobalFlags(command);

  command.action(async (options) => {
    const appName = (options as { app?: string }).app;
    const envAssignments = (options as { env?: string[] }).env;
    const projectRef = (options as { project?: string }).project;

    await runCommand<AppUpdateEnvResult>(
      runtime,
      "app.update-env",
      options as Record<string, unknown>,
      (context) => runAppUpdateEnv(context, appName, envAssignments, projectRef),
      {
        renderHuman: (context, descriptor, result) => renderAppUpdateEnv(context, descriptor, result),
        renderJson: (result) => serializeAppUpdateEnv(result),
      },
    );
  });

  return command;
}

function createListEnvCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("list-env"), runtime),
    "app.list-env",
  );

  command
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"));
  addGlobalFlags(command);

  command.action(async (options) => {
    const appName = (options as { app?: string }).app;
    const projectRef = (options as { project?: string }).project;

    await runCommand<AppListEnvResult>(
      runtime,
      "app.list-env",
      options as Record<string, unknown>,
      (context) => runAppListEnv(context, appName, projectRef),
      {
        renderHuman: (context, descriptor, result) => renderAppListEnv(context, descriptor, result),
        renderJson: (result) => serializeAppListEnv(result),
      },
    );
  });

  return command;
}

function createShowCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("show"), runtime),
    "app.show",
  );

  command
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"));
  addGlobalFlags(command);

  command.action(async (options) => {
    const appName = (options as { app?: string }).app;
    const projectRef = (options as { project?: string }).project;

    await runCommand<AppShowResult>(
      runtime,
      "app.show",
      options as Record<string, unknown>,
      (context) => runAppShow(context, appName, projectRef),
      {
        renderHuman: (context, descriptor, result) => renderAppShow(context, descriptor, result),
        renderJson: (result) => serializeAppShow(result),
      },
    );
  });

  return command;
}

function createOpenCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("open"), runtime),
    "app.open",
  );

  command
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"));
  addGlobalFlags(command);

  command.action(async (options) => {
    const appName = (options as { app?: string }).app;
    const projectRef = (options as { project?: string }).project;

    await runCommand<AppOpenResult>(
      runtime,
      "app.open",
      options as Record<string, unknown>,
      (context) => runAppOpen(context, appName, projectRef),
      {
        renderHuman: (context, descriptor, result) => renderAppOpen(context, descriptor, result),
        renderJson: (result) => serializeAppOpen(result),
      },
    );
  });

  return command;
}

function createLogsCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("logs"), runtime),
    "app.logs",
  );

  command
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"))
    .addOption(new Option("--deployment <id>", "Deployment id"));
  addGlobalFlags(command);

  command.action(async (options) => {
    const appName = (options as { app?: string }).app;
    const deploymentId = (options as { deployment?: string }).deployment;
    const projectRef = (options as { project?: string }).project;

    await runStreamingCommand(
      runtime,
      "app.logs",
      options as Record<string, unknown>,
      (context) => runAppLogs(context, appName, deploymentId, projectRef),
    );
  });

  return command;
}

function collectRepeatableValues(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

function createListDeploysCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("list-deploys"), runtime),
    "app.list-deploys",
  );

  command
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"));
  addGlobalFlags(command);

  command.action(async (options) => {
    const appName = (options as { app?: string }).app;
    const projectRef = (options as { project?: string }).project;

    await runCommand<AppListDeploysResult>(
      runtime,
      "app.list-deploys",
      options as Record<string, unknown>,
      (context) => runAppListDeploys(context, appName, projectRef),
      {
        renderHuman: (context, descriptor, result) => renderAppListDeploys(context, descriptor, result),
        renderJson: (result) => serializeAppListDeploys(result),
      },
    );
  });

  return command;
}

function createShowDeployCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("show-deploy"), runtime),
    "app.show-deploy",
  );

  command.argument("<deployment>", "Deployment id");
  addGlobalFlags(command);

  command.action(async (deploymentId: string, options) => {
    await runCommand<AppShowDeployResult>(
      runtime,
      "app.show-deploy",
      options as Record<string, unknown>,
      (context) => runAppShowDeploy(context, deploymentId),
      {
        renderHuman: (context, descriptor, result) => renderAppShowDeploy(context, descriptor, result),
        renderJson: (result) => serializeAppShowDeploy(result),
      },
    );
  });

  return command;
}

function createPromoteCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("promote"), runtime),
    "app.promote",
  );

  command.argument("<deployment>", "Deployment id");
  command
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"));
  addGlobalFlags(command);

  command.action(async (deploymentId: string, options) => {
    const appName = (options as { app?: string }).app;
    const projectRef = (options as { project?: string }).project;

    await runCommand<AppPromoteResult>(
      runtime,
      "app.promote",
      options as Record<string, unknown>,
      (context) => runAppPromote(context, deploymentId, appName, projectRef),
      {
        renderHuman: (context, descriptor, result) => renderAppPromote(context, descriptor, result),
        renderJson: (result) => serializeAppPromote(result),
      },
    );
  });

  return command;
}

function createRollbackCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("rollback"), runtime),
    "app.rollback",
  );

  command
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"))
    .addOption(new Option("--to <deployment>", "Deployment id"));
  addGlobalFlags(command);

  command.action(async (options) => {
    const appName = (options as { app?: string }).app;
    const deploymentId = (options as { to?: string }).to;
    const projectRef = (options as { project?: string }).project;

    await runCommand<AppRollbackResult>(
      runtime,
      "app.rollback",
      options as Record<string, unknown>,
      (context) => runAppRollback(context, appName, deploymentId, projectRef),
      {
        renderHuman: (context, descriptor, result) => renderAppRollback(context, descriptor, result),
        renderJson: (result) => serializeAppRollback(result),
      },
    );
  });

  return command;
}

function createRemoveCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("remove"), runtime),
    "app.remove",
  );

  command
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"));
  addGlobalFlags(command);

  command.action(async (options) => {
    const appName = (options as { app?: string }).app;
    const projectRef = (options as { project?: string }).project;

    await runCommand<AppRemoveResult>(
      runtime,
      "app.remove",
      options as Record<string, unknown>,
      (context) => runAppRemove(context, appName, projectRef),
      {
        renderHuman: (context, descriptor, result) => renderAppRemove(context, descriptor, result),
        renderJson: (result) => serializeAppRemove(result),
      },
    );
  });

  return command;
}
