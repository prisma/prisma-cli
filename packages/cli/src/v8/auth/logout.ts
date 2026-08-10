import { defineCommand, type Presentations } from "@prisma/cli-engine";
import { type NextAction, ok } from "@prisma/cli-engine/protocol";
import { environmentSessionInForce } from "../../auth";
import { CLI_NAME } from "../../cli-name";
import { ENVIRONMENT_SESSION_NOTICE } from "./session-card";

const SIGN_IN: NextAction = {
  kind: "run-command",
  label: "Sign in",
  command: `${CLI_NAME} auth login`,
};

export interface LogoutResult {
  readonly endedCount: number;
  readonly workspaceIds: readonly string[];
}

function presentationsFor(
  result: LogoutResult,
  environmentInForce: boolean,
): Presentations {
  const summary =
    result.endedCount === 0
      ? "No workspace sessions to end."
      : `Ended ${result.endedCount} workspace ${result.endedCount === 1 ? "session" : "sessions"}.`;
  const rows = [{ label: "ended", value: String(result.endedCount) }];
  return {
    human: () => [
      {
        kind: "summary",
        tone: "info",
        text: "Clearing the current CLI session.",
      },
      { kind: "fields", rows },
      { kind: "summary", tone: "ok", text: summary },
      ...(environmentInForce
        ? [
            {
              kind: "summary",
              tone: "info",
              text: ENVIRONMENT_SESSION_NOTICE,
            } as const,
          ]
        : []),
    ],
    stdout: () => rows.map((row) => `${row.label}: ${row.value}`),
    next: () => [SIGN_IN],
  };
}

export const authLogoutCommand = defineCommand({
  managesCredentials: true,
  help: {
    summary: "Clear stored authentication credentials",
    examples: ["auth logout"],
  },
  handler: async (_args, ctx) => {
    const stored = await ctx.credentialManager.sessions();
    await ctx.credentialManager.endAllSessions();
    const result: LogoutResult = {
      endedCount: stored.sessions.length,
      workspaceIds: stored.sessions.map((session) => session.workspaceId),
    };
    return ok(
      ctx.present(
        { data: result },
        presentationsFor(result, environmentSessionInForce(ctx.env)),
      ),
    );
  },
});
