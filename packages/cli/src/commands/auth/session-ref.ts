/**
 * Command-side resolution of a user-typed workspace reference against
 * the sessions the credential manager holds. The manager resolves no
 * user input: the commands match the ref and pass the matched session's
 * workspace id. This is also where a workspace the user never had is
 * caught, which is why removal being idempotent still leaves a mistyped
 * ref with a useful error.
 */
import { noSessionForWorkspaceError, type Session } from "@prisma/cli-engine";
import { CliStructuredError } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";

export type SessionRefResolution =
  | { readonly kind: "matched"; readonly session: Session }
  | { readonly kind: "no-match" }
  | { readonly kind: "ambiguous"; readonly matches: readonly Session[] };

export interface SessionUser {
  readonly id: string | null;
  readonly email: string | null;
  readonly name: string | null;
}

/** The safe identity fields a command may expose for a stored session. */
export function sessionUser(session: Session): SessionUser | null {
  const identity = session.identity;
  if (identity === undefined) return null;
  return {
    id: identity.userId ?? null,
    email: identity.email ?? null,
    name: identity.name ?? null,
  };
}

/** The shortest useful human identity for a workspace session. */
export function sessionUserLabel(session: Session): string | undefined {
  const identity = session.identity;
  return identity?.email ?? identity?.name ?? identity?.userId;
}

/** Workspace first, account second: suitable for interactive choices. */
export function sessionChoiceLabel(session: Session): string {
  const user = sessionUserLabel(session);
  return user === undefined
    ? sessionLabel(session)
    : `${sessionLabel(session)} — ${user}`;
}

/** Exact workspace id first, then case-insensitive workspace name. */
export function resolveSessionRef(
  sessions: readonly Session[],
  ref: string,
): SessionRefResolution {
  const wanted = ref.trim();
  const byId = sessions.find((session) => session.workspaceId === wanted);
  if (byId !== undefined) {
    return { kind: "matched", session: byId };
  }
  const byName = sessions.filter(
    (session) =>
      session.workspaceName !== undefined &&
      session.workspaceName.toLowerCase() === wanted.toLowerCase(),
  );
  if (byName.length === 1) {
    return { kind: "matched", session: byName[0] };
  }
  if (byName.length > 1) {
    return { kind: "ambiguous", matches: byName };
  }
  return { kind: "no-match" };
}

export function ambiguousSessionRefError(
  ref: string,
  matches: readonly Session[],
): CliStructuredError {
  return new CliStructuredError(
    "AUTH.WORKSPACE_AMBIGUOUS",
    `More than one workspace session is named '${ref}'.`,
    {
      why: `Matching sessions: ${matches
        .map((match) => {
          const user = sessionUserLabel(match);
          return user === undefined
            ? match.workspaceId
            : `${match.workspaceId} (${user})`;
        })
        .join(", ")}.`,
      meta: {
        workspaceIds: matches.map((match) => match.workspaceId),
        sessions: matches.map((match) => ({
          workspaceId: match.workspaceId,
          user: sessionUser(match),
        })),
      },
      nextActions: [
        {
          kind: "run-command",
          label: "List your workspace sessions and pass a workspace id",
          command: `${CLI_NAME} auth workspace list`,
        },
      ],
    },
  );
}

/**
 * Resolves the ref or throws the structured error for its failure —
 * the ruled "no session for X" error for a ref that matches nothing.
 */
export function requireSession(
  sessions: readonly Session[],
  ref: string,
): Session {
  const resolution = resolveSessionRef(sessions, ref);
  if (resolution.kind === "ambiguous") {
    throw ambiguousSessionRefError(ref, resolution.matches);
  }
  if (resolution.kind === "no-match") {
    throw noSessionForWorkspaceError(ref);
  }
  return resolution.session;
}

/** How a session is named to users: its workspace name, or its id
 *  when no name was ever fetched. */
export function sessionLabel(session: Session): string {
  return session.workspaceName ?? session.workspaceId;
}
