import {
  type AnyCommand,
  type Cli,
  type CommandFamily,
  createCli,
  defineCommandFamily,
} from "@prisma/cli-engine";
import { CLI_DOCS_URL } from "../cli-name";
import { getCliVersion } from "../lib/version";
import { authLoginCommand } from "./auth/login";
import { authLogoutCommand } from "./auth/logout";
import { authWhoamiCommand } from "./auth/whoami";
import { authWorkspaceListCommand } from "./auth/workspace-list";
import { authWorkspaceLogoutCommand } from "./auth/workspace-logout";
import { authWorkspaceUseCommand } from "./auth/workspace-use";
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
