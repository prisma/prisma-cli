/** The `project variable list` command. */
import {
  type Block,
  defineCommand,
  flag,
  type Presentations,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
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
import { projectFlag, serviceFlag } from "./shared";

const MANAGED_NOTE = "Managed by Prisma";
const OVERRIDE_NOTE = "Deprecated override";

interface BranchKey {
  key: string;
  source: string;
  note: string | null;
}

function toBranchKey(item: ResolvedVariable): BranchKey {
  const managed = item.isManagedBySystem || item.key.startsWith("COMPOSER_");
  if (item.source.type === "group") {
    return {
      key: item.key,
      source: `group:${item.source.groupName}`,
      note: managed ? MANAGED_NOTE : null,
    };
  }
  if (item.source.type === "override") {
    return { key: item.key, source: "override", note: OVERRIDE_NOTE };
  }
  return {
    key: item.key,
    source: `service:${item.source.serviceId}`,
    note: managed ? MANAGED_NOTE : null,
  };
}

interface GroupWithVariables {
  group: RawVariableGroup;
  keys: string[];
}

function listPresentations(result: {
  projectId: string;
  groups?: GroupWithVariables[];
  branchResolved?: {
    branchName: string;
    groupName: string;
    groupClass: string;
    keys: BranchKey[];
  };
}): Presentations {
  const branch = result.branchResolved;
  if (branch) {
    const rows = branch.keys.map((item) => [
      item.key,
      item.source,
      item.note ?? "",
    ]);
    const hasOverrides = branch.keys.some((item) => item.source === "override");
    return {
      json: () => result,
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
            { label: "project", value: result.projectId },
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

  const groups = result.groups ?? [];
  const humanBlocks: Block[] = [
    {
      kind: "summary",
      status: "info",
      text: "Listing variables by group.",
    },
    {
      kind: "fields",
      rows: [{ label: "project", value: result.projectId }],
    },
  ];

  if (groups.length === 0) {
    humanBlocks.push({
      kind: "summary",
      status: "info",
      text: "No variable groups found.",
    });
  } else {
    for (const { group, keys } of groups) {
      humanBlocks.push({
        kind: "summary",
        status: "info",
        text: `Group: ${group.name} (${group.class})`,
      } as Block);
      if (keys.length === 0) {
        humanBlocks.push({
          kind: "summary",
          status: "info",
          text: "  No variables in this group.",
        } as Block);
      } else {
        humanBlocks.push({
          kind: "table",
          columns: ["key"],
          rows: keys.map((k) => [k]),
        } as Block);
      }
    }
  }

  const stdoutRows: string[] = [];
  for (const { group, keys } of groups) {
    for (const key of keys) {
      stdoutRows.push(`${group.name}\t${key}`);
    }
  }

  return {
    json: () => result,
    next: () => [],
    stdout: () => stdoutRows,
    human: () => humanBlocks,
  };
}

export const projectVariableListCommand = defineCommand({
  args: {
    flags: {
      group: flag.string({
        brief: "Show one group by name: production, preview, or a custom group",
        placeholder: "name",
      }),
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
      "Lists keys, never values. Without flags, shows every group with its keys, one section per group. --group shows one group only. --branch shows what one branch receives at its next deploy: the group it gets and where each key comes from. A key marked 'Deprecated override' was set for that one branch with 'prisma project env --branch'; move it into a group. A key marked 'Managed by Prisma' starts with COMPOSER_ and is set by Prisma. Add --service to include that service's own variables.",
    examples: [
      "project variable list",
      "project variable list --group production",
      "project variable list --group staging",
      "project variable list --branch feature/foo",
      "project variable list --branch feature/foo --service api",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const workspace = await resolveActiveWorkspace(ctx);
    const resolved = await resolvePinnedProject(
      ctx,
      workspace,
      args.flags.project,
      "project variable list",
    );
    const projectId = resolved.project.id;

    if (args.flags.branch !== undefined) {
      // Resolve the branch to get its id.
      const branches = await listBranches(ctx.api, projectId, ctx.signal);
      const branch = branches.find((b) => b.gitName === args.flags.branch);
      if (!branch) {
        return ok(
          ctx.present(
            {
              data: {
                projectId,
                branchResolved: {
                  branchName: args.flags.branch,
                  groupName: "unknown",
                  groupClass: "unknown",
                  keys: [],
                },
              },
            },
            listPresentations({
              projectId,
              branchResolved: {
                branchName: args.flags.branch,
                groupName: "unknown",
                groupClass: "unknown",
                keys: [],
              },
            }),
          ),
        );
      }

      const resolvedVars = await getResolvedVariables(ctx.api, projectId, {
        branchId: branch.id,
        serviceId: args.flags.service,
        signal: ctx.signal,
      });

      const keys = resolvedVars.data.map(toBranchKey);

      const branchResolved = {
        branchName: args.flags.branch,
        groupName: resolvedVars.group.name,
        groupClass: resolvedVars.group.class,
        keys,
      };

      return ok(
        ctx.present(
          { data: { projectId, branchResolved } },
          listPresentations({ projectId, branchResolved }),
        ),
      );
    }

    // No --branch: show groups.
    const allGroups = await listVariableGroups(ctx.api, projectId, ctx.signal);

    let targetGroups = allGroups;
    if (args.flags.group !== undefined) {
      const found = allGroups.find((g) => g.name === args.flags.group);
      targetGroups = found ? [found] : [];
    }

    const groupsWithVariables: GroupWithVariables[] = [];
    for (const group of targetGroups) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential group fetches are acceptable for a list command.
      const rows = (await listEnvVarsInGroup(
        ctx.api,
        projectId,
        group.id,
        ctx.signal,
      )) as Array<{ key: string }>;
      groupsWithVariables.push({
        group,
        keys: rows.map((r) => r.key).sort(),
      });
    }

    const data = { projectId, groups: groupsWithVariables };
    return ok(ctx.present({ data }, listPresentations(data)));
  },
});
