import type { CommandDescriptor } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import type { ProjectListResult, ProjectShowResult } from "../types/project";
import { renderList, renderMutate, renderShow, serializeList } from "../output/patterns";

export function renderProjectList(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: ProjectListResult,
): string[] {
  return renderList(
    {
      title: "Listing projects for the authenticated workspace.",
      descriptor,
      parentContext: {
        key: "workspace",
        value: result.workspace.name,
      },
      items: result.projects.map((project) => ({
        noun: "project",
        label: project.name,
        id: project.id,
        status: result.linkedProjectId === project.id ? "linked" : null,
      })),
      emptyMessage: "No projects found.",
    },
    context.ui,
  );
}

export function serializeProjectList(result: ProjectListResult) {
  return serializeList({
    context: {
      workspace: result.workspace.name,
    },
    items: result.projects.map((project) => ({
      noun: "project",
      label: project.name,
      id: project.id,
      status: result.linkedProjectId === project.id ? "linked" : null,
    })),
  });
}

export function renderProjectShow(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: ProjectShowResult,
): string[] {
  if (!result.linkedProjectId) {
    return renderShow(
      {
        title: "Showing the linked project for the current repo.",
        descriptor,
        fields: [{ key: "project", value: "not linked", tone: "dim" }],
      },
      context.ui,
    );
  }

  if (!result.project || !result.workspace) {
    return renderShow(
      {
        title: "Showing the linked project for the current repo.",
        descriptor,
        fields: [
          { key: "project", value: "linked", tone: "success" },
          { key: "remote details", value: "unavailable until you sign in", tone: "dim" },
        ],
      },
      context.ui,
    );
  }

  return renderShow(
    {
      title: "Showing the linked project for the current repo.",
      descriptor,
      fields: [
        { key: "project", value: result.project.name },
        { key: "workspace", value: result.workspace.name },
      ],
    },
    context.ui,
  );
}

export function renderProjectLink(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: ProjectShowResult,
): string[] {
  if (!result.project || !result.workspace) {
    throw new Error("Linked project result must be enriched for human output.");
  }

  return renderMutate(
    {
      title: "Linking the current repo to an existing project.",
      descriptor,
      context: [
        { key: "project", value: result.project.name },
        { key: "workspace", value: result.workspace.name },
      ],
      operationDescription: "Applying local project link",
      operationCount: 1,
      details: ["Project link written to local repo config."],
    },
    context.ui,
  );
}
