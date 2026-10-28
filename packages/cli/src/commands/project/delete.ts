/** The `project delete` command. */
import {
  type Block,
  defineCommand,
  noDataLines,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { ok } from "@prisma/cli-engine/protocol";
import { cleanupLocalPinForProject } from "../../controllers/project";
import { createManagementProjectProvider } from "../../lib/project/provider";
import {
  resolveProjectForSetup,
  toProjectSummary,
} from "../../lib/project/setup";
import type { ProjectDeleteResult } from "../../types/project";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
import {
  listWorkspaceProjects,
  operationContext,
  resolveProjectPositional,
} from "./context";
import { localPinDiagnostics } from "./presentation";

function consentQuestion(
  project: { id: string; name: string },
  address: string | undefined,
): string {
  return address
    ? `Deleting Project "${project.name}" (${project.id}) is permanent, destroys its databases on every branch, and stops its apps, so it requires the exact project address.`
    : "Deleting a project is permanent, destroys its databases, and stops its apps, so it requires the exact project id.";
}

function deletePresentations(result: ProjectDeleteResult): Presentations {
  return {
    stdout: noDataLines("A delete has no data; its exit code is the result."),
    json: () => result,
    next: () => [],
    human: (): Block[] => [
      { kind: "summary", status: "ok", text: "Deleting project." },
      {
        kind: "fields",
        rows: [
          { label: "workspace", value: result.workspace.name },
          { label: "project", value: result.project.name },
          { label: "id", value: result.project.id },
        ],
      },
      {
        kind: "list",
        items: [
          "The project, its databases, and its apps were deleted.",
          ...(result.localPin.cleared
            ? ["This directory's local project binding was cleared."]
            : []),
        ],
      },
    ],
  };
}

export const projectDeleteCommand = defineCommand({
  args: {
    positionals: {
      project: positional.string({
        brief:
          "Project id or name, or its address: @ and the app name, such as @shop",
        placeholder: "id-or-name",
      }),
    },
  },
  help: {
    summary: "Delete a Project permanently after exact confirmation",
    description:
      "Deletion is permanent: it destroys the project's databases and stops its deployed services. Because of that, the command asks for the exact project id as a consent token, or the address when you pass one; pass it with --confirm to run non-interactively.",
    examples: [
      "project delete proj_123 --confirm proj_123",
      "project delete @shop --confirm @shop",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const workspace = await resolveActiveWorkspace(ctx);
    const projects = await listWorkspaceProjects(ctx);
    const subject = await resolveProjectPositional(
      ctx,
      args.positionals.project,
    );
    const project = toProjectSummary(
      resolveProjectForSetup(subject?.ref ?? "", projects, workspace),
    );

    await ctx.prompt.consent(consentQuestion(project, subject?.address), {
      token: subject?.address ?? project.id,
    });

    await createManagementProjectProvider(ctx.api).removeProject({
      projectId: project.id,
      signal: ctx.signal,
    });

    const warnings: string[] = [];
    const cleared = await cleanupLocalPinForProject(
      operationContext(ctx),
      project.id,
      { onError: (message) => warnings.push(message) },
    );

    const result: ProjectDeleteResult = {
      workspace,
      project,
      localPin: { cleared },
    };
    const diagnostics: Diagnostic[] = localPinDiagnostics(warnings);
    return ok(
      ctx.present({ data: result, diagnostics }, deletePresentations(result)),
    );
  },
});
