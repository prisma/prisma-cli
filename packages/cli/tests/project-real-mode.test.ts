import path from "node:path";

import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

type ApiGetMock = Mock<
  (
    pathName: string,
    request?: { params?: { query?: Record<string, unknown> } },
  ) => unknown
>;
type ApiMutationMock = Mock<(pathName: string, request?: unknown) => unknown>;

afterEach(() => {
  vi.doUnmock("../src/auth");
  vi.doUnmock("../src/auth/guard");
  vi.doUnmock("open");
  vi.resetModules();
  vi.restoreAllMocks();
});

function mockAuthState() {
  return vi.fn().mockResolvedValue({
    authenticated: true,
    provider: null,
    user: {
      email: "real@example.com",
    },
    workspace: {
      id: "ws_123",
      name: "Acme Inc",
    },
  });
}

function mockClient(
  extra: Partial<{
    GET: ApiGetMock;
    POST: ApiMutationMock;
    DELETE: ApiMutationMock;
  }> = {},
) {
  return {
    GET:
      extra.GET ??
      vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/projects") {
          return {
            data: {
              data: [
                {
                  id: "proj_456",
                  name: "Billing API",
                  slug: "billing-api",
                  url: "https://prisma.build/acme/billing-api",
                  workspace: { id: "ws_123", name: "Acme Inc" },
                },
                {
                  id: "proj_999",
                  name: "Alpha",
                  slug: "alpha",
                  workspace: { id: "ws_other", name: "Other" },
                },
                {
                  id: "proj_123",
                  name: "Acme Dashboard",
                  slug: "acme-dashboard",
                  url: "https://prisma.build/acme/acme-dashboard",
                  workspace: { id: "ws_123", name: "Acme Inc" },
                },
              ],
            },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
    POST: extra.POST ?? vi.fn(),
    DELETE: extra.DELETE ?? vi.fn(),
  };
}

function sourceRepositoryList(records: unknown[] = []) {
  return {
    data: {
      data: records,
      pagination: {
        nextCursor: null,
        hasMore: false,
      },
    },
  };
}

function scmInstallationRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "scminstall_123",
    type: "scm-installation",
    url: "https://api.prisma.test/v1/scm-installations/scminstall_123",
    provider: "github",
    installationId: 98765,
    accountId: 111,
    accountLogin: "prisma",
    accountType: "organization",
    suspended: false,
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
    ...overrides,
  };
}

function scmRepositoryRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 999,
    type: "scm-repository",
    fullName: "prisma/other",
    defaultBranch: "main",
    isPrivate: false,
    ...overrides,
  };
}

function expectInstallIntentPost(post: ReturnType<typeof vi.fn>): void {
  expect(post).toHaveBeenCalledWith(
    "/v1/scm-installations/install-intents",
    expect.objectContaining({
      body: {
        provider: "github",
        workspaceId: "ws_123",
      },
    }),
  );
}

