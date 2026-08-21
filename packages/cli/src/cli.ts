import {
  type AnyCommand,
  type Cli,
  type CommandFamily,
  createCli,
  defineCommandFamily,
  telemetryCommandGroup,
} from "@prisma/cli-engine";
import { createComposerFamily } from "@prisma/composer-cli/family";
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
import { feedbackCommand } from "./commands/feedback";
import { gitConnectCommand } from "./commands/git/connect";
import { gitDisconnectCommand } from "./commands/git/disconnect";
import { postgresBackupListCommand } from "./commands/postgres/backup-list";
import { postgresBackupRestoreCommand } from "./commands/postgres/backup-restore";
import { postgresConnectionCreateCommand } from "./commands/postgres/connection-create";
import { postgresConnectionDeleteCommand } from "./commands/postgres/connection-delete";
import { postgresConnectionListCommand } from "./commands/postgres/connection-list";
import { postgresConnectionRotateCommand } from "./commands/postgres/connection-rotate";
import { postgresCreateCommand } from "./commands/postgres/create";
import { postgresDeleteCommand } from "./commands/postgres/delete";
import { postgresListCommand } from "./commands/postgres/list";
import { postgresShowCommand } from "./commands/postgres/show";
import { postgresUsageCommand } from "./commands/postgres/usage";
import { projectCreateCommand } from "./commands/project/create";
import { projectDeleteCommand } from "./commands/project/delete";
import { projectEnvAddCommand } from "./commands/project/env-add";
import { projectEnvDeleteCommand } from "./commands/project/env-delete";
import { projectEnvListCommand } from "./commands/project/env-list";
import { projectEnvUpdateCommand } from "./commands/project/env-update";
import { projectLinkCommand } from "./commands/project/link";
import { projectListCommand } from "./commands/project/list";
import { projectRenameCommand } from "./commands/project/rename";
import { projectShowCommand } from "./commands/project/show";
import { projectTransferCommand } from "./commands/project/transfer";
import { serviceCreateCommand } from "./commands/service/create";
import { serviceDeleteCommand } from "./commands/service/delete";
import { serviceDomainAddCommand } from "./commands/service/domain-add";
import { serviceDomainDeleteCommand } from "./commands/service/domain-delete";
import { serviceDomainRetryCommand } from "./commands/service/domain-retry";
import { serviceDomainShowCommand } from "./commands/service/domain-show";
import { serviceDomainWaitCommand } from "./commands/service/domain-wait";
import { serviceListCommand } from "./commands/service/list";
import { serviceLogsCommand } from "./commands/service/logs";
import { serviceOpenCommand } from "./commands/service/open";
import { serviceShowCommand } from "./commands/service/show";
import { serviceVersionDeleteCommand } from "./commands/service/version-delete";
import { serviceVersionListCommand } from "./commands/service/version-list";
import { serviceVersionPromoteCommand } from "./commands/service/version-promote";
import { serviceVersionRollbackCommand } from "./commands/service/version-rollback";
import { serviceVersionShowCommand } from "./commands/service/version-show";
import { serviceVersionStartCommand } from "./commands/service/version-start";
import { serviceVersionStopCommand } from "./commands/service/version-stop";
import { skillsCommandFamily } from "./commands/skills/family";
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
    projectDelete: projectDeleteCommand,
    projectTransfer: projectTransferCommand,
    projectEnvAdd: projectEnvAddCommand,
    projectEnvUpdate: projectEnvUpdateCommand,
    projectEnvList: projectEnvListCommand,
    projectEnvDelete: projectEnvDeleteCommand,
    postgresList: postgresListCommand,
    postgresShow: postgresShowCommand,
    postgresCreate: postgresCreateCommand,
    postgresUsage: postgresUsageCommand,
    postgresBackupRestore: postgresBackupRestoreCommand,
    postgresDelete: postgresDeleteCommand,
    postgresBackupList: postgresBackupListCommand,
    postgresConnectionList: postgresConnectionListCommand,
    postgresConnectionCreate: postgresConnectionCreateCommand,
    postgresConnectionRotate: postgresConnectionRotateCommand,
    postgresConnectionDelete: postgresConnectionDeleteCommand,
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
    serviceVersionList: serviceVersionListCommand,
    serviceVersionShow: serviceVersionShowCommand,
    serviceVersionPromote: serviceVersionPromoteCommand,
    serviceVersionRollback: serviceVersionRollbackCommand,
    serviceVersionStart: serviceVersionStartCommand,
    serviceVersionStop: serviceVersionStopCommand,
    serviceVersionDelete: serviceVersionDeleteCommand,
    serviceDelete: serviceDeleteCommand,
    serviceDomainAdd: serviceDomainAddCommand,
    serviceDomainShow: serviceDomainShowCommand,
    serviceDomainDelete: serviceDomainDeleteCommand,
    serviceDomainRetry: serviceDomainRetryCommand,
    serviceDomainWait: serviceDomainWaitCommand,
  },
});

/**
 * Composer's commands, contributed by composer's own package and run by
 * this process, mounted as shipped. Only the command definitions and
 * their handler entry functions load here; the alchemy and effect
 * constellation stays behind composer's dynamic executor imports, so
 * mounting costs an unrelated command nothing.
 */
export const composerCommandFamily: CommandFamily = createComposerFamily();

