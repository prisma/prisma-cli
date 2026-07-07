import { COMPUTE_CONFIG_JSON_FILENAME } from "@prisma/compute-sdk/config";

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
    renderSummaryLine(
      ui,
      "success",
      result.converted
        ? `Converted ${COMPUTE_CONFIG_JSON_FILENAME} to ${result.configPath}`
        : `Wrote ${result.configPath}`,
    ),
  ];

  // Failed steps surface through the runner's success-warning rendering, so
  // this block only covers the success and quiet-hint cases.
  if (result.types.status === "installed") {
    lines.push(
      renderSummaryLine(
        ui,
        "success",
        `Installed ${result.types.package} (config types)`,
      ),
    );
  } else if (
    (result.types.status === "skipped" || result.types.status === "declined") &&
    result.types.installCommand
  ) {
    lines.push(
      `  ${ui.dim(`For editor types: ${result.types.installCommand}`)}`,
    );
  }

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
      // The failure detail renders via the runner's success-warning lines.
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
