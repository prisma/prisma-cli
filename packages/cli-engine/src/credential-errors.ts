import { CliStructuredError, type NextAction } from "./protocol";

const signInAction: NextAction = {
  kind: "user-choice",
  label: "Sign in, then run the command again.",
};

const activateGrantAction: NextAction = {
  kind: "run-command",
  label: "Activate one of your held workspace grants",
  command: "prisma auth workspace use",
};

export type CredentialsRequiredReason =
  | "unauthenticated"
  | "expired"
  | "grant-removed"
  | "grants-held-none-active";

/**
 * The single constructor of CLI.CREDENTIALS_REQUIRED. Raised by the
 * needs check, by an unauthenticated ctx.api request, and by the
 * credential manager's session()/credential() in the
 * grants-held-none-active state — identically from all of them.
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
    case "grant-removed":
      return new CliStructuredError(
        "CLI.CREDENTIALS_REQUIRED",
        "The workspace grant this command was using is no longer held.",
        {
          why: "It was removed while the command was running (for example by another prisma process).",
          nextActions: [activateGrantAction, signInAction],
        },
      );
    case "grants-held-none-active":
      return new CliStructuredError(
        "CLI.CREDENTIALS_REQUIRED",
        "No workspace is active.",
        {
          why: "You hold workspace grants, but none is active.",
          nextActions: [activateGrantAction, signInAction],
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
 * A mutation refused while an env-supplied session is in force: state
 * the user cannot observe as their session is never changed.
 */
export function environmentSessionMutationError(spec: {
  readonly envVar: string;
  readonly storedGrantsExist: boolean;
}): CliStructuredError {
  return new CliStructuredError(
    "AUTH.ENV_SESSION_IN_FORCE",
    `The current session comes from ${spec.envVar}, which this command cannot change.`,
    {
      why: spec.storedGrantsExist
        ? `${spec.envVar} overrides your stored workspace grants; unsetting it restores them.`
        : `${spec.envVar} supplies the only session; there is no stored state to change.`,
      nextActions: [
        {
          kind: "run-command",
          label: `Unset ${spec.envVar}`,
          command: `unset ${spec.envVar}`,
        },
      ],
    },
  );
}
