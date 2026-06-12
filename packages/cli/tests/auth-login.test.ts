import { PassThrough } from "node:stream";
import type { TokenStorage } from "@prisma/management-api-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

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

  it("requests the supported Management API OAuth scopes", async () => {
    const result = await requestSuccessPage({ workspaceName: "Acme Corp" });

    expect(result.loginScope).toBe("workspace:admin offline_access");
  });

  it("renders the workspace name when it resolves", async () => {
    const result = await requestSuccessPage({ workspaceName: "Acme Corp" });

    expect(result.body).toContain("You're all set.");
    expect(result.body).toContain(
      "Your terminal is now connected to your Acme Corp workspace. Head back to your terminal to continue.",
    );
  });

  it("renders generic success copy when the workspace lookup fails", async () => {
    const result = await requestSuccessPage({
      workspaceLookupError: new Error("lookup failed"),
    });

    expect(result.body).toContain("You're all set.");
    expect(result.body).toContain(
      "Your terminal is now connected to your Prisma workspace. Head back to your terminal to continue.",
    );
    expect(result.body).not.toContain("connected to your Acme Corp workspace");
  });

  it("escapes the workspace name before rendering it", async () => {
    const result = await requestSuccessPage({
      workspaceName: 'Acme <Corp> & "Team"',
    });

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

  it("rejects when the command signal aborts while waiting for the callback", async () => {
    vi.doMock("@prisma/management-api-sdk", () => ({
      AuthError: class SDKAuthError extends Error {},
      createManagementApiSdk: vi.fn().mockReturnValue({
        getLoginUrl: vi.fn().mockReturnValue({
          url: "https://auth.example.test/login",
          state: "state_123",
          verifier: "verifier_123",
        }),
        handleCallback: vi.fn().mockReturnValue(new Promise(() => {})),
        client: { GET: vi.fn() },
      }),
    }));
    const controller = new AbortController();
    const reason = new DOMException("Command canceled", "AbortError");
    const tokenStorage: TokenStorage = {
      getTokens: vi.fn(),
      setTokens: vi.fn(),
      clearTokens: vi.fn(),
    };

    const { login } = await import("../src/lib/auth/login");

    await expect(
      login({
        hostname: "127.0.0.1",
        tokenStorage,
        signal: controller.signal,
        openUrl: () => {
          controller.abort(reason);
        },
      }),
    ).rejects.toBe(reason);
  });

  it("rejects when the command signal aborts during workspace lookup", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Command canceled", "AbortError");
    const tokenStorage: TokenStorage = {
      getTokens: vi.fn().mockResolvedValue({
        workspaceId: "ws_123",
        accessToken: "access-token",
        refreshToken: "refresh-token",
      }),
      setTokens: vi.fn().mockResolvedValue(undefined),
      clearTokens: vi.fn().mockResolvedValue(undefined),
    };
    let redirectUri: string | undefined;

    vi.doMock("@prisma/management-api-sdk", () => ({
      AuthError: class SDKAuthError extends Error {},
      createManagementApiSdk: vi
        .fn()
        .mockImplementation((sdkOptions: { redirectUri: string }) => {
          redirectUri = sdkOptions.redirectUri;

          return {
            getLoginUrl: vi.fn().mockReturnValue({
              url: "https://auth.example.test/login",
              state: "state_123",
              verifier: "verifier_123",
            }),
            handleCallback: vi.fn().mockResolvedValue(undefined),
            client: {
              GET: vi.fn().mockImplementation(() => {
                controller.abort(reason);
                throw reason;
              }),
            },
          };
        }),
    }));

    const { login } = await import("../src/lib/auth/login");

    await expect(
      login({
        hostname: "127.0.0.1",
        tokenStorage,
        signal: controller.signal,
        openUrl: async () => {
          expect(redirectUri).toBeDefined();
          await fetch(`${redirectUri}?code=code_123&state=state_123`);
        },
      }),
    ).rejects.toBe(reason);
  });
});

