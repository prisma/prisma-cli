import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../src/adapters/token-storage");
  vi.doUnmock("../src/lib/auth/guard");
  vi.resetModules();
  vi.restoreAllMocks();
});

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

    await expect(readAuthState(process.env)).resolves.toEqual({
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

    await expect(readAuthState(process.env)).resolves.toMatchObject({
      authenticated: true,
      user: null,
      workspace: {
        id: "wksp_cmmxlp7ae1251zyfs8mdpnavm",
        name: "Sandpit",
      },
    });
  });
});
