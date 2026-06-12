import { Command, Option } from "commander";

import {
  runAppBuild,
  runAppDeploy,
  runAppDomainAdd,
  runAppDomainRemove,
  runAppDomainRetry,
  runAppDomainShow,
  runAppDomainWait,
  runAppListDeploys,
  runAppLogs,
  runAppOpen,
  runAppPromote,
  runAppRemove,
  runAppRollback,
  runAppShow,
  runAppRun,
  runAppShowDeploy,
} from "../../controllers/app";
import {
  isAppDeployAllResult,
  renderAppBuild,
  renderAppDeploy,
  renderAppDeployAll,
  renderAppDomainAdd,
  renderAppDomainRemove,
  renderAppDomainRetry,
  renderAppDomainShow,
  renderAppListDeploys,
  renderAppOpen,
  renderAppPromote,
  renderAppRemove,
  renderAppRollback,
  renderAppShow,
  renderAppRun,
  renderAppShowDeploy,
  serializeAppBuild,
  serializeAppDeploy,
  serializeAppDeployAll,
  serializeAppDomainAdd,
  serializeAppDomainRemove,
  serializeAppDomainRetry,
  serializeAppDomainShow,
  serializeAppListDeploys,
  serializeAppOpen,
  serializeAppPromote,
  serializeAppRemove,
  serializeAppRollback,
  serializeAppShow,
  serializeAppRun,
  serializeAppShowDeploy,
} from "../../presenters/app";
import { attachCommandDescriptor } from "../../shell/command-meta";
import { usageError } from "../../shell/errors";
import { addCompactGlobalFlags, addGlobalFlags } from "../../shell/global-flags";
import { runCommand, runStreamingCommand } from "../../shell/command-runner";
import { configureRuntimeCommand, type CliRuntime } from "../../shell/runtime";
import { PREVIEW_BUILD_TYPES } from "../../lib/app/preview-build";
import { FRAMEWORK_KEYS, LOCAL_DEV_BUILD_TYPES } from "@prisma/compute-sdk/config";
import type {
  AppBuildResult,
  AppDeployAllResult,
  AppDeployResult,
  AppDomainAddResult,
  AppDomainRemoveResult,
  AppDomainRetryResult,
  AppDomainShowResult,
  AppListDeploysResult,
  AppOpenResult,
  AppPromoteResult,
  AppRemoveResult,
  AppRollbackResult,
  AppShowResult,
  AppRunResult,
  AppShowDeployResult,
} from "../../types/app";

