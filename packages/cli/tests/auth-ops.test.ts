import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../src/auth/token-storage");
  vi.doUnmock("../src/auth/guard");
  vi.resetModules();
  vi.restoreAllMocks();
});

function encodeJwt(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString(
    "base64url",
  );
  return `header.${payload}.signature`;
}

function mockFileTokenStorage(getTokens: ReturnType<typeof vi.fn>) {
  return vi.fn().mockImplementation(function FileTokenStorageMock() {
    return { getTokens };
  });
}

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "prisma-cli-auth-ops-"));
}

async function writeAuthFile(
  authFilePath: string,
  tokens: unknown[],
): Promise<void> {
  await fs.mkdir(path.dirname(authFilePath), { recursive: true });
  await fs.writeFile(authFilePath, JSON.stringify({ tokens }, null, 2));
}

describe("readAuthState", () => {
  it("resolves the current OAuth principal from /v1/me when available", async () => {
    const getTokens = vi.fn().mockResolvedValue({
      workspaceId: "cmmxlp7ae1251zyfs8mdpnavm",
      accessToken: encodeJwt({ sub: "user:usr_123" }),
      refreshToken: "refresh-token",
    });
    const authenticatedManagementApiClient = vi.fn().mockResolvedValue({
      GET: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/me") {
          return {
            data: {
              data: {
                user: {
                  id: "usr_123",
                  email: "luan@example.com",
                  name: "Luan",
                },
                workspace: {
                  id: "wksp_cmmxlp7ae1251zyfs8mdpnavm",
                  name: "Sandpit",
                },
                credential: {
                  type: "oauth",
                  id: null,
                  name: null,
                },
              },
            },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
    });

    vi.doMock("../src/auth/token-storage", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth/token-storage")>()),
      FileTokenStorage: mockFileTokenStorage(getTokens),
    }));
    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));

    const { readAuthState } = await import("../src/auth/operations");

    await expect(readAuthState({} as NodeJS.ProcessEnv)).resolves.toEqual({
      authenticated: true,
      provider: null,
      user: {
        id: "usr_123",
        email: "luan@example.com",
        name: "Luan",
      },
      workspace: {
        id: "wksp_cmmxlp7ae1251zyfs8mdpnavm",
        name: "Sandpit",
      },
      credential: {
        type: "oauth",
        id: null,
        name: null,
      },
    });
  });

  it("caches resolved workspace metadata in real token storage", async () => {
    const tempDir = await createTempDir();
    const authFilePath = path.join(tempDir, "auth.json");
    await writeAuthFile(authFilePath, [
      {
        workspaceId: "cmmxlp7ae1251zyfs8mdpnavm",
        token: encodeJwt({ sub: "user:usr_123" }),
        refreshToken: "refresh-token",
      },
    ]);
    const authenticatedManagementApiClient = vi.fn().mockResolvedValue({
      GET: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/me") {
          return {
            data: {
              data: {
                user: {
                  id: "usr_123",
                  email: "luan@example.com",
                  name: "Luan",
                },
                workspace: {
                  id: "wksp_cmmxlp7ae1251zyfs8mdpnavm",
                  name: "Sandpit",
                },
                credential: {
                  type: "oauth",
                  id: null,
                  name: null,
                },
              },
            },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
    });

    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));

    const { readAuthState } = await import("../src/auth/operations");
    const { FileTokenStorage } = await import("../src/auth/token-storage");

    await expect(
      readAuthState({
        PRISMA_COMPUTE_AUTH_FILE: authFilePath,
      } as NodeJS.ProcessEnv),
    ).resolves.toMatchObject({
      authenticated: true,
      workspace: {
        id: "wksp_cmmxlp7ae1251zyfs8mdpnavm",
        name: "Sandpit",
      },
    });

    await expect(
      new FileTokenStorage({
        PRISMA_COMPUTE_AUTH_FILE: authFilePath,
      } as NodeJS.ProcessEnv).listWorkspaces(),
    ).resolves.toEqual([
      expect.objectContaining({
        credentialWorkspaceId: "cmmxlp7ae1251zyfs8mdpnavm",
        id: "wksp_cmmxlp7ae1251zyfs8mdpnavm",
        name: "Sandpit",
      }),
    ]);
  });

  it("normalizes the workspace id to the canonical API id and returns the user email", async () => {
    const getTokens = vi.fn().mockResolvedValue({
      workspaceId: "cmmxlp7ae1251zyfs8mdpnavm",
      accessToken:
        "header.eyJzdWIiOiJ1c2VyOmNsaXQ0YnNxMTAwMjBvMDBoNDUzcWo1cTEiLCJlbWFpbCI6Imx1YW5AZXhhbXBsZS5jb20ifQ.signature",
      refreshToken: "refresh-token",
    });
    const authenticatedManagementApiClient = vi.fn().mockResolvedValue({
      GET: vi
        .fn()
        .mockImplementation(
          (
            pathName: string,
            request?: { params?: { path?: { id?: string } } },
          ) => {
            if (
              pathName === "/v1/workspaces/{id}" &&
              request?.params?.path?.id === "cmmxlp7ae1251zyfs8mdpnavm"
            ) {
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
          },
        ),
    });

    vi.doMock("../src/auth/token-storage", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth/token-storage")>()),
      FileTokenStorage: mockFileTokenStorage(getTokens),
    }));
    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));

    const { readAuthState } = await import("../src/auth/operations");

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
      credential: null,
    });
  });

  it("keeps authenticated state but omits the user when the token has no email claim", async () => {
    const getTokens = vi.fn().mockResolvedValue({
      workspaceId: "cmmxlp7ae1251zyfs8mdpnavm",
      accessToken:
        "header.eyJzdWIiOiJ1c2VyOmNsaXQ0YnNxMTAwMjBvMDBoNDUzcWo1cTEifQ.signature",
      refreshToken: "refresh-token",
    });
    const authenticatedManagementApiClient = vi.fn().mockResolvedValue({
      GET: vi.fn().mockResolvedValue({
        data: {
          data: {
            id: "wksp_cmmxlp7ae1251zyfs8mdpnavm",
            name: "Sandpit",
          },
        },
      }),
    });

    vi.doMock("../src/auth/token-storage", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth/token-storage")>()),
      FileTokenStorage: mockFileTokenStorage(getTokens),
    }));
    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));

    const { readAuthState } = await import("../src/auth/operations");

    await expect(readAuthState({} as NodeJS.ProcessEnv)).resolves.toMatchObject(
      {
        authenticated: true,
        user: null,
        workspace: {
          id: "wksp_cmmxlp7ae1251zyfs8mdpnavm",
          name: "Sandpit",
        },
      },
    );
  });

  it("uses the canonical workspace id as the fallback name when the API omits a name", async () => {
    const getTokens = vi.fn().mockResolvedValue({
      workspaceId: "cmmxlp7ae1251zyfs8mdpnavm",
      accessToken: encodeJwt({ sub: "user:usr_123" }),
      refreshToken: "refresh-token",
    });
    const authenticatedManagementApiClient = vi.fn().mockResolvedValue({
      GET: vi.fn().mockResolvedValue({
        data: {
          data: {
            id: "wksp_cmmxlp7ae1251zyfs8mdpnavm",
          },
        },
      }),
    });

    vi.doMock("../src/auth/token-storage", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth/token-storage")>()),
      FileTokenStorage: mockFileTokenStorage(getTokens),
    }));
    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));

    const { readAuthState } = await import("../src/auth/operations");

    await expect(readAuthState({} as NodeJS.ProcessEnv)).resolves.toMatchObject(
      {
        workspace: {
          id: "wksp_cmmxlp7ae1251zyfs8mdpnavm",
          name: "wksp_cmmxlp7ae1251zyfs8mdpnavm",
        },
      },
    );
  });

  it("derives authenticated state from PRISMA_SERVICE_TOKEN without consulting FileTokenStorage", async () => {
    const getTokens = vi.fn();
    const authenticatedManagementApiClient = vi.fn().mockResolvedValue({
      GET: vi
        .fn()
        .mockImplementation(
          (
            pathName: string,
            request?: { params?: { path?: { id?: string } } },
          ) => {
            if (pathName === "/v1/me") {
              return {
                data: {
                  data: {
                    user: null,
                    workspace: {
                      id: "wksp_clitq5hfg0000qv0gtg9nv9fy",
                      name: "Prisma Platform",
                    },
                    credential: {
                      type: "service_token",
                      id: "itgr_ci",
                      name: "ci-deploys-prod",
                    },
                  },
                },
              };
            }

            if (
              pathName === "/v1/workspaces/{id}" &&
              request?.params?.path?.id === "clitq5hfg0000qv0gtg9nv9fy"
            ) {
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
          },
        ),
    });

    vi.doMock("../src/auth/token-storage", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth/token-storage")>()),
      FileTokenStorage: mockFileTokenStorage(getTokens),
    }));
    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));

    const { readAuthState } = await import("../src/auth/operations");
    const token = encodeJwt({
      sub: "workspace:clitq5hfg0000qv0gtg9nv9fy",
      email: "service@example.com",
    });

    await expect(
      readAuthState({ PRISMA_SERVICE_TOKEN: token } as NodeJS.ProcessEnv),
    ).resolves.toEqual({
      authenticated: true,
      provider: null,
      user: null,
      workspace: {
        id: "wksp_clitq5hfg0000qv0gtg9nv9fy",
        name: "Prisma Platform",
      },
      credential: {
        type: "service_token",
        id: "itgr_ci",
        name: "ci-deploys-prod",
      },
    });

    expect(getTokens).not.toHaveBeenCalled();
  });

  it("ignores a stored OAuth session when PRISMA_SERVICE_TOKEN is set", async () => {
    // Regression: a locally cached OAuth login for one workspace must not win
    // over the service token scoped to a different workspace. Otherwise CI
    // deploys silently target whichever workspace the developer last logged
    // into.
    const getTokens = vi.fn().mockResolvedValue({
      workspaceId: "wksp_local_oauth_workspace",
      accessToken: encodeJwt({
        sub: "user:usr_local",
        email: "dev@example.com",
      }),
      refreshToken: "refresh-token",
    });
    const authenticatedManagementApiClient = vi.fn().mockResolvedValue({
      GET: vi.fn().mockResolvedValue({
        data: {
          data: {
            id: "wksp_clitq5hfg0000qv0gtg9nv9fy",
            name: "Prisma Platform",
          },
        },
      }),
    });

    vi.doMock("../src/auth/token-storage", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth/token-storage")>()),
      FileTokenStorage: mockFileTokenStorage(getTokens),
    }));
    vi.doMock("../src/auth/guard", () => ({ authenticatedManagementApiClient }));

    const { readAuthState } = await import("../src/auth/operations");
    const token = encodeJwt({ sub: "workspace:clitq5hfg0000qv0gtg9nv9fy" });

    const result = await readAuthState({
      PRISMA_SERVICE_TOKEN: token,
    } as NodeJS.ProcessEnv);

    expect(result.authenticated).toBe(true);
    expect(result.workspace?.id).toBe("wksp_clitq5hfg0000qv0gtg9nv9fy");
    expect(getTokens).not.toHaveBeenCalled();
  });

  it("returns signed-out state when the workspace lookup is rejected with HTTP 401", async () => {
    // A 401 on the workspace lookup means the credential is fundamentally
    // broken (revoked, wrong signing key, expired). The previous behavior
    // swallowed the failure and returned a fake workspace where id == name,
    // which made `auth whoami` look fine for a token the API was already
    // rejecting. Now `auth whoami` reports the truth and downstream
    // commands trigger the standard AUTH_REQUIRED flow.
    const authenticatedManagementApiClient = vi.fn().mockResolvedValue({
      GET: vi.fn().mockResolvedValue({
        data: undefined,
        error: { message: "Unauthorized" },
        response: { status: 401 } as Response,
      }),
    });

    vi.doMock("../src/auth/token-storage", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth/token-storage")>()),
      FileTokenStorage: mockFileTokenStorage(vi.fn()),
    }));
    vi.doMock("../src/auth/guard", () => ({ authenticatedManagementApiClient }));

    const { readAuthState } = await import("../src/auth/operations");
    const token = encodeJwt({ sub: "workspace:clitq5hfg0000qv0gtg9nv9fy" });

    await expect(
      readAuthState({ PRISMA_SERVICE_TOKEN: token } as NodeJS.ProcessEnv),
    ).resolves.toEqual({
      authenticated: false,
      provider: null,
      user: null,
      workspace: null,
      credential: null,
    });
  });

  it("falls back to the workspace id when the API lookup fails with a non-401 status", async () => {
    // Non-401 lookup failures (404/5xx/network) leave the existing UX in
    // place: the credential is presumably valid but the workspace lookup
    // didn't succeed, so we keep authenticated state and use the
    // workspace id as a placeholder name.
    const authenticatedManagementApiClient = vi.fn().mockResolvedValue({
      GET: vi.fn().mockResolvedValue({
        data: undefined,
        error: { message: "Internal Server Error" },
        response: { status: 503 } as Response,
      }),
    });

    vi.doMock("../src/auth/token-storage", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth/token-storage")>()),
      FileTokenStorage: mockFileTokenStorage(vi.fn()),
    }));
    vi.doMock("../src/auth/guard", () => ({ authenticatedManagementApiClient }));

    const { readAuthState } = await import("../src/auth/operations");
    const token = encodeJwt({ sub: "workspace:clitq5hfg0000qv0gtg9nv9fy" });

    await expect(
      readAuthState({ PRISMA_SERVICE_TOKEN: token } as NodeJS.ProcessEnv),
    ).resolves.toEqual({
      authenticated: true,
      provider: null,
      user: null,
      workspace: {
        id: "clitq5hfg0000qv0gtg9nv9fy",
        name: "clitq5hfg0000qv0gtg9nv9fy",
      },
      credential: null,
    });
  });

  it("falls back to the workspace id when the API lookup fails for a service token", async () => {
    const authenticatedManagementApiClient = vi.fn().mockResolvedValue({
      GET: vi.fn().mockRejectedValue(new Error("network down")),
    });

    vi.doMock("../src/auth/token-storage", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth/token-storage")>()),
      FileTokenStorage: mockFileTokenStorage(vi.fn()),
    }));
    vi.doMock("../src/auth/guard", () => ({ authenticatedManagementApiClient }));

    const { readAuthState } = await import("../src/auth/operations");
    const token = encodeJwt({ sub: "workspace:clitq5hfg0000qv0gtg9nv9fy" });

    await expect(
      readAuthState({ PRISMA_SERVICE_TOKEN: token } as NodeJS.ProcessEnv),
    ).resolves.toEqual({
      authenticated: true,
      provider: null,
      user: null,
      workspace: {
        id: "clitq5hfg0000qv0gtg9nv9fy",
        name: "clitq5hfg0000qv0gtg9nv9fy",
      },
      credential: null,
    });
  });

  it("rejects when cancellation aborts the current principal lookup", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Command canceled", "AbortError");
    const authenticatedManagementApiClient = vi.fn().mockResolvedValue({
      GET: vi.fn().mockImplementation(() => {
        controller.abort(reason);
        throw reason;
      }),
    });

    vi.doMock("../src/auth/token-storage", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth/token-storage")>()),
      FileTokenStorage: vi.fn().mockImplementation(() => ({
        getTokens: vi.fn(),
      })),
    }));
    vi.doMock("../src/auth/guard", () => ({ authenticatedManagementApiClient }));

    const { readAuthState } = await import("../src/auth/operations");
    const token = encodeJwt({ sub: "workspace:clitq5hfg0000qv0gtg9nv9fy" });

    await expect(
      readAuthState(
        { PRISMA_SERVICE_TOKEN: token } as NodeJS.ProcessEnv,
        controller.signal,
      ),
    ).rejects.toBe(reason);
  });

  it("rejects when cancellation aborts the workspace fallback lookup", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Command canceled", "AbortError");
    const authenticatedManagementApiClient = vi.fn().mockResolvedValue({
      GET: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/me") {
          return { data: { data: null } };
        }

        controller.abort(reason);
        throw reason;
      }),
    });

    vi.doMock("../src/auth/token-storage", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth/token-storage")>()),
      FileTokenStorage: vi.fn().mockImplementation(() => ({
        getTokens: vi.fn(),
      })),
    }));
    vi.doMock("../src/auth/guard", () => ({ authenticatedManagementApiClient }));

    const { readAuthState } = await import("../src/auth/operations");
    const token = encodeJwt({ sub: "workspace:clitq5hfg0000qv0gtg9nv9fy" });

    await expect(
      readAuthState(
        { PRISMA_SERVICE_TOKEN: token } as NodeJS.ProcessEnv,
        controller.signal,
      ),
    ).rejects.toBe(reason);
  });

  it("returns signed-out state when PRISMA_SERVICE_TOKEN does not carry a workspace subject", async () => {
    const getTokens = vi.fn();
    vi.doMock("../src/auth/token-storage", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth/token-storage")>()),
      FileTokenStorage: mockFileTokenStorage(getTokens),
    }));
    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient: vi.fn(),
    }));

    const { readAuthState } = await import("../src/auth/operations");
    const token = encodeJwt({ sub: "user:usr_123" });

    await expect(
      readAuthState({ PRISMA_SERVICE_TOKEN: token } as NodeJS.ProcessEnv),
    ).resolves.toEqual({
      authenticated: false,
      provider: null,
      user: null,
      workspace: null,
      credential: null,
    });
    expect(getTokens).not.toHaveBeenCalled();
  });

  it("treats an empty PRISMA_SERVICE_TOKEN as invalid and does not fall back to FileTokenStorage", async () => {
    const getTokens = vi.fn().mockResolvedValue(null);

    vi.doMock("../src/auth/token-storage", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth/token-storage")>()),
      FileTokenStorage: mockFileTokenStorage(getTokens),
    }));
    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient: vi.fn(),
    }));

    const { readAuthState } = await import("../src/auth/operations");

    await expect(
      readAuthState({ PRISMA_SERVICE_TOKEN: "   " } as NodeJS.ProcessEnv),
    ).rejects.toThrow(
      "PRISMA_SERVICE_TOKEN is set but empty. Provide a valid token or unset the variable.",
    );
    expect(getTokens).not.toHaveBeenCalled();
  });
});
