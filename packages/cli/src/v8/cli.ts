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
import { projectCreateCommand } from "./project/create";
import { projectLinkCommand } from "./project/link";
import { projectListCommand } from "./project/list";
import { projectRenameCommand } from "./project/rename";
import { projectShowCommand } from "./project/show";
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
