/** The `project env list` command. */
import {
  type Block,
  defineCommand,
  flag,
  type Presentations,
} from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
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
import { projectFlag, roleFlag, variableRows } from "./env-shared";
import { mapProjectOperationError } from "./errors";

const TITLE = "Listing environment variables for the selected scope.";

function listPresentations(
  result: EnvListResult,
  addScopeFlag: string,
): Presentations {
  const rows = variableRows(result.variables);
  return {
    human: (): Block[] => [
      { kind: "summary", tone: "info", text: TITLE },
      {
        kind: "fields",
        rows: [{ label: "target", value: listTargetLabel(result) }],
      },
      ...(rows.length === 0
        ? [
            {
              kind: "list" as const,
              items: ["No environment variables defined in this scope."],
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
    stdout: () => rows.map((row) => row.join("\t")),
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
        brief: "Preview branch resolved scope",
        placeholder: "git-name",
      }),
      project: projectFlag,
    },
  },
  help: {
    summary: "List environment variable metadata for a scope (no values).",
    examples: [
      "project env list",
      "project env list --role production",
      "project env list --role preview",
      "project env list --branch feature/foo",
    ],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    try {
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
        { cwd: ctx.cwd, signal: ctx.signal },
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
    } catch (error) {
      const mapped = mapProjectOperationError(error);
      if (mapped) {
        return notOk(mapped);
      }
      throw error;
    }
  },
});
