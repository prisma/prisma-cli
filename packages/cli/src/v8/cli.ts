import {
  type Cli,
  createCli,
  defineCommandFamily,
  type MountedTree,
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
import { buildLogsCommand } from "./build/logs";
import { feedbackCommand } from "./feedback";
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

/** Every user-facing command path the shipped binary answers to. Exported
 *  so tests assert and reuse this map instead of restating it. */
export const MOUNTED_COMMANDS = {
  "auth login": authLoginCommand,
  "auth logout": authLogoutCommand,
  "auth whoami": authWhoamiCommand,
  "auth workspace list": authWorkspaceListCommand,
  "auth workspace use": authWorkspaceUseCommand,
  "auth workspace logout": authWorkspaceLogoutCommand,
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
  "build logs": buildLogsCommand,
  // Shell-owned local utilities (no command family).
  "agent install": agentInstallCommand,
  "agent update": agentUpdateCommand,
  "agent status": agentStatusCommand,
  feedback: feedbackCommand,
  // Shell-owned consent surface (no command family).
  "telemetry status": telemetryStatusCommand,
  "telemetry enable": telemetryEnableCommand,
  "telemetry disable": telemetryDisableCommand,
} satisfies MountedTree;

export function buildCli(): Cli {
  return createCli({
    name: "prisma-v8",
    version: getCliVersion(),
    commandFamilies: [
      defineCommandFamily({
        commands: {
          login: authLoginCommand,
          logout: authLogoutCommand,
          whoami: authWhoamiCommand,
          workspaceList: authWorkspaceListCommand,
          workspaceUse: authWorkspaceUseCommand,
          workspaceLogout: authWorkspaceLogoutCommand,
        },
      }),
      defineCommandFamily({
        commands: {
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
      }),
    ],
    groups: {
      auth: { brief: "Manage local authentication for the CLI" },
      "auth workspace": { brief: "Manage local workspace sessions" },
      service: { brief: "Manage services and deployments for a project" },
      "service domain": { brief: "Manage custom domains for a service" },
      build: { brief: "Inspect builds created by a git push or Console" },
      agent: { brief: "Install Prisma context for AI coding agents" },
      telemetry: {
        brief: "Show or change whether the CLI sends anonymous usage data",
        description:
          "Show telemetry status, or enable / disable anonymous CLI usage data.\n" +
          `Telemetry is on by default (opt-out); see ${CLI_DOCS_URL}\n` +
          "for what is collected and why.",
      },
    },
    commands: MOUNTED_COMMANDS,
  });
}
