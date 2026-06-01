import type { CommandDescriptor } from "../shell/command-meta";
import { formatCommandArgument } from "../shell/command-arguments";
import type { CommandContext } from "../shell/runtime";
import type {
  GitRepositoryConnection,
  ProjectListResult,
  ProjectRepositoryConnectionResult,
  ProjectSetupResult,
  ProjectShowResult,
} from "../types/project";
import { renderList, renderMutate, renderShow, serializeList } from "../output/patterns";
import { renderNextSteps, renderSummaryLine } from "../shell/ui";

export function renderProjectList(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: ProjectListResult,
): string[] {
  const lines = renderList(
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

  if (result.localBinding?.status === "not-linked" || result.localBinding?.status === "invalid") {
    lines.push(...renderNextSteps(["Link the chosen Project: prisma-cli project link <id-or-name>"]));
  }

  return lines;
}

export function serializeProjectList(result: ProjectListResult) {
  return {
    ...serializeList({
      context: {
        workspace: result.workspace.name,
      },
      items: result.projects.map((project) => ({
        noun: "project",
        label: project.name,
        id: project.id,
        status: null,
      })),
    }),
    localBinding: result.localBinding ?? null,
  };
}

export function renderProjectShow(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: ProjectShowResult,
): string[] {
  if (result.project === null) {
    const lines = renderShow(
      {
        title: "This directory is not linked to a Prisma Project.",
        descriptor,
        fields: [
          { key: "workspace", value: result.workspace.name },
          { key: "project", value: "Not linked", tone: "warning" },
        ],
      },
      context.ui,
    );

    lines.push(...renderNextSteps([
      "Link an existing Project: prisma-cli project link <id-or-name>",
      `Create a new Project: prisma-cli project create ${formatCommandArgument(result.suggestedProjectName)}`,
    ]));

    return lines;
  }

  return renderShow(
    {
      title: "Showing this directory's Project binding.",
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

export function renderProjectSetup(
  context: CommandContext,
  _descriptor: CommandDescriptor,
  result: ProjectSetupResult,
): string[] {
  const lines = result.action === "created"
    ? [renderSummaryLine(context.ui, "success", `Created Project "${result.project.name}"`)]
    : [];

  lines.push(
    renderSummaryLine(context.ui, "success", `Linked "${result.directory}" to Project "${result.project.name}"`),
    `Saved ${result.localPin.path}`,
  );

  return lines;
}

export function serializeProjectSetup(result: ProjectSetupResult) {
  return result;
}

export function renderGitConnect(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: ProjectRepositoryConnectionResult,
): string[] {
  const connection = result.repositoryConnection;
  return renderMutate(
    {
      title: "Connecting Git to the resolved project.",
      descriptor,
      context: [
        { key: "project", value: result.project.name },
        { key: "workspace", value: result.workspace.name },
        { key: "repository", value: connection.repository.fullName },
        { key: "status", value: connection.status },
      ],
      operationDescription: "Applying repository connection",
      operationCount: 1,
      details: [formatGitConnectionDetail(connection.status)],
    },
    context.ui,
  );
}

export function renderGitDisconnect(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: ProjectRepositoryConnectionResult,
): string[] {
  return renderMutate(
    {
      title: "Disconnecting Git from the resolved project.",
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
    case "env":
      return "environment";
    case "local-pin":
      return "local pin";
    case "platform-mapping":
      return "platform mapping";
    case "created":
      return "created";
    case "prompt":
      return "prompt";
    case "unbound":
      return "unbound";
  }
}

function formatGitConnectionDetail(status: GitRepositoryConnection["status"]): string {
  switch (status) {
    case "active":
      return "GitHub branch automation is active for this project.";
    case "pending":
      return "GitHub branch automation is pending GitHub App installation.";
    case "archived":
      return "GitHub branch automation has been archived for this project.";
    default:
      return "GitHub repository is connected, but branch automation is not active.";
  }
}
