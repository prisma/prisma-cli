/**
 * The active workspace for resource commands. `ctx` carries credentials
 * but not the workspace they belong to; until `ctx.session()` lands this
 * helper is the single place that reads it from the auth module.
 */
import type { CommandContext } from "@prisma/cli-engine";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import { readAuthState } from "../../auth";
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
  const state = await readAuthState(ctx.env, ctx.signal);
  if (!state.workspace) {
    throw workspaceRequiredError();
  }
  return state.workspace;
}
