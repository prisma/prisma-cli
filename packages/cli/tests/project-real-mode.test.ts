import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../src/lib/auth/auth-ops");
  vi.doUnmock("../src/lib/auth/guard");
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

function mockClient() {
  return {
    GET: vi.fn().mockImplementation((pathName: string) => {
      if (pathName === "/v1/projects") {
        return {
          data: {
            data: [
              { id: "proj_456", name: "Billing API", slug: "billing-api", workspace: { id: "ws_123", name: "Acme Inc" } },
              { id: "proj_999", name: "Alpha", slug: "alpha", workspace: { id: "ws_other", name: "Other" } },
              { id: "proj_123", name: "Acme Dashboard", slug: "acme-dashboard", workspace: { id: "ws_123", name: "Acme Inc" } },
            ],
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    }),
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
        { id: "proj_123", name: "Acme Dashboard" },
        { id: "proj_456", name: "Billing API" },
      ],
    });
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
        },
        resolution: {
          projectSource: "explicit",
        },
      },
    });
  });
});
