/** The `project variable update` command. */
import {
  type Block,
  defineCommand,
  noDataLines,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import type { ManagementApiClient } from "@prisma/management-api-sdk";
import { apiCallError } from "../../../controllers/app-env-api";
import { parseKeyValuePositional } from "../../../lib/app/env-config";
import { readEnvFileAssignments } from "../../../lib/app/env-file";
import { findEnvVarInGroup } from "../../../lib/variable/api";
import { resolveActiveWorkspace } from "../../resources-shared/workspace";
import { resolvePinnedProject } from "../context";
import {
  branchFlag,
  enforceRolePreviewCheck,
  fileFlag,
  groupFlag,
  projectFlag,
  rejectBranchWrite,
  resolveGroupByTarget,
  resolveGroupTarget,
  roleFlag,
  variableFieldRows,
} from "./shared";

function updatePresentations(result: {
  projectId: string;
  groupName: string;
  key: string;
  id: string;
  updatedAt: string;
}): Presentations {
  return {
    stdout: noDataLines(
      "Replacing a value has no data; the variable keeps its key and id.",
    ),
    json: () => result,
    next: () => [],
    human: (): Block[] => [
      {
        kind: "summary",
        status: "info",
        text: "Replacing the variable's value.",
      },
      {
        kind: "fields",
        rows: variableFieldRows(
          result.projectId,
          result.groupName,
          result.key,
          result.id,
          result.updatedAt,
        ),
      },
    ],
  };
}

function updateFilePresentations(result: {
  projectId: string;
  groupName: string;
  keys: string[];
}): Presentations {
  return {
    stdout: noDataLines("Replacing values has no data output."),
    json: () => result,
    next: () => [],
    human: (): Block[] => [
      {
        kind: "summary",
        status: "info",
        text: "Replacing variable values from file.",
      },
      {
        kind: "fields",
        rows: [
          { label: "project", value: result.projectId },
          { label: "group", value: result.groupName },
        ],
      },
      result.keys.length === 0
        ? { kind: "summary", status: "info", text: "No variables updated." }
        : {
            kind: "table",
            columns: ["key"],
            rows: result.keys.map((k) => [k]),
          },
    ],
  };
}

export const projectVariableUpdateCommand = defineCommand({
  args: {
    positionals: {
      assignment: positional.optionalString({
        brief:
          "Variable assignment as KEY=VALUE, or KEY to read the value from the current environment",
        placeholder: "assignment",
      }),
    },
    flags: {
      group: groupFlag,
      role: roleFlag,
      file: fileFlag,
      branch: branchFlag,
      project: projectFlag,
    },
  },
  help: {
    summary: "Replace an existing variable's value in a group",
    description:
      "Replaces one variable's value in the named group; the variable must already exist (use `prisma project variable add` to create it). With --file, replaces every variable the dotenv file lists.",
    examples: [
      "project variable update STRIPE_KEY=sk_new_xxx --group production",
      "project variable update STRIPE_KEY=sk_new_xxx --role preview",
      "project variable update --file .env --group staging",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    rejectBranchWrite(args.flags.branch, "update");

    const target = resolveGroupTarget(
      args.flags.group,
      args.flags.role,
      "update",
    );

    const workspace = await resolveActiveWorkspace(ctx);
    const resolved = await resolvePinnedProject(
      ctx,
      workspace,
      args.flags.project,
      "project variable update",
    );
    const projectId = resolved.project.id;

    await enforceRolePreviewCheck(ctx.api, projectId, target, ctx.signal);

    const group = await resolveGroupByTarget(
      ctx.api,
      projectId,
      target,
      ctx.signal,
    );

    if (args.flags.file !== undefined) {
      const assignments = await readEnvFileAssignments(
        ctx.cwd,
        args.flags.file,
        "update",
      );
      const keys: string[] = [];
      for (const { key, value } of assignments) {
        // biome-ignore lint/performance/noAwaitInLoops: keys are updated one at a time so the import stops at the first failure.
        const updated = await updateValueInGroup(
          ctx.api,
          { projectId, groupId: group.id, key, value },
          ctx.signal,
        );
        if (updated) {
          keys.push(key);
        }
      }
      return ok(
        ctx.present(
          { data: { projectId, groupName: group.name, keys } },
          updateFilePresentations({ projectId, groupName: group.name, keys }),
        ),
      );
    }

    const { key, value } = parseKeyValuePositional(
      args.positionals.assignment,
      "update",
      ctx.env,
    );

    const updated = await updateValueInGroup(
      ctx.api,
      { projectId, groupId: group.id, key, value },
      ctx.signal,
    );

    if (!updated) {
      throw new CliStructuredError(
        "VARIABLE.NOT_FOUND",
        `Variable "${key}" not found in group "${group.name}"`,
        {
          why: "No variable with this key exists in the targeted group.",
          nextActions: [
            {
              kind: "user-choice",
              label: `Use \`prisma project variable add ${key}=<value> --group ${group.name}\` to create it.`,
            },
          ],
        },
      );
    }

    const result = {
      projectId,
      groupName: group.name,
      key: updated.key,
      id: updated.id,
      updatedAt: updated.updatedAt,
    };

    return ok(ctx.present({ data: result }, updatePresentations(result)));
  },
});

/** Replaces the value of `key` in one variable group. Returns null when the group has no such key. */
async function updateValueInGroup(
  api: ManagementApiClient,
  input: { projectId: string; groupId: string; key: string; value: string },
  signal: AbortSignal,
): Promise<{ id: string; key: string; updatedAt: string } | null> {
  const existing = await findEnvVarInGroup(api, input, signal);
  if (!existing) {
    return null;
  }

  const { data, error, response } = await api.PATCH(
    "/v1/environment-variables/{envVarId}",
    {
      params: { path: { envVarId: existing.id } },
      body: { value: input.value },
      signal,
    },
  );
  if (error || !data) {
    throw apiCallError(
      `Failed to update value for ${input.key}`,
      response,
      error,
    );
  }
  return data.data as { id: string; key: string; updatedAt: string };
}
