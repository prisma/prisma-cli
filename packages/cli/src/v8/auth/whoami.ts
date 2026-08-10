import {
  type ActiveCredential,
  type CredentialIdentity,
  defineCommand,
  type ManagementApiClient,
  type Presentations,
} from "@prisma/cli-engine";
import { type NextAction, ok } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../../cli-name";
import {
  credentialFieldRows,
  ENVIRONMENT_SESSION_NOTICE,
} from "./session-card";

const TITLE = "Showing the current authenticated identity.";

const SIGN_IN: NextAction = {
  kind: "run-command",
  label: "Sign in",
  command: `${CLI_NAME} auth login`,
};

export interface WhoamiResult {
  readonly authenticated: boolean;
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

/** Best-effort online enrichment: whoami works offline, so any failure
 *  leaves the identity as whatever the credential's own claims said. */
async function fetchedIdentity(
  api: ManagementApiClient,
  signal: AbortSignal,
): Promise<CredentialIdentity | undefined> {
  const bounded = AbortSignal.any([
    signal,
    AbortSignal.timeout(ENRICHMENT_TIMEOUT_MS),
  ]);
  try {
    const { data } = await api.GET("/v1/me", { signal: bounded });
    const user = data?.data?.user;
    if (!user) {
      return undefined;
    }
    return {
      userId: user.id ?? undefined,
      email: user.email ?? undefined,
      name: user.name ?? undefined,
    };
  } catch {
    signal.throwIfAborted();
    return undefined;
  }
}

/** `/v1/me` wins field by field where it disagrees with the claims;
 *  the claims are the offline fallback. */
function mergedIdentity(
  claimed: CredentialIdentity | undefined,
  fetched: CredentialIdentity | undefined,
): CredentialIdentity | null {
  const userId = fetched?.userId ?? claimed?.userId;
  const email = fetched?.email ?? claimed?.email;
  const name = fetched?.name ?? claimed?.name;
  return userId === undefined && email === undefined && name === undefined
    ? null
    : { userId, email, name };
}

function presentationsFor(spec: {
  readonly credential: ActiveCredential | null;
  readonly identity: CredentialIdentity | null;
}): Presentations {
  const rows = credentialFieldRows(spec);
  const fromEnvironment = spec.credential?.origin.source === "environment";
  return {
    human: () => [
      { kind: "summary", tone: "info", text: TITLE },
      { kind: "fields", rows },
      ...(fromEnvironment
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
    next: () => (spec.credential === null ? [SIGN_IN] : []),
  };
}

export const authWhoamiCommand = defineCommand({
  help: {
    summary: "Show the authenticated user and accessible workspace",
    examples: ["auth whoami", "auth whoami --json"],
  },
  handler: async (_args, ctx) => {
    const credential = await ctx.activeCredential();
    const identity =
      credential === null
        ? null
        : mergedIdentity(
            credential.identity,
            await fetchedIdentity(ctx.api, ctx.signal),
          );
    const result: WhoamiResult = {
      authenticated: credential !== null,
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
      ctx.present({ data: result }, presentationsFor({ credential, identity })),
    );
  },
});
