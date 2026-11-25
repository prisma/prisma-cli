/** Flags and utilities shared across the `prisma project variable` commands. */
import { flag } from "@prisma/cli-engine";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import type { ManagementApiClient } from "@prisma/management-api-sdk";
import {
  isBuiltInGroup,
  listVariableGroups,
  type RawVariableGroup,
} from "../../../lib/variable/api";

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
  brief: "Service name or id",
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
    "`prisma project variable` does not manage overrides",
    {
      why: "Overrides are being phased out. `prisma project variable` sets branch variables in groups.",
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Use `prisma project env` for existing overrides. For new values, set a branch variable in a group, or send a service variable with the deploy.",
        },
        {
          kind: "run-command",
          label: `prisma project env ${command} KEY=value --branch ${branchName}`,
          command: `prisma project env ${command} KEY=value --branch ${branchName}`,
        },
      ],
    },
  );
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
