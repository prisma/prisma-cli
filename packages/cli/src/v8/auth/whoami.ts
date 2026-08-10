import { defineCommand, type Presentations } from "@prisma/cli-engine";
import { type NextAction, notOk, ok } from "@prisma/cli-engine/protocol";
import { isEmptyServiceTokenError, readAuthState } from "../../auth";
import type { AuthStateResult } from "../../types/auth";
import { authConfigInvalidError } from "./errors";
import { authStateFieldRows } from "./state-card";

const TITLE = "Showing the current authenticated identity.";

const SIGN_IN: NextAction = {
  kind: "run-command",
  label: "Sign in",
  command: "prisma-cli auth login",
};

function presentationsFor(state: AuthStateResult): Presentations {
  const rows = authStateFieldRows(state);
  return {
    human: () => [
      { kind: "summary", tone: "info", text: TITLE },
      { kind: "fields", rows },
    ],
    stdout: () => rows.map((row) => `${row.label}: ${row.value}`),
    next: () => (state.authenticated ? [] : [SIGN_IN]),
  };
}

export const authWhoamiCommand = defineCommand({
  help: {
    summary: "Show the authenticated user and accessible workspace",
    examples: ["auth whoami", "auth whoami --json"],
  },
  handler: async (_args, ctx) => {
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
