/** The `project rename` command. */
import {
  defineCommand,
  flag,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createManagementProjectProvider } from "../../lib/project/provider";
import {
  isValidProjectSetupName,
  projectSetupNameRequiredError,
} from "../../lib/project/setup";
import type { ProjectRenameResult } from "../../types/project";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
import { resolvePinnedProject } from "./context";

function renamePresentations(result: ProjectRenameResult): Presentations {
  return {
    stdout: () => [],
    json: () => result,
    next: () => [],
    human: () => [
      { kind: "summary", status: "ok", text: "Renaming project." },
      {
        kind: "fields",
        rows: [
          { label: "workspace", value: result.workspace.name },
          { label: "project", value: result.previousName },
          { label: "id", value: result.project.id },
        ],
      },
      {
        kind: "list",
        items: [
          `The project is now named "${result.project.name}". Directory bindings pin the project id, so they stay valid.`,
        ],
      },
    ],
  };
}

export const projectRenameCommand = defineCommand({
  args: {
    positionals: {
      name: positional.string({
        brief: "New project name",
        placeholder: "name",
      }),
    },
    flags: {
      project: flag.string({
        brief:
          "Project id or name (default: the project this directory is linked to)",
        placeholder: "id-or-name",
      }),
    },
  },
  help: {
    summary: "Rename a Project",
    description:
      "Changes the display name of the linked project, or of the one named by --project. The project id stays the same, so existing links and automation keep working.",
    examples: [
      'project rename "Acme Dashboard v2"',
      "project rename billing-api --project proj_123",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const workspace = await resolveActiveWorkspace(ctx);
    const name = args.positionals.name.trim();
    if (!isValidProjectSetupName(name)) {
      throw projectSetupNameRequiredError("project rename");
    }

    const target = await resolvePinnedProject(
      ctx,
      workspace,
      args.flags.project,
      "project rename",
    );
    const renamed = await createManagementProjectProvider(
      ctx.api,
    ).renameProject({
      projectId: target.project.id,
      name,
      signal: ctx.signal,
    });

    const result: ProjectRenameResult = {
      workspace,
      project: renamed,
      previousName: target.project.name,
    };
    return ok(ctx.present({ data: result }, renamePresentations(result)));
  },
});
