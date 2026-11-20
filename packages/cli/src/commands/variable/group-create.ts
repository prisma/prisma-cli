/** The `variable group create` command. */
import {
  type Block,
  defineCommand,
  flag,
  type Presentations,
  positional,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import { createVariableGroup, formatGroupRule } from "../../lib/variable/api";
import { resolvePinnedProject } from "../project/context";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
import { projectFlag } from "./shared";

function createPresentations(result: {
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
        text: "Variable group created.",
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

export const variableGroupCreateCommand = defineCommand({
  args: {
    positionals: {
      name: positional.string({
        brief: "Group name: lowercase letters, digits, and hyphens",
        placeholder: "name",
      }),
    },
    flags: {
      equals: flag.string({
        brief:
          "Match branches whose git name equals this value exactly. Cannot be used with --starts-with",
        placeholder: "branch-name",
      }),
      startsWith: flag.string({
        brief:
          "Match branches whose git name starts with this prefix. Cannot be used with --equals",
        placeholder: "prefix",
      }),
      project: projectFlag,
    },
  },
  help: {
    summary: "Create a custom variable group with a branch-matching rule",
    description:
      "Creates a new custom group for the project. Supply exactly one of --equals or --starts-with to define which branches receive this group's variables. Branches whose git name equals the value or starts with the prefix will source this group instead of the preview group.",
    examples: [
      "variable group create staging --equals staging",
      "variable group create features --starts-with feat/",
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
        "variable group create accepts --equals or --starts-with, not both",
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
      args.flags.equals === undefined &&
      args.flags.startsWith === undefined
    ) {
      throw new CliStructuredError(
        "VARIABLE.GROUP_RULE_MISSING",
        "variable group create requires --equals or --starts-with",
        {
          why: "Every custom group needs a rule so the platform knows which branches to route to it.",
          nextActions: [
            {
              kind: "user-choice",
              label: "Pass --equals <branch-name> or --starts-with <prefix>.",
            },
          ],
        },
      );
    }

    const rule =
      args.flags.equals !== undefined
        ? { type: "equals" as const, value: args.flags.equals }
        : { type: "startsWith" as const, value: args.flags.startsWith ?? "" };

    const workspace = await resolveActiveWorkspace(ctx);
    const resolved = await resolvePinnedProject(
      ctx,
      workspace,
      args.flags.project,
      "variable group create",
    );
    const projectId = resolved.project.id;

    const group = await createVariableGroup(
      ctx.api,
      { projectId, name: args.positionals.name, rule },
      ctx.signal,
    );

    const data = {
      projectId,
      group: {
        id: group.id,
        name: group.name,
        class: group.class,
        rule: formatGroupRule(group),
      },
    };

    return ok(ctx.present({ data }, createPresentations(data)));
  },
});
