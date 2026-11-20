/** The `variable delete` command. */
import {
  type Block,
  defineCommand,
  noDataLines,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import { apiCallError } from "../../controllers/app-env-api";
import { resolvePinnedProject } from "../project/context";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
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

export const variableDeleteCommand = defineCommand({
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
      "variable delete STRIPE_KEY --group production",
      "variable delete STRIPE_KEY --role preview",
      "variable delete STRIPE_KEY --group staging",
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
      "variable delete",
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

    // Look up the variable in this group.
    const {
      data: listData,
      error: listError,
      response: listResponse,
    } = await ctx.api.GET("/v1/environment-variables", {
      params: {
        // groupId is not in the published SDK types
        query: { projectId, key, groupId: group.id } as any,
      },
      signal: ctx.signal,
    });

    if (listError || !listData) {
      throw apiCallError(`Failed to look up ${key}`, listResponse, listError);
    }

    const rows = listData.data as Array<{ id: string }>;
    const existing = rows[0];

    if (!existing) {
      throw new CliStructuredError(
        "VARIABLE.NOT_FOUND",
        `Variable "${key}" not found in group "${group.name}"`,
        {
          why: "No variable with this key exists in the targeted group.",
          nextActions: [
            {
              kind: "user-choice",
              label: `Run \`prisma variable list --group ${group.name}\` to see the available variables.`,
            },
          ],
        },
      );
    }

    const { error, response } = await ctx.api.DELETE(
      "/v1/environment-variables/{envVarId}",
      {
        params: { path: { envVarId: existing.id } },
        signal: ctx.signal,
      },
    );
    if (error) {
      throw apiCallError(`Failed to delete ${key}`, response, error);
    }

    const result = { projectId, groupName: group.name, key };
    return ok(ctx.present({ data: result }, deletePresentations(result)));
  },
});
