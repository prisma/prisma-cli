import { afterEach, describe, expect, it, vi } from "vitest";

import { CLIENT_ID } from "../src/auth/client";
import { makeCredentialRefresher } from "../src/auth/refresh";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("makeCredentialRefresher", () => {
  it("exchanges a refresh token using the OAuth refresh grant", async () => {
    const requestBodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requestBodies.push(String(init.body));
        return new Response(
          JSON.stringify({
            access_token: "access-2",
            refresh_token: "refresh-2",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const refresher = makeCredentialRefresher("https://auth.example.test/");

    const result = await refresher({
      refreshToken: "refresh-1",
      signal: new AbortController().signal,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://auth.example.test/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(new URLSearchParams(requestBodies[0])).toEqual(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: "refresh-1",
        client_id: CLIENT_ID,
      }),
    );
    expect(result).toEqual({
      kind: "success",
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });
  });

  it("returns only the invalid_grant verdict from a rejected refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "invalid_grant",
              error_description: "response text must not escape",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    await expect(
      makeCredentialRefresher("https://auth.example.test")({
        refreshToken: "refresh-1",
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ kind: "invalid" });
  });

  it("throws a fixed error for transient and malformed responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("upstream SECRET response", {
            status: 503,
            headers: { "content-type": "text/plain" },
          }),
      ),
    );

    await expect(
      makeCredentialRefresher("https://auth.example.test")({
        refreshToken: "refresh-1",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("OAuth token refresh failed");
  });
});
