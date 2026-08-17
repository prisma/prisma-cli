import { afterEach, describe, expect, it, vi } from "vitest";

import { CLIENT_ID } from "../src/auth/client";
import { makeCredentialRefresher } from "../src/auth/refresh";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("makeCredentialRefresher", () => {
  it("exchanges a refresh token using the OAuth refresh grant", async () => {
    const now = new Date("2030-01-01T00:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    const requestBodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requestBodies.push(String(init.body));
        return new Response(
          JSON.stringify({
            access_token: "access-2",
            refresh_token: "refresh-2",
            expires_in: 3_600,
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
      expiresAt: new Date(now.getTime() + 3_600_000),
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

  it("throws a fixed error for a transient response", async () => {
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
    ).rejects.toThrow("OAuth token refresh failed (status 503)");
  });

  it("throws a fixed error for a malformed successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: "access-2",
              expires_in: 3_600,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    await expect(
      makeCredentialRefresher("https://auth.example.test")({
        refreshToken: "refresh-1",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("OAuth token refresh failed (status 200)");
  });

  it("aborts a stalled refresh after the fixed timeout", async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeout.signal);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url: string, init: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true },
            );
          }),
      ),
    );
    const refresh = makeCredentialRefresher("https://auth.example.test")({
      refreshToken: "refresh-1",
      signal: new AbortController().signal,
    });
    const rejection = expect(refresh).rejects.toMatchObject({
      name: "TimeoutError",
    });

    timeout.abort(new DOMException("Timed out", "TimeoutError"));

    await rejection;
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
  });
});
