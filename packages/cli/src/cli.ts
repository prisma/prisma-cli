import {
  type AnyCommand,
  type Cli,
  type CommandFamily,
  createCli,
  defineCommandFamily,
  telemetryCommandGroup,
} from "@prisma/cli-engine";
// TODO(release): @prisma/composer@0.6.0-dev.16 pins
// @prisma/cli-engine@0.0.9, while this package ships the workspace
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
import { CLI_DOCS_URL, CLI_NAME } from "./cli-name";
import { agentInstallCommand } from "./commands/agent/install";
import { agentStatusCommand } from "./commands/agent/status";
import { agentUpdateCommand } from "./commands/agent/update";
import { authLoginCommand } from "./commands/auth/login";
import { authLogoutCommand } from "./commands/auth/logout";
import { authWhoamiCommand } from "./commands/auth/whoami";
import { authWorkspaceListCommand } from "./commands/auth/workspace-list";
import { authWorkspaceLogoutCommand } from "./commands/auth/workspace-logout";
import { authWorkspaceUseCommand } from "./commands/auth/workspace-use";
import { branchListCommand } from "./commands/branch/list";
import { bucketCreateCommand } from "./commands/bucket/create";
import { bucketDeleteCommand } from "./commands/bucket/delete";
import { bucketKeyCreateCommand } from "./commands/bucket/key-create";
import { bucketKeyDeleteCommand } from "./commands/bucket/key-delete";
import { bucketKeyListCommand } from "./commands/bucket/key-list";
import { bucketListCommand } from "./commands/bucket/list";
import { buildLogsCommand } from "./commands/build/logs";
import { feedbackCommand } from "./commands/feedback";
import { gitConnectCommand } from "./commands/git/connect";
import { gitDisconnectCommand } from "./commands/git/disconnect";
import { initCommand } from "./commands/init/init";
import { postgresBackupListCommand } from "./commands/postgres/backup-list";
import { postgresConnectionCreateCommand } from "./commands/postgres/connection-create";
import { postgresConnectionListCommand } from "./commands/postgres/connection-list";
import { postgresConnectionRemoveCommand } from "./commands/postgres/connection-remove";
import { postgresConnectionRotateCommand } from "./commands/postgres/connection-rotate";
import { postgresCreateCommand } from "./commands/postgres/create";
import { postgresListCommand } from "./commands/postgres/list";
import { postgresRemoveCommand } from "./commands/postgres/remove";
import { postgresRestoreCommand } from "./commands/postgres/restore";
import { postgresShowCommand } from "./commands/postgres/show";
import { postgresUsageCommand } from "./commands/postgres/usage";
import { projectCreateCommand } from "./commands/project/create";
import { projectEnvAddCommand } from "./commands/project/env-add";
import { projectEnvListCommand } from "./commands/project/env-list";
import { projectEnvRemoveCommand } from "./commands/project/env-remove";
import { projectEnvUpdateCommand } from "./commands/project/env-update";
import { projectLinkCommand } from "./commands/project/link";
import { projectListCommand } from "./commands/project/list";
import { projectRemoveCommand } from "./commands/project/remove";
import { projectRenameCommand } from "./commands/project/rename";
import { projectShowCommand } from "./commands/project/show";
import { projectTransferCommand } from "./commands/project/transfer";
import { serviceCreateCommand } from "./commands/service/create";
import { serviceDeploymentDeleteCommand } from "./commands/service/deployment-delete";
import { serviceDeploymentListCommand } from "./commands/service/deployment-list";
import { serviceDeploymentPromoteCommand } from "./commands/service/deployment-promote";
import { serviceDeploymentRollbackCommand } from "./commands/service/deployment-rollback";
import { serviceDeploymentShowCommand } from "./commands/service/deployment-show";
import { serviceDeploymentStartCommand } from "./commands/service/deployment-start";
import { serviceDeploymentStopCommand } from "./commands/service/deployment-stop";
import { serviceDomainAddCommand } from "./commands/service/domain-add";
import { serviceDomainRemoveCommand } from "./commands/service/domain-remove";
import { serviceDomainRetryCommand } from "./commands/service/domain-retry";
import { serviceDomainShowCommand } from "./commands/service/domain-show";
import { serviceDomainWaitCommand } from "./commands/service/domain-wait";
import { serviceListCommand } from "./commands/service/list";
import { serviceLogsCommand } from "./commands/service/logs";
import { serviceOpenCommand } from "./commands/service/open";
import { serviceRemoveCommand } from "./commands/service/remove";
import { serviceShowCommand } from "./commands/service/show";
import { getCliVersion } from "./lib/version";

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
    serviceLogs: serviceLogsCommand,
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
  orm: { brief: "Initialize a Prisma ORM project" },
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
  "service logs": serviceLogsCommand,
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
  // The ORM family. Written out per path: the shell owns the tree
  // (R12), so this map — not the family's own keying — is the source of
  // truth for where each command mounts.
  "contract emit": ormCommandFamily.commands["contract emit"],
  "contract infer": ormCommandFamily.commands["contract infer"],
  "db init": ormCommandFamily.commands["db init"],
  "db schema": ormCommandFamily.commands["db schema"],
  "db sign": ormCommandFamily.commands["db sign"],
  "db update": ormCommandFamily.commands["db update"],
  "db verify": ormCommandFamily.commands["db verify"],
  format: ormCommandFamily.commands.format,
  // Ruled (operator, 2026-08-12): the ORM's project initializer lives at
  // `orm init`; top-level `init` is the platform's compute-config wizard.
  "orm init": ormCommandFamily.commands.init,
  lsp: ormCommandFamily.commands.lsp,
  migrate: ormCommandFamily.commands.migrate,
  "migration check": ormCommandFamily.commands["migration check"],
  "migration graph": ormCommandFamily.commands["migration graph"],
  "migration list": ormCommandFamily.commands["migration list"],
  "migration log": ormCommandFamily.commands["migration log"],
  "migration new": ormCommandFamily.commands["migration new"],
  "migration plan": ormCommandFamily.commands["migration plan"],
  "migration show": ormCommandFamily.commands["migration show"],
  "migration status": ormCommandFamily.commands["migration status"],
  "ref delete": ormCommandFamily.commands["ref delete"],
  "ref list": ormCommandFamily.commands["ref list"],
  "ref set": ormCommandFamily.commands["ref set"],
  // Local utilities: no owning package, no config section, no API.
  "agent install": agentInstallCommand,
  "agent update": agentUpdateCommand,
  "agent status": agentStatusCommand,
  feedback: feedbackCommand,
  // The engine's consent surface, mounted whole (no command family).
  ...telemetry.commands,
  // Top-level, and not the platform package's: init writes the local
  // compute config the service group reads. It joins the compute family
  // when one exists.
  init: initCommand,
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
