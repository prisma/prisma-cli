import type { CommandDescriptor } from "../shell/command-meta";
import { formatDescriptorLabel } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import type {
  GithubConnectResult,
  GithubInstallResult,
  GithubListResult,
} from "../types/github";

export function renderGithubList(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: GithubListResult,
): string[] {
  const ui = context.ui;
  const rail = ui.dim("│");
  const lines = [
    `${ui.strong(formatDescriptorLabel(descriptor))} ${ui.dim("→")} ${ui.dim("GitHub installations for the active workspace.")}`,
    "",
    `${rail}  ${ui.accent("workspace:")}  ${result.workspace.name}`,
    rail,
  ];

  if (result.connected.length === 0) {
    lines.push(`${rail}  ${ui.dim("No GitHub account connected.")}`);
  } else {
    for (const installation of result.connected) {
      const status = installation.suspended ? ui.dim(" (suspended)") : "";
      lines.push(
        `${rail}  ${ui.accent("connected:")}  ${installation.accountLogin} ${ui.dim(`(${installation.accountType}, installation ${installation.installationId})`)}${status}`,
      );
    }
  }

  if (result.connectable.length > 0) {
    lines.push(rail);
    for (const candidate of result.connectable) {
      lines.push(
        `${rail}  ${ui.accent("connectable:")} ${candidate.accountLogin} ${ui.dim(`(installation ${candidate.installationId}, via another workspace)`)}`,
      );
    }
  }

  return lines;
}

export function serializeGithubList(result: GithubListResult) {
  return result;
}

export function renderGithubConnect(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: GithubConnectResult,
): string[] {
  const ui = context.ui;
  const rail = ui.dim("│");
  return [
    `${ui.strong(formatDescriptorLabel(descriptor))} ${ui.dim("→")} ${ui.dim("Connecting a GitHub account.")}`,
    "",
    `${rail}  ${ui.accent("workspace:")}  ${result.workspace.name}`,
    `${rail}  ${ui.accent("account:")}    ${result.installation.accountLogin}`,
    `${rail}  ${ui.accent("connected:")}  yes`,
  ];
}

export function serializeGithubConnect(result: GithubConnectResult) {
  return result;
}

export function renderGithubInstall(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: GithubInstallResult,
): string[] {
  const ui = context.ui;
  const rail = ui.dim("│");
  return [
    `${ui.strong(formatDescriptorLabel(descriptor))} ${ui.dim("→")} ${ui.dim("Install the Prisma GitHub App.")}`,
    "",
    `${rail}  ${ui.accent("workspace:")}  ${result.workspace.name}`,
    `${rail}  ${ui.accent("open:")}       ${result.installUrl}`,
    rail,
    `${rail}  ${ui.dim("Finish the installation on GitHub; the Console completes the connection.")}`,
  ];
}

export function serializeGithubInstall(result: GithubInstallResult) {
  return result;
}
