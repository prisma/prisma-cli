/** The `project show` command. */
import {
  defineCommand,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { shortenHomePath } from "../../lib/fs/home-path";
import {
  buildProjectSetupNextActions,
  inspectProjectBinding,
  projectResolutionErrorToStructured,
} from "../../lib/project/resolution";
import type { ProjectShowResult } from "../../types/project";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
import { listWorkspaceProjects, operationContext } from "./context";

interface FieldRow {
  readonly label: string;
  readonly value: string;
}

function fieldRows(
  result: ProjectShowResult,
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): FieldRow[] {
  if (result.project === null) {
    return [
      { label: "workspace", value: result.workspace.name },
      { label: "project", value: "Not linked" },
    ];
  }

  return [
    { label: "local repo", value: shortenHomePath(cwd, env) },
    {
      label: "platform",
      value: `${result.workspace.name} / ${result.project.name}`,
    },
    ...(result.project.url
      ? [{ label: "url", value: result.project.url }]
      : []),
    ...(result.project.defaultRegion
      ? [{ label: "region", value: result.project.defaultRegion }]
      : []),
  ];
}

/** The stdout mirror. Three human affordances stay on the human side:
 *  the home directory shortened to `~`, the workspace and project glued
 *  into one "platform" line, and the words "Not linked" standing in for
 *  an absent project. stdout gets the raw path and one fact per line,
 *  under the labels this same command already uses when the directory
 *  is not linked. */
function stdoutFieldRows(result: ProjectShowResult, cwd: string): FieldRow[] {
  return [
    { label: "local repo", value: cwd },
    { label: "workspace", value: result.workspace.name },
    { label: "project", value: result.project?.name ?? "" },
    ...(result.project?.url
      ? [{ label: "url", value: result.project.url }]
      : []),
    ...(result.project?.defaultRegion
      ? [{ label: "region", value: result.project.defaultRegion }]
      : []),
  ];
}

function showPresentations(
  result: ProjectShowResult,
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): Presentations {
  const rows = fieldRows(result, cwd, env);
  return {
    json: () => result,
    human: () => [
      result.project === null
        ? {
            kind: "summary",
            status: "warn",
            text: "This directory is not linked to a Prisma Project.",
          }
        : {
            kind: "summary",
            status: "info",
            text:
              result.resolution.projectSource === "explicit"
                ? "Showing the named project (this directory's own link, if any, is unchanged)."
                : "This directory is linked to the following platform project.",
          },
      { kind: "fields", rows },
    ],
    stdout: () =>
      stdoutFieldRows(result, cwd).map((row) => `${row.label}: ${row.value}`),
    next: () =>
      result.project === null
        ? buildProjectSetupNextActions({
            commandName: "project show",
            retryCommand: "prisma project show <id-or-name>",
            suggestedProjectName: result.suggestedProjectName,
            reason:
              "This directory is not linked to a Prisma Project. Package and directory names can suggest setup defaults, but they do not select a Project.",
          })
        : [],
  };
}

export const projectShowCommand = defineCommand({
  args: {
    positionals: {
      project: positional.optionalString({
        brief:
          "Project id or name (default: the project this directory is linked to)",
        placeholder: "id-or-name",
      }),
    },
  },
  help: {
    summary: "Show which Project this directory is linked to",
    description:
      "Reports which Project this directory is linked to, or that it is not linked, with next steps. Pass an id or name to inspect any project without changing the local link.",
    examples: ["project show", "project show proj_123 --json"],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const workspace = await resolveActiveWorkspace(ctx);
    const inspected = await inspectProjectBinding({
      context: operationContext(ctx),
      workspace,
      explicitProject: args.positionals.project,
      listProjects: () => listWorkspaceProjects(ctx),
      commandName: "project show",
    });
    if (inspected.isErr()) {
      throw projectResolutionErrorToStructured(inspected.error);
    }
    const result = inspected.value;
    return ok(
      ctx.present(
        { data: result },
        showPresentations(result, ctx.cwd, ctx.env),
      ),
    );
  },
});
