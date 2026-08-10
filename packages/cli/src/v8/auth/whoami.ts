import {
  type CommandContext,
  defineCommand,
  type ManagementApiClient,
  type Presentations,
  type Session,
} from "@prisma/cli-engine";
import { type NextAction, ok } from "@prisma/cli-engine/protocol";
import { decodeClaims, environmentServiceToken } from "../../auth";
import { CLI_NAME } from "../../cli-name";
import {
  ENVIRONMENT_SESSION_NOTICE,
  type SessionIdentity,
  sessionFieldRows,
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
  readonly user: SessionIdentity | null;
  readonly source: "stored" | "environment" | null;
  readonly expiresAt: string | null;
}

function claimedIdentity(token: string): SessionIdentity | null {
  const claims = decodeClaims(token);
  if (claims === undefined) {
    return null;
  }
  const read = (key: string): string | null =>
    typeof claims[key] === "string" ? (claims[key] as string) : null;
  const identity = {
    id: read("sub"),
    email: read("email"),
    name: read("name"),
  };
  return identity.id === null && identity.email === null ? null : identity;
}

/** Best-effort online enrichment: whoami works offline, so any failure
 *  leaves the identity as whatever the session itself could supply. */
async function enrichedIdentity(
  api: ManagementApiClient,
  signal: AbortSignal,
): Promise<SessionIdentity | null> {
  try {
    const { data } = await api.GET("/v1/me", { signal });
    const user = data?.data?.user;
    if (!user) {
      return null;
    }
    return {
      id: user.id ?? null,
      email: user.email ?? null,
      name: user.name ?? null,
    };
  } catch {
    signal.throwIfAborted();
    return null;
  }
}

/** An env session's identity is the env token's own claims — decoded
 *  locally, never fetched. `/v1/me` is the stored-session path, whose
 *  token whoami cannot reach. */
async function identityFor(
  session: Session,
  ctx: CommandContext<undefined, never>,
): Promise<SessionIdentity | null> {
  if (session.source === "environment") {
    const envToken = environmentServiceToken(ctx.env);
    return envToken === undefined ? null : claimedIdentity(envToken);
  }
  return enrichedIdentity(ctx.api, ctx.signal);
}

function presentationsFor(spec: {
  readonly session: Session | null;
  readonly identity: SessionIdentity | null;
}): Presentations {
  const rows = sessionFieldRows(spec);
  const environmentSession = spec.session?.source === "environment";
  return {
    human: () => [
      { kind: "summary", tone: "info", text: TITLE },
      { kind: "fields", rows },
      ...(environmentSession
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
    next: () => (spec.session === null ? [SIGN_IN] : []),
  };
}

export const authWhoamiCommand = defineCommand({
  help: {
    summary: "Show the authenticated user and accessible workspace",
    examples: ["auth whoami", "auth whoami --json"],
  },
  handler: async (_args, ctx) => {
    const session = await ctx.session();
    const identity = session === null ? null : await identityFor(session, ctx);
    const result: WhoamiResult = {
      authenticated: session !== null,
      workspace:
        session === null
          ? null
          : { id: session.workspaceId, name: session.workspaceName ?? null },
      user: identity,
      source: session?.source ?? null,
      expiresAt: session?.expiresAt?.toISOString() ?? null,
    };
    return ok(
      ctx.present({ data: result }, presentationsFor({ session, identity })),
    );
  },
});
