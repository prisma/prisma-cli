import { formatShellCommand } from "../shell/command-arguments";
import type { CommandDescriptor } from "../shell/command-meta";
import { formatDescriptorLabel } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import { renderSummaryLine } from "../shell/ui";
import type { AgentInstallResult, AgentStatusResult } from "../types/agent";

export function renderAgentInstall(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AgentInstallResult,
): string[] {
  const ui = context.ui;
  const rail = ui.dim("│");
  const lines = [
    renderSummaryLine(
      ui,
      "success",
      `${formatDescriptorLabel(descriptor)} → ${operationSummary(result)} Prisma skills.`,
    ),
    "",
    `${rail}  ${ui.accent("skills:")}  ${result.skills.status.replace("-", " ")}`,
    `${rail}  ${ui.dim(formatShellCommand(result.skills.command))}`,
  ];

  return lines;
}

export function renderAgentStatus(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: AgentStatusResult,
): string[] {
  const ui = context.ui;
  const rail = ui.dim("│");
  const lines = [
    `${ui.strong(formatDescriptorLabel(descriptor))} ${ui.dim("→")} ${ui.dim(`Checking ${result.statusScope} Prisma skills.`)}`,
    "",
    `${rail}  ${ui.accent("skills:")}  ${result.skillsInstalled ? "installed" : "not found"}`,
    ...renderInstalledSkills(context, result.skills),
    `${rail}`,
    `${rail}  ${ui.accent("source:")}  ${formatStatusSource(result)}`,
    `${rail}  ${ui.dim(formatShellCommand(result.skillsListCommand))}`,
    ...renderProjectStatusDetails(context, result),
  ];

  return lines;
}

export function serializeAgentInstall(result: AgentInstallResult) {
  return result;
}

export function serializeAgentStatus(result: AgentStatusResult) {
  return result;
}

function formatSetupPromptStatus(result: AgentStatusResult): string {
  if (result.skillsInstalled) {
    return "not needed";
  }

  if (result.promptDismissedAt) {
    return `dismissed ${result.promptDismissedAt}`;
  }

  return "active";
}

function formatStatusSource(result: AgentStatusResult): string {
  if (result.statusSource === "skills-cli") {
    return result.statusScope === "global"
      ? "skills list -g --json"
      : "skills list --json";
  }

  if (result.statusSource === "skills-lock") {
    return result.skillsLockPath;
  }

  return "unavailable";
}

function renderProjectStatusDetails(
  context: CommandContext,
  result: AgentStatusResult,
): string[] {
  if (result.statusScope !== "project") {
    return [];
  }

  const ui = context.ui;
  const rail = ui.dim("│");
  return [
    `${rail}`,
    `${rail}  ${ui.accent("skills lock:")}  ${result.skillsLockInstalled ? "installed" : "not found"}`,
    `${rail}  ${ui.dim(result.skillsLockPath)}`,
    `${rail}`,
    `${rail}  ${ui.accent("setup prompt:")}  ${formatSetupPromptStatus(result)}`,
  ];
}

function renderInstalledSkills(
  context: CommandContext,
  skills: AgentStatusResult["skills"],
): string[] {
  const ui = context.ui;
  const rail = ui.dim("│");
  if (skills.length === 0) {
    return [`${rail}    ${ui.dim("No Prisma skills reported.")}`];
  }

  return skills.map((skill) => {
    const agents =
      skill.agents.length > 0 ? skill.agents.join(", ") : "no agents reported";
    return `${rail}    ${skill.name}  ${ui.dim(`${skill.scope}; ${agents}`)}`;
  });
}

function operationSummary(result: AgentInstallResult): string {
  if (result.skills.status === "would-install") {
    return "Would install";
  }

  return operationLabel(result.operation);
}

function operationLabel(operation: AgentInstallResult["operation"]): string {
  return operation === "update" ? "Updated" : "Installed";
}
