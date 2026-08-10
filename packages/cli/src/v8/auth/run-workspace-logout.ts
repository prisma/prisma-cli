/**
 * The shared workspace-logout operation + presentation, called by both
 * `auth workspace logout <ref>` and `auth logout --workspace <ref>` —
 * the same operation, the same presentation.
 */
import type { CommandContext, Presentations } from "@prisma/cli-engine";
import { CliStructuredError, notOk, ok } from "@prisma/cli-engine/protocol";
import { logoutAuthWorkspace } from "../../auth";
import { CLI_NAME } from "../../cli-name";
import type { AuthWorkspaceLogoutResult } from "../../types/auth";
import { mapAuthOperationError } from "./errors";
import { LIST_NEXT_ACTION, operationContext } from "./workspace-shared";

function logoutPresentations(result: AuthWorkspaceLogoutResult): Presentations {
  const rows = [
    { label: "workspace", value: result.workspace.name },
    { label: "active", value: result.activeWorkspace?.name ?? "none" },
  ];
  return {
    human: () => [
      {
        kind: "summary",
        tone: "info",
        text: "Removing a local OAuth workspace session.",
      },
      { kind: "fields", rows },
      {
        kind: "summary",
        tone: "ok",
        text: result.wasActive
          ? "Removed active workspace session; no replacement workspace was selected."
          : "Removed workspace session.",
      },
    ],
    stdout: () => rows.map((row) => `${row.label}: ${row.value}`),
    next: () =>
      result.activeWorkspace
        ? [LIST_NEXT_ACTION]
        : [
            LIST_NEXT_ACTION,
            {
              kind: "run-command",
              label: "Select a replacement workspace",
              command: `${CLI_NAME} auth workspace use <id>`,
            },
          ],
  };
}

function workspaceRequiredError(): CliStructuredError {
  return new CliStructuredError("AUTH.USAGE_ERROR", "Workspace required", {
    why: "auth workspace logout needs a workspace id or cached workspace name.",
    nextActions: [
      {
        kind: "user-choice",
        label: `Pass a workspace from ${CLI_NAME} auth workspace list.`,
      },
    ],
  });
}

export async function runWorkspaceLogout(
  ctx: CommandContext<undefined, never>,
  workspaceRef: string,
) {
  if (!workspaceRef.trim()) {
    return notOk(workspaceRequiredError());
  }

  let result: AuthWorkspaceLogoutResult;
  try {
    result = await logoutAuthWorkspace(operationContext(ctx), workspaceRef);
  } catch (error) {
    const mapped = mapAuthOperationError(error);
    if (mapped) {
      return notOk(mapped);
    }
    throw error;
  }
  return ok(ctx.present({ data: result }, logoutPresentations(result)));
}
