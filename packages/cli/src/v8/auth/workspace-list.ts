/** The `auth workspace list` command. */
import {
  defineCommand,
  type Presentations,
  type Session,
} from "@prisma/cli-engine";
import { type NextAction, ok } from "@prisma/cli-engine/protocol";
import { environmentSessionInForce } from "../../auth";
import { CLI_NAME } from "../../cli-name";
import { ENVIRONMENT_SESSION_NOTICE } from "./session-card";
import { sessionLabel } from "./session-ref";

const LOGIN_NEXT_ACTION: NextAction = {
  kind: "run-command",
  label: "Sign in",
  command: `${CLI_NAME} auth login`,
};

export interface WorkspaceListResult {
  readonly sessions: readonly Session[];
  readonly environmentSessionInForce: boolean;
}

export function serializeWorkspaceList(result: WorkspaceListResult) {
  return {
    context: {
      environmentSessionInForce: result.environmentSessionInForce,
      currentWorkspaceId:
        result.sessions.find((session) => session.current)?.workspaceId ?? null,
    },
    items: result.sessions.map((session) => ({
      workspaceId: session.workspaceId,
      workspaceName: session.workspaceName ?? null,
      current: session.current,
      expiresAt: session.expiresAt?.toISOString() ?? null,
    })),
    count: result.sessions.length,
  };
}

function listPresentations(result: WorkspaceListResult): Presentations {
  const columns = ["name", "id", "status"];
  const rows = result.sessions.map((session) => [
    sessionLabel(session),
    session.workspaceId,
    session.current ? "current" : "",
  ]);
  return {
    human: () => [
      {
        kind: "summary",
        tone: "info",
        text: "Listing your workspace sessions on this machine.",
      },
      ...(result.environmentSessionInForce
        ? [
            {
              kind: "summary",
              tone: "info",
              text: ENVIRONMENT_SESSION_NOTICE,
            } as const,
          ]
        : []),
      ...(result.sessions.length === 0
        ? [
            {
              kind: "summary",
              tone: "info",
              text: "No workspace sessions found.",
            } as const,
          ]
        : [{ kind: "table", columns, rows } as const]),
    ],
    stdout: () => rows.map((row) => row.join("  ").trimEnd()),
    json: () => serializeWorkspaceList(result),
    next: () => (result.sessions.length === 0 ? [LOGIN_NEXT_ACTION] : []),
  };
}

export const authWorkspaceListCommand = defineCommand({
  managesCredentials: true,
  help: {
    summary: "List your workspace sessions",
    examples: ["auth workspace list", "auth workspace list --json"],
  },
  handler: async (_args, ctx) => {
    const result: WorkspaceListResult = {
      sessions: await ctx.credentialManager.sessions(),
      environmentSessionInForce: environmentSessionInForce(ctx.env),
    };
    return ok(ctx.present({ data: result }, listPresentations(result)));
  },
});
