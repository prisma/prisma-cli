import {
  type AnyCommand,
  type Cli,
  type CommandFamily,
  createCli,
  defineCommandFamily,
  telemetryCommandGroup,
} from "@prisma/cli-engine";
// TODO(release): @prisma/composer@0.6.0-dev.15 pins
// @prisma/cli-engine@0.0.7, while this package ships the workspace
// engine at the lockstep version (8.0.0-rc.1). Those are different
// versions, so an install of @prisma/cli resolves two copies of the
// engine. Closing it is composer's move, not this repo's: composer
// must pin the same engine version prisma-cli publishes, per the
// tandem release order engine → composer → prisma-cli (R-S3-6).
import { createComposerFamily } from "@prisma/composer/family";
// TODO(release): @prisma/orm-toolchain@8.0.0-rc.1-dev.40 pins
// @prisma/cli-engine@0.0.9, the same second copy composer's pin
// installs. Both close the same way: the two packages pin the engine
// version prisma-cli publishes, per the tandem release order.
import { ormCommandFamily as ormToolchainFamily } from "@prisma/orm-toolchain/cli";
import { CLI_DOCS_URL, CLI_NAME } from "../cli-name";
import { getCliVersion } from "../lib/version";
import { agentInstallCommand } from "./agent/install";
import { agentStatusCommand } from "./agent/status";
import { agentUpdateCommand } from "./agent/update";
import { authLoginCommand } from "./auth/login";
import { authLogoutCommand } from "./auth/logout";
import { authWhoamiCommand } from "./auth/whoami";
import { authWorkspaceListCommand } from "./auth/workspace-list";
import { authWorkspaceLogoutCommand } from "./auth/workspace-logout";
import { authWorkspaceUseCommand } from "./auth/workspace-use";
import { branchListCommand } from "./branch/list";
import { bucketCreateCommand } from "./bucket/create";
import { bucketDeleteCommand } from "./bucket/delete";
import { bucketKeyCreateCommand } from "./bucket/key-create";
import { bucketKeyDeleteCommand } from "./bucket/key-delete";
import { bucketKeyListCommand } from "./bucket/key-list";
import { bucketListCommand } from "./bucket/list";
import { buildLogsCommand } from "./build/logs";
import { feedbackCommand } from "./feedback";
import { gitConnectCommand } from "./git/connect";
import { gitDisconnectCommand } from "./git/disconnect";
import { postgresBackupListCommand } from "./postgres/backup-list";
import { postgresConnectionCreateCommand } from "./postgres/connection-create";
import { postgresConnectionListCommand } from "./postgres/connection-list";
import { postgresConnectionRemoveCommand } from "./postgres/connection-remove";
import { postgresConnectionRotateCommand } from "./postgres/connection-rotate";
import { postgresCreateCommand } from "./postgres/create";
import { postgresListCommand } from "./postgres/list";
import { postgresRemoveCommand } from "./postgres/remove";
import { postgresRestoreCommand } from "./postgres/restore";
import { postgresShowCommand } from "./postgres/show";
import { postgresUsageCommand } from "./postgres/usage";
import { projectCreateCommand } from "./project/create";
import { projectEnvAddCommand } from "./project/env-add";
import { projectEnvListCommand } from "./project/env-list";
import { projectEnvRemoveCommand } from "./project/env-remove";
import { projectEnvUpdateCommand } from "./project/env-update";
import { projectLinkCommand } from "./project/link";
import { projectListCommand } from "./project/list";
import { projectRemoveCommand } from "./project/remove";
import { projectRenameCommand } from "./project/rename";
import { projectShowCommand } from "./project/show";
import { projectTransferCommand } from "./project/transfer";
import { serviceCreateCommand } from "./service/create";
import { serviceDeploymentDeleteCommand } from "./service/deployment-delete";
import { serviceDeploymentListCommand } from "./service/deployment-list";
import { serviceDeploymentPromoteCommand } from "./service/deployment-promote";
import { serviceDeploymentRollbackCommand } from "./service/deployment-rollback";
import { serviceDeploymentShowCommand } from "./service/deployment-show";
import { serviceDeploymentStartCommand } from "./service/deployment-start";
import { serviceDeploymentStopCommand } from "./service/deployment-stop";
import { serviceDomainAddCommand } from "./service/domain-add";
import { serviceDomainRemoveCommand } from "./service/domain-remove";
import { serviceDomainRetryCommand } from "./service/domain-retry";
import { serviceDomainShowCommand } from "./service/domain-show";
import { serviceDomainWaitCommand } from "./service/domain-wait";
import { serviceListCommand } from "./service/list";
import { serviceOpenCommand } from "./service/open";
import { serviceRemoveCommand } from "./service/remove";
import { serviceShowCommand } from "./service/show";

