import { resolvePrismaCliPackageCommandFormatterSync } from "../lib/agent/cli-command";
import type { CommandDescriptor } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import { renderNextSteps, renderSummaryLine } from "../shell/ui";
import type { InitResult } from "../types/init";

export function renderInit(
  context: CommandContext,
  _descriptor: CommandDescriptor,
  result: InitResult,
): string[] {
  const ui = context.ui;
  const formatCommand = resolvePrismaCliPackageCommandFormatterSync(
    context.runtime.cwd,
  );
  const lines = [
    renderSummaryLine(ui, "success", `Wrote ${result.configPath}`),
  ];

  switch (result.link.status) {
    case "linked":
      lines.push(
        renderSummaryLine(
          ui,
          "success",
          `Linked "${result.directory}" to Project "${result.link.project?.name ?? ""}"`,
        ),
      );
      break;
    case "already-linked":
      break;
    case "skipped":
    case "declined":
      lines.push(
        `  ${ui.dim(`Not linked to a Project yet; link with ${formatCommand(["project", "link"])}.`)}`,
      );
      break;
    case "failed":
      // The failure detail is in warnings; nothing extra here.
      break;
  }

  const linked =
    result.link.status === "linked" || result.link.status === "already-linked";
  lines.push(
    ...renderNextSteps([
      formatCommand(["app", "deploy"]),
      ...(linked ? [] : [formatCommand(["project", "link"])]),
    ]),
  );

  return lines;
}

export function serializeInit(result: InitResult) {
  return result;
}
