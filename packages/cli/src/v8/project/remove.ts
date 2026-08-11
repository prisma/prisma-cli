/** The `project remove` command. */
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
import type { ProjectRemoveResult } from "../../types/project";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
import { legacyOperationContext, listWorkspaceProjects } from "./context";
import { mapProjectOperationError } from "./errors";
import { localPinDiagnostics } from "./presentation";

const CONSENT_QUESTION =
  "Removing a project is permanent, deletes its databases, and stops its apps, so it requires the exact project id.";

function removePresentations(result: ProjectRemoveResult): Presentations {
  return {
    human: (): Block[] => [
      { kind: "summary", tone: "ok", text: "Removing project." },
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
          "The project, its databases, and its apps were removed.",
          ...(result.localPin.cleared
            ? ["This directory's local project binding was cleared."]
            : []),
        ],
      },
    ],
  };
}

export const projectRemoveCommand = defineCommand({
  args: {
    positionals: {
      project: positional.string({
        brief: "Project id or name",
        placeholder: "id-or-name",
      }),
    },
  },
  help: {
    summary: "Remove a Project permanently after exact id confirmation",
    examples: ["project remove proj_123 --confirm proj_123"],
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

      const result: ProjectRemoveResult = {
        workspace,
        project,
        localPin: { cleared },
      };
      const diagnostics: Diagnostic[] = localPinDiagnostics(warnings);
      return ok(
        ctx.present({ data: result, diagnostics }, removePresentations(result)),
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
