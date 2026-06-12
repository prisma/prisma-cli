import path from "node:path";

import { shortenHomePath } from "../lib/fs/home-path";

import stringWidth from "string-width";

import { formatCommandArgument } from "../shell/command-arguments";
import type { CommandDescriptor } from "../shell/command-meta";
import { formatDescriptorLabel } from "../shell/command-meta";
import type { CommandContext } from "../shell/runtime";
import type {
  GitRepositoryConnection,
  ProjectListResult,
  ProjectRepositoryConnectionResult,
  ProjectSetupResult,
  ProjectShowResult,
} from "../types/project";
import { renderMutate, renderShow, serializeList } from "../output/patterns";
import { padDisplay, renderNextSteps, renderSummaryLine, renderVerboseBlock } from "../shell/ui";
import { renderResolvedProjectContextBlock } from "./verbose-context";

export function renderProjectList(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: ProjectListResult,
): string[] {
  const ui = context.ui;
  const rail = ui.dim("│");
  const lines = [
    `${ui.strong(formatDescriptorLabel(descriptor))} ${ui.dim("→")} ${ui.dim("Listing projects for the authenticated workspace.")}`,
    "",
  ];
  lines.push(`${rail}  ${ui.accent("workspace:")}  ${result.workspace.name}`);

  if (result.projects.length === 0) {
    lines.push(`${rail}  ${ui.dim("No projects found.")}`);
    if (result.localBinding?.status === "not-linked" || result.localBinding?.status === "invalid") {
      lines.push(...renderNextSteps([
        "Link an existing Project you choose: prisma-cli project link <id-or-name>",
        "Create a new Project: prisma-cli project create <name>",
      ]));
    }
    return lines;
  }

  const nameWidth = Math.max("name".length, ...result.projects.map((project) => stringWidth(project.name)));
  lines.push(rail);
  lines.push(`${rail}  ${ui.accent(padDisplay("name", nameWidth))}  ${ui.accent("id")}`);
  for (const project of result.projects) {
    lines.push(`${rail}  ${padDisplay(project.name, nameWidth)}  ${project.id}`);
  }

  if (result.localBinding?.status === "not-linked" || result.localBinding?.status === "invalid") {
    lines.push(...renderNextSteps([
      "Link an existing Project you choose: prisma-cli project link <id-or-name>",
      "Create a new Project: prisma-cli project create <name>",
    ]));
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

    lines.push(...renderVerboseBlock(context.ui, [
      { key: "workspace", value: result.workspace.name },
      { key: "workspace id", value: result.workspace.id, tone: "dim" },
      { key: "project source", value: "unbound" },
      { key: "suggested name", value: `${result.suggestedProjectName} (${result.suggestedProjectNameSource})` },
    ], { title: "Resolved context" }));

    lines.push(...renderNextSteps([
      "Link an existing Project you choose: prisma-cli project link <id-or-name>",
      `Create a new Project: prisma-cli project create ${formatCommandArgument(result.suggestedProjectName)}`,
    ]));

    return lines;
  }

  return renderBoundProjectShow(context, descriptor, result);
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

function renderBoundProjectShow(
  context: CommandContext,
  descriptor: CommandDescriptor,
  result: Exclude<ProjectShowResult, { project: null }>,
): string[] {
  const { ui } = context;
  const rail = ui.dim("│");
  const keyWidth = "local repo".length;
  const platform = `${result.workspace.name} / ${result.project.name}`;
  const lines = [
    `${ui.strong(formatDescriptorLabel(descriptor))} ${ui.dim("→")} ${ui.dim("This directory is linked to the following platform project.")}`,
    "",
    `${rail}  ${ui.accent(padDisplay("local repo", keyWidth))}  ${formatLocalRepoPath(context.runtime.cwd, context.runtime.env)}`,
    `${rail}  ${ui.accent(padDisplay("platform", keyWidth))}  ${ui.strong(platform)}`,
  ];

  if (result.project.url) {
    lines.push(rail);
    lines.push(`${rail}  ${ui.dim("→")} ${ui.link(result.project.url)}`);
  }

  lines.push(...renderResolvedProjectContextBlock(context.ui, {
    workspace: result.workspace,
    project: result.project,
    resolution: result.resolution,
  }));

  return lines;
}

function formatLocalRepoPath(cwd: string, env: NodeJS.ProcessEnv): string {
  return shortenHomePath(cwd, env);
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
