/** The `variable add` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { parseKeyValuePositional } from "../../lib/app/env-config";
import { readEnvFileAssignments } from "../../lib/app/env-file";
import { createEnvVarInGroup } from "../../lib/variable/api";
import { resolvePinnedProject } from "../project/context";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
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

function addPresentations(result: {
  projectId: string;
  groupName: string;
  key: string;
  id: string;
  updatedAt: string;
}): Presentations {
  return {
    stdout: () => [result.id],
    json: () => result,
    next: () => [],
    human: (): Block[] => [
      {
        kind: "summary",
        status: "info",
        text: "Setting a new variable.",
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

function addFilePresentations(result: {
  projectId: string;
  groupName: string;
  keys: string[];
}): Presentations {
  return {
    stdout: () => result.keys,
    json: () => result,
    next: () => [],
    human: (): Block[] => [
      {
        kind: "summary",
        status: "info",
        text: "Setting new variables from file.",
      },
      {
        kind: "fields",
        rows: [
          { label: "project", value: result.projectId },
          { label: "group", value: result.groupName },
        ],
      },
      result.keys.length === 0
        ? { kind: "summary", status: "info", text: "No variables imported." }
        : {
            kind: "table",
            columns: ["key"],
            rows: result.keys.map((k) => [k]),
          },
    ],
  };
}

export const variableAddCommand = defineCommand({
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
    summary: "Add a variable to a group",
    description:
      "Creates a branch variable in the named group: production, preview, or a custom group. Use --group <name> or --role production|preview. The value comes from KEY=VALUE, from the current shell environment when only KEY is given, or from a dotenv file with --file. --branch is not accepted; use a variable group or send a service variable with the deploy.",
    examples: [
      "variable add STRIPE_KEY=sk_test_xxx --group production",
      "variable add STRIPE_KEY=sk_test_xxx --role production",
      "variable add STRIPE_KEY=sk_test_xxx --group staging",
      "variable add --file .env --group preview",
      "API_URL=https://api.example prisma variable add API_URL --group production",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    rejectBranchWrite(args.flags.branch, "add");

    const target = resolveGroupTarget(args.flags.group, args.flags.role, "add");

    const workspace = await resolveActiveWorkspace(ctx);
    const resolved = await resolvePinnedProject(
      ctx,
      workspace,
      args.flags.project,
      "variable add",
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
        "add",
      );
      const keys: string[] = [];
      for (const { key, value } of assignments) {
        // biome-ignore lint/performance/noAwaitInLoops: keys are added one at a time so the import stops at the first failure.
        await createEnvVarInGroup(
          ctx.api,
          { projectId, groupId: group.id, key, value },
          ctx.signal,
        );
        keys.push(key);
      }
      return ok(
        ctx.present(
          { data: { projectId, groupName: group.name, keys } },
          addFilePresentations({ projectId, groupName: group.name, keys }),
        ),
      );
    }

    const { key, value } = parseKeyValuePositional(
      args.positionals.assignment,
      "add",
      ctx.env,
    );

    const row = (await createEnvVarInGroup(
      ctx.api,
      { projectId, groupId: group.id, key, value },
      ctx.signal,
    )) as { id: string; key: string; updatedAt: string };

    const result = {
      projectId,
      groupName: group.name,
      key: row.key,
      id: row.id,
      updatedAt: row.updatedAt,
    };

    return ok(ctx.present({ data: result }, addPresentations(result)));
  },
});
