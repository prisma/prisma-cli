/** The `project variable add` command. */
import {
  type Block,
  defineCommand,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import {
  createEnvVarInGroup,
  listEnvVarsInGroup,
} from "../../../lib/variable/api";
import {
  parseAssignment,
  readDotenvFile,
} from "../../../lib/variable/assignment";
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
  writeFileAssignments,
} from "./shared";

interface WrittenVariable {
  key: string;
  id: string;
  updatedAt: string;
}

function addPresentations(
  result: { projectId: string; groupName: string } & WrittenVariable,
): Presentations {
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
  file: { path: string; count: number };
  variables: WrittenVariable[];
}): Presentations {
  return {
    stdout: () => result.variables.map((v) => `${v.key}\t${v.id}`),
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
          { label: "file", value: result.file.path },
        ],
      },
      {
        kind: "table",
        columns: ["key", "id"],
        rows: result.variables.map((v) => [v.key, v.id]),
      },
    ],
  };
}

export const projectVariableAddCommand = defineCommand({
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
      "Creates a branch variable in the named group: production, preview, or a custom group. Use --group <name> or --role production|preview. The value comes from KEY=VALUE, from the current shell environment when only KEY is given, or from a dotenv file with --file. The key must not exist in the group yet; use 'prisma project variable update' to change a value. --branch is not accepted: write to a group instead.",
    examples: [
      "project variable add STRIPE_KEY=sk_test_xxx --group production",
      "project variable add STRIPE_KEY=sk_test_xxx --role production",
      "project variable add STRIPE_KEY=sk_test_xxx --group staging",
      "project variable add --file .env --group preview",
      "API_URL=https://api.example prisma project variable add API_URL --group production",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    rejectBranchWrite(args.flags.branch, "add");

    const target = resolveGroupTarget(args.flags.group, args.flags.role, "add");
    const assignments =
      args.flags.file === undefined
        ? [parseAssignment(args.positionals.assignment, "add", ctx.env)]
        : await readDotenvFile(ctx.cwd, args.flags.file, "add");

    const workspace = await resolveActiveWorkspace(ctx);
    const resolved = await resolvePinnedProject(
      ctx,
      workspace,
      args.flags.project,
      "project variable add",
    );
    const projectId = resolved.project.id;

    await enforceRolePreviewCheck(ctx.api, projectId, target, ctx.signal);

    const group = await resolveGroupByTarget(
      ctx.api,
      projectId,
      target,
      ctx.signal,
    );

    const existingKeys = new Set(
      (await listEnvVarsInGroup(ctx.api, projectId, group.id, ctx.signal)).map(
        (row) => row.key,
      ),
    );
    const conflicts = assignments
      .map((a) => a.key)
      .filter((key) => existingKeys.has(key));
    if (conflicts.length > 0) {
      throw new CliStructuredError(
        "VARIABLE.ALREADY_EXISTS",
        conflicts.length === 1
          ? `Variable "${conflicts[0]}" already exists in group "${group.name}"`
          : `${conflicts.length} variables already exist in group "${group.name}"`,
        {
          why: `Existing keys: ${conflicts.join(", ")}. Nothing was written.`,
          meta: { keys: conflicts },
          nextActions: [
            {
              kind: "user-choice",
              label:
                args.flags.file === undefined
                  ? "Use prisma project variable update to change the value."
                  : "Move the existing keys into a separate file and import it with prisma project variable update.",
            },
            ...(args.flags.file === undefined
              ? [
                  {
                    kind: "run-command" as const,
                    label: `prisma project variable update ${conflicts[0]}=<value> --group ${group.name}`,
                    command: `prisma project variable update ${conflicts[0]}=<value> --group ${group.name}`,
                  },
                ]
              : []),
          ],
        },
      );
    }

    const create = async ({
      key,
      value,
    }: {
      key: string;
      value: string;
    }): Promise<WrittenVariable> => {
      const row = await createEnvVarInGroup(
        ctx.api,
        { projectId, groupId: group.id, key, value },
        ctx.signal,
      );
      return { key: row.key, id: row.id, updatedAt: row.updatedAt };
    };

    if (args.flags.file !== undefined) {
      const variables = await writeFileAssignments(
        args.flags.file,
        "add",
        assignments,
        create,
      );
      const result = {
        projectId,
        groupName: group.name,
        file: { path: args.flags.file, count: variables.length },
        variables,
      };
      return ok(ctx.present({ data: result }, addFilePresentations(result)));
    }

    const result = {
      projectId,
      groupName: group.name,
      ...(await create(assignments[0])),
    };
    return ok(ctx.present({ data: result }, addPresentations(result)));
  },
});
