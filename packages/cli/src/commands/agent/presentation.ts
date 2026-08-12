import type { Block, Presentations } from "@prisma/cli-engine";
import type { NextAction } from "@prisma/cli-engine/protocol";
import { formatShellCommand } from "../../shell-command";
import type { AgentInstallResult, AgentStatusResult } from "./results";

function fields(rows: Array<{ label: string; value: string }>): Block {
  return { kind: "fields", rows };
}

function title(text: string): Block {
  return { kind: "summary", status: "info", text };
}

function operationSummary(result: AgentInstallResult): string {
  if (result.skills.status === "would-install") {
    return "Would install";
  }
  return result.operation === "update" ? "Updated" : "Installed";
}

function statusSourceValue(result: AgentStatusResult): string {
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

function setupPromptValue(result: AgentStatusResult): string {
  if (result.skillsInstalled) {
    return "not needed";
  }
  if (result.promptDismissedAt) {
    return `dismissed ${result.promptDismissedAt}`;
  }
  return "active";
}

function projectStatusRows(
  result: AgentStatusResult,
): Array<{ label: string; value: string }> {
  if (result.statusScope !== "project") {
    return [];
  }
  return [
    {
      label: "skills lock",
      value: result.skillsLockInstalled ? "installed" : "not found",
    },
    { label: "skills lock path", value: result.skillsLockPath },
    { label: "setup prompt", value: setupPromptValue(result) },
  ];
}

export function installPresentations(
  result: AgentInstallResult,
  statusCommand: string | null,
): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    human: () => [
      {
        kind: "summary",
        status: result.skills.status === "installed" ? "ok" : "info",
        text: `${operationSummary(result)} Prisma skills.`,
      },
      fields([
        { label: "skills", value: result.skills.status.replace("-", " ") },
        { label: "command", value: formatShellCommand(result.skills.command) },
      ]),
    ],
    next: () =>
      statusCommand === null
        ? []
        : [
            {
              kind: "run-command",
              label: "Verify the installed Prisma skills",
              command: statusCommand,
            } satisfies NextAction,
          ],
  };
}

export function statusPresentations(
  result: AgentStatusResult,
  installCommand: string | null,
): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    human: () => [
      title(`Checking ${result.statusScope} Prisma skills.`),
      fields([
        {
          label: "skills",
          value: result.skillsInstalled ? "installed" : "not found",
        },
        { label: "source", value: statusSourceValue(result) },
        {
          label: "command",
          value: formatShellCommand(result.skillsListCommand),
        },
        ...projectStatusRows(result),
      ]),
      result.skills.length === 0
        ? { kind: "list", items: ["No Prisma skills reported."] }
        : {
            kind: "table",
            columns: ["skill", "scope", "agents"],
            rows: result.skills.map((skill) => [
              skill.name,
              skill.scope,
              skill.agents.length > 0
                ? skill.agents.join(", ")
                : "no agents reported",
            ]),
          },
    ],
    next: () =>
      installCommand === null
        ? []
        : [
            {
              kind: "run-command",
              label: "Install or refresh Prisma skills",
              command: installCommand,
            } satisfies NextAction,
          ],
  };
}