async function requestSuccessPage(options: {
  workspaceName?: string;
  workspaceLookupError?: Error;
}): Promise<{
  contentType: string | null;
  body: string;
  loginScope: string | undefined;
}> {
  let redirectUri: string | undefined;
  let loginScope: string | undefined;
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
    createManagementApiSdk: vi
      .fn()
      .mockImplementation((sdkOptions: { redirectUri: string }) => {
        redirectUri = sdkOptions.redirectUri;

        return {
          getLoginUrl: vi
            .fn()
            .mockImplementation((options: { scope: string }) => {
              loginScope = options.scope;
              return {
                url: "https://auth.example.test/login",
                state: "state_123",
                verifier: "verifier_123",
              };
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
      const response = await fetch(
        `${redirectUri}?code=code_123&state=state_123`,
      );

      contentType = response.headers.get("content-type");
      body = await response.text();
    },
  });

  return { contentType, body, loginScope };
}

describe("auth login remote paste flow", () => {
  it("completes the token exchange via a pasted callback URL on a TTY", async () => {
    const result = await runLogin({
      ttyInput: true,
      openUrl: () => {
        // Browser is unavailable on the remote machine; do nothing so the
        // paste path is the only one that can complete sign-in.
      },
      pasteLines: [PASTE_CALLBACK_URL],
    });

    expect(result.handleCallbackCalls).toBe(1);
    expect(result.output).toContain("Paste the callback URL here:");
  });

  it("prints the concrete remote sign-in instructions on a TTY", async () => {
    const result = await runLogin({
      ttyInput: true,
      openUrl: () => {},
      pasteLines: [PASTE_CALLBACK_URL],
    });

    expect(result.output).toContain("Open this URL to sign in:");
    expect(result.output).toContain(
      "copy the full localhost URL from the address bar",
    );
  });

  it("runs the token exchange once when browser and paste both deliver", async () => {
    const result = await runLogin({
      ttyInput: true,
      // The browser callback wins first...
      openUrl: async (redirectUri) => {
        await fetch(`${redirectUri}?code=code_123&state=state_123`);
      },
      // ...and the user also pastes the same callback URL.
      pasteLines: [PASTE_CALLBACK_URL],
    });

    expect(result.handleCallbackCalls).toBe(1);
  });

  it("re-prompts after an unparseable paste instead of ending login", async () => {
    const result = await runLogin({
      ttyInput: true,
      openUrl: () => {},
      pasteLines: ["not a url", PASTE_CALLBACK_URL],
    });

    expect(result.output).toContain("That didn't look like a URL");
    expect(result.handleCallbackCalls).toBe(1);
  });

  it("re-prompts after a callback the exchange rejects, then succeeds", async () => {
    const result = await runLogin({
      ttyInput: true,
      openUrl: () => {},
      // First paste carries the wrong state and is rejected; second is valid.
      pasteLines: [
        "http://localhost:9999/auth/callback?code=code_123&state=wrong_state",
        PASTE_CALLBACK_URL,
      ],
    });

    expect(result.output).toContain("Sign-in didn't complete");
    expect(result.handleCallbackCalls).toBe(2);
  });

  it("surfaces a browser-launch failure when stdin is not a TTY", async () => {
    await expect(
      runLogin({
        ttyInput: false,
        openUrl: () => {
          throw new Error("no browser available");
        },
      }),
    ).rejects.toThrow("no browser available");
  });

  it("does not prompt or print instructions when stdin is not a TTY", async () => {
    const result = await runLogin({
      ttyInput: false,
      openUrl: async (redirectUri) => {
        await fetch(`${redirectUri}?code=code_123&state=state_123`);
      },
    });

    expect(result.handleCallbackCalls).toBe(1);
    expect(result.output).not.toContain("Paste the callback URL here:");
    expect(result.output).not.toContain("Open this URL to sign in:");
  });
});

const PASTE_CALLBACK_URL =
  "http://localhost:9999/auth/callback?code=code_123&state=state_123";

async function runLogin(options: {
  ttyInput: boolean;
  openUrl: (redirectUri: string) => Promise<unknown> | unknown;
  pasteLines?: string[];
}): Promise<{ handleCallbackCalls: number; output: string }> {
  let redirectUri = "";
  const handleCallback = vi.fn(
    async (args: { callbackUrl: URL; expectedState: string }) => {
      if (args.callbackUrl.searchParams.get("state") !== args.expectedState) {
        throw new SDKAuthErrorStub("State mismatch");
      }
    },
  );

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
    AuthError: SDKAuthErrorStub,
    createManagementApiSdk: vi
      .fn()
      .mockImplementation((sdkOptions: { redirectUri: string }) => {
        redirectUri = sdkOptions.redirectUri;

        return {
          getLoginUrl: vi.fn().mockReturnValue({
            url: "https://auth.example.test/login",
            state: "state_123",
            verifier: "verifier_123",
          }),
          handleCallback,
          client: {
            GET: vi.fn().mockResolvedValue({
              data: { data: { id: "ws_123", name: "Acme Corp" } },
            }),
          },
        };
      }),
  }));

  const input = new PassThrough();
  if (options.ttyInput) {
    (input as unknown as { isTTY: boolean }).isTTY = true;
  }

  // Feed one pending line each time the prompt is (re)displayed. readline drops
  // 'line' events that arrive with no question awaiting, so pre-buffering every
  // line at once loses all but the first across re-prompts.
  const pasteLines = [...(options.pasteLines ?? [])];
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk) => {
    const text = chunk.toString();
    chunks.push(text);
    if (
      text.includes("Paste the callback URL here:") &&
      pasteLines.length > 0
    ) {
      const line = pasteLines.shift() as string;
      queueMicrotask(() => input.write(`${line}\n`));
    }
  });

  const { login } = await import("../src/lib/auth/login");

  await login({
    hostname: "127.0.0.1",
    tokenStorage,
    input,
    output,
    openUrl: () => options.openUrl(redirectUri),
  });

  return {
    handleCallbackCalls: handleCallback.mock.calls.length,
    output: chunks.join(""),
  };
}

class SDKAuthErrorStub extends Error {}
