import path from "node:path";

import stripAnsi from "strip-ansi";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../src/lib/auth/auth-ops");
  vi.doUnmock("../src/lib/auth/guard");
  vi.doUnmock("../src/adapters/config");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("real project mode", () => {
  it("uses the real API path for project list and sorts by name then id", async () => {
    const readAuthState = vi.fn().mockResolvedValue({
      authenticated: true,
      provider: null,
      user: {
        email: "real@example.com",
      },
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      linkedProjectId: null,
    });
    const requireComputeAuth = vi.fn().mockResolvedValue({
      GET: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/projects") {
          return {
            data: {
              data: [
                { id: "proj_456", name: "Billing API", workspace: { id: "ws_123", name: "Acme Inc" } },
                { id: "proj_999", name: "Alpha", workspace: { id: "ws_other", name: "Other" } },
                { id: "proj_123", name: "Acme Dashboard", workspace: { id: "ws_123", name: "Acme Inc" } },
                { id: "proj_321", name: "Billing API", workspace: { id: "ws_123", name: "Acme Inc" } },
              ],
            },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
    });
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState,
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
        writeLinkedProjectId: vi.fn(),
      };
    });

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
      linkedProjectId: "proj_123",
      projects: [
        { id: "proj_123", name: "Acme Dashboard" },
        { id: "proj_321", name: "Billing API" },
        { id: "proj_456", name: "Billing API" },
      ],
    });
  });

  it("stays in fixture mode for project list when a fixture path is enabled", async () => {
    const readAuthState = vi.fn();
    const requireComputeAuth = vi.fn();

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState,
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));

    const fixturePath = path.resolve("fixtures/mock-api.json");
    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runProjectList } = await import("../src/controllers/project");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      fixturePath,
    });

    await context.stateStore.setAuthSession({
      provider: "github",
      userId: "usr_456",
      workspaceId: "ws_123",
    });

    const result = await runProjectList(context);

    expect(readAuthState).not.toHaveBeenCalled();
    expect(requireComputeAuth).not.toHaveBeenCalled();
    expect(result.result.projects).toEqual([
      { id: "proj_123", name: "Acme Dashboard" },
      { id: "proj_456", name: "Billing API" },
    ]);
  });

  it("returns linked local-only state from project show when signed out", async () => {
    const readAuthState = vi.fn().mockResolvedValue({
      authenticated: false,
      provider: null,
      user: null,
      workspace: null,
      linkedProjectId: null,
    });
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState,
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
        writeLinkedProjectId: vi.fn(),
      };
    });

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

    await expect(runProjectShow(context)).resolves.toMatchObject({
      result: {
        linkedProjectId: "proj_123",
        workspace: null,
        project: null,
      },
    });
    expect(readAuthState).toHaveBeenCalledWith(context.runtime.env);
  });

  it("returns enriched remote details from project show when signed in", async () => {
    const readAuthState = vi.fn().mockResolvedValue({
      authenticated: true,
      provider: null,
      user: {
        email: "real@example.com",
      },
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      linkedProjectId: null,
    });
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({
      GET: vi.fn().mockImplementation((pathName: string, request?: { params?: { path?: { id?: string } } }) => {
        if (pathName === "/v1/projects/{id}" && request?.params?.path?.id === "proj_123") {
          return {
            data: {
              data: {
                id: "proj_123",
                name: "Acme Dashboard",
                workspace: {
                  id: "ws_123",
                  name: "Acme Inc",
                },
              },
            },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
    });

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState,
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
        writeLinkedProjectId: vi.fn(),
      };
    });

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

    await expect(runProjectShow(context)).resolves.toMatchObject({
      result: {
        linkedProjectId: "proj_123",
        workspace: {
          id: "ws_123",
          name: "Acme Inc",
        },
        project: {
          id: "proj_123",
          name: "Acme Dashboard",
        },
      },
    });
  });

  it("validates explicit project ids against the active workspace and writes only the project id", async () => {
    const readAuthState = vi.fn().mockResolvedValue({
      authenticated: true,
      provider: null,
      user: {
        email: "real@example.com",
      },
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      linkedProjectId: null,
    });
    const writeLinkedProjectId = vi.fn().mockResolvedValue(undefined);
    const requireComputeAuth = vi.fn().mockResolvedValue({
      GET: vi.fn().mockImplementation((pathName: string, request?: { params?: { path?: { id?: string } } }) => {
        if (pathName === "/v1/projects/{id}" && request?.params?.path?.id === "proj_123") {
          return {
            data: {
              data: {
                id: "proj_123",
                name: "Acme Dashboard",
                workspace: {
                  id: "ws_123",
                  name: "Acme Inc",
                },
              },
            },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
    });

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState,
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId: vi.fn().mockResolvedValue(null),
        writeLinkedProjectId,
      };
    });

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runProjectLink } = await import("../src/controllers/project");
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

    const result = await runProjectLink(context, "proj_123");

    expect(writeLinkedProjectId).toHaveBeenCalledWith(context.runtime.cwd, "proj_123");
    expect(result.result).toEqual({
      linkedProjectId: "proj_123",
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      project: {
        id: "proj_123",
        name: "Acme Dashboard",
      },
    });
  });

  it("uses sorted interactive project labels with ids in real mode", async () => {
    const readAuthState = vi.fn().mockResolvedValue({
      authenticated: true,
      provider: null,
      user: {
        email: "real@example.com",
      },
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      linkedProjectId: null,
    });
    const writeLinkedProjectId = vi.fn().mockResolvedValue(undefined);
    const requireComputeAuth = vi.fn().mockResolvedValue({
      GET: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/projects") {
          return {
            data: {
              data: [
                { id: "proj_456", name: "Billing API", workspace: { id: "ws_123", name: "Acme Inc" } },
                { id: "proj_123", name: "Acme Dashboard", workspace: { id: "ws_123", name: "Acme Inc" } },
              ],
            },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
    });

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState,
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId: vi.fn().mockResolvedValue(null),
        writeLinkedProjectId,
      };
    });

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runProjectLink } = await import("../src/controllers/project");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context, stderr } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
      isTTY: true,
      stdinText: "\u001B[B\r",
    });

    const result = await runProjectLink(context, undefined);
    const output = stripAnsi(stderr.buffer);

    expect(output).toContain("Select a project");
    expect(output).toContain("Acme Dashboard (proj_123)");
    expect(output).toContain("Billing API (proj_456)");
    expect(writeLinkedProjectId).toHaveBeenCalledWith(context.runtime.cwd, "proj_456");
    expect(result.result.linkedProjectId).toBe("proj_456");
  });

  it("surfaces writable-config failures as the documented usage error", async () => {
    const readAuthState = vi.fn().mockResolvedValue({
      authenticated: true,
      provider: null,
      user: {
        email: "real@example.com",
      },
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      linkedProjectId: null,
    });

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState,
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn().mockResolvedValue({
        GET: vi.fn().mockImplementation((pathName: string, request?: { params?: { path?: { id?: string } } }) => {
          if (pathName === "/v1/projects/{id}" && request?.params?.path?.id === "proj_123") {
            return {
              data: {
                data: {
                  id: "proj_123",
                  name: "Acme Dashboard",
                  workspace: {
                    id: "ws_123",
                    name: "Acme Inc",
                  },
                },
              },
            };
          }

          throw new Error(`Unexpected path ${pathName}`);
        }),
      }),
    }));
    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId: vi.fn().mockResolvedValue(null),
        writeLinkedProjectId: vi.fn().mockRejectedValue(
          new actual.UnsafeConfigWriteError("The existing prisma.config.ts file could not be updated safely."),
        ),
      };
    });

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runProjectLink } = await import("../src/controllers/project");
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

    await expect(runProjectLink(context, "proj_123")).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "project",
      summary: "Project link requires a writable Prisma config",
    });
  });

  it("does not mutate local branch state when linking in real mode", async () => {
    const readAuthState = vi.fn().mockResolvedValue({
      authenticated: true,
      provider: null,
      user: {
        email: "real@example.com",
      },
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      linkedProjectId: null,
    });
    const writeLinkedProjectId = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState,
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn().mockResolvedValue({
        GET: vi.fn().mockImplementation((pathName: string, request?: { params?: { path?: { id?: string } } }) => {
          if (pathName === "/v1/projects/{id}" && request?.params?.path?.id === "proj_123") {
            return {
              data: {
                data: {
                  id: "proj_123",
                  name: "Acme Dashboard",
                  workspace: {
                    id: "ws_123",
                    name: "Acme Inc",
                  },
                },
              },
            };
          }

          throw new Error(`Unexpected path ${pathName}`);
        }),
      }),
    }));
    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId: vi.fn().mockResolvedValue(null),
        writeLinkedProjectId,
      };
    });

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runProjectLink } = await import("../src/controllers/project");
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

    await runProjectLink(context, "proj_123");

    const state = await context.stateStore.read();
    expect(state.branch.active).toBe("preview");
  });
});
