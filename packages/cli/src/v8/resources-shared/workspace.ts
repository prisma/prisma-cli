/**
 * The active workspace for resource commands: the engine's pinned
 * session, reshaped into the legacy `{ id, name }` workspace the
 * operation layer takes.
 */
import type { CommandContext } from "@prisma/cli-engine";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import type { AuthWorkspace } from "../../types/auth";

export function workspaceRequiredError(): CliStructuredError {
  return new CliStructuredError("AUTH.USAGE_ERROR", "Workspace required", {
    why: "This command needs an active workspace, but the authenticated session does not have one.",
    nextActions: [
      {
        kind: "user-choice",
        label: `Run ${CLI_NAME} auth login and choose a workspace.`,
      },
      {
        kind: "run-command",
        label: `${CLI_NAME} auth login`,
        command: `${CLI_NAME} auth login`,
      },
    ],
  });
}

export async function resolveActiveWorkspace(
  ctx: CommandContext<undefined, never>,
): Promise<AuthWorkspace> {
  const session = await ctx.session();
  if (session === null) {
    throw workspaceRequiredError();
  }
  return {
    id: session.workspaceId,
    name: session.workspaceName ?? session.workspaceId,
  };
}