describe("real project mode", () => {
  it("uses the real API path for project list and sorts by name then id", async () => {
    const readAuthState = mockAuthState();
    const authenticatedManagementApiClient = vi
      .fn()
      .mockResolvedValue(mockClient());

    vi.doMock("../src/auth", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth")>()),
      readAuthState,
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runProjectList } = await import("../src/controllers/project");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const result = await runProjectList(context);

    expect(readAuthState).toHaveBeenCalledWith(
      context.runtime.env,
      context.runtime.signal,
    );
    expect(authenticatedManagementApiClient).toHaveBeenCalledWith(
      context.runtime.env,
      context.runtime.signal,
    );
    expect(result.result).toEqual({
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      projects: [
        {
          id: "proj_123",
          name: "Acme Dashboard",
          url: "https://prisma.build/acme/acme-dashboard",
        },
        {
          id: "proj_456",
          name: "Billing API",
          url: "https://prisma.build/acme/billing-api",
        },
      ],
      localBinding: {
        status: "not-linked",
      },
    });
    expect(result.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "user-choice",
          journey: "project-setup",
        }),
      ]),
    );
  });

  it("resolves an explicit project in real mode", async () => {
    vi.doMock("../src/auth", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth")>()),
      readAuthState: mockAuthState(),
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient: vi.fn().mockResolvedValue(mockClient()),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runProjectShow } = await import("../src/controllers/project");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(runProjectShow(context, "proj_123")).resolves.toMatchObject({
      result: {
        workspace: {
          id: "ws_123",
          name: "Acme Inc",
        },
        project: {
          id: "proj_123",
          name: "Acme Dashboard",
          url: "https://prisma.build/acme/acme-dashboard",
        },
        resolution: {
          projectSource: "explicit",
        },
      },
    });
  });

  it("creates an install intent when the stored GitHub App installation is unavailable", async () => {
    const get = vi.fn().mockImplementation((pathName: string) => {
      if (pathName === "/v1/projects") {
        return mockClient().GET(pathName);
      }

      if (pathName === "/v1/source-repositories") {
        return sourceRepositoryList();
      }

      if (pathName === "/v1/scm-installations") {
        return {
          data: {
            data: [
              {
                id: "scminstall_123",
                type: "scm-installation",
                url: "https://api.prisma.test/v1/scm-installations/scminstall_123",
                provider: "github",
                installationId: 98765,
                accountId: 111,
                accountLogin: "prisma",
                accountType: "organization",
                suspended: false,
                createdAt: "2026-05-18T00:00:00.000Z",
                updatedAt: "2026-05-18T00:00:00.000Z",
              },
            ],
            pagination: {
              nextCursor: null,
              hasMore: false,
            },
          },
        };
      }

      if (pathName === "/v1/scm-installations/{installationId}/repositories") {
        return {
          error: {
            error: {
              code: "validation-error",
              message: "Failed to list repositories via the SCM provider",
              hint: "Check the request body against the API docs at GET /v1/doc.",
            },
          },
          response: new Response(null, { status: 422 }),
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    });
    const post = vi.fn().mockImplementation((pathName: string) => {
      if (pathName === "/v1/scm-installations/install-intents") {
        return {
          data: {
            data: {
              type: "install-intent",
              provider: "github",
              workspaceId: "wksp_123",
              installUrl:
                "https://github.com/apps/prisma/installations/new?state=abc",
            },
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    });

    vi.doMock("../src/auth", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth")>()),
      readAuthState: mockAuthState(),
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient: vi
        .fn()
        .mockResolvedValue(mockClient({ GET: get, POST: post })),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runGitConnect } = await import("../src/controllers/project");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(
      runGitConnect(context, "https://github.com/prisma/prisma-cli", {
        project: "proj_123",
      }),
    ).rejects.toMatchObject({
      code: "REPO_INSTALLATION_REQUIRED",
      meta: {
        installUrl:
          "https://github.com/apps/prisma/installations/new?state=abc",
        opened: false,
        repository: "prisma/prisma-cli",
      },
    });
    expect(post).toHaveBeenCalledOnce();
    expectInstallIntentPost(post);
  });

  it("guards repeated GitHub App installation pagination cursors", async () => {
    const get = vi.fn().mockImplementation((pathName: string) => {
      if (pathName === "/v1/projects") {
        return mockClient().GET(pathName);
      }

      if (pathName === "/v1/source-repositories") {
        return sourceRepositoryList();
      }

      if (pathName === "/v1/scm-installations") {
        return {
          data: {
            data: [],
            pagination: {
              nextCursor: "repeat",
              hasMore: true,
            },
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    });
    const post = vi.fn();

    vi.doMock("../src/auth", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth")>()),
      readAuthState: mockAuthState(),
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient: vi
        .fn()
        .mockResolvedValue(mockClient({ GET: get, POST: post })),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runGitConnect } = await import("../src/controllers/project");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(
      runGitConnect(context, "https://github.com/prisma/prisma-cli", {
        project: "proj_123",
      }),
    ).rejects.toMatchObject({
      code: "REPO_CONNECTION_FAILED",
      why: "Pagination cursor did not advance.",
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("guards repeated GitHub repository pagination cursors", async () => {
    const get = vi.fn().mockImplementation((pathName: string) => {
      if (pathName === "/v1/projects") {
        return mockClient().GET(pathName);
      }

      if (pathName === "/v1/source-repositories") {
        return sourceRepositoryList();
      }

      if (pathName === "/v1/scm-installations") {
        return {
          data: {
            data: [scmInstallationRecord()],
            pagination: {
              nextCursor: null,
              hasMore: false,
            },
          },
        };
      }

      if (pathName === "/v1/scm-installations/{installationId}/repositories") {
        return {
          data: {
            data: [scmRepositoryRecord()],
            pagination: {
              nextCursor: "repeat",
              hasMore: true,
            },
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    });
    const post = vi.fn();

    vi.doMock("../src/auth", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth")>()),
      readAuthState: mockAuthState(),
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient: vi
        .fn()
        .mockResolvedValue(mockClient({ GET: get, POST: post })),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runGitConnect } = await import("../src/controllers/project");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(
      runGitConnect(context, "https://github.com/prisma/prisma-cli", {
        project: "proj_123",
      }),
    ).rejects.toMatchObject({
      code: "REPO_CONNECTION_FAILED",
      why: "Pagination cursor did not advance.",
    });
    expect(post).not.toHaveBeenCalled();
  });
});
