import { afterEach, describe, expect, it, vi } from "vitest";

import type { TokenStorage } from "@prisma/management-api-sdk";

afterEach(() => {
  vi.doUnmock("@prisma/management-api-sdk");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("auth login callback", () => {
  it("serves the success page as UTF-8 HTML", async () => {
    const result = await requestSuccessPage({ workspaceName: "Acme Corp" });

    expect(result.contentType).toContain("text/html; charset=utf-8");
    expect(result.body).toContain('<meta charset="utf-8">');
  });

  it("renders the workspace name when it resolves", async () => {
    const result = await requestSuccessPage({ workspaceName: "Acme Corp" });

    expect(result.body).toContain("You're all set.");
    expect(result.body).toContain(
      "Your terminal is now connected to your Acme Corp workspace. Head back to your terminal to continue.",
    );
  });

  it("renders generic success copy when the workspace lookup fails", async () => {
    const result = await requestSuccessPage({ workspaceLookupError: new Error("lookup failed") });

    expect(result.body).toContain("You're all set.");
    expect(result.body).toContain(
      "Your terminal is now connected to your Prisma workspace. Head back to your terminal to continue.",
    );
    expect(result.body).not.toContain("connected to your Acme Corp workspace");
  });

  it("escapes the workspace name before rendering it", async () => {
    const result = await requestSuccessPage({ workspaceName: 'Acme <Corp> & "Team"' });

    expect(result.body).toContain(
      "Your terminal is now connected to your Acme &lt;Corp&gt; &amp; &quot;Team&quot; workspace. Head back to your terminal to continue.",
    );
    expect(result.body).not.toContain('Acme <Corp> & "Team"');
  });

  it("includes dark-mode theme CSS", async () => {
    const result = await requestSuccessPage({ workspaceName: "Acme Corp" });

    expect(result.body).toContain("@media (prefers-color-scheme: dark)");
  });

  it("sizes and colors the logo through theme CSS", async () => {
    const result = await requestSuccessPage({ workspaceName: "Acme Corp" });

    expect(result.body).toContain('<svg class="mark" width="36" height="36"');
    expect(result.body).toContain("width: 36px;");
    expect(result.body).toContain("height: 36px;");
    expect(result.body).toContain("fill: currentColor !important;");
  });
});

async function requestSuccessPage(options: {
  workspaceName?: string;
  workspaceLookupError?: Error;
}): Promise<{ contentType: string | null; body: string }> {
  let redirectUri: string | undefined;
  let contentType: string | null = null;
  let body = "";
  const tokenStorage: TokenStorage = {
    getTokens: vi.fn().mockResolvedValue({
      workspaceId: "ws_123",
      accessToken: "access-token",
      refreshToken: "refresh-token",
    }),
    setTokens: vi.fn().mockResolvedValue(undefined),
    clearTokens: vi.fn().mockResolvedValue(undefined),
  };

  vi.doMock("@prisma/management-api-sdk", () => ({
    AuthError: class SDKAuthError extends Error {},
    createManagementApiSdk: vi.fn().mockImplementation((sdkOptions: { redirectUri: string }) => {
      redirectUri = sdkOptions.redirectUri;

      return {
        getLoginUrl: vi.fn().mockResolvedValue({
          url: "https://auth.example.test/login",
          state: "state_123",
          verifier: "verifier_123",
        }),
        handleCallback: vi.fn().mockResolvedValue(undefined),
        client: {
          GET: vi.fn().mockImplementation((pathName: string) => {
            if (pathName !== "/v1/workspaces/{id}") {
              throw new Error(`Unexpected path ${pathName}`);
            }

            if (options.workspaceLookupError) {
              throw options.workspaceLookupError;
            }

            return {
              data: {
                data: {
                  id: "ws_123",
                  name: options.workspaceName,
                },
              },
            };
          }),
        },
      };
    }),
  }));

  const { login } = await import("../src/lib/auth/login");

  await login({
    hostname: "127.0.0.1",
    tokenStorage,
    openUrl: async () => {
      expect(redirectUri).toBeDefined();
      const response = await fetch(`${redirectUri}?code=code_123&state=state_123`);

      contentType = response.headers.get("content-type");
      body = await response.text();
    },
  });

  return { contentType, body };
}