export const platformCommandFamily: CommandFamily = defineCommandFamily({
  commands: {
    login: authLoginCommand,
    logout: authLogoutCommand,
    whoami: authWhoamiCommand,
    workspaceList: authWorkspaceListCommand,
    workspaceUse: authWorkspaceUseCommand,
    workspaceLogout: authWorkspaceLogoutCommand,
    projectList: projectListCommand,
    projectShow: projectShowCommand,
    projectCreate: projectCreateCommand,
    projectLink: projectLinkCommand,
    projectRename: projectRenameCommand,
    projectRemove: projectRemoveCommand,
    projectTransfer: projectTransferCommand,
    projectEnvAdd: projectEnvAddCommand,
    projectEnvUpdate: projectEnvUpdateCommand,
    projectEnvList: projectEnvListCommand,
    projectEnvRemove: projectEnvRemoveCommand,
    postgresList: postgresListCommand,
    postgresShow: postgresShowCommand,
    postgresCreate: postgresCreateCommand,
    postgresUsage: postgresUsageCommand,
    postgresRestore: postgresRestoreCommand,
    postgresRemove: postgresRemoveCommand,
    postgresBackupList: postgresBackupListCommand,
    postgresConnectionList: postgresConnectionListCommand,
    postgresConnectionCreate: postgresConnectionCreateCommand,
    postgresConnectionRotate: postgresConnectionRotateCommand,
    postgresConnectionRemove: postgresConnectionRemoveCommand,
    bucketList: bucketListCommand,
    bucketCreate: bucketCreateCommand,
    bucketDelete: bucketDeleteCommand,
    bucketKeyList: bucketKeyListCommand,
    bucketKeyCreate: bucketKeyCreateCommand,
    bucketKeyDelete: bucketKeyDeleteCommand,
    branchList: branchListCommand,
    gitConnect: gitConnectCommand,
    gitDisconnect: gitDisconnectCommand,
    serviceList: serviceListCommand,
    serviceCreate: serviceCreateCommand,
    serviceShow: serviceShowCommand,
    serviceOpen: serviceOpenCommand,
    serviceDeploymentList: serviceDeploymentListCommand,
    serviceDeploymentShow: serviceDeploymentShowCommand,
    serviceDeploymentPromote: serviceDeploymentPromoteCommand,
    serviceDeploymentRollback: serviceDeploymentRollbackCommand,
    serviceDeploymentStart: serviceDeploymentStartCommand,
    serviceDeploymentStop: serviceDeploymentStopCommand,
    serviceDeploymentDelete: serviceDeploymentDeleteCommand,
    serviceRemove: serviceRemoveCommand,
    serviceDomainAdd: serviceDomainAddCommand,
    serviceDomainShow: serviceDomainShowCommand,
    serviceDomainRemove: serviceDomainRemoveCommand,
    serviceDomainRetry: serviceDomainRetryCommand,
    serviceDomainWait: serviceDomainWaitCommand,
    buildLogs: buildLogsCommand,
  },
});

/**
 * Composer's commands, contributed by composer's own package and run by
 * this process. Only the command definitions and their handler entry
 * functions load here; the alchemy and effect constellation stays behind
 * composer's dynamic executor imports, so mounting costs an unrelated
 * command nothing.
 */
export const composerCommandFamily: CommandFamily = createComposerFamily();

/**
 * The ORM commands, contributed by orm-toolchain's own package. The
 * family object carries its `orm` config section, its docs base and its
 * redirect table, so nothing here is wired per command. Unlike
 * composer's, this family's entry module imports esbuild and arktype
 * statically, so every invocation of this bin pays that import; fixing
 * that is orm-toolchain's move.
 */
export const ormCommandFamily: CommandFamily = ormToolchainFamily;

/** The engine ships the three telemetry commands and the group help
 *  text that belongs to them; both halves are spread in below. */
const telemetry = telemetryCommandGroup({ docsUrl: CLI_DOCS_URL });

export const cliGroups: Readonly<
  Record<string, { brief: string; description?: string }>
