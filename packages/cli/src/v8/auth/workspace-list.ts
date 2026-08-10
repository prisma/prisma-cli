/** The `auth workspace list` command. */
import { defineCommand, type Presentations } from "@prisma/cli-engine";
import { notOk, ok } from "@prisma/cli-engine/protocol";
import { isEmptyServiceTokenError, listAuthWorkspaces } from "../../auth";
import type { AuthWorkspaceListResult } from "../../types/auth";
import { authConfigInvalidError } from "./errors";
import {
  LOGIN_NEXT_ACTION,
  operationContext,
  rethrowMapped,
} from "./workspace-shared";

function authSourceLabel(
  source: AuthWorkspaceListResult["authSource"],
): string {
  if (source === "oauth") {
    return "local OAuth";
  }
  if (source === "service_token") {
    return "PRISMA_SERVICE_TOKEN";
  }
  return "none";
}

function workspaceSourceLabel(source: "oauth" | "service_token"): string {
  return source === "service_token" ? "service token" : "OAuth";
}

export function serializeAuthWorkspaceList(result: AuthWorkspaceListResult) {
  return {
    context: {
      authSource: result.authSource,
      activeWorkspaceId: result.activeWorkspace?.id ?? null,
      activeWorkspaceName: result.activeWorkspace?.name ?? null,
    },
    items: result.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      status: workspace.active ? "active" : null,
      source: workspace.source,
      switchable: workspace.switchable,
      credentialWorkspaceId: workspace.credentialWorkspaceId,
      lastSeenAt: workspace.lastSeenAt,
    })),
    count: result.workspaces.length,
  };
}

/** The legacy table's column rule: the source column appears only when
 *  the listed workspaces mix sources. */
function workspaceTableRows(result: AuthWorkspaceListResult): {
  columns: readonly string[];
  rows: ReadonlyArray<readonly string[]>;
} {
  const hasMixedSources =
    new Set(result.workspaces.map((workspace) => workspace.source)).size > 1;
  const columns = hasMixedSources
    ? ["name", "id", "source", "status"]
    : ["name", "id", "status"];
  const rows = result.workspaces.map((workspace) => {
    const status = workspace.active ? "active" : "";
    return hasMixedSources
      ? [
          workspace.name,
          workspace.id,
          workspaceSourceLabel(workspace.source),
          status,
        ]
      : [workspace.name, workspace.id, status];
  });
  return { columns, rows };
}

function listPresentations(result: AuthWorkspaceListResult): Presentations {
  const table = workspaceTableRows(result);
  return {
    human: () => [
      {
        kind: "summary",
        tone: "info",
        text: "Listing authenticated workspaces on this machine.",
      },
      {
        kind: "fields",
        rows: [
          { label: "auth source", value: authSourceLabel(result.authSource) },
        ],
      },
      ...(result.workspaces.length === 0
        ? [
            {
              kind: "summary",
              tone: "info",
              text: "No local OAuth workspaces found.",
            } as const,
          ]
        : [{ kind: "table", ...table } as const]),
    ],
    stdout: () => table.rows.map((row) => row.join("  ").trimEnd()),
    json: () => serializeAuthWorkspaceList(result),
    next: () => (result.workspaces.length === 0 ? [LOGIN_NEXT_ACTION] : []),
  };
}

export const authWorkspaceListCommand = defineCommand({
  help: {
    summary: "List locally authenticated workspaces",
    examples: ["auth workspace list", "auth workspace list --json"],
  },
  handler: async (_args, ctx) => {
    let result: AuthWorkspaceListResult;
    try {
      result = await listAuthWorkspaces(operationContext(ctx));
    } catch (error) {
      if (isEmptyServiceTokenError(error)) {
        return notOk(authConfigInvalidError(error.message));
      }
      rethrowMapped(error);
    }
    return ok(ctx.present({ data: result }, listPresentations(result)));
  },
});
