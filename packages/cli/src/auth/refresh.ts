import type { CredentialRefresher } from "@prisma/cli-engine";

import { CLIENT_ID } from "./client";

const TRAILING_SLASH = /\/$/;

interface TokenEndpointBody {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly error?: unknown;
}

/** The dumb HTTP adapter behind the engine's delegated-credential policy. */
export function makeCredentialRefresher(
  authBaseUrl: string,
): CredentialRefresher {
  const endpoint = `${authBaseUrl.replace(TRAILING_SLASH, "")}/token`;
  return async ({ refreshToken, signal }) => {
    signal.throwIfAborted();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
      signal,
    });
    const body = await readBody(response);
    if (
      response.status >= 400 &&
      response.status < 500 &&
      body?.error === "invalid_grant"
    ) {
      return { kind: "invalid" };
    }
    if (
      !response.ok ||
      typeof body?.access_token !== "string" ||
      typeof body.refresh_token !== "string"
    ) {
      throw new Error("OAuth token refresh failed");
    }
    return {
      kind: "success",
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
    };
  };
}

async function readBody(response: Response): Promise<TokenEndpointBody | null> {
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null
      ? (body as TokenEndpointBody)
      : null;
  } catch {
    return null;
  }
}
