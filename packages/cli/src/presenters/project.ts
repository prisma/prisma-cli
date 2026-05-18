import type { CommandDescriptor } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import type {
  ProjectListResult,
  ProjectRepositoryConnectionResult,
  ProjectShowResult,
} from "../types/project";
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
        status: null,
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
      status: null,
    })),
  });
}

export function renderProjectShow(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: ProjectShowResult,
): string[] {
  return renderShow(
    {
      title: "Showing the project Prisma resolves for this directory.",
      descriptor,
      fields: [
        { key: "workspace", value: result.workspace.name },
        { key: "project", value: result.project.name },
        { key: "resolution", value: formatProjectSource(result.resolution.projectSource) },
      ],
    },
    context.ui,
  );
}

export function serializeProjectShow(result: ProjectShowResult) {
  return result;
}

export function renderProjectConnectRepo(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: ProjectRepositoryConnectionResult,
): string[] {
  const connection = result.repositoryConnection;
  return renderMutate(
    {
      title: "Connecting the resolved project to a GitHub repository.",
      descriptor,
      context: [
        { key: "project", value: result.project.name },
        { key: "workspace", value: result.workspace.name },
        { key: "repository", value: connection.repository.fullName },
        { key: "status", value: connection.status },
      ],
      operationDescription: "Applying repository connection",
      operationCount: 1,
      details: [
        connection.status === "active"
          ? "GitHub branch automation is active for this project."
          : "GitHub branch automation is pending GitHub App installation.",
      ],
    },
    context.ui,
  );
}

export function renderProjectDisconnectRepo(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: ProjectRepositoryConnectionResult,
): string[] {
  return renderMutate(
    {
      title: "Disconnecting the GitHub repository from the resolved project.",
      descriptor,
      context: [
        { key: "project", value: result.project.name },
        { key: "workspace", value: result.workspace.name },
        { key: "repository", value: result.repositoryConnection.repository.fullName },
      ],
      operationDescription: "Applying repository disconnection",
      operationCount: 1,
      details: ["GitHub branch automation is no longer active for this project."],
    },
    context.ui,
  );
}

function formatProjectSource(source: ProjectShowResult["resolution"]["projectSource"]): string {
  switch (source) {
    case "explicit":
      return "explicit";
    case "platform-mapping":
      return "platform mapping";
    case "remembered-local":
      return "remembered local context";
    case "package-name":
      return "package name";
    case "created":
      return "created";
    case "prompt":
      return "prompt";
  }
}
