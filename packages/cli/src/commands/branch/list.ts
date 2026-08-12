/** The `branch list` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
} from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import {
  listBranches,
  sortBranches,
  toBranchSummary,
} from "../../controllers/branch";
import type { BranchListResult } from "../../types/branch";
import { resolvePinnedProject } from "../project/context";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
import { mapBranchOperationError } from "./errors";

const TITLE = "Listing branches for the resolved project.";

function listPresentations(result: BranchListResult): Presentations {
  const rows = result.branches.map((branch) => [
    branch.name,
    branch.role,
    branch.envMap,
  ]);
  return {
    json: () => result,
    next: () => [],
    human: (): Block[] => [
      { kind: "summary", status: "info", text: TITLE },
      {
        kind: "fields",
        rows: [{ label: "project", value: result.projectName }],
      },
      ...(rows.length === 0
        ? [{ kind: "list" as const, items: ["No branches found."] }]
        : [
            {
              kind: "table" as const,
              columns: ["Name", "Role", "Env map"],
              rows,
            },
          ]),
    ],
    stdout: () => rows.map((row) => row.join("\t")),
  };
}

export const branchListCommand = defineCommand({
  help: {
    summary: "List Platform branches for the resolved project",
    examples: ["branch list", "branch list --json"],
  },
  needs: { credentials: true },
  handler: async (_args, ctx) => {
    try {
      const workspace = await resolveActiveWorkspace(ctx);
      /** Legacy quirk: `branch list` has no `--project` and passes no
       *  command name, so an unbound directory reads "this command". */
      const target = await resolvePinnedProject(
        ctx,
        workspace,
        undefined,
        undefined,
      );
      const branches = await listBranches(
        ctx.api,
        target.project.id,
        ctx.signal,
      );

      const result: BranchListResult = {
        projectId: target.project.id,
        projectName: target.project.name,
        branches: sortBranches(branches.map(toBranchSummary)),
      };
      return ok(ctx.present({ data: result }, listPresentations(result)));
    } catch (error) {
      const mapped = mapBranchOperationError(error);
      if (mapped) {
        return notOk(mapped);
      }
      throw error;
    }
  },
});
