import { defineCommand, flag, type Presentations } from "@prisma/cli-engine";
import { type NextAction, notOk, ok } from "@prisma/cli-engine/protocol";
import {
  isEmptyServiceTokenError,
  performLogout,
  readAuthState,
} from "../../auth";
import { CLI_NAME } from "../../cli-name";
import type { AuthStateResult } from "../../types/auth";
import { authConfigInvalidError } from "./errors";
import { runWorkspaceLogout } from "./run-workspace-logout";
import { authStateFieldRows } from "./state-card";

const SIGN_IN: NextAction = {
  kind: "run-command",
  label: "Sign in",
  command: `${CLI_NAME} auth login`,
};

function presentationsFor(state: AuthStateResult): Presentations {
  const rows = authStateFieldRows(state);
  return {
    human: () => [
      {
        kind: "summary",
        tone: "info",
        text: "Clearing the current CLI session.",
      },
      {
        kind: "fields",
        rows: [{ label: "session", value: "local CLI state" }],
      },
      {
        kind: "summary",
        tone: "ok",
        text: "Session removed from local CLI state.",
      },
    ],
    stdout: () => rows.map((row) => `${row.label}: ${row.value}`),
    next: () => [SIGN_IN],
  };
}

export const authLogoutCommand = defineCommand({
  args: {
    flags: {
      workspace: flag.string({
        brief: "Remove one stored OAuth workspace session",
        placeholder: "id-or-name",
      }),
    },
  },
  help: {
    summary: "Clear stored authentication credentials",
    examples: ["auth logout", "auth logout --workspace my-workspace"],
  },
  handler: async (args, ctx) => {
    const workspaceRef = args.flags.workspace?.trim();
    if (workspaceRef) {
      // Same semantics and presentation as `auth workspace logout <ref>`,
      // by calling the shared operation directly (the legacy shell's
      // argv-level re-dispatch does not port).
      return runWorkspaceLogout(ctx, workspaceRef);
    }

    await performLogout(ctx.env, ctx.signal);
    let state: AuthStateResult;
    try {
      state = await readAuthState(ctx.env, ctx.signal);
    } catch (error) {
      if (isEmptyServiceTokenError(error)) {
        return notOk(authConfigInvalidError(error.message));
      }
      throw error;
    }

    return ok(ctx.present({ data: state }, presentationsFor(state)));
  },
});
