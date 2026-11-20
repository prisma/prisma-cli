/** The `variable group delete` command. */
import {
  type Block,
  defineCommand,
  noDataLines,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import {
  deleteVariableGroup,
  listVariableGroups,
} from "../../lib/variable/api";
import { resolvePinnedProject } from "../project/context";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
import { projectFlag } from "./shared";

function deletePresentations(result: {
  projectId: string;
  groupName: string;
}): Presentations {
  return {
    stdout: noDataLines("A delete has no data; its exit code is the result."),
    json: () => result,
    next: () => [],
    human: (): Block[] => [
      {
        kind: "summary",
        status: "info",
        text: `Variable group "${result.groupName}" and all its branch variables deleted.`,
      },
      {
        kind: "fields",
        rows: [
          { label: "project", value: result.projectId },
          { label: "name", value: result.groupName },
        ],
      },
    ],
  };
}

export const variableGroupDeleteCommand = defineCommand({
  args: {
    positionals: {
      name: positional.string({
        brief: "Group name to delete",
        placeholder: "name",
      }),
    },
    flags: {
      project: projectFlag,
    },
  },
  help: {
    summary: "Delete a custom variable group and all its branch variables",
    description:
      "Permanently deletes the custom group and every variable in it. This cannot be undone. The confirmation token is the group name; pass it with --confirm to run non-interactively. Built-in groups (production, preview) cannot be deleted.",
    examples: [
      "variable group delete staging",
      "variable group delete staging --confirm staging",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const groupName = args.positionals.name;

    const workspace = await resolveActiveWorkspace(ctx);
    const resolved = await resolvePinnedProject(
      ctx,
      workspace,
      args.flags.project,
      "variable group delete",
    );
    const projectId = resolved.project.id;

    const groups = await listVariableGroups(ctx.api, projectId, ctx.signal);
    const existing = groups.find((g) => g.name === groupName);

    if (!existing) {
      throw new CliStructuredError(
        "VARIABLE.GROUP_NOT_FOUND",
        `Variable group "${groupName}" not found`,
        {
          why: "No group with this name exists in the project.",
          nextActions: [
            {
              kind: "user-choice",
              label: "Run `prisma variable group list` to see all groups.",
            },
          ],
        },
      );
    }

    if (existing.class !== "custom") {
      throw new CliStructuredError(
        "VARIABLE.BUILTIN_GROUP_DELETE",
        `Built-in group "${groupName}" cannot be deleted`,
        {
          why: "The production and preview groups are created automatically and cannot be removed.",
          nextActions: [
            {
              kind: "user-choice",
              label:
                "Only custom groups can be deleted. Use `prisma variable group list` to list all groups.",
            },
          ],
        },
      );
    }

    await ctx.prompt.consent(
      `Delete variable group "${groupName}" and all its branch variables?`,
      { token: groupName },
    );

    await deleteVariableGroup(ctx.api, existing.id, ctx.signal);

    const result = { projectId, groupName };
    return ok(ctx.present({ data: result }, deletePresentations(result)));
  },
});
