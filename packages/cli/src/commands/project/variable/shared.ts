/** Flags and utilities shared across the `prisma project variable` commands. */
import { flag } from "@prisma/cli-engine";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import type { ManagementApiClient } from "@prisma/management-api-sdk";
import {
  isBuiltInGroup,
  listVariableGroups,
  type RawVariableGroup,
} from "../../../lib/variable/api";
import type { VariableAssignment } from "../../../lib/variable/assignment";

export const projectFlag = flag.string({
  brief:
    "Project id or name (default: the project this directory is linked to)",
  placeholder: "id-or-name",
});

export const groupFlag = flag.string({
  brief:
    "Variable group name: production, preview, or a custom group. Cannot be used with --role",
  placeholder: "name",
});

export const roleFlag = flag.enum({
  brief:
    "Built-in group by role: production or preview. Cannot be used with --group",
  values: ["production", "preview"],
});

export const fileFlag = flag.string({
  brief:
    "Read KEY=VALUE assignments from a dotenv file; use to import many variables at once",
  placeholder: "path",
});

export const branchFlag = flag.string({
  brief: "Branch git name",
  placeholder: "git-name",
});

export const serviceFlag = flag.string({
  brief:
    "Service name or id; with --branch, also show that service's own service variables",
  placeholder: "id-or-name",
});

export type VariableGroupTarget =
  | { kind: "group-name"; name: string }
  | { kind: "role"; role: "production" | "preview" };

/** Resolve --group and --role into one target, enforcing mutual exclusion. */
export function resolveGroupTarget(
  groupName: string | undefined,
  roleName: string | undefined,
  command: "add" | "update" | "delete",
): VariableGroupTarget {
  if (groupName !== undefined && roleName !== undefined) {
    throw new CliStructuredError(
      "VARIABLE.CONFLICTING_FLAGS",
      `prisma project variable ${command} accepts --group or --role, not both`,
      {
        why: "--group names any group including built-in ones; --role is a shorthand for production or preview.",
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Pass --group production, --group preview, or --group <custom-name>.",
          },
        ],
      },
    );
  }

  if (groupName !== undefined) {
    return { kind: "group-name", name: groupName };
  }

  if (roleName !== undefined) {
    return { kind: "role", role: roleName as "production" | "preview" };
  }

  throw new CliStructuredError(
    "VARIABLE.MISSING_GROUP",
    `prisma project variable ${command} requires --group or --role`,
    {
      why: "Writing without an explicit target is rejected so the command never silently targets production.",
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Pass --role production, --role preview, or --group <name> for a custom group.",
        },
      ],
    },
  );
}

/** Check if a project has any custom groups, and fail if --role preview was
 *  used in such a project: those branches would not all receive the preview group. */
export async function enforceRolePreviewCheck(
  client: ManagementApiClient,
  projectId: string,
  target: VariableGroupTarget,
  signal: AbortSignal,
): Promise<void> {
  if (target.kind !== "role" || target.role !== "preview") {
    return;
  }

  const groups = await listVariableGroups(client, projectId, signal);
  const hasCustomGroups = groups.some((g) => !isBuiltInGroup(g));

  if (hasCustomGroups) {
    throw new CliStructuredError(
      "VARIABLE.CUSTOM_GROUP_CONFLICT",
      "This project has custom variable groups, so --role preview does not reach every preview branch",
      {
        why: "With custom groups, some preview branches receive a custom group instead of the preview group.",
        nextActions: [
          {
            kind: "user-choice",
            label:
              "Use --group preview for the preview group only, or --group <name> for a specific custom group.",
          },
        ],
      },
    );
  }
}

/** Resolve the group name to a RawVariableGroup object. */
export async function resolveGroupByTarget(
  client: ManagementApiClient,
  projectId: string,
  target: VariableGroupTarget,
  signal: AbortSignal,
): Promise<RawVariableGroup> {
  const groups = await listVariableGroups(client, projectId, signal);

  const name = target.kind === "role" ? target.role : target.name;

  const found = groups.find((g) => g.name === name);
  if (!found) {
    throw new CliStructuredError(
      "VARIABLE.GROUP_NOT_FOUND",
      `Variable group "${name}" not found in this project`,
      {
        why: "No group with this name exists.",
        nextActions: [
          {
            kind: "user-choice",
            label: "Run prisma project variable group list to see all groups.",
          },
        ],
      },
    );
  }

  return found;
}

/** Shared error handler for --branch writes, which are not supported. */
export function rejectBranchWrite(
  branchName: string | undefined,
  command: "add" | "update" | "delete",
): void {
  if (branchName === undefined) {
    return;
  }

  throw new CliStructuredError(
    "VARIABLE.NO_BRANCH_WRITE",
    "`prisma project variable` does not manage overrides. Overrides are deprecated.",
    {
      why: "An override is a value set for one branch with `prisma project env --branch`. Overrides and the `prisma project env` command are deprecated. `prisma project variable` writes branch variables to groups, and each branch receives the one group that matches its name.",
      nextActions: [
        {
          kind: "user-choice",
          label: `Recommended: move the value into a group. Create a custom group for this branch with \`prisma project variable group create <name> --equals ${branchName}\`, then add the value with \`prisma project variable add KEY=value --group <name>\`. The new group does not include the \`preview\` group's values. Add every key the branch needs, or use the Console, which can copy them. In Console, use "Move to a custom group" on the service's Variables page.`,
        },
        {
          kind: "run-command",
          label: `Deprecated, for an existing override only: prisma project env ${command} KEY=value --branch ${branchName}`,
          command: `prisma project env ${command} KEY=value --branch ${branchName}`,
        },
      ],
    },
  );
}

/** Writes a dotenv file's assignments one at a time, in file order. When a
 *  write fails, the error names the keys already written, so the user knows
 *  what to remove from the file before running the command again. */
export async function writeFileAssignments<T>(
  filePath: string,
  command: "add" | "update",
  assignments: readonly VariableAssignment[],
  write: (assignment: VariableAssignment) => Promise<T>,
): Promise<T[]> {
  const written: T[] = [];
  const writtenKeys: string[] = [];
  for (const assignment of assignments) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: the import stops at the first failed key, so writes run in order.
      written.push(await write(assignment));
      writtenKeys.push(assignment.key);
    } catch (error) {
      const cause =
        error instanceof Error ? error.message : "The API call failed.";
      throw new CliStructuredError(
        "VARIABLE.FILE_APPLY_FAILED",
        `Failed to ${command} "${assignment.key}" from "${filePath}"`,
        {
          why:
            writtenKeys.length === 0
              ? `No keys were written. ${cause}`
              : `These keys were written before the failure: ${writtenKeys.join(", ")}. ${cause}`,
          meta: { file: filePath, failedKey: assignment.key, writtenKeys },
          nextActions: [
            {
              kind: "user-choice",
              label:
                writtenKeys.length === 0
                  ? "Fix the cause and run the command again."
                  : "Remove the written keys from the file, fix the cause, and run the command again.",
            },
          ],
        },
      );
    }
  }
  return written;
}

export function variableFieldRows(
  projectId: string,
  groupName: string,
  key: string,
  id: string,
  updatedAt: string,
): Array<{ label: string; value: string }> {
  return [
    { label: "project", value: projectId },
    { label: "group", value: groupName },
    { label: "key", value: key },
    { label: "id", value: id },
    { label: "last updated", value: updatedAt },
  ];
}
