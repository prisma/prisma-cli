/** The `branch list` command. */
import {
  type Block,
  defineCommand,
  flag,
  type Presentations,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  listBranches,
  sortBranches,
  toBranchSummary,
} from "../../controllers/branch";
import type { BranchListResult } from "../../types/branch";
import { resolvePinnedProject } from "../project/context";
import { resolveActiveWorkspace } from "../resources-shared/workspace";

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
        ? [
            {
              kind: "summary" as const,
              status: "info" as const,
              text: "No branches found.",
            },
          ]
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
    summary: "List a project's Platform branches",
    description:
      "A Branch maps to a Git branch of the connected repository. Each one is an isolated environment with its own services, databases, buckets, and environment variables: the production branch serves live traffic, every other branch is a preview.",
    examples: ["branch list", "branch list --project my-app"],
  },
  args: {
    flags: {
      project: flag.string({
        brief:
          "Project id or name (default: the project this directory is linked to)",
        placeholder: "id-or-name",
      }),
    },
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const workspace = await resolveActiveWorkspace(ctx);
    const target = await resolvePinnedProject(
      ctx,
      workspace,
      args.flags.project,
      "branch list",
    );
    const branches = await listBranches(ctx.api, target.project.id, ctx.signal);

    const result: BranchListResult = {
      projectId: target.project.id,
      projectName: target.project.name,
      branches: sortBranches(branches.map(toBranchSummary)),
    };
    return ok(ctx.present({ data: result }, listPresentations(result)));
  },
});
