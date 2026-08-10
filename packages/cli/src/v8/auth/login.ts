import {
  defineCommand,
  type Presentations,
  type Session,
} from "@prisma/cli-engine";
import {
  CliStructuredError,
  type NextAction,
  ok,
} from "@prisma/cli-engine/protocol";
import {
  claimedWorkspaceId,
  performLogin,
  SERVICE_TOKEN_ENV_VAR,
} from "../../auth";
import { CLI_NAME } from "../../cli-name";
import { resolveAgentSetupTipCommand } from "./agent-setup-tip";
import { ENVIRONMENT_SESSION_NOTICE } from "./session-card";
import { sessionLabel } from "./session-ref";

const TITLE = "Starting an authenticated CLI session.";
const LOGIN_STEP = "Sign in via your browser";

export interface LoginResult {
  readonly workspace: { readonly id: string; readonly name: string | null };
  readonly environmentSessionInForce: boolean;
}

/** The minted credential names no workspace, so no session can be
 *  keyed by one. */
function loginWorkspaceUnknownError(): CliStructuredError {
  return new CliStructuredError(
    "AUTH.LOGIN_WORKSPACE_UNKNOWN",
    "Sign-in produced a credential that names no workspace.",
    {
      why: "A workspace session is keyed by the credential's workspace_id claim, and this credential carries none.",
      nextActions: [
        {
          kind: "run-command",
          label: "Sign in again and pick a workspace in the browser",
          command: `${CLI_NAME} auth login`,
        },
      ],
    },
  );
}

function nextActionsFor(
  agentSetupTipCommand: string | null,
): readonly NextAction[] {
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
    ...(agentSetupTipCommand === null
      ? []
      : [
          {
            kind: "run-command",
            label: "Install Prisma skills for this project",
            command: agentSetupTipCommand,
          } as const,
        ]),
  ];
}

function presentationsFor(spec: {
  readonly session: Session;
  readonly environmentSessionInForce: boolean;
  readonly agentSetupTipCommand: string | null;
}): Presentations {
  const rows = [
    { label: "status", value: "signed in" },
    { label: "workspace", value: sessionLabel(spec.session) },
  ];
  return {
    human: () => [
      { kind: "summary", tone: "info", text: TITLE },
      { kind: "fields", rows },
      ...(spec.environmentSessionInForce
        ? [
            {
              kind: "summary",
              tone: "info",
              text: ENVIRONMENT_SESSION_NOTICE,
            } as const,
          ]
        : []),
      ...(spec.agentSetupTipCommand === null
        ? []
        : [
            {
              kind: "summary",
              tone: "info",
              text: `Install Prisma skills for this project with ${spec.agentSetupTipCommand}.`,
            } as const,
          ]),
    ],
    stdout: () => rows.map((row) => `${row.label}: ${row.value}`),
    next: () => nextActionsFor(spec.agentSetupTipCommand),
  };
}

export const authLoginCommand = defineCommand({
  managesCredentials: true,
  help: {
    summary: "Log in to your Prisma platform account",
    examples: ["auth login"],
  },
  handler: async (_args, ctx) => {
    ctx.report({ kind: "step-started", step: LOGIN_STEP });
    let session: Session;
    try {
      const credential = await performLogin(ctx.env, ctx.signal, {
        onVerificationUrl: (url) =>
          ctx.report({ kind: "endpoint", name: "verification", url }),
      });
      const workspaceId = claimedWorkspaceId(credential.token);
      if (workspaceId === undefined) {
        throw loginWorkspaceUnknownError();
      }
      session = await ctx.credentialManager.createSession(
        credential,
        workspaceId,
      );
    } catch (error) {
      ctx.report({
        kind: "step-finished",
        step: LOGIN_STEP,
        outcome: "failed",
      });
      throw error;
    }
    ctx.report({ kind: "step-finished", step: LOGIN_STEP, outcome: "ok" });

    const environmentSessionInForce =
      ctx.env[SERVICE_TOKEN_ENV_VAR] !== undefined;
    const agentSetupTipCommand = await resolveAgentSetupTipCommand(ctx);
    const result: LoginResult = {
      workspace: {
        id: session.workspaceId,
        name: session.workspaceName ?? null,
      },
      environmentSessionInForce,
    };
    return ok(
      ctx.present(
        { data: result },
        presentationsFor({
          session,
          environmentSessionInForce,
          agentSetupTipCommand,
        }),
      ),
    );
  },
});
