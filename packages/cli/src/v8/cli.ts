import {
  type AnyCommand,
  type Cli,
  type CommandFamily,
  createCli,
  defineCommandFamily,
} from "@prisma/cli-engine";
import { CLI_DOCS_URL } from "../cli-name";
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
import { serviceDomainAddCommand } from "./service/domain-add";
import { serviceDomainRemoveCommand } from "./service/domain-remove";
import { serviceDomainRetryCommand } from "./service/domain-retry";
import { serviceDomainShowCommand } from "./service/domain-show";
import { serviceDomainWaitCommand } from "./service/domain-wait";
import { serviceListDeploysCommand } from "./service/list-deploys";
import { serviceOpenCommand } from "./service/open";
import { servicePromoteCommand } from "./service/promote";
import { serviceRemoveCommand } from "./service/remove";
import { serviceRollbackCommand } from "./service/rollback";
import { serviceShowCommand } from "./service/show";
import { serviceShowDeployCommand } from "./service/show-deploy";
import { telemetryDisableCommand } from "./telemetry/disable";
import { telemetryEnableCommand } from "./telemetry/enable";
import { telemetryStatusCommand } from "./telemetry/status";

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
    serviceShow: serviceShowCommand,
    serviceOpen: serviceOpenCommand,
    serviceListDeploys: serviceListDeploysCommand,
    serviceShowDeploy: serviceShowDeployCommand,
    servicePromote: servicePromoteCommand,
    serviceRollback: serviceRollbackCommand,
    serviceRemove: serviceRemoveCommand,
    serviceDomainAdd: serviceDomainAddCommand,
    serviceDomainShow: serviceDomainShowCommand,
    serviceDomainRemove: serviceDomainRemoveCommand,
    serviceDomainRetry: serviceDomainRetryCommand,
    serviceDomainWait: serviceDomainWaitCommand,
    buildLogs: buildLogsCommand,
  },
});

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
  build: { brief: "Inspect builds created by a git push or Console" },
  agent: { brief: "Manage Prisma skills for AI coding agents" },
  "auth workspace": { brief: "Manage local workspace sessions" },
  telemetry: {
    brief: "Inspect and change anonymous CLI telemetry",
    description:
      "Show telemetry status, or enable / disable anonymous CLI usage data.\n" +
      `Telemetry is on by default (opt-out); see ${CLI_DOCS_URL}\n` +
      "for what is collected and why.",
  },
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
  "service show": serviceShowCommand,
  "service open": serviceOpenCommand,
  "service list-deploys": serviceListDeploysCommand,
  "service show-deploy": serviceShowDeployCommand,
  "service promote": servicePromoteCommand,
  "service rollback": serviceRollbackCommand,
  "service remove": serviceRemoveCommand,
  "service domain add": serviceDomainAddCommand,
  "service domain show": serviceDomainShowCommand,
  "service domain remove": serviceDomainRemoveCommand,
  "service domain retry": serviceDomainRetryCommand,
  "service domain wait": serviceDomainWaitCommand,
  // Platform builds are their own group; there is no local build verb.
  "build logs": buildLogsCommand,
  // Local utilities: no owning package, no config section, no API.
  "agent install": agentInstallCommand,
  "agent update": agentUpdateCommand,
  "agent status": agentStatusCommand,
  feedback: feedbackCommand,
  // Shell-owned consent surface (no command family).
  "telemetry status": telemetryStatusCommand,
  "telemetry enable": telemetryEnableCommand,
  "telemetry disable": telemetryDisableCommand,
};

export function buildCli(): Cli {
  return createCli({
    name: "prisma-v8",
    version: getCliVersion(),
    commandFamilies: [platformCommandFamily],
    groups: cliGroups,
    commands: mountedCommands,
  });
}