export function createAppCommand(runtime: CliRuntime): Command {
  const app = attachCommandDescriptor(configureRuntimeCommand(new Command("app"), runtime), "app");

  addCompactGlobalFlags(app);

  app.addCommand(createBuildCommand(runtime));
  app.addCommand(createRunCommand(runtime));
  app.addCommand(createDeployCommand(runtime));
  app.addCommand(createShowCommand(runtime));
  app.addCommand(createOpenCommand(runtime));
  app.addCommand(createDomainCommand(runtime));
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
    .argument("[app]", "App target from prisma.compute.ts when the config defines multiple apps")
    .addOption(new Option("--entry <path>", "Entrypoint path for Bun or auto builds"))
    .addOption(
      new Option("--build-type <type>", "Local build type")
        .choices([...PREVIEW_BUILD_TYPES])
        .default("auto"),
    );
  addGlobalFlags(command);

  command.action(async (configTarget: string | undefined, options) => {
    const entry = (options as { entry?: string }).entry;
    const buildType = (options as { buildType?: string }).buildType;

    await runCommand<AppBuildResult>(
      runtime,
      "app.build",
      options as Record<string, unknown>,
      (context) => runAppBuild(context, { entrypoint: entry, buildType, configTarget }),
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
    .argument("[app]", "App target from prisma.compute.ts when the config defines multiple apps")
    .addOption(new Option("--entry <path>", "Entrypoint path for Bun or auto runs"))
    .addOption(
      new Option("--build-type <type>", "Local framework type")
        .choices(["auto", ...LOCAL_DEV_BUILD_TYPES])
        .default("auto"),
    )
    .addOption(new Option("--port <port>", "Local port"));
  addGlobalFlags(command);

  command.action(async (configTarget: string | undefined, options) => {
    const entry = (options as { entry?: string }).entry;
    const buildType = (options as { buildType?: string }).buildType;
    const port = (options as { port?: string }).port;

    await runCommand<AppRunResult>(
      runtime,
      "app.run",
      options as Record<string, unknown>,
      (context) => runAppRun(context, { entrypoint: entry, buildType, port, configTarget }),
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
    .argument("[app]", "App target from prisma.compute.ts when the config defines multiple apps")
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"))
    .addOption(new Option("--create-project <name>", "Create and link a new Project before deploying"))
    .addOption(new Option("--branch <name>", "Branch name"))
    .addOption(
      new Option("--framework <name>", "Framework to deploy")
        .choices([...FRAMEWORK_KEYS]),
    )
    .addOption(new Option("--entry <path>", "Entrypoint path for Bun deploys"))
    .addOption(new Option("--http-port <port>", "HTTP port override for the deployed app"))
    .addOption(
      new Option("--env <name=value|file>", "Environment variable assignment or dotenv file")
        .argParser(collectRepeatableValues),
    )
    .addOption(new Option("--db", "Create and wire a Prisma Postgres database for this deploy target"))
    .addOption(new Option("--no-db", "Skip database setup"))
    .addOption(new Option("--prod", "Confirm intent to deploy to production"));
  addGlobalFlags(command);

  command.action(async (configTarget: string | undefined, options) => {
    const appName = (options as { app?: string }).app;
    const entry = (options as { entry?: string }).entry;
    const branchName = (options as { branch?: string }).branch;
    const framework = (options as { framework?: string }).framework;
    const httpPort = (options as { httpPort?: string }).httpPort;
    const envAssignments = (options as { env?: string[] }).env;
    const projectRef = (options as { project?: string }).project;
    const createProjectName = (options as { createProject?: string }).createProject;
    const prod = (options as { prod?: boolean }).prod;
    const db = (options as { db?: boolean }).db;
    const hasDbConflict = hasFlag(runtime.argv, "--db") && hasFlag(runtime.argv, "--no-db");

    await runCommand<AppDeployResult | AppDeployAllResult>(
      runtime,
      "app.deploy",
      options as Record<string, unknown>,
      (context) => {
        if (hasDbConflict) {
          throw usageError(
            "app deploy accepts either --db or --no-db",
            "--db requests database setup, while --no-db disables it.",
            "Pass exactly one database setup flag.",
            [
              "prisma-cli app deploy --db",
              "prisma-cli app deploy --no-db",
            ],
            "app",
          );
        }

        return runAppDeploy(context, appName, {
          projectRef,
          createProjectName,
          branchName,
          entrypoint: entry,
          framework,
          httpPort,
          envAssignments,
          prod: prod === true,
          db,
          configTarget,
        });
      },
      {
        renderHuman: (context, descriptor, result) => isAppDeployAllResult(result)
          ? renderAppDeployAll(context, descriptor, result)
          : renderAppDeploy(context, descriptor, result),
        renderJson: (result) => isAppDeployAllResult(result)
          ? serializeAppDeployAll(result)
          : serializeAppDeploy(result),
      },
    );
  });

  return command;
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

function createShowCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("show"), runtime),
    "app.show",
  );

  command
    .argument("[app]", "App target from prisma.compute.ts when the config defines multiple apps")
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"));
  addGlobalFlags(command);

  command.action(async (configTarget: string | undefined, options) => {
    const appName = (options as { app?: string }).app;
    const projectRef = (options as { project?: string }).project;

    await runCommand<AppShowResult>(
      runtime,
      "app.show",
      options as Record<string, unknown>,
      (context) => runAppShow(context, appName, projectRef, configTarget),
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
    .argument("[app]", "App target from prisma.compute.ts when the config defines multiple apps")
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"));
  addGlobalFlags(command);

  command.action(async (configTarget: string | undefined, options) => {
    const appName = (options as { app?: string }).app;
    const projectRef = (options as { project?: string }).project;

    await runCommand<AppOpenResult>(
      runtime,
      "app.open",
      options as Record<string, unknown>,
      (context) => runAppOpen(context, appName, projectRef, configTarget),
      {
        renderHuman: (context, descriptor, result) => renderAppOpen(context, descriptor, result),
        renderJson: (result) => serializeAppOpen(result),
      },
    );
  });

  return command;
}

function createDomainCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("domain"), runtime),
    "app.domain",
  );

  addCompactGlobalFlags(command);

  command.addCommand(createDomainAddCommand(runtime));
  command.addCommand(createDomainShowCommand(runtime));
  command.addCommand(createDomainRemoveCommand(runtime));
  command.addCommand(createDomainRetryCommand(runtime));
  command.addCommand(createDomainWaitCommand(runtime));

  return command;
}

function addDomainTargetOptions(command: Command): Command {
  return command
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"))
    .addOption(new Option("--branch <name>", "Branch name"));
}

function createDomainAddCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("add"), runtime),
    "app.domain.add",
  );

  command.argument("<hostname>", "Custom domain hostname");
  command.argument("[app]", "App target from prisma.compute.ts when the config defines multiple apps");
  addDomainTargetOptions(command);
  addGlobalFlags(command);

  command.action(async (hostname: string, configTarget: string | undefined, options) => {
    const appName = (options as { app?: string }).app;
    const projectRef = (options as { project?: string }).project;
    const branchName = (options as { branch?: string }).branch;

    await runCommand<AppDomainAddResult>(
      runtime,
      "app.domain.add",
      options as Record<string, unknown>,
      (context) => runAppDomainAdd(context, hostname, { appName, projectRef, branchName, configTarget }),
      {
        renderHuman: (context, descriptor, result) => renderAppDomainAdd(context, descriptor, result),
        renderJson: (result) => serializeAppDomainAdd(result),
      },
    );
  });

  return command;
}

function createDomainShowCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("show"), runtime),
    "app.domain.show",
  );

  command.argument("<hostname>", "Custom domain hostname");
  command.argument("[app]", "App target from prisma.compute.ts when the config defines multiple apps");
  addDomainTargetOptions(command);
  addGlobalFlags(command);

  command.action(async (hostname: string, configTarget: string | undefined, options) => {
    const appName = (options as { app?: string }).app;
    const projectRef = (options as { project?: string }).project;
    const branchName = (options as { branch?: string }).branch;

    await runCommand<AppDomainShowResult>(
      runtime,
      "app.domain.show",
      options as Record<string, unknown>,
      (context) => runAppDomainShow(context, hostname, { appName, projectRef, branchName, configTarget }),
      {
        renderHuman: (context, descriptor, result) => renderAppDomainShow(context, descriptor, result),
        renderJson: (result) => serializeAppDomainShow(result),
      },
    );
  });

  return command;
}

function createDomainRemoveCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("remove"), runtime),
    "app.domain.remove",
  );

  command.argument("<hostname>", "Custom domain hostname");
  command.argument("[app]", "App target from prisma.compute.ts when the config defines multiple apps");
  addDomainTargetOptions(command);
  addGlobalFlags(command);

  command.action(async (hostname: string, configTarget: string | undefined, options) => {
    const appName = (options as { app?: string }).app;
    const projectRef = (options as { project?: string }).project;
    const branchName = (options as { branch?: string }).branch;

    await runCommand<AppDomainRemoveResult>(
      runtime,
      "app.domain.remove",
      options as Record<string, unknown>,
      (context) => runAppDomainRemove(context, hostname, { appName, projectRef, branchName, configTarget }),
      {
        renderHuman: (context, descriptor, result) => renderAppDomainRemove(context, descriptor, result),
        renderJson: (result) => serializeAppDomainRemove(result),
      },
    );
  });

  return command;
}

function createDomainRetryCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("retry"), runtime),
    "app.domain.retry",
  );

  command.argument("<hostname>", "Custom domain hostname");
  command.argument("[app]", "App target from prisma.compute.ts when the config defines multiple apps");
  addDomainTargetOptions(command);
  addGlobalFlags(command);

  command.action(async (hostname: string, configTarget: string | undefined, options) => {
    const appName = (options as { app?: string }).app;
    const projectRef = (options as { project?: string }).project;
    const branchName = (options as { branch?: string }).branch;

    await runCommand<AppDomainRetryResult>(
      runtime,
      "app.domain.retry",
      options as Record<string, unknown>,
      (context) => runAppDomainRetry(context, hostname, { appName, projectRef, branchName, configTarget }),
      {
        renderHuman: (context, descriptor, result) => renderAppDomainRetry(context, descriptor, result),
        renderJson: (result) => serializeAppDomainRetry(result),
      },
    );
  });

  return command;
}