/**
 * The ORM commands, contributed by orm-toolchain's own package, mounted
 * as shipped: the family keys are the mount paths, so the shell adds
 * nothing. The family object carries its `orm` config section, its docs
 * base and its redirect table. Unlike composer's, this family's entry
 * module imports esbuild and arktype statically, so every invocation of
 * this bin pays that import; fixing that is orm-toolchain's move.
 */
export const ormCommandFamily: CommandFamily = ormToolchainFamily;

/**
 * Skill delivery for AI coding agents: one pair of commands for every
 * product, defined in this package because the skills travel in the
 * product packages and only the shell sees all of them.
 */
export { skillsCommandFamily };

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
  "postgres backup": {
    brief: "Inspect and restore platform-created database backups",
  },
  "postgres connection": {
    brief: "Manage one-time-view database connection strings",
  },
  bucket: { brief: "Manage object-store buckets for a project" },
  "bucket key": { brief: "Manage access keys for an object-store bucket" },
  branch: { brief: "View your Platform branches" },
  git: { brief: "Manage Git repository connections for a project" },
  service: { brief: "Manage services and their versions for a project" },
  "service domain": { brief: "Manage custom domains for a service" },
  "service version": { brief: "Manage the versions of a service" },
  agent: { brief: "Manage Prisma skills for AI coding agents" },
  "auth workspace": { brief: "Manage local workspace sessions" },
  contract: { brief: "Define and emit your application data contract" },
  db: { brief: "Verify, sign and update your database against the contract" },
  migration: { brief: "Plan, inspect and scaffold on-disk migrations" },
  "migration ref": { brief: "Manage named refs that point at contracts" },
  orm: { brief: "Initialize a Prisma ORM project" },
  skills: { brief: "Keep this project's Prisma agent skills current" },
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
  "project delete": projectDeleteCommand,
  "project transfer": projectTransferCommand,
  "project env add": projectEnvAddCommand,
  "project env update": projectEnvUpdateCommand,
  "project env list": projectEnvListCommand,
  "project env delete": projectEnvDeleteCommand,
  "postgres list": postgresListCommand,
  "postgres show": postgresShowCommand,
  "postgres create": postgresCreateCommand,
  "postgres usage": postgresUsageCommand,
  "postgres delete": postgresDeleteCommand,
  "postgres backup list": postgresBackupListCommand,
  "postgres backup restore": postgresBackupRestoreCommand,
  "postgres connection list": postgresConnectionListCommand,
  "postgres connection create": postgresConnectionCreateCommand,
  "postgres connection rotate": postgresConnectionRotateCommand,
  "postgres connection delete": postgresConnectionDeleteCommand,
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
  "service version list": serviceVersionListCommand,
  "service version show": serviceVersionShowCommand,
  "service version promote": serviceVersionPromoteCommand,
  "service version rollback": serviceVersionRollbackCommand,
  "service version start": serviceVersionStartCommand,
  "service version stop": serviceVersionStopCommand,
  "service version delete": serviceVersionDeleteCommand,
  "service delete": serviceDeleteCommand,
  "service domain add": serviceDomainAddCommand,
  "service domain show": serviceDomainShowCommand,
  "service domain delete": serviceDomainDeleteCommand,
  "service domain retry": serviceDomainRetryCommand,
  "service domain wait": serviceDomainWaitCommand,
  // Composer's two product verbs, mounted at the root.
  deploy: composerCommandFamily.commands.deploy,
  dev: composerCommandFamily.commands.dev,
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
  "db migrate": ormCommandFamily.commands["db migrate"],
  "contract format": ormCommandFamily.commands["contract format"],
  // `orm init` keeps this path: only the top-level `init` (the compute
  // config wizard) was removed, by the 2026-08-21 PM review.
  "orm init": ormCommandFamily.commands["orm init"],
  lsp: ormCommandFamily.commands.lsp,
  "migration check": ormCommandFamily.commands["migration check"],
  "migration graph": ormCommandFamily.commands["migration graph"],
  "migration list": ormCommandFamily.commands["migration list"],
  "migration log": ormCommandFamily.commands["migration log"],
  "migration new": ormCommandFamily.commands["migration new"],
  "migration plan": ormCommandFamily.commands["migration plan"],
  "migration show": ormCommandFamily.commands["migration show"],
  "migration status": ormCommandFamily.commands["migration status"],
  "migration ref delete": ormCommandFamily.commands["migration ref delete"],
  "migration ref list": ormCommandFamily.commands["migration ref list"],
  "migration ref set": ormCommandFamily.commands["migration ref set"],
  // Local utilities: no owning package, no config section, no API.
  "agent install": agentInstallCommand,
  "agent update": agentUpdateCommand,
  "agent status": agentStatusCommand,
  "skills sync": skillsCommandFamily.commands.sync,
  "skills list": skillsCommandFamily.commands.list,
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
      skillsCommandFamily,
    ],
    groups: cliGroups,
    commands: mountedCommands,
    help: {
      tagline: "The Prisma Developer Platform, from your terminal",
      description:
        "Deploy your app with isolated infrastructure for every branch.",
      examples: ["auth login", "project list", "deploy"],
      docsUrl: CLI_DOCS_URL,
    },
    telemetry: { docsUrl: CLI_DOCS_URL },
  });
}
