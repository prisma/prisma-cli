/** The `variable group update` command. */
import {
  type Block,
  defineCommand,
  flag,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import {
  formatGroupRule,
  listVariableGroups,
  updateVariableGroup,
} from "../../lib/variable/api";
import { resolvePinnedProject } from "../project/context";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
import { projectFlag } from "./shared";

function updatePresentations(result: {
  projectId: string;
  group: { id: string; name: string; class: string; rule: string };
}): Presentations {
  return {
    stdout: () => [result.group.id],
    json: () => result,
    next: () => [],
    human: (): Block[] => [
      {
        kind: "summary",
        status: "info",
        text: "Variable group updated.",
      },
      {
        kind: "fields",
        rows: [
          { label: "project", value: result.projectId },
          { label: "name", value: result.group.name },
          { label: "class", value: result.group.class },
          { label: "rule", value: result.group.rule },
          { label: "id", value: result.group.id },
        ],
      },
    ],
  };
}

export const variableGroupUpdateCommand = defineCommand({
  args: {
    positionals: {
      currentName: positional.string({
        brief: "Current group name",
        placeholder: "current-name",
      }),
    },
    flags: {
      name: flag.string({
        brief: "New name for the group",
        placeholder: "new-name",
      }),
      equals: flag.string({
        brief: "New equals rule; cannot be combined with --starts-with",
        placeholder: "branch-name",
      }),
      startsWith: flag.string({
        brief: "New startsWith rule; cannot be combined with --equals",
        placeholder: "prefix",
      }),
      project: projectFlag,
    },
  },
  help: {
    summary: "Rename a group or change its rule",
    description:
      "Updates a variable group: rename it with --name, replace its rule with --equals or --starts-with, or do both at once. Built-in groups (production, preview) accept --name only.",
    examples: [
      "variable group update staging --name staging/eu",
      "variable group update staging --equals staging-branch",
      "variable group update features --starts-with feature/",
      "variable group update staging --name staging/new --equals staging-new",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    if (
      args.flags.equals !== undefined &&
      args.flags.startsWith !== undefined
    ) {
      throw new CliStructuredError(
        "VARIABLE.GROUP_RULE_CONFLICT",
        "variable group update accepts --equals or --starts-with, not both",
        {
          why: "A group has exactly one rule.",
          nextActions: [
            {
              kind: "user-choice",
              label: "Pass --equals <value> or --starts-with <prefix>.",
            },
          ],
        },
      );
    }

    if (
      args.flags.name === undefined &&
      args.flags.equals === undefined &&
      args.flags.startsWith === undefined
    ) {
      throw new CliStructuredError(
        "VARIABLE.GROUP_NOTHING_TO_UPDATE",
        "variable group update requires at least one of --name, --equals, or --starts-with",
        {
          why: "Nothing to update.",
          nextActions: [
            {
              kind: "user-choice",
              label:
                "Pass --name <new-name> to rename, or --equals/--starts-with to change the rule.",
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
      "variable group update",
    );
    const projectId = resolved.project.id;

    const groups = await listVariableGroups(ctx.api, projectId, ctx.signal);
    const existing = groups.find(
      (g) => g.name === args.positionals.currentName,
    );

    if (!existing) {
      throw new CliStructuredError(
        "VARIABLE.GROUP_NOT_FOUND",
        `Variable group "${args.positionals.currentName}" not found`,
        {
          why: "No group with this name exists in the project.",
          nextActions: [
            {
              kind: "user-choice",
              label: "Run `prisma variable group list` to see all groups.",
            },
          ],
        },
      );
    }

    const patch: {
      name?: string;
      rule?: { type: "equals" | "startsWith"; value: string } | null;
    } = {};

    if (args.flags.name !== undefined) {
      patch.name = args.flags.name;
    }

    if (args.flags.equals !== undefined) {
      if (existing.class !== "custom") {
        throw new CliStructuredError(
          "VARIABLE.BUILTIN_GROUP_NO_RULE",
          `Built-in group "${existing.name}" does not support rule changes`,
          {
            why: "Only custom groups have configurable rules.",
            nextActions: [
              {
                kind: "user-choice",
                label:
                  "Create a custom group with `prisma variable group create`.",
              },
            ],
          },
        );
      }
      patch.rule = { type: "equals", value: args.flags.equals };
    } else if (args.flags.startsWith !== undefined) {
      if (existing.class !== "custom") {
        throw new CliStructuredError(
          "VARIABLE.BUILTIN_GROUP_NO_RULE",
          `Built-in group "${existing.name}" does not support rule changes`,
          {
            why: "Only custom groups have configurable rules.",
            nextActions: [
              {
                kind: "user-choice",
                label:
                  "Create a custom group with `prisma variable group create`.",
              },
            ],
          },
        );
      }
      patch.rule = { type: "startsWith", value: args.flags.startsWith };
    }

    const updated = await updateVariableGroup(
      ctx.api,
      existing.id,
      patch,
      ctx.signal,
    );

    const data = {
      projectId,
      group: {
        id: updated.id,
        name: updated.name,
        class: updated.class,
        rule: formatGroupRule(updated),
      },
    };

    return ok(ctx.present({ data }, updatePresentations(data)));
  },
});
