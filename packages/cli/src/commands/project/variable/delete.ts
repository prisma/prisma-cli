/** The `project variable delete` command. */
import {
  type Block,
  defineCommand,
  noDataLines,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import {
  deleteGroupVariable,
  findEnvVarInGroup,
} from "../../../lib/variable/api";
import { resolveActiveWorkspace } from "../../resources-shared/workspace";
import { resolvePinnedProject } from "../context";
import {
  branchFlag,
  enforceRolePreviewCheck,
  groupFlag,
  projectFlag,
  rejectBranchWrite,
  resolveGroupByTarget,
  resolveGroupTarget,
  roleFlag,
} from "./shared";

function deletePresentations(result: {
  projectId: string;
  groupName: string;
  key: string;
}): Presentations {
  return {
    stdout: noDataLines("A delete has no data; its exit code is the result."),
    json: () => result,
    next: () => [],
    human: (): Block[] => [
      {
        kind: "summary",
        status: "info",
        text: "Deleting the variable from the group.",
      },
      {
        kind: "fields",
        rows: [
          { label: "project", value: result.projectId },
          { label: "group", value: result.groupName },
          { label: "key", value: result.key },
        ],
      },
    ],
  };
}

export const projectVariableDeleteCommand = defineCommand({
  args: {
    positionals: {
      key: positional.string({
        brief: "Variable key to delete",
        placeholder: "key",
      }),
    },
    flags: {
      group: groupFlag,
      role: roleFlag,
      branch: branchFlag,
      project: projectFlag,
    },
  },
  help: {
    summary: "Delete a variable from a group",
    description:
      "Removes the variable from the named group. The variable is gone from that group's deploys after the next deploy.",
    examples: [
      "project variable delete STRIPE_KEY --group production",
      "project variable delete STRIPE_KEY --role preview",
      "project variable delete STRIPE_KEY --group staging",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    rejectBranchWrite(args.flags.branch, "delete");

    const target = resolveGroupTarget(
      args.flags.group,
      args.flags.role,
      "delete",
    );

    const workspace = await resolveActiveWorkspace(ctx);
    const resolved = await resolvePinnedProject(
      ctx,
      workspace,
      args.flags.project,
      "project variable delete",
    );
    const projectId = resolved.project.id;

    await enforceRolePreviewCheck(ctx.api, projectId, target, ctx.signal);

    const group = await resolveGroupByTarget(
      ctx.api,
      projectId,
      target,
      ctx.signal,
    );

    const key = args.positionals.key;

    const existing = await findEnvVarInGroup(
      ctx.api,
      { projectId, groupId: group.id, key },
      ctx.signal,
    );

    if (!existing) {
      throw new CliStructuredError(
        "VARIABLE.NOT_FOUND",
        `Variable "${key}" not found in group "${group.name}"`,
        {
          why: "No variable with this key exists in the targeted group.",
          nextActions: [
            {
              kind: "user-choice",
              label: `Run \`prisma project variable list --group ${group.name}\` to see the available variables.`,
            },
          ],
        },
      );
    }

    await deleteGroupVariable(ctx.api, group.id, existing.id, ctx.signal);

    const result = { projectId, groupName: group.name, key };
    return ok(ctx.present({ data: result }, deletePresentations(result)));
  },
});
