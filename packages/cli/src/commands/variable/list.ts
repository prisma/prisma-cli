/** The `variable list` command. */
import {
  type Block,
  defineCommand,
  flag,
  type Presentations,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { listBranches } from "../../controllers/branch";
import {
  getResolvedVariables,
  listEnvVarsInGroup,
  listVariableGroups,
  type RawVariableGroup,
  type ResolvedVariableSource,
} from "../../lib/variable/api";

function sourceLabel(source: ResolvedVariableSource): string {
  if (source.type === "group") {
    return `group:${source.groupName}`;
  }
  if (source.type === "branchOverride") {
    return "branch-override";
  }
  return `service:${source.serviceId}`;
}

import { resolvePinnedProject } from "../project/context";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
import { projectFlag, serviceFlag } from "./shared";

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
    keys: Array<{ key: string; source: string }>;
  };
}): Presentations {
  const branch = result.branchResolved;
  if (branch) {
    const rows = branch.keys.map((item) => [item.key, item.source]);
    return {
      json: () => result,
      next: () => [],
      stdout: () => rows.map((row) => row.join("\t")),
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
              label: "variable group",
              value: `${branch.groupName} (${branch.groupClass})`,
            },
          ],
        },
        rows.length === 0
          ? { kind: "summary", status: "info", text: "No variables." }
          : {
              kind: "table",
              columns: ["key", "source"],
              rows,
            },
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

export const variableListCommand = defineCommand({
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
    summary: "List variables: by group, or what a branch receives",
    description:
      "Without flags, shows every group with its variable keys — one section per group. --group shows one group only. --branch shows the variable set a preview branch receives, including which group it sources and each key's origin. Add --service to include that service's variables too.",
    examples: [
      "variable list",
      "variable list --group production",
      "variable list --group staging",
      "variable list --branch feature/foo",
      "variable list --branch feature/foo --service api",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const workspace = await resolveActiveWorkspace(ctx);
    const resolved = await resolvePinnedProject(
      ctx,
      workspace,
      args.flags.project,
      "variable list",
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

      const keys = resolvedVars.data.map((item) => ({
        key: item.key,
        source: sourceLabel(item.source),
      }));

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
