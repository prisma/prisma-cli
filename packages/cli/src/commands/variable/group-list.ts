/** The `variable group list` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { formatGroupRule, listVariableGroups } from "../../lib/variable/api";
import { resolvePinnedProject } from "../project/context";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
import { projectFlag } from "./shared";

function listPresentations(result: {
  projectId: string;
  groups: Array<{
    id: string;
    name: string;
    class: string;
    rule: string;
    matchedBranchIds: string[];
  }>;
}): Presentations {
  const rows = result.groups.map((g) => [
    g.name,
    g.class,
    g.rule,
    String(g.matchedBranchIds.length),
  ]);

  return {
    json: () => result,
    next: () => [],
    stdout: () => rows.map((row) => row.join("\t")),
    human: (): Block[] => [
      {
        kind: "summary",
        status: "info",
        text: "Listing variable groups.",
      },
      {
        kind: "fields",
        rows: [{ label: "project", value: result.projectId }],
      },
      rows.length === 0
        ? { kind: "summary", status: "info", text: "No variable groups found." }
        : {
            kind: "table",
            columns: ["name", "class", "rule", "branches"],
            rows,
          },
    ],
  };
}

export const variableGroupListCommand = defineCommand({
  args: {
    flags: {
      project: projectFlag,
    },
  },
  help: {
    summary: "List all variable groups for a project",
    description:
      "Shows the production and preview groups, then any custom groups ordered by name. Each row shows the group's name, class, matching rule, and how many branches it currently serves.",
    examples: ["variable group list", "variable group list --project my-app"],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const workspace = await resolveActiveWorkspace(ctx);
    const resolved = await resolvePinnedProject(
      ctx,
      workspace,
      args.flags.project,
      "variable group list",
    );
    const projectId = resolved.project.id;

    const groups = await listVariableGroups(ctx.api, projectId, ctx.signal);

    const data = {
      projectId,
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        class: g.class,
        rule: formatGroupRule(g),
        matchedBranchIds: g.matchedBranchIds,
      })),
    };

    return ok(ctx.present({ data }, listPresentations(data)));
  },
});
