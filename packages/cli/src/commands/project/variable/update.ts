/** The `project variable update` command. */
import {
  type Block,
  defineCommand,
  noDataLines,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import {
  listEnvVarsInGroup,
  type RawGroupVariable,
  updateGroupVariable,
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

function updatePresentations(
  result: { projectId: string; groupName: string } & WrittenVariable,
): Presentations {
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
        text: "Replacing variable values from file.",
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
      "Replaces one variable's value in the named group; the variable must already exist (use 'prisma project variable add' to create it). With --file, replaces every variable the dotenv file lists; every key in the file must already exist in the group. New values reach services on their next deploy.",
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
    const assignments =
      args.flags.file === undefined
        ? [parseAssignment(args.positionals.assignment, "update", ctx.env)]
        : await readDotenvFile(ctx.cwd, args.flags.file, "update");

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

    const existing = new Map<string, RawGroupVariable>(
      (await listEnvVarsInGroup(ctx.api, projectId, group.id, ctx.signal)).map(
        (row) => [row.key, row],
      ),
    );
    const missing = assignments
      .map((a) => a.key)
      .filter((key) => !existing.has(key));
    if (missing.length > 0) {
      throw new CliStructuredError(
        "VARIABLE.NOT_FOUND",
        missing.length === 1
          ? `Variable "${missing[0]}" not found in group "${group.name}"`
          : `${missing.length} variables not found in group "${group.name}"`,
        {
          why: `Missing keys: ${missing.join(", ")}. Nothing was written.`,
          meta: { keys: missing },
          nextActions: [
            {
              kind: "user-choice",
              label:
                args.flags.file === undefined
                  ? `Use \`prisma project variable add ${missing[0]}=<value> --group ${group.name}\` to create it.`
                  : "Move the missing keys into a separate file and import it with prisma project variable add.",
            },
          ],
        },
      );
    }

    const replace = async ({
      key,
      value,
    }: {
      key: string;
      value: string;
    }): Promise<WrittenVariable> => {
      // biome-ignore lint/style/noNonNullAssertion: every key was checked against the group above.
      const row = existing.get(key)!;
      const updated = await updateGroupVariable(
        ctx.api,
        group.id,
        row.id,
        value,
        ctx.signal,
      );
      return { key: updated.key, id: updated.id, updatedAt: updated.updatedAt };
    };

    if (args.flags.file !== undefined) {
      const variables = await writeFileAssignments(
        args.flags.file,
        "update",
        assignments,
        replace,
      );
      const result = {
        projectId,
        groupName: group.name,
        file: { path: args.flags.file, count: variables.length },
        variables,
      };
      return ok(ctx.present({ data: result }, updateFilePresentations(result)));
    }

    const result = {
      projectId,
      groupName: group.name,
      ...(await replace(assignments[0])),
    };
    return ok(ctx.present({ data: result }, updatePresentations(result)));
  },
});
