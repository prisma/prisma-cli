/** The `auth workspace list` command. */
import {
  defineCommand,
  type Presentations,
  type Session,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { sessionsForDisplay } from "../../auth/credential-manager";
import { environmentCredentialInForce } from "../../auth/service-token";
import { CLI_NAME } from "../../cli-name";
import { ENVIRONMENT_CREDENTIAL_NOTICE } from "./credential-card";
import { sessionLabel, sessionUser, sessionUserLabel } from "./session-ref";

export interface WorkspaceListResult {
  readonly sessions: readonly Session[];
  readonly selectedWorkspaceId: string | undefined;
  readonly environmentCredentialInForce: boolean;
}

export function serializeWorkspaceList(result: WorkspaceListResult) {
  return {
    context: {
      scope: "local-sessions" as const,
      environmentCredentialInForce: result.environmentCredentialInForce,
      currentWorkspaceId: result.selectedWorkspaceId ?? null,
    },
    items: result.sessions.map((session) => ({
      workspaceId: session.workspaceId,
      workspaceName: session.workspaceName ?? null,
      user: sessionUser(session),
      current: session.workspaceId === result.selectedWorkspaceId,
      expiresAt: session.expiresAt?.toISOString() ?? null,
    })),
    count: result.sessions.length,
  };
}

function listPresentations(result: WorkspaceListResult): Presentations {
  const columns = ["workspace", "user", "id", "status"];
  const rows = result.sessions.map((session) => [
    sessionLabel(session),
    sessionUserLabel(session) ?? "",
    session.workspaceId,
    session.workspaceId === result.selectedWorkspaceId ? "current" : "",
  ]);
  return {
    human: () => [
      {
        kind: "summary",
        status: "info",
        text: "Listing your workspace sessions on this machine.",
      },
      ...(result.environmentCredentialInForce
        ? [
            {
              kind: "summary",
              status: "info",
              text: ENVIRONMENT_CREDENTIAL_NOTICE,
            } as const,
          ]
        : []),
      ...(result.sessions.length === 0
        ? [
            {
              kind: "summary",
              status: "info",
              text: "No workspace sessions found.",
            } as const,
          ]
        : [{ kind: "table", columns, rows } as const]),
    ],
    // Scripts read these columns by position, so the optional user stays out.
    stdout: () =>
      result.sessions.map((session) =>
        [
          sessionLabel(session),
          session.workspaceId,
          session.workspaceId === result.selectedWorkspaceId ? "current" : "",
        ]
          .join("  ")
          .trimEnd(),
      ),
    json: () => serializeWorkspaceList(result),
    next: () => [
      {
        kind: "run-command",
        label:
          result.sessions.length === 0
            ? "Authorize a workspace"
            : "Authorize another workspace",
        command: `${CLI_NAME} auth login`,
      },
    ],
  };
}

export const authWorkspaceListCommand = defineCommand({
  managesCredentials: true,
  help: {
    summary: "List your workspace sessions",
    description:
      "Each 'auth login' stores one session per workspace. This lists the sessions on this machine and marks the current one, which every workspace-scoped command targets unless a PRISMA_SERVICE_TOKEN credential is set; that credential overrides stored sessions.",
    examples: ["auth workspace list", "auth workspace list --json"],
  },
  handler: async (_args, ctx) => {
    const stored = await sessionsForDisplay(ctx.credentialManager);
    const result: WorkspaceListResult = {
      sessions: stored.sessions,
      selectedWorkspaceId: stored.selectedWorkspaceId,
      environmentCredentialInForce: environmentCredentialInForce(ctx.env),
    };
    return ok(ctx.present({ data: result }, listPresentations(result)));
  },
});
