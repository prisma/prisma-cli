import { Buffer } from "node:buffer";
import type { CredentialIdentity } from "@prisma/cli-engine";

const WORKSPACE_SUB_PREFIX = "workspace:";

export function decodeClaims(
  token: string,
): Record<string, unknown> | undefined {
  const payload = token.split(".")[1];
  if (payload === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The `workspace_id` claim, which is what sessions are keyed by. */
export function claimedWorkspaceId(token: string): string | undefined {
  const workspaceId = decodeClaims(token)?.workspace_id;
  return typeof workspaceId === "string" && workspaceId.length > 0
    ? workspaceId
    : undefined;
}

/** The workspace a service token names, for display only: its
 *  `workspace_id` claim, or the workspace its `sub` names. */
export function serviceTokenWorkspaceId(token: string): string | undefined {
  const fromWorkspaceClaim = claimedWorkspaceId(token);
  if (fromWorkspaceClaim !== undefined) return fromWorkspaceClaim;

  const sub = decodeClaims(token)?.sub;
  if (typeof sub !== "string" || !sub.startsWith(WORKSPACE_SUB_PREFIX)) {
    return undefined;
  }
  const derived = sub.slice(WORKSPACE_SUB_PREFIX.length).trim();
  return derived.length > 0 ? derived : undefined;
}

export function claimedExpiresAt(token: string): Date | undefined {
  const exp = decodeClaims(token)?.exp;
  return typeof exp === "number" ? new Date(exp * 1000) : undefined;
}

/** Who a credential belongs to, from its own claims. The manager
 *  decodes it so no command ever holds a token to decode. */
export function claimedIdentity(token: string): CredentialIdentity | undefined {
  const claims = decodeClaims(token);
  const userId = typeof claims?.sub === "string" ? claims.sub : undefined;
  const email = typeof claims?.email === "string" ? claims.email : undefined;
  return userId === undefined && email === undefined
    ? undefined
    : { userId, email, name: undefined };
}