function createDomainWaitCommand(runtime: CliRuntime): Command {
  const command = attachCommandDescriptor(
    configureRuntimeCommand(new Command("wait"), runtime),
    "app.domain.wait",
  );

  command.argument("<hostname>", "Custom domain hostname");
  command.argument("[app]", "App target from prisma.compute.ts when the config defines multiple apps");
  addDomainTargetOptions(command);
  command.addOption(new Option("--timeout <duration>", "Maximum time to wait").default("15m"));
  addGlobalFlags(command);

  command.action(async (hostname: string, configTarget: string | undefined, options) => {
    const appName = (options as { app?: string }).app;
    const projectRef = (options as { project?: string }).project;
    const branchName = (options as { branch?: string }).branch;
    const timeout = (options as { timeout?: string }).timeout;

    await runStreamingCommand(
      runtime,
      "app.domain.wait",
      options as Record<string, unknown>,
      (context) => runAppDomainWait(context, hostname, { appName, projectRef, branchName, timeout, configTarget }),
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
    .argument("[app]", "App target from prisma.compute.ts when the config defines multiple apps")
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"))
    .addOption(new Option("--deployment <id>", "Deployment id"));
  addGlobalFlags(command);

  command.action(async (configTarget: string | undefined, options) => {
    const appName = (options as { app?: string }).app;
    const deploymentId = (options as { deployment?: string }).deployment;
    const projectRef = (options as { project?: string }).project;

    await runStreamingCommand(
      runtime,
      "app.logs",
      options as Record<string, unknown>,
      (context) => runAppLogs(context, appName, deploymentId, projectRef, configTarget),
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
    .argument("[app]", "App target from prisma.compute.ts when the config defines multiple apps")
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"));
  addGlobalFlags(command);

  command.action(async (configTarget: string | undefined, options) => {
    const appName = (options as { app?: string }).app;
    const projectRef = (options as { project?: string }).project;

    await runCommand<AppListDeploysResult>(
      runtime,
      "app.list-deploys",
      options as Record<string, unknown>,
      (context) => runAppListDeploys(context, appName, projectRef, configTarget),
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
  command.argument("[app]", "App target from prisma.compute.ts when the config defines multiple apps");
  command
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"));
  addGlobalFlags(command);

  command.action(async (deploymentId: string, configTarget: string | undefined, options) => {
    const appName = (options as { app?: string }).app;
    const projectRef = (options as { project?: string }).project;

    await runCommand<AppPromoteResult>(
      runtime,
      "app.promote",
      options as Record<string, unknown>,
      (context) => runAppPromote(context, deploymentId, appName, projectRef, configTarget),
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
    .argument("[app]", "App target from prisma.compute.ts when the config defines multiple apps")
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"))
    .addOption(new Option("--to <deployment>", "Deployment id"));
  addGlobalFlags(command);

  command.action(async (configTarget: string | undefined, options) => {
    const appName = (options as { app?: string }).app;
    const deploymentId = (options as { to?: string }).to;
    const projectRef = (options as { project?: string }).project;

    await runCommand<AppRollbackResult>(
      runtime,
      "app.rollback",
      options as Record<string, unknown>,
      (context) => runAppRollback(context, appName, deploymentId, projectRef, configTarget),
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
    .argument("[app]", "App target from prisma.compute.ts when the config defines multiple apps")
    .addOption(new Option("--app <name>", "App name"))
    .addOption(new Option("--project <id-or-name>", "Project id or name"));
  addGlobalFlags(command);

  command.action(async (configTarget: string | undefined, options) => {
    const appName = (options as { app?: string }).app;
    const projectRef = (options as { project?: string }).project;

    await runCommand<AppRemoveResult>(
      runtime,
      "app.remove",
      options as Record<string, unknown>,
      (context) => runAppRemove(context, appName, projectRef, configTarget),
      {
        renderHuman: (context, descriptor, result) => renderAppRemove(context, descriptor, result),
        renderJson: (result) => serializeAppRemove(result),
      },
    );
  });

  return command;
}
