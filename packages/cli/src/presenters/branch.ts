import type { CommandDescriptor } from "../shell/command-meta";
import { formatDescriptorLabel } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import { formatColumns } from "../shell/ui";
import type { BranchListResult } from "../types/branch";
import { renderResolvedProjectContextBlock } from "./verbose-context";

export function renderBranchList(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: BranchListResult,
): string[] {
  const ui = context.ui;
  const lines = [`${ui.strong(formatDescriptorLabel(descriptor))} ${ui.dim("→")} ${ui.dim("Listing branches for the resolved project.")}`, ""];
  const rail = ui.dim("│");
  lines.push(`${rail}  ${ui.accent("project:")}  ${result.projectName}`);
  lines.push(rail);

  if (result.branches.length === 0) {
    lines.push(`${rail}  ${ui.dim("No branches found.")}`);
    lines.push(...renderBranchResolvedContextBlock(context, result));
    return lines;
  }

  const widths = [
    Math.max("Name".length, ...result.branches.map((branch) => branch.name.length)),
    Math.max("Role".length, ...result.branches.map((branch) => branch.role.length)),
    Math.max("Env map".length, ...result.branches.map((branch) => branch.envMap.length)),
  ];
  lines.push(`${rail}  ${ui.accent(formatColumns(["Name", "Role", "Env map"], widths))}`);
  for (const branch of result.branches) {
    lines.push(`${rail}  ${formatColumns([branch.name, branch.role, branch.envMap], widths)}`);
  }

  lines.push(...renderBranchResolvedContextBlock(context, result));
  return lines;
}

export function serializeBranchList(result: BranchListResult) {
  const { verboseContext: _verboseContext, ...serializable } = result;
  return {
    projectId: serializable.projectId,
    projectName: serializable.projectName,
    branches: serializable.branches,
  };
}

function renderBranchResolvedContextBlock(
  context: CommandContext,
  result: BranchListResult,
): string[] {
  return renderResolvedProjectContextBlock(context.ui, result.verboseContext);
}
