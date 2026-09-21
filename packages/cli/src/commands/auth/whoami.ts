import {
  type ActiveCredential,
  type CredentialIdentity,
  defineCommand,
  type ManagementApiClient,
  type Presentations,
} from "@prisma/cli-engine";
import {
  CliStructuredError,
  type NextAction,
  ok,
} from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import {
  credentialFieldRows,
  ENVIRONMENT_CREDENTIAL_NOTICE,
  UNVERIFIED_CREDENTIAL_NOTICE,
} from "./credential-card";

const TITLE = "Showing the active authenticated identity.";

const SIGN_IN: NextAction = {
  kind: "run-command",
  label: "Sign in",
  command: `${CLI_NAME} auth login`,
};

export interface WhoamiResult {
  readonly authenticated: boolean;
  /** True only when the API accepted the credential during this run. */
  readonly verified: boolean;
  readonly workspace: {
    readonly id: string;
    readonly name: string | null;
  } | null;
  readonly user: {
    readonly id: string | null;
    readonly email: string | null;
    readonly name: string | null;
  } | null;
  readonly source: "stored" | "environment" | null;
  readonly expiresAt: string | null;
}

/** whoami answers from the credential's own claims, so the lookup is
 *  worth a moment and no more. ctx.signal only fires on Ctrl-C, and
 *  nothing else bounds a request: a host that accepts the connection
 *  and never answers would otherwise hold the command for minutes. */
const ENRICHMENT_TIMEOUT_MS = 3_000;

type Lookup =
  | {
      readonly kind: "confirmed";
      readonly identity: CredentialIdentity | undefined;
    }
  | { readonly kind: "signed-out" }
  | { readonly kind: "inconclusive" };

/** Best-effort online enrichment: whoami works offline, so a transient
 *  failure leaves the identity as the credential's own claims said.
 *  CLI.CREDENTIALS_REQUIRED means signed out; AUTH.SERVICE_TOKEN_REJECTED
 *  is rethrown because signing in cannot fix an environment token. */
async function fetchedIdentity(
  api: ManagementApiClient,
  signal: AbortSignal,
): Promise<Lookup> {
  const bounded = AbortSignal.any([
    signal,
    AbortSignal.timeout(ENRICHMENT_TIMEOUT_MS),
  ]);
  try {
    const { data } = await api.GET("/v1/me", { signal: bounded });
    if (data === undefined) {
      return { kind: "inconclusive" };
    }
    const user = data.data?.user;
    return {
      kind: "confirmed",
      identity: user
        ? {
            userId: user.id ?? undefined,
            email: user.email ?? undefined,
            name: user.name ?? undefined,
          }
        : undefined,
    };
  } catch (cause) {
    signal.throwIfAborted();
    if (CliStructuredError.is(cause)) {
      if (cause.code === "CLI.CREDENTIALS_REQUIRED") {
        return { kind: "signed-out" };
      }
      if (cause.code === "AUTH.SERVICE_TOKEN_REJECTED") {
        throw cause;
      }
    }
    return { kind: "inconclusive" };
  }
}

/**
 * `/v1/me` wins field by field where it disagrees with the claims, and
 * the claims are the offline fallback — but only while both describe
 * the same person. The two are read at different moments, so another
 * process replacing the session in between can leave the claims
 * describing one user and the lookup another; filling a gap in one from
 * the other would then invent a person who does not exist. When the two
 * name different users, the lookup is taken whole.
 */
function mergedIdentity(
  claimed: CredentialIdentity | undefined,
  fetched: CredentialIdentity | undefined,
): CredentialIdentity | null {
  if (fetched === undefined) return claimed ?? null;
  if (claimed === undefined) return fetched;

  const samePerson =
    fetched.userId === undefined ||
    claimed.userId === undefined ||
    fetched.userId === claimed.userId;
  if (!samePerson) return fetched;

  return {
    userId: fetched.userId ?? claimed.userId,
    email: fetched.email ?? claimed.email,
    name: fetched.name ?? claimed.name,
  };
}

function presentationsFor(
  spec: {
    readonly credential: ActiveCredential | null;
    readonly identity: CredentialIdentity | null;
  },
  result: WhoamiResult,
): Presentations {
  const rows = credentialFieldRows(spec);
  const fromEnvironment = spec.credential?.origin.source === "environment";
  return {
    json: () => result,
    human: () => [
      { kind: "summary", status: "info", text: TITLE },
      { kind: "fields", rows },
      ...(fromEnvironment
        ? [
            {
              kind: "summary",
              status: "info",
              text: ENVIRONMENT_CREDENTIAL_NOTICE,
            } as const,
          ]
        : []),
      ...(result.authenticated && !result.verified
        ? [
            {
              kind: "summary",
              status: "info",
              text: UNVERIFIED_CREDENTIAL_NOTICE,
            } as const,
          ]
        : []),
    ],
    stdout: () => rows.map((row) => `${row.label}: ${row.value}`),
    next: () => (spec.credential === null ? [SIGN_IN] : []),
  };
}

export const authWhoamiCommand = defineCommand({
  help: {
    summary: "Show who is signed in and which workspace commands target",
    description:
      "Shows which identity the CLI is acting as and which workspace its commands will target. Run it to check you are in the right workspace before creating or deleting resources, or to see whether a PRISMA_SERVICE_TOKEN credential is overriding your stored sessions.",
    examples: ["auth whoami", "auth whoami --json"],
  },
  handler: async (_args, ctx) => {
    const active = await ctx.activeCredential();
    const lookup =
      active === null ? undefined : await fetchedIdentity(ctx.api, ctx.signal);
    const credential = lookup?.kind === "signed-out" ? null : active;
    const identity =
      credential === null
        ? null
        : mergedIdentity(
            credential.identity,
            lookup?.kind === "confirmed" ? lookup.identity : undefined,
          );
    const result: WhoamiResult = {
      authenticated: credential !== null,
      verified: credential !== null && lookup?.kind === "confirmed",
      workspace:
        credential === null || credential.workspaceId === undefined
          ? null
          : {
              id: credential.workspaceId,
              name: credential.workspaceName ?? null,
            },
      user:
        identity === null
          ? null
          : {
              id: identity.userId ?? null,
              email: identity.email ?? null,
              name: identity.name ?? null,
            },
      source: credential?.origin.source ?? null,
      expiresAt: credential?.expiresAt?.toISOString() ?? null,
    };
    return ok(
      ctx.present(
        { data: result },
        presentationsFor({ credential, identity }, result),
      ),
    );
  },
});
