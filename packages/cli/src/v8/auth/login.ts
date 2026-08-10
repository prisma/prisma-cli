import { defineCommand, type Presentations } from "@prisma/cli-engine";
import { type NextAction, notOk, ok } from "@prisma/cli-engine/protocol";
import {
  isEmptyServiceTokenError,
  performLogin,
  readAuthState,
} from "../../auth";
import { CLI_NAME } from "../../cli-name";
import type { AuthStateResult } from "../../types/auth";
import { resolveAgentSetupTipCommand } from "./agent-setup-tip";
import { authConfigInvalidError } from "./errors";
import { authStateFieldRows } from "./state-card";

const TITLE = "Starting an authenticated CLI session.";
const LOGIN_STEP = "Sign in via your browser";

function nextActionsFor(state: AuthStateResult): readonly NextAction[] {
  return [
    {
      kind: "run-command",
      label: "Show the signed-in identity",
      command: `${CLI_NAME} auth whoami`,
    },
    {
      kind: "run-command",
      label: "List projects",
      command: `${CLI_NAME} project list`,
    },
    ...(state.agentSetupTip
      ? [
          {
            kind: "run-command",
            label: "Install Prisma skills for this project",
            command: state.agentSetupTip.command,
          } as const,
        ]
      : []),
  ];
}

function presentationsFor(state: AuthStateResult): Presentations {
  const rows = authStateFieldRows(state);
  return {
    human: () => [
      { kind: "summary", tone: "info", text: TITLE },
      { kind: "fields", rows },
      ...(state.agentSetupTip
        ? [
            {
              kind: "summary",
              tone: "info",
              text: `Install Prisma skills for this project with ${state.agentSetupTip.command}.`,
            } as const,
          ]
        : []),
    ],
    stdout: () => rows.map((row) => `${row.label}: ${row.value}`),
    next: () => nextActionsFor(state),
  };
}

export const authLoginCommand = defineCommand({
  help: {
    summary: "Log in to your Prisma platform account",
    examples: ["auth login"],
  },
  handler: async (_args, ctx) => {
    ctx.report({ kind: "step-started", step: LOGIN_STEP });
    try {
      await performLogin(ctx.env, ctx.signal, {
        onVerificationUrl: (url) =>
          ctx.report({ kind: "endpoint", name: "verification", url }),
      });
    } catch (error) {
      ctx.report({
        kind: "step-finished",
        step: LOGIN_STEP,
        outcome: "failed",
      });
      throw error;
    }
    ctx.report({ kind: "step-finished", step: LOGIN_STEP, outcome: "ok" });

    let state: AuthStateResult;
    try {
      state = await readAuthState(ctx.env, ctx.signal);
    } catch (error) {
      if (isEmptyServiceTokenError(error)) {
        return notOk(authConfigInvalidError(error.message));
      }
      throw error;
    }

    const agentSetupTipCommand = await resolveAgentSetupTipCommand(ctx);
    if (agentSetupTipCommand) {
      state = { ...state, agentSetupTip: { command: agentSetupTipCommand } };
    }

    return ok(ctx.present({ data: state }, presentationsFor(state)));
  },
});
