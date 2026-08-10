import type { CredentialOrigin } from "./credential-manager";
import { CliStructuredError, type NextAction } from "./protocol";

const signInAction: NextAction = {
  kind: "user-choice",
  label: "Sign in, then run the command again.",
};

const useSessionAction: NextAction = {
  kind: "run-command",
  label: "Make one of your workspace sessions current",
  command: "prisma auth workspace use",
};

export type CredentialsRequiredReason =
  | "unauthenticated"
  | "expired"
  | "session-ended"
  | "sessions-held-none-selected";

/**
 * The single constructor of CLI.CREDENTIALS_REQUIRED. Raised
 * identically by the needs check, ctx.session, and the engine's
 * request path.
 */
export function credentialsRequiredError(
  reason: CredentialsRequiredReason = "unauthenticated",
): CliStructuredError {
  switch (reason) {
    case "unauthenticated":
      return new CliStructuredError(
        "CLI.CREDENTIALS_REQUIRED",
        "You must be signed in to run this command.",
        { nextActions: [signInAction] },
      );
    case "expired":
      return new CliStructuredError(
        "CLI.CREDENTIALS_REQUIRED",
        "Your session has expired — sign in again.",
        { nextActions: [signInAction] },
      );
    case "session-ended":
      return new CliStructuredError(
        "CLI.CREDENTIALS_REQUIRED",
        "The workspace session this command was using has ended.",
        {
          why: "It was ended while the command was running (for example by another prisma process).",
          nextActions: [useSessionAction, signInAction],
        },
      );
    case "sessions-held-none-selected":
      return new CliStructuredError(
        "CLI.CREDENTIALS_REQUIRED",
        "No workspace session is current.",
        {
          why: "You have workspace sessions but none is current.",
          nextActions: [useSessionAction, signInAction],
        },
      );
  }
}

/**
 * A refresh attempt failed transiently (the auth service, not the
 * credentials): nothing was cleared, and signing in again is not the
 * fix.
 */
export function authServiceError(): CliStructuredError {
  return new CliStructuredError(
    "CLI.AUTH_SERVICE_ERROR",
    "The authentication service could not refresh your session.",
    {
      why: "The refresh attempt failed transiently; your stored credentials were left untouched.",
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Run the command again; sign in again only if the problem persists.",
        },
      ],
    },
  );
}

/**
 * The credential in force was rejected and could never be renewed — it
 * carries no refresh token. The ONE place wording differs by origin;
 * nothing else compares against `origin.source`.
 */
export function credentialRejectedError(
  origin: CredentialOrigin,
  envVar: string,
): CliStructuredError {
  return origin.source === "environment"
    ? serviceTokenRejectedError({ envVar })
    : credentialsRequiredError("expired");
}

/**
 * A credential's workspace_id claim disagrees with the workspace it is
 * being stored under, or a rotated token would re-scope a session.
 * Raised by every CredentialManager, so a test sees what production
 * raises.
 */
export function credentialWorkspaceMismatchError(
  workspaceId: string,
): CliStructuredError {
  return new CliStructuredError(
    "AUTH.CREDENTIAL_WORKSPACE_MISMATCH",
    "That credential belongs to a different workspace.",
    {
      why: `The token's workspace_id claim does not name workspace '${workspaceId}'.`,
      nextActions: [
        {
          kind: "run-command",
          label: "Sign in again and pick the workspace you want",
          command: "prisma auth login",
        },
      ],
    },
  );
}

/**
 * The env var that supplies a session is set to a blank value. The one
 * structured error for it, raised identically by currentSession(), the
 * needs check, and the engine's request path.
 */
export function emptyServiceTokenError(spec: {
  readonly envVar: string;
}): CliStructuredError {
  return new CliStructuredError(
    "AUTH.SERVICE_TOKEN_EMPTY",
    `${spec.envVar} is set but empty.`,
    {
      why: `A blank token authenticates nothing, and ${spec.envVar} overrides your stored workspace sessions while it is set.`,
      nextActions: [
        {
          kind: "run-command",
          label: `Unset ${spec.envVar}`,
          command: `unset ${spec.envVar}`,
        },
        {
          kind: "user-choice",
          label: `Or set ${spec.envVar} to a valid service token.`,
        },
      ],
    },
  );
}

/**
 * No session exists for the named workspace. Sessions are created by
 * `prisma auth login` alone — `workspace use` selects among the ones
 * you have.
 */
export function noSessionForWorkspaceError(
  workspaceRef: string,
): CliStructuredError {
  return new CliStructuredError(
    "AUTH.NO_SESSION_FOR_WORKSPACE",
    `You have no session for workspace '${workspaceRef}'.`,
    {
      nextActions: [
        {
          kind: "run-command",
          label: `Sign in and pick '${workspaceRef}' in the browser`,
          command: "prisma auth login",
        },
      ],
    },
  );
}

/**
 * Module-private on purpose: `credentialRejectedError` is the one place
 * wording differs by origin (§11.1), and exporting this would be a
 * second door into the environment-specific text that bypasses it.
 *
 * The management API rejected the env-supplied service token (401).
 * There is no refresh for it and nothing stored is cleared.
 */
function serviceTokenRejectedError(spec: {
  readonly envVar: string;
}): CliStructuredError {
  return new CliStructuredError(
    "AUTH.SERVICE_TOKEN_REJECTED",
    `The management API rejected the service token from ${spec.envVar}.`,
    {
      nextActions: [
        {
          kind: "user-choice",
          label: `Replace ${spec.envVar} with a valid service token, or unset it to use your stored sessions.`,
        },
      ],
    },
  );
}
