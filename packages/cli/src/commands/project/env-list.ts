/** The `project env list` command. */
import {
  type Block,
  defineCommand,
  flag,
  type Presentations,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import {
  formatScopeFlag,
  listOverviewVariables,
  listVariables,
  resolveListScopeToApi,
} from "../../controllers/app-env";
import { toMetadata } from "../../controllers/app-env-api";
import { resolveEnvScope } from "../../lib/app/env-config";
import { listTargetLabel, serializeEnvList } from "../../presenters/app-env";
import type { EnvListResult } from "../../types/app-env";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
import { resolvePinnedProject } from "./context";
import {
  projectFlag,
  roleFlag,
  variableRows,
  variableStdoutRows,
} from "./env-shared";

const TITLE = "Listing environment variables for the selected scope.";

function listPresentations(
  result: EnvListResult,
  addScopeFlag: string,
): Presentations {
  const rows = variableRows(result.variables);
  const stdoutRows = variableStdoutRows(result.variables);
  return {
    human: (): Block[] => [
      { kind: "summary", status: "info", text: TITLE },
      {
        kind: "fields",
        rows: [{ label: "target", value: listTargetLabel(result) }],
      },
      ...(rows.length === 0
        ? [
            {
              kind: "summary" as const,
              status: "info" as const,
              text: "No environment variables defined in this scope.",
            },
          ]
        : [
            {
              kind: "table" as const,
              columns: ["variable", "id", "status"],
              rows,
            },
          ]),
    ],
    stdout: () => stdoutRows.map((row) => row.join("\t")),
    json: () => serializeEnvList(result),
    next: () =>
      result.variables.length === 0
        ? [
            {
              kind: "run-command",
              label: `${CLI_NAME} project env add KEY=value ${addScopeFlag}`,
              command: `${CLI_NAME} project env add KEY=value ${addScopeFlag}`,
            },
          ]
        : [],
  };
}

export const projectEnvListCommand = defineCommand({
  args: {
    flags: {
      role: roleFlag,
      branch: flag.string({
        brief:
          "Show what one preview branch resolves: the preview scope plus its overrides",
        placeholder: "git-name",
      }),
      project: projectFlag,
    },
  },
  help: {
    summary:
      "List environment variables in a scope: names and ids, never values",
    description:
      "Values are write-only through the CLI: listing shows names, ids, and status, never values. Without a scope flag it shows an overview of every scope; --role narrows to the production or preview scope, and --branch shows what one preview branch resolves.",
    examples: [
      "project env list",
      "project env list --role production",
      "project env list --role preview",
      "project env list --branch feature/foo",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const explicit = resolveEnvScope(
      { roleName: args.flags.role, branchName: args.flags.branch },
      { requireExplicit: false, command: "list" },
    );
    const workspace = await resolveActiveWorkspace(ctx);
    const target = await resolvePinnedProject(
      ctx,
      workspace,
      args.flags.project,
      "project env list",
    );
    const projectId = target.project.id;
    const resolved = await resolveListScopeToApi(
      ctx.api,
      projectId,
      explicit ?? undefined,
      { signal: ctx.signal },
    );

    const rows =
      resolved.kind === "scoped"
        ? await listVariables(
            ctx.api,
            projectId,
            {
              scope: resolved.addScope,
              descriptor: resolved.descriptor,
              apiTarget: resolved.apiTarget,
            },
            ctx.signal,
          )
        : await listOverviewVariables(ctx.api, projectId, ctx.signal);

    const result: EnvListResult = {
      projectId,
      scope: resolved.descriptor,
      target: resolved.target,
      variables: rows.map((row) => toMetadata(row, resolved.descriptor)),
    };
    return ok(
      ctx.present(
        { data: result },
        listPresentations(result, formatScopeFlag(resolved.addScope)),
      ),
    );
  },
});
