import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../src/lib/auth/auth-ops");
  vi.doUnmock("../src/lib/auth/guard");
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

function mockClient(extra: Partial<{
  GET: ReturnType<typeof vi.fn>;
  POST: ReturnType<typeof vi.fn>;
  DELETE: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    GET: extra.GET ?? vi.fn().mockImplementation((pathName: string) => {
      if (pathName === "/v1/projects") {
        return {
          data: {
            data: [
              { id: "proj_456", name: "Billing API", slug: "billing-api", url: "https://prisma.build/acme/billing-api", workspace: { id: "ws_123", name: "Acme Inc" } },
              { id: "proj_999", name: "Alpha", slug: "alpha", workspace: { id: "ws_other", name: "Other" } },
              { id: "proj_123", name: "Acme Dashboard", slug: "acme-dashboard", url: "https://prisma.build/acme/acme-dashboard", workspace: { id: "ws_123", name: "Acme Inc" } },
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

function sourceRepositoryRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "srcrepo_123",
    repoId: 123456,
    provider: "github",
    repoFullName: "prisma/prisma-cli",
    defaultBranch: "main",
    isPrivate: true,
    status: "active",
    projectId: "proj_123",
    installationId: "scminstall_123",
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
    ...overrides,
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

describe("real project mode", () => {
  it("uses the real API path for project list and sorts by name then id", async () => {
    const readAuthState = mockAuthState();
    const requireComputeAuth = vi.fn().mockResolvedValue(mockClient());

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState,
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
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

    expect(readAuthState).toHaveBeenCalledWith(context.runtime.env);
    expect(requireComputeAuth).toHaveBeenCalledWith(context.runtime.env);
    expect(result.result).toEqual({
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      projects: [
        { id: "proj_123", name: "Acme Dashboard", url: "https://prisma.build/acme/acme-dashboard" },
        { id: "proj_456", name: "Billing API", url: "https://prisma.build/acme/billing-api" },
      ],
      localBinding: {
        status: "not-linked",
      },
    });
    expect(result.nextActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "user-choice",
        journey: "project-setup",
      }),
    ]));
  });

  it("resolves an explicit project in real mode", async () => {
    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState: mockAuthState(),
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn().mockResolvedValue(mockClient()),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
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

  it("connects a GitHub repository through an installed GitHub App", async () => {
    const get = vi.fn().mockImplementation((pathName: string, request?: { params?: { query?: Record<string, unknown> } }) => {
      if (pathName === "/v1/projects") {
        return mockClient().GET(pathName);
      }

      if (pathName === "/v1/source-repositories") {
        return sourceRepositoryList();
      }

      if (pathName === "/v1/scm-installations") {
        expect(request?.params?.query).toEqual({
          workspaceId: "ws_123",
          limit: 100,
        });
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
        if (request?.params?.query?.cursor === "2") {
          return {
            data: {
              data: [
                {
                  id: 123456,
                  type: "scm-repository",
                  fullName: "prisma/prisma-cli",
                  defaultBranch: "main",
                  isPrivate: true,
                },
              ],
              pagination: {
                nextCursor: null,
                hasMore: false,
              },
            },
          };
        }

        return {
          data: {
            data: [
              {
                id: 999,
                type: "scm-repository",
                fullName: "prisma/other",
                defaultBranch: "main",
                isPrivate: false,
              },
            ],
            pagination: {
              nextCursor: "2",
              hasMore: true,
            },
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    });
    const post = vi.fn().mockImplementation((pathName: string, request?: { body?: unknown }) => {
      if (pathName === "/v1/source-repositories") {
        expect(request?.body).toEqual({
          projectId: "proj_123",
          provider: "github",
          providerRepositoryId: 123456,
          installationId: "scminstall_123",
        });
        return {
          data: {
            data: {
              id: "srcrepo_123",
              repoId: 123456,
              provider: "github",
              repoFullName: "prisma/prisma-cli",
              defaultBranch: "main",
              isPrivate: true,
              status: "active",
              projectId: "proj_123",
              installationId: "scminstall_123",
              createdAt: "2026-05-18T00:00:00.000Z",
              updatedAt: "2026-05-18T00:00:00.000Z",
            },
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    });

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState: mockAuthState(),
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn().mockResolvedValue(mockClient({ GET: get, POST: post })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
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

    const result = await runGitConnect(context, "https://github.com/prisma/prisma-cli", { project: "proj_123" });

    expect(post).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith("/v1/scm-installations/{installationId}/repositories", {
      params: {
        path: {
          installationId: "scminstall_123",
        },
        query: {
          limit: 100,
          cursor: "2",
        },
      },
    });
    expect(result.result.repositoryConnection).toMatchObject({
      id: "srcrepo_123",
      repoId: 123456,
      repository: {
        fullName: "prisma/prisma-cli",
      },
      defaultBranch: "main",
      isPrivate: true,
      status: "active",
      installation: {
        id: "scminstall_123",
        status: "connected",
      },
    });
  });

  it("returns the existing connection when the project is already connected to the same GitHub repository", async () => {
    const get = vi.fn().mockImplementation((pathName: string) => {
      if (pathName === "/v1/projects") {
        return mockClient().GET(pathName);
      }

      if (pathName === "/v1/source-repositories") {
        return sourceRepositoryList([
          sourceRepositoryRecord({
            repoFullName: "Prisma/Prisma-CLI",
          }),
        ]);
      }

      throw new Error(`Unexpected path ${pathName}`);
    });
    const post = vi.fn();

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState: mockAuthState(),
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn().mockResolvedValue(mockClient({ GET: get, POST: post })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
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

    const result = await runGitConnect(context, "https://github.com/prisma/prisma-cli", { project: "proj_123" });

    expect(post).not.toHaveBeenCalled();
    expect(result.result.repositoryConnection).toMatchObject({
      id: "srcrepo_123",
      repository: {
        fullName: "Prisma/Prisma-CLI",
      },
      status: "active",
    });
  });

  it("creates an install intent when the workspace has no GitHub App installation", async () => {
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
              nextCursor: null,
              hasMore: false,
            },
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    });
    const post = vi.fn().mockImplementation((pathName: string, request?: { body?: unknown }) => {
      if (pathName === "/v1/scm-installations/install-intents") {
        expect(request?.body).toEqual({
          provider: "github",
          workspaceId: "ws_123",
        });
        return {
          data: {
            data: {
              type: "install-intent",
              provider: "github",
              workspaceId: "wksp_123",
              installUrl: "https://github.com/apps/prisma/installations/new?state=abc",
            },
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    });

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState: mockAuthState(),
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn().mockResolvedValue(mockClient({ GET: get, POST: post })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
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

    await expect(runGitConnect(context, "https://github.com/prisma/prisma-cli", { project: "proj_123" }))
      .rejects
      .toMatchObject({
        code: "REPO_INSTALLATION_REQUIRED",
        meta: {
          installUrl: "https://github.com/apps/prisma/installations/new?state=abc",
          opened: false,
          repository: "prisma/prisma-cli",
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
    const post = vi.fn().mockImplementation((pathName: string, request?: { body?: unknown }) => {
      if (pathName === "/v1/scm-installations/install-intents") {
        expect(request?.body).toEqual({
          provider: "github",
          workspaceId: "ws_123",
        });
        return {
          data: {
            data: {
              type: "install-intent",
              provider: "github",
              workspaceId: "wksp_123",
              installUrl: "https://github.com/apps/prisma/installations/new?state=abc",
            },
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    });

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState: mockAuthState(),
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn().mockResolvedValue(mockClient({ GET: get, POST: post })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
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

    await expect(runGitConnect(context, "https://github.com/prisma/prisma-cli", { project: "proj_123" }))
      .rejects
      .toMatchObject({
        code: "REPO_INSTALLATION_REQUIRED",
        meta: {
          installUrl: "https://github.com/apps/prisma/installations/new?state=abc",
          opened: false,
          repository: "prisma/prisma-cli",
        },
      });
    expect(post).toHaveBeenCalledOnce();
  });

  it("waits for GitHub App installation in interactive mode and connects after approval", async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);
    vi.doMock("open", () => ({ default: openBrowser }));

    let installationListCalls = 0;
    const get = vi.fn().mockImplementation((pathName: string) => {
      if (pathName === "/v1/projects") {
        return mockClient().GET(pathName);
      }

      if (pathName === "/v1/source-repositories") {
        return sourceRepositoryList();
      }

      if (pathName === "/v1/scm-installations") {
        installationListCalls += 1;
        return {
          data: {
            data: installationListCalls === 1
              ? []
              : [
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
          data: {
            data: [
              {
                id: 123456,
                type: "scm-repository",
                fullName: "prisma/prisma-cli",
                defaultBranch: "main",
                isPrivate: true,
              },
            ],
            pagination: {
              nextCursor: null,
              hasMore: false,
            },
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    });
    const post = vi.fn().mockImplementation((pathName: string, request?: { body?: unknown }) => {
      if (pathName === "/v1/scm-installations/install-intents") {
        expect(request?.body).toEqual({
          provider: "github",
          workspaceId: "ws_123",
        });
        return {
          data: {
            data: {
              type: "install-intent",
              provider: "github",
              workspaceId: "wksp_123",
              installUrl: "https://github.com/apps/prisma/installations/new?state=abc",
            },
          },
        };
      }

      if (pathName === "/v1/source-repositories") {
        expect(request?.body).toEqual({
          projectId: "proj_123",
          provider: "github",
          providerRepositoryId: 123456,
          installationId: "scminstall_123",
        });
        return {
          data: {
            data: {
              id: "srcrepo_123",
              repoId: 123456,
              provider: "github",
              repoFullName: "prisma/prisma-cli",
              defaultBranch: "main",
              isPrivate: true,
              status: "active",
              projectId: "proj_123",
              installationId: "scminstall_123",
              createdAt: "2026-05-18T00:00:00.000Z",
              updatedAt: "2026-05-18T00:00:00.000Z",
            },
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    });

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState: mockAuthState(),
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn().mockResolvedValue(mockClient({ GET: get, POST: post })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runGitConnect } = await import("../src/controllers/project");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context, stderr } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: true,
      flags: { interactive: true },
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
        PRISMA_CLI_GITHUB_INSTALL_POLL_INTERVAL_MS: "1",
        PRISMA_CLI_GITHUB_INSTALL_TIMEOUT_MS: "50",
      },
    });

    const result = await runGitConnect(context, "https://github.com/prisma/prisma-cli", { project: "proj_123" });

    expect(openBrowser).toHaveBeenCalledWith("https://github.com/apps/prisma/installations/new?state=abc");
    expect(installationListCalls).toBe(2);
    expect(post).toHaveBeenCalledWith("/v1/source-repositories", {
      body: {
        projectId: "proj_123",
        provider: "github",
        providerRepositoryId: 123456,
        installationId: "scminstall_123",
      },
    });
    expect(stderr.buffer).toContain("Waiting for GitHub App installation or repository access approval");
    expect(result.result.repositoryConnection?.repository.fullName).toBe("prisma/prisma-cli");
  });

  it("returns REPO_NOT_ACCESSIBLE when the GitHub App cannot see the repository", async () => {
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
          data: {
            data: [
              {
                id: 999,
                type: "scm-repository",
                fullName: "prisma/other",
                defaultBranch: "main",
                isPrivate: false,
              },
            ],
            pagination: {
              nextCursor: null,
              hasMore: false,
            },
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    });
    const post = vi.fn().mockImplementation((pathName: string, request?: { body?: unknown }) => {
      if (pathName === "/v1/scm-installations/install-intents") {
        expect(request?.body).toEqual({
          provider: "github",
          workspaceId: "ws_123",
        });
        return {
          data: {
            data: {
              type: "install-intent",
              provider: "github",
              workspaceId: "wksp_123",
              installUrl: "https://github.com/apps/prisma/installations/new?state=abc",
            },
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    });

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState: mockAuthState(),
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn().mockResolvedValue(mockClient({ GET: get, POST: post })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
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

    await expect(runGitConnect(context, "https://github.com/prisma/prisma-cli", { project: "proj_123" }))
      .rejects
      .toMatchObject({
        code: "REPO_NOT_ACCESSIBLE",
        meta: {
          installUrl: "https://github.com/apps/prisma/installations/new?state=abc",
          opened: false,
          repository: "prisma/prisma-cli",
        },
      });
    expect(post).toHaveBeenCalledOnce();
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

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState: mockAuthState(),
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn().mockResolvedValue(mockClient({ GET: get, POST: post })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
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

    await expect(runGitConnect(context, "https://github.com/prisma/prisma-cli", { project: "proj_123" }))
      .rejects
      .toMatchObject({
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

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState: mockAuthState(),
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn().mockResolvedValue(mockClient({ GET: get, POST: post })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
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

    await expect(runGitConnect(context, "https://github.com/prisma/prisma-cli", { project: "proj_123" }))
      .rejects
      .toMatchObject({
        code: "REPO_CONNECTION_FAILED",
        why: "Pagination cursor did not advance.",
      });
    expect(post).not.toHaveBeenCalled();
  });

  it("disconnects a GitHub repository through the source repositories API", async () => {
    const del = vi.fn().mockResolvedValue({});
    const get = vi.fn().mockImplementation((pathName: string) => {
      if (pathName === "/v1/projects") {
        return mockClient().GET(pathName);
      }

      if (pathName === "/v1/source-repositories") {
        return {
          data: {
            data: [
              {
                id: "srcrepo_123",
                repoId: 123456,
                provider: "github",
                repoFullName: "prisma/prisma-cli",
                defaultBranch: "main",
                isPrivate: false,
                status: "active",
                projectId: "proj_123",
                installationId: "scminstall_123",
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

      throw new Error(`Unexpected path ${pathName}`);
    });

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState: mockAuthState(),
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn().mockResolvedValue(mockClient({ GET: get, DELETE: del })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runGitDisconnect } = await import("../src/controllers/project");
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

    const result = await runGitDisconnect(context, { project: "proj_123" });

    expect(del).toHaveBeenCalledWith("/v1/source-repositories/{id}", {
      params: {
        path: {
          id: "srcrepo_123",
        },
      },
    });
    expect(result.result.repositoryConnection?.repository.fullName).toBe("prisma/prisma-cli");
  });
});
