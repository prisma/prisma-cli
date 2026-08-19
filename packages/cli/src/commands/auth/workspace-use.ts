/** The `auth workspace use` command: it SELECTS among the sessions you
 *  have — it never creates one, and never opens a browser. */
import {
  defineCommand,
  type Presentations,
  positional,
  type Session,
  type StoredSessions,
} from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import { environmentCredentialInForce } from "../../auth/service-token";
import { CLI_NAME } from "../../cli-name";
import { ENVIRONMENT_CREDENTIAL_NOTICE } from "./credential-card";
import {
  requireSession,
  type SessionUser,
  sessionChoiceLabel,
  sessionLabel,
  sessionUser,
  sessionUserLabel,
} from "./session-ref";

export interface WorkspaceUseResult {
  readonly workspace: { readonly id: string; readonly name: string | null };
  readonly user: SessionUser | null;
  readonly previousWorkspaceId: string | null;
}

function noWorkspaceSessionsError(): CliStructuredError {
  return new CliStructuredError(
    "AUTH.NO_WORKSPACE_SESSIONS",
    "You have no workspace sessions to select from.",
    {
      nextActions: [
        {
          kind: "run-command",
          label: "Sign in and pick a workspace in the browser",
          command: `${CLI_NAME} auth login`,
        },
      ],
    },
  );
}

function usePresentations(
  spec: {
    readonly session: Session;
    readonly previous: Session | undefined;
    readonly environmentCredentialInForce: boolean;
  },
  result: WorkspaceUseResult,
): Presentations {
  const user = sessionUserLabel(spec.session);
  const rows = [
    ...(spec.previous === undefined
      ? []
      : [{ label: "previous", value: sessionLabel(spec.previous) }]),
    { label: "workspace", value: sessionLabel(spec.session) },
    ...(user === undefined ? [] : [{ label: "user", value: user }]),
  ];
  return {
    json: () => result,
    human: () => [
      {
        kind: "summary",
        status: "info",
        text: "Switching the current workspace session.",
      },
      { kind: "fields", rows },
      {
        kind: "summary",
        status: "ok",
        text: "Current workspace session updated.",
      },
      ...(spec.environmentCredentialInForce
        ? [
            {
              kind: "summary",
              status: "info",
              text: ENVIRONMENT_CREDENTIAL_NOTICE,
            } as const,
          ]
        : []),
    ],
    stdout: () => rows.map((row) => `${row.label}: ${row.value}`),
    next: () => [
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
    ],
  };
}

export const authWorkspaceUseCommand = defineCommand({
  managesCredentials: true,
  args: {
    positionals: {
      workspace: positional.optionalString({
        brief: "Workspace id or name",
        placeholder: "id-or-name",
      }),
    },
  },
  help: {
    summary: "Make one of your workspace sessions current",
    examples: ["auth workspace use", "auth workspace use my-workspace"],
  },
  handler: async (args, ctx) => {
    const stored = await ctx.credentialManager.enrichSessions();
    if (stored.sessions.length === 0) {
      throw noWorkspaceSessionsError();
    }
    const ref = args.positionals.workspace?.trim();
    const chosen = ref
      ? requireSession(stored.sessions, ref)
      : await promptForSession(stored, ctx.prompt.select);
    const previous = stored.sessions.find(
      (session) => session.workspaceId === stored.selectedWorkspaceId,
    );

    const session = await ctx.credentialManager.selectSession(
      chosen.workspaceId,
    );
    const result: WorkspaceUseResult = {
      workspace: {
        id: session.workspaceId,
        name: session.workspaceName ?? null,
      },
      user: sessionUser(session),
      previousWorkspaceId: previous?.workspaceId ?? null,
    };
    return ok(
      ctx.present(
        { data: result },
        usePresentations(
          {
            session,
            previous,
            environmentCredentialInForce: environmentCredentialInForce(ctx.env),
          },
          result,
        ),
      ),
    );
  },
});

async function promptForSession(
  stored: StoredSessions,
  select: <T extends string>(
    question: string,
    options: ReadonlyArray<{ value: T; label: string }>,
  ) => Promise<T>,
): Promise<Session> {
  if (stored.sessions.length === 1) {
    return stored.sessions[0];
  }
  const workspaceId = await select(
    "Select a workspace",
    stored.sessions.map((session) => ({
      value: session.workspaceId,
      label: `${sessionChoiceLabel(session)} (${session.workspaceId})${
        session.workspaceId === stored.selectedWorkspaceId ? " current" : ""
      }`,
    })),
  );
  return requireSession(stored.sessions, workspaceId);
}
