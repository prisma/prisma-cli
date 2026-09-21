/** The `project list` command. */
import { defineCommand, type Presentations } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import { readProjectListLocalBinding } from "../../controllers/project";
import {
  buildProjectSetupNextActions,
  sortProjects,
} from "../../lib/project/resolution";
import { toProjectSummary } from "../../lib/project/setup";
import { serializeProjectList } from "../../presenters/project";
import type { ProjectListResult } from "../../types/project";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
import { listWorkspaceProjects } from "./context";

const TITLE = "Listing projects for the authenticated workspace.";

/** An absent region stays empty; the table renderer draws the dim
 *  placeholder dash. */
function projectRows(result: ProjectListResult): string[][] {
  return result.projects.map((project) => [
    project.name,
    project.id,
    project.defaultRegion ?? "",
  ]);
}

/** The stdout rows: a project with no default region has an empty
 *  region field, not the word the human table shows. */
function projectStdoutRows(result: ProjectListResult): string[][] {
  return result.projects.map((project) => [
    project.name,
    project.id,
    project.defaultRegion ?? "",
  ]);
}

function nextActionsFor(result: ProjectListResult) {
  if (result.localBinding?.status === "linked") {
    return [];
  }
  return buildProjectSetupNextActions({
    createCommand: `${CLI_NAME} project create <name>`,
    reason:
      result.localBinding?.status === "invalid"
        ? "This directory has an invalid local Project binding. Ask the user which Prisma Project to link before running Project-scoped commands."
        : "This directory is not linked to a Prisma Project. Project list shows available Projects, but none is selected for this directory.",
  });
}

function listPresentations(result: ProjectListResult): Presentations {
  const rows = projectRows(result);
  const stdoutRows = projectStdoutRows(result);
  return {
    human: () => [
      { kind: "summary", status: "info", text: TITLE },
      {
        kind: "fields",
        rows: [{ label: "workspace", value: result.workspace.name }],
      },
      ...(rows.length === 0
        ? [
            {
              kind: "summary",
              status: "info",
              text: "No projects found.",
            } as const,
          ]
        : [
            {
              kind: "table",
              columns: ["name", "id", "region"],
              rows,
            } as const,
          ]),
    ],
    stdout: () => stdoutRows.map((row) => row.join("\t")),
    json: () => serializeProjectList(result),
    next: () => nextActionsFor(result),
  };
}

export const projectListCommand = defineCommand({
  help: {
    summary: "List all projects in your workspace",
    description:
      "A Project groups one product or codebase. It is the child of a workspace and the parent of Branches: isolated environments that hold your services, databases, and buckets.",
    examples: ["project list", "project list --json"],
  },
  needs: { credentials: true },
  handler: async (_args, ctx) => {
    const workspace = await resolveActiveWorkspace(ctx);
    const projects = sortProjects(await listWorkspaceProjects(ctx));
    const localBinding = await readProjectListLocalBinding(
      ctx.cwd,
      projects,
      ctx.signal,
    );
    const result: ProjectListResult = {
      workspace,
      projects: projects.map(toProjectSummary),
      localBinding,
    };
    return ok(ctx.present({ data: result }, listPresentations(result)));
  },
});