> = {
  auth: { brief: "Manage local authentication for the CLI" },
  project: { brief: "Manage and inspect your Prisma projects" },
  "project env": {
    brief: "Manage environment variables for the active project",
  },
  postgres: { brief: "Manage Prisma Postgres databases for a project" },
  "postgres backup": { brief: "Inspect platform-created database backups" },
  "postgres connection": {
    brief: "Manage one-time-view database connection strings",
  },
  bucket: { brief: "Manage object-store buckets for a project" },
  "bucket key": { brief: "Manage access keys for an object-store bucket" },
  branch: { brief: "View your Platform branches" },
  git: { brief: "Manage Git repository connections for a project" },
  service: { brief: "Manage services and deployments for a project" },
  "service domain": { brief: "Manage custom domains for a service" },
  "service deployment": { brief: "Manage deployments for a service" },
  build: { brief: "Inspect builds created by a git push or Console" },
  composer: {
    brief: "Run and deploy applications composed from Prisma modules",
  },
  agent: { brief: "Manage Prisma skills for AI coding agents" },
  "auth workspace": { brief: "Manage local workspace sessions" },
  contract: { brief: "Define and emit your application data contract" },
  db: { brief: "Verify, sign and update your database against the contract" },
  migration: { brief: "Plan, inspect and scaffold on-disk migrations" },
  ref: { brief: "Manage named refs that point at contracts" },
  ...telemetry.groups,
};

export const mountedCommands: Readonly<Record<string, AnyCommand>> = {
  "auth login": authLoginCommand,
  "auth logout": authLogoutCommand,
  "auth whoami": authWhoamiCommand,
  "auth workspace list": authWorkspaceListCommand,
  "auth workspace use": authWorkspaceUseCommand,
  "auth workspace logout": authWorkspaceLogoutCommand,
  "project list": projectListCommand,
  "project show": projectShowCommand,
  "project create": projectCreateCommand,
  "project link": projectLinkCommand,
  "project rename": projectRenameCommand,
  "project remove": projectRemoveCommand,
  "project transfer": projectTransferCommand,
  "project env add": projectEnvAddCommand,
  "project env update": projectEnvUpdateCommand,
  "project env list": projectEnvListCommand,
  "project env remove": projectEnvRemoveCommand,
  "postgres list": postgresListCommand,
  "postgres show": postgresShowCommand,
  "postgres create": postgresCreateCommand,
  "postgres usage": postgresUsageCommand,
  "postgres restore": postgresRestoreCommand,
  "postgres remove": postgresRemoveCommand,
  "postgres backup list": postgresBackupListCommand,
  "postgres connection list": postgresConnectionListCommand,
  "postgres connection create": postgresConnectionCreateCommand,
  "postgres connection rotate": postgresConnectionRotateCommand,
  "postgres connection remove": postgresConnectionRemoveCommand,
  "bucket list": bucketListCommand,
  "bucket create": bucketCreateCommand,
  "bucket delete": bucketDeleteCommand,
  "bucket key list": bucketKeyListCommand,
  "bucket key create": bucketKeyCreateCommand,
  "bucket key delete": bucketKeyDeleteCommand,
  "branch list": branchListCommand,
  "git connect": gitConnectCommand,
  "git disconnect": gitDisconnectCommand,
  "service list": serviceListCommand,
  "service create": serviceCreateCommand,
  "service show": serviceShowCommand,
  "service open": serviceOpenCommand,
  "service deployment list": serviceDeploymentListCommand,
  "service deployment show": serviceDeploymentShowCommand,
  "service deployment promote": serviceDeploymentPromoteCommand,
  "service deployment rollback": serviceDeploymentRollbackCommand,
  "service deployment start": serviceDeploymentStartCommand,
  "service deployment stop": serviceDeploymentStopCommand,
  "service deployment delete": serviceDeploymentDeleteCommand,
  "service remove": serviceRemoveCommand,
  "service domain add": serviceDomainAddCommand,
  "service domain show": serviceDomainShowCommand,
  "service domain remove": serviceDomainRemoveCommand,
  "service domain retry": serviceDomainRetryCommand,
  "service domain wait": serviceDomainWaitCommand,
  // Platform builds are their own group; there is no local build verb.
  "build logs": buildLogsCommand,
  "composer deploy": composerCommandFamily.commands.deploy,
  "composer destroy": composerCommandFamily.commands.destroy,
  "composer dev": composerCommandFamily.commands.dev,
  "composer log": composerCommandFamily.commands.log,
  // orm-toolchain keys its commands by the path they mount at, so the
  // family's own map is the mount, with no renaming layer.
  ...ormCommandFamily.commands,
  // Local utilities: no owning package, no config section, no API.
  "agent install": agentInstallCommand,
  "agent update": agentUpdateCommand,
  "agent status": agentStatusCommand,
  feedback: feedbackCommand,
  // The engine's consent surface, mounted whole (no command family).
  ...telemetry.commands,
};

export function buildCli(): Cli {
  return createCli({
    name: CLI_NAME,
    version: getCliVersion(),
    commandFamilies: [
      platformCommandFamily,
      composerCommandFamily,
      ormCommandFamily,
    ],
    groups: cliGroups,
    commands: mountedCommands,
    telemetry: { docsUrl: CLI_DOCS_URL },
  });
}
