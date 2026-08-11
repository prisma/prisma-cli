/**
 * Reading a credential's own claims. This lives in the engine and is
 * shared rather than reimplemented, because both credential managers
 * need it and the two copies had already drifted: one knew a service
 * token names its workspace through `sub`, the other did not, so a
 * token that worked in production could not be reproduced in a test.
 *
 * Decoding only. Nothing here verifies a signature — the claims are the
 * issuer's word, used for display and for keying, never for authorizing.
 */
import { Buffer } from "node:buffer";
import type { CredentialIdentity } from "./credential-manager";

/** A service token's subject is its workspace, not a person. */
const WORKSPACE_SUBJECT_PREFIX = "workspace:";

export function decodeTokenClaims(
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

function claimedString(
  claims: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  const value = claims?.[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The `workspace_id` claim, which is what sessions are keyed by. */
export function claimedWorkspaceId(token: string): string | undefined {
  return claimedString(decodeTokenClaims(token), "workspace_id");
}

/** The workspace a credential names: its `workspace_id` claim, or the
 *  workspace its subject names when it is a service token. */
export function credentialWorkspaceId(token: string): string | undefined {
  const claims = decodeTokenClaims(token);
  const fromClaim = claimedString(claims, "workspace_id");
  if (fromClaim !== undefined) return fromClaim;

  const subject = claimedString(claims, "sub");
  if (subject === undefined || !subject.startsWith(WORKSPACE_SUBJECT_PREFIX)) {
    return undefined;
  }
  const derived = subject.slice(WORKSPACE_SUBJECT_PREFIX.length).trim();
  return derived.length > 0 ? derived : undefined;
}

export function claimedExpiresAt(token: string): Date | undefined {
  const exp = decodeTokenClaims(token)?.exp;
  return typeof exp === "number" ? new Date(exp * 1000) : undefined;
}

/**
 * Who a credential belongs to, from its own claims. A service token's
 * subject names a workspace rather than a person, so it yields no user
 * — reporting `workspace:ws_1` as a user id was a real defect.
 */
export function claimedIdentity(token: string): CredentialIdentity | undefined {
  const claims = decodeTokenClaims(token);
  const subject = claimedString(claims, "sub");
  const userId = subject?.startsWith(WORKSPACE_SUBJECT_PREFIX)
    ? undefined
    : subject;
  const email = claimedString(claims, "email");
  return userId === undefined && email === undefined
    ? undefined
    : { userId, email, name: undefined };
}
