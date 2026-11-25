/** The `project variable list` command. */
import {
  type Block,
  defineCommand,
  flag,
  type Presentations,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import { listBranches } from "../../../controllers/branch";
import {
  getResolvedVariables,
  listEnvVarsInGroup,
  listVariableGroups,
  type RawVariableGroup,
  type ResolvedVariable,
} from "../../../lib/variable/api";
import { resolveActiveWorkspace } from "../../resources-shared/workspace";
import { resolvePinnedProject } from "../context";
import { projectFlag, roleFlag, serviceFlag } from "./shared";

const MANAGED_NOTE = "Managed by Prisma";
const OVERRIDE_NOTE = "Deprecated override";

function isManaged(key: string, isManagedBySystem: boolean | undefined) {
  return isManagedBySystem === true || key.startsWith("COMPOSER_");
}

interface BranchKey {
  key: string;
  source: string;
  note: string | null;
}

function toBranchKey(item: ResolvedVariable): BranchKey {
  const note = isManaged(item.key, item.isManagedBySystem)
    ? MANAGED_NOTE
    : null;
  if (item.source.type === "group") {
    return {
      key: item.key,
      source: `group:${item.source.groupName}`,
      note,
    };
  }
  if (item.source.type === "override") {
    return { key: item.key, source: "override", note: OVERRIDE_NOTE };
  }
  return { key: item.key, source: `service:${item.source.serviceId}`, note };
}

interface GroupVariable {
  key: string;
  id: string;
  updatedAt: string;
  isManagedBySystem: boolean;
}

interface GroupWithVariables {
  group: RawVariableGroup;
  variables: GroupVariable[];
}

interface BranchResolved {
  branchName: string;
  groupName: string;
  groupClass: string;
  keys: BranchKey[];
}

function branchPresentations(
  projectId: string,
  branch: BranchResolved,
): Presentations {
  const rows = branch.keys.map((item) => [
    item.key,
    item.source,
    item.note ?? "",
  ]);
  const hasOverrides = branch.keys.some((item) => item.source === "override");
  return {
    json: () => ({ projectId, branchResolved: branch }),
    next: () => [],
    stdout: () => rows.map((row) => row.slice(0, 2).join("\t")),
    human: (): Block[] => [
      {
        kind: "summary",
        status: "info",
        text: `Variables for branch ${branch.branchName}.`,
      },
      {
        kind: "fields",
        rows: [
          { label: "project", value: projectId },
          { label: "branch", value: branch.branchName },
          {
            label: "project variable group",
            value: `${branch.groupName} (${branch.groupClass})`,
          },
        ],
      },
      rows.length === 0
        ? { kind: "summary", status: "info", text: "No variables." }
        : {
            kind: "table",
            columns: ["key", "source", "note"],
            rows,
          },
      ...(hasOverrides
        ? [
            {
              kind: "summary",
              status: "warn",
              text: "Overrides are deprecated. Move each value into a group with `prisma project variable add`, or give this branch its own custom group with `prisma project variable group create`.",
            } satisfies Block,
          ]
        : []),
    ],
  };
}

function groupsPresentations(
  projectId: string,
  groups: GroupWithVariables[],
  singleGroup: boolean,
): Presentations {
  const humanBlocks: Block[] = [
    {
      kind: "summary",
      status: "info",
      text: "Listing variables by group.",
    },
    {
      kind: "fields",
      rows: [{ label: "project", value: projectId }],
    },
  ];

  if (groups.length === 0) {
    humanBlocks.push({
      kind: "summary",
      status: "info",
      text: "No variable groups found.",
    });
  }
  for (const { group, variables } of groups) {
    humanBlocks.push({
      kind: "summary",
      status: "info",
      text: `Group: ${group.name} (${group.class})`,
    });
    humanBlocks.push(
      variables.length === 0
        ? {
            kind: "summary",
            status: "info",
            text: "  No variables in this group.",
          }
        : {
            kind: "table",
            columns: ["key", "id", "note"],
            rows: variables.map((v) => [
              v.key,
              v.id,
              v.isManagedBySystem ? MANAGED_NOTE : "",
            ]),
          },
    );
  }

  const only = singleGroup ? groups[0] : undefined;
  return {
    json: () => ({ projectId, groups }),
    next: () =>
      only !== undefined && only.variables.length === 0
        ? [
            {
              kind: "run-command",
              label: `prisma project variable add KEY=value --group ${only.group.name}`,
              command: `prisma project variable add KEY=value --group ${only.group.name}`,
            },
          ]
        : [],
    stdout: () =>
      groups.flatMap(({ group, variables }) =>
        variables.map((v) => `${group.name}\t${v.key}\t${v.id}`),
      ),
    human: () => humanBlocks,
  };
}

export const projectVariableListCommand = defineCommand({
  args: {
    flags: {
      group: flag.string({
        brief:
          "Show one group by name: production, preview, or a custom group. Cannot be used with --role",
        placeholder: "name",
      }),
      role: roleFlag,
      branch: flag.string({
        brief:
          "Show what one branch receives: its group and every key with its source",
        placeholder: "git-name",
      }),
      service: serviceFlag,
      project: projectFlag,
    },
  },
  help: {
    summary: "List branch variables by group, or what a branch receives",
    description:
      "Lists keys and ids, never values. Without flags, shows every group with its keys, one section per group. --group or --role shows one group only. --branch shows what one branch receives at its next deploy: the group it gets and where each key comes from. A key marked 'Deprecated override' was set for that one branch with 'prisma project env --branch'; move it into a group. A key marked 'Managed by Prisma' is set by Prisma. Add --service to include that service's own variables.",
    examples: [
      "project variable list",
      "project variable list --role production",
      "project variable list --group staging",
      "project variable list --branch feature/foo",
      "project variable list --branch feature/foo --service api",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    if (args.flags.group !== undefined && args.flags.role !== undefined) {
      throw new CliStructuredError(
        "VARIABLE.CONFLICTING_FLAGS",
        "prisma project variable list accepts --group or --role, not both",
        {
          why: "--group names any group including built-in ones; --role is a shorthand for production or preview.",
          nextActions: [
            {
              kind: "user-choice",
              label: "Pass --group <name>, or --role production or preview.",
            },
          ],
        },
      );
    }

    const workspace = await resolveActiveWorkspace(ctx);
    const resolved = await resolvePinnedProject(
      ctx,
      workspace,
      args.flags.project,
      "project variable list",
    );
    const projectId = resolved.project.id;

    if (args.flags.branch !== undefined) {
      const branchName = args.flags.branch;
      const branches = await listBranches(ctx.api, projectId, ctx.signal);
      const branch = branches.find((b) => b.gitName === branchName);
      if (!branch) {
        throw new CliStructuredError(
          "VARIABLE.BRANCH_NOT_FOUND",
          `Branch "${branchName}" not found in this project`,
          {
            why: "No branch with this git name exists. A branch exists once it has been deployed.",
            nextActions: [
              {
                kind: "run-command",
                label: "prisma branch list",
                command: "prisma branch list",
              },
            ],
          },
        );
      }

      const resolvedVars = await getResolvedVariables(ctx.api, projectId, {
        branchId: branch.id,
        serviceId: args.flags.service,
        signal: ctx.signal,
      });
      const branchResolved: BranchResolved = {
        branchName,
        groupName: resolvedVars.group.name,
        groupClass: resolvedVars.group.class,
        keys: resolvedVars.data.map(toBranchKey),
      };
      return ok(
        ctx.present(
          { data: { projectId, branchResolved } },
          branchPresentations(projectId, branchResolved),
        ),
      );
    }

    const allGroups = await listVariableGroups(ctx.api, projectId, ctx.signal);
    const groupName = args.flags.group ?? args.flags.role;
    let targetGroups = allGroups;
    if (groupName !== undefined) {
      const found = allGroups.find((g) => g.name === groupName);
      if (!found) {
        throw new CliStructuredError(
          "VARIABLE.GROUP_NOT_FOUND",
          `Variable group "${groupName}" not found in this project`,
          {
            why: "No group with this name exists.",
            nextActions: [
              {
                kind: "run-command",
                label: "prisma project variable group list",
                command: "prisma project variable group list",
              },
            ],
          },
        );
      }
      targetGroups = [found];
    }

    const groups: GroupWithVariables[] = [];
    for (const group of targetGroups) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential group fetches are acceptable for a list command.
      const rows = await listEnvVarsInGroup(
        ctx.api,
        projectId,
        group.id,
        ctx.signal,
      );
      groups.push({
        group,
        variables: rows
          .map((row) => ({
            key: row.key,
            id: row.id,
            updatedAt: row.updatedAt,
            isManagedBySystem: isManaged(row.key, row.isManagedBySystem),
          }))
          .sort((a, b) => a.key.localeCompare(b.key)),
      });
    }

    return ok(
      ctx.present(
        { data: { projectId, groups } },
        groupsPresentations(projectId, groups, groupName !== undefined),
      ),
    );
  },
});
