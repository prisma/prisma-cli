import type { CommandDescriptor } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import type { BranchListResult, BranchShowResult } from "../types/branch";
import { renderList, renderMutate, renderShow, serializeList } from "../output/patterns";

export function renderBranchList(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: BranchListResult,
): string[] {
  return renderList(
    {
      title: "Listing branches for the linked project.",
      descriptor,
      parentContext: {
        key: "project",
        value: result.projectName ?? "not linked",
      },
      items: result.branches.map((branch) => ({
        noun: "branch",
        label: branch.name,
        id: branch.id,
        status: branch.active ? "active" : null,
      })),
      emptyMessage: "No branches found.",
    },
    context.ui,
  );
}

export function serializeBranchList(result: BranchListResult) {
  return serializeList({
    context: {
      project: result.projectName ?? "not linked",
    },
    items: result.branches.map((branch) => ({
      noun: "branch",
      label: branch.name,
      id: branch.id,
      status: branch.active ? "active" : null,
    })),
  });
}

export function serializeBranchShow(result: BranchShowResult) {
  return {
    linkedProjectId: result.linkedProjectId,
    projectName: result.projectName,
    branch: {
      name: result.branch.name,
      kind: result.branch.kind,
      active: result.branch.active,
      remoteState: result.branch.remoteState,
      liveDeployment: result.branch.liveDeployment,
    },
  };
}

export function renderBranchShow(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: BranchShowResult,
): string[] {
  const fields: Array<{
    key: string;
    value: string;
    tone?: "default" | "dim" | "success" | "warning" | "error" | "link";
  }> = [
    {
      key: "project",
      value: result.projectName ?? "not linked",
      tone: result.projectName ? ("default" as const) : ("dim" as const),
    },
    {
      key: "branch",
      value: result.branch.name,
      tone: result.branch.active ? ("success" as const) : ("default" as const),
    },
    { key: "kind", value: result.branch.kind },
  ];

  if (result.branch.liveDeployment) {
    fields.push({
      key: "status",
      value: result.branch.liveDeployment.status,
      tone: toneForDeploymentStatus(result.branch.liveDeployment.status),
    });

    if (result.branch.liveDeployment.url) {
      fields.push({ key: "url", value: result.branch.liveDeployment.url, tone: "link" });
    }
  } else if (!result.branch.remoteState) {
    fields.push({ key: "remote state", value: "not created yet", tone: "dim" });
  }

  return renderShow(
    {
      title: "Showing the current active branch context.",
      descriptor,
      fields,
    },
    context.ui,
  );
}

function toneForDeploymentStatus(status: string): "success" | "warning" | "error" | "default" {
  if (status === "ready" || status === "active" || status === "healthy") {
    return "success";
  }

  if (status === "pending" || status === "building" || status === "starting") {
    return "warning";
  }

  if (status === "failed" || status === "error") {
    return "error";
  }

  return "default";
}

export function renderBranchUse(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: BranchShowResult,
): string[] {
  return renderMutate(
    {
      title: "Changing the local default branch context.",
      descriptor,
      context: [
        { key: "project", value: result.projectName ?? "not linked", tone: result.projectName ? "default" : "dim" },
        { key: "branch", value: result.branch.name },
      ],
      operationDescription: "Applying active branch change",
      operationCount: 1,
      details: ["Active branch updated in local CLI state for this repo."],
      alerts:
        result.branch.kind === "production"
          ? [{ tone: "warning", text: "Production is protected and durable. Use with care" }]
          : undefined,
    },
    context.ui,
  );
}
