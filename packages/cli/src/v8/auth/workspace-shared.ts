/**
 * Helpers shared by the `auth workspace *` commands. Operations come
 * from the auth module (`src/auth/index.ts`); legacy CliError shapes
 * map to dotted AUTH.* structured errors via `mapAuthOperationError`.
 */
import type { CommandContext } from "@prisma/cli-engine";
import type { NextAction } from "@prisma/cli-engine/protocol";
import type { WorkspaceOperationContext } from "../../auth";
import { CLI_NAME } from "../../cli-name";
import { mapAuthOperationError } from "./errors";

export const LIST_NEXT_ACTION: NextAction = {
  kind: "run-command",
  label: "List authenticated workspaces",
  command: `${CLI_NAME} auth workspace list`,
};

export const LOGIN_NEXT_ACTION: NextAction = {
  kind: "run-command",
  label: "Sign in",
  command: `${CLI_NAME} auth login`,
};

export function operationContext(
  ctx: CommandContext<undefined, never>,
): WorkspaceOperationContext {
  return { env: ctx.env, signal: ctx.signal };
}

export function rethrowMapped(error: unknown): never {
  const mapped = mapAuthOperationError(error);
  if (mapped) {
    throw mapped;
  }
  throw error;
}
