/** The `project delete` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import { cleanupLocalPinForProject } from "../../controllers/project";
import { createManagementProjectProvider } from "../../lib/project/provider";
import {
  resolveProjectForSetup,
  toProjectSummary,
} from "../../lib/project/setup";
import type { ProjectDeleteResult } from "../../types/project";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
import { legacyOperationContext, listWorkspaceProjects } from "./context";
import { mapProjectOperationError } from "./errors";
import { localPinDiagnostics } from "./presentation";

const CONSENT_QUESTION =
  "Deleting a project is permanent, destroys its databases, and stops its apps, so it requires the exact project id.";

function deletePresentations(result: ProjectDeleteResult): Presentations {
  return {
    stdout: () => [],
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
        brief: "Project id or name",
        placeholder: "id-or-name",
      }),
    },
  },
  help: {
    summary: "Delete a Project permanently after exact id confirmation",
    examples: ["project delete proj_123 --confirm proj_123"],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
      const workspace = await resolveActiveWorkspace(ctx);
      const projects = await listWorkspaceProjects(ctx);
      const project = toProjectSummary(
        resolveProjectForSetup(
          args.positionals.project.trim(),
          projects,
          workspace,
        ),
      );

      await ctx.prompt.consent(CONSENT_QUESTION, { token: project.id });

      await createManagementProjectProvider(ctx.api).removeProject({
        projectId: project.id,
        signal: ctx.signal,
      });

      const warnings: string[] = [];
      const cleared = await cleanupLocalPinForProject(
        legacyOperationContext(ctx),
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
    } catch (error) {
      const mapped = mapProjectOperationError(error);
      if (mapped) {
        return notOk(mapped);
      }
      throw error;
    }
  },
});
