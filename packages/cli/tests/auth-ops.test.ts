import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../src/adapters/token-storage");
  vi.doUnmock("../src/lib/auth/guard");
  vi.resetModules();
  vi.restoreAllMocks();
});

function encodeJwt(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `header.${payload}.signature`;
}

describe("readAuthState", () => {
  it("normalizes the workspace id to the canonical API id and returns the user email", async () => {
    const getTokens = vi.fn().mockResolvedValue({
      workspaceId: "cmmxlp7ae1251zyfs8mdpnavm",
      accessToken:
        "header.eyJzdWIiOiJ1c2VyOmNsaXQ0YnNxMTAwMjBvMDBoNDUzcWo1cTEiLCJlbWFpbCI6Imx1YW5AZXhhbXBsZS5jb20ifQ.signature",
      refreshToken: "refresh-token",
    });
    const requireComputeAuth = vi.fn().mockResolvedValue({
      GET: vi.fn().mockImplementation((pathName: string, request?: { params?: { path?: { id?: string } } }) => {
        if (pathName === "/v1/workspaces/{id}" && request?.params?.path?.id === "cmmxlp7ae1251zyfs8mdpnavm") {
          return {
            data: {
              data: {
                id: "wksp_cmmxlp7ae1251zyfs8mdpnavm",
                name: "Sandpit",
              },
            },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
    });

    vi.doMock("../src/adapters/token-storage", () => ({
      FileTokenStorage: vi.fn().mockImplementation(() => ({
        getTokens,
      })),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));

    const { readAuthState } = await import("../src/lib/auth/auth-ops");

    await expect(readAuthState({} as NodeJS.ProcessEnv)).resolves.toEqual({
      authenticated: true,
      provider: null,
      user: {
        email: "luan@example.com",
      },
      workspace: {
        id: "wksp_cmmxlp7ae1251zyfs8mdpnavm",
        name: "Sandpit",
      },
    });
  });

  it("keeps authenticated state but omits the user when the token has no email claim", async () => {
    const getTokens = vi.fn().mockResolvedValue({
      workspaceId: "cmmxlp7ae1251zyfs8mdpnavm",
      accessToken:
        "header.eyJzdWIiOiJ1c2VyOmNsaXQ0YnNxMTAwMjBvMDBoNDUzcWo1cTEifQ.signature",
      refreshToken: "refresh-token",
    });
    const requireComputeAuth = vi.fn().mockResolvedValue({
      GET: vi.fn().mockResolvedValue({
        data: {
          data: {
            id: "wksp_cmmxlp7ae1251zyfs8mdpnavm",
            name: "Sandpit",
          },
        },
      }),
    });

    vi.doMock("../src/adapters/token-storage", () => ({
      FileTokenStorage: vi.fn().mockImplementation(() => ({
        getTokens,
      })),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));

    const { readAuthState } = await import("../src/lib/auth/auth-ops");

    await expect(readAuthState({} as NodeJS.ProcessEnv)).resolves.toMatchObject({
      authenticated: true,
      user: null,
      workspace: {
        id: "wksp_cmmxlp7ae1251zyfs8mdpnavm",
        name: "Sandpit",
      },
    });
  });

  it("derives authenticated state from PRISMA_API_TOKEN without consulting FileTokenStorage", async () => {
    const getTokens = vi.fn();
    const requireComputeAuth = vi.fn().mockResolvedValue({
      GET: vi.fn().mockImplementation((pathName: string, request?: { params?: { path?: { id?: string } } }) => {
        if (pathName === "/v1/workspaces/{id}" && request?.params?.path?.id === "clitq5hfg0000qv0gtg9nv9fy") {
          return {
            data: {
              data: {
                id: "wksp_clitq5hfg0000qv0gtg9nv9fy",
                name: "Prisma Platform",
              },
            },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
    });

    vi.doMock("../src/adapters/token-storage", () => ({
      FileTokenStorage: vi.fn().mockImplementation(() => ({
        getTokens,
      })),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));

    const { readAuthState } = await import("../src/lib/auth/auth-ops");
    const token = encodeJwt({ sub: "workspace:clitq5hfg0000qv0gtg9nv9fy", email: "service@example.com" });

    await expect(
      readAuthState({ PRISMA_API_TOKEN: token } as NodeJS.ProcessEnv),
    ).resolves.toEqual({
      authenticated: true,
      provider: null,
      user: { email: "service@example.com" },
      workspace: {
        id: "wksp_clitq5hfg0000qv0gtg9nv9fy",
        name: "Prisma Platform",
      },
    });

    expect(getTokens).not.toHaveBeenCalled();
  });

  it("ignores a stored OAuth session when PRISMA_API_TOKEN is set", async () => {
    // Regression: a locally cached OAuth login for one workspace must not win
    // over the service token scoped to a different workspace. Otherwise CI
    // deploys silently target whichever workspace the developer last logged
    // into.
    const getTokens = vi.fn().mockResolvedValue({
      workspaceId: "wksp_local_oauth_workspace",
      accessToken: encodeJwt({ sub: "user:usr_local", email: "dev@example.com" }),
      refreshToken: "refresh-token",
    });
    const requireComputeAuth = vi.fn().mockResolvedValue({
      GET: vi.fn().mockResolvedValue({
        data: {
          data: { id: "wksp_clitq5hfg0000qv0gtg9nv9fy", name: "Prisma Platform" },
        },
      }),
    });

    vi.doMock("../src/adapters/token-storage", () => ({
      FileTokenStorage: vi.fn().mockImplementation(() => ({ getTokens })),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({ requireComputeAuth }));

    const { readAuthState } = await import("../src/lib/auth/auth-ops");
    const token = encodeJwt({ sub: "workspace:clitq5hfg0000qv0gtg9nv9fy" });

    const result = await readAuthState({ PRISMA_API_TOKEN: token } as NodeJS.ProcessEnv);

    expect(result.authenticated).toBe(true);
    expect(result.workspace?.id).toBe("wksp_clitq5hfg0000qv0gtg9nv9fy");
    expect(getTokens).not.toHaveBeenCalled();
  });

  it("falls back to the workspace id when the API lookup fails for a service token", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue({
      GET: vi.fn().mockRejectedValue(new Error("network down")),
    });

    vi.doMock("../src/adapters/token-storage", () => ({
      FileTokenStorage: vi.fn().mockImplementation(() => ({
        getTokens: vi.fn(),
      })),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({ requireComputeAuth }));

    const { readAuthState } = await import("../src/lib/auth/auth-ops");
    const token = encodeJwt({ sub: "workspace:clitq5hfg0000qv0gtg9nv9fy" });

    await expect(
      readAuthState({ PRISMA_API_TOKEN: token } as NodeJS.ProcessEnv),
    ).resolves.toEqual({
      authenticated: true,
      provider: null,
      user: null,
      workspace: {
        id: "clitq5hfg0000qv0gtg9nv9fy",
        name: "clitq5hfg0000qv0gtg9nv9fy",
      },
    });
  });

  it("returns signed-out state when PRISMA_API_TOKEN does not carry a workspace subject", async () => {
    const getTokens = vi.fn();
    vi.doMock("../src/adapters/token-storage", () => ({
      FileTokenStorage: vi.fn().mockImplementation(() => ({ getTokens })),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn(),
    }));

    const { readAuthState } = await import("../src/lib/auth/auth-ops");
    const token = encodeJwt({ sub: "user:usr_123" });

    await expect(
      readAuthState({ PRISMA_API_TOKEN: token } as NodeJS.ProcessEnv),
    ).resolves.toEqual({
      authenticated: false,
      provider: null,
      user: null,
      workspace: null,
    });
    expect(getTokens).not.toHaveBeenCalled();
  });

  it("treats an empty PRISMA_API_TOKEN as unset and falls back to FileTokenStorage", async () => {
    const getTokens = vi.fn().mockResolvedValue(null);

    vi.doMock("../src/adapters/token-storage", () => ({
      FileTokenStorage: vi.fn().mockImplementation(() => ({ getTokens })),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn(),
    }));

    const { readAuthState } = await import("../src/lib/auth/auth-ops");

    await expect(
      readAuthState({ PRISMA_API_TOKEN: "   " } as NodeJS.ProcessEnv),
    ).resolves.toEqual({
      authenticated: false,
      provider: null,
      user: null,
      workspace: null,
    });
    expect(getTokens).toHaveBeenCalled();
  });
});
