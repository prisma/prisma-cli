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

  if (result.types.status === "installed") {
    lines.push(
      renderSummaryLine(
        ui,
        "success",
        `Installed ${result.types.package} (config types)`,
      ),
    );
  } else if (result.types.status === "failed" && result.types.installCommand) {
    lines.push(
      renderSummaryLine(
        ui,
        "warning",
        `Could not install ${result.types.package}; install later with ${result.types.installCommand}`,
      ),
    );
  } else if (
    result.types.status !== "already-installed" &&
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
      // Human mode does not render success.warnings, so surface it here.
      lines.push(
        renderSummaryLine(
          ui,
          "warning",
          `Project link failed; link later with ${formatCommand(["project", "link"])}`,
        ),
      );
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
