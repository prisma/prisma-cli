import { defineCommand, type Presentations } from "@prisma/cli-engine";
import {
  CliStructuredError,
  type NextAction,
  notOk,
  ok,
} from "@prisma/cli-engine/protocol";
import { isEmptyServiceTokenError, readAuthState } from "../../auth";
import type { AuthProviderId, AuthStateResult } from "../../types/auth";

const TITLE = "Showing the current authenticated identity.";

const SIGN_IN: NextAction = {
  kind: "run-command",
  label: "Sign in",
  command: "prisma-cli auth login",
};

interface FieldRow {
  readonly label: string;
  readonly value: string;
}

function providerLabel(provider: AuthProviderId): string {
  return provider === "github" ? "GitHub" : "Google";
}

function userLabel(state: AuthStateResult): string | null {
  if (state.user?.email) {
    return state.user.email;
  }

  if (state.credential?.type === "service_token") {
    return state.credential.name
      ? `<service token: ${state.credential.name}>`
      : "<service token>";
  }

  if (state.credential?.type === "management_token") {
    return state.credential.name
      ? `<management token: ${state.credential.name}>`
      : "<management token>";
  }

  return null;
}

function fieldRows(state: AuthStateResult): readonly FieldRow[] {
  if (!state.authenticated) {
    return [{ label: "status", value: "signed out" }];
  }

  const rows: FieldRow[] = [{ label: "status", value: "signed in" }];
  const user = userLabel(state);
  if (user) {
    rows.push({ label: "user", value: user });
  }
  if (state.provider) {
    rows.push({ label: "provider", value: providerLabel(state.provider) });
  }
  if (state.workspace?.name) {
    rows.push({ label: "workspace", value: state.workspace.name });
  }
  return rows;
}

function presentationsFor(state: AuthStateResult): Presentations {
  const rows = fieldRows(state);
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
        return notOk(
          new CliStructuredError(
            "AUTH.CONFIG_INVALID",
            "Authentication configuration is invalid",
            {
              why: error.message,
              nextActions: [
                {
                  kind: "user-choice",
                  label:
                    "Provide a valid PRISMA_SERVICE_TOKEN value, or unset the variable to use local OAuth login.",
                },
              ],
            },
          ),
        );
      }
      throw error;
    }

    return ok(ctx.present({ data: state }, presentationsFor(state)));
  },
});
