import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  process.env.PRISMA_CLI_TEST_REMEMBER_PROJECT_ID = "proj_123";
  process.env.PRISMA_CLI_TEST_REMEMBER_PROJECT_NAME = "Acme Dashboard";
  process.env.PRISMA_CLI_TEST_REMEMBER_WORKSPACE_ID = "ws_123";

  vi.doMock("../src/lib/auth/auth-ops", () => ({
    readAuthState: vi.fn().mockResolvedValue({
      authenticated: true,
      provider: null,
      user: {
        email: "test@example.com",
      },
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
    }),
    performLogin: vi.fn(),
    performLogout: vi.fn(),
  }));
});

afterEach(() => {
  delete process.env.PRISMA_CLI_TEST_REMEMBER_PROJECT_ID;
  delete process.env.PRISMA_CLI_TEST_REMEMBER_PROJECT_NAME;
  delete process.env.PRISMA_CLI_TEST_REMEMBER_WORKSPACE_ID;

  vi.doUnmock("../src/lib/auth/auth-ops");
  vi.doUnmock("../src/lib/auth/guard");
  vi.doUnmock("../src/lib/app/preview-provider");
  vi.resetModules();
  vi.restoreAllMocks();
});

function createProjectClient() {
  return {
    token: "token",
    GET: vi.fn().mockImplementation((pathName: string) => {
      if (pathName === "/v1/projects") {
        return {
          data: {
            data: [
              {
                id: "proj_123",
                name: "Acme Dashboard",
                slug: "acme-dashboard",
                workspace: {
                  id: "ws_123",
                  name: "Acme Inc",
                },
              },
            ],
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    }),
  };
}

describe("app env vars", () => {
  it("parses repeated env assignments and allows empty values", async () => {
    const { parseEnvAssignments } = await import("../src/lib/app/env-vars");

    expect(
      parseEnvAssignments(
        [
          "DATABASE_URL=postgresql://example",
          "EMPTY=",
        ],
        { commandName: "deploy" },
      ),
    ).toEqual({
      DATABASE_URL: "postgresql://example",
      EMPTY: "",
    });
  });

  it("rejects invalid env assignments without leaking values", async () => {
    const { parseEnvAssignments } = await import("../src/lib/app/env-vars");

    expect(() => parseEnvAssignments(["DATABASE_URL"], { commandName: "deploy" })).toThrowError(
      expect.objectContaining({
        code: "USAGE_ERROR",
        summary: "Environment variable assignment must use NAME=VALUE",
      }),
    );
    expect(() => parseEnvAssignments(["=secret"], { commandName: "deploy" })).toThrowError(
      expect.objectContaining({
        code: "USAGE_ERROR",
        summary: "Environment variable name is required",
      }),
    );

    try {
      parseEnvAssignments(
        [
          "DATABASE_URL=postgresql://first",
          "DATABASE_URL=postgresql://second",
        ],
        { commandName: "deploy" },
      );
    } catch (error) {
      expect(error).toMatchObject({
        code: "USAGE_ERROR",
        summary: 'Environment variable "DATABASE_URL" was provided more than once',
      });
      expect(JSON.stringify(error)).not.toContain("postgresql://first");
      expect(JSON.stringify(error)).not.toContain("postgresql://second");
    }
  });

  it("returns sorted environment variable names only", async () => {
    const { envVarNames } = await import("../src/lib/app/env-vars");

    expect(
      envVarNames({
        ZOO: "1",
        DATABASE_URL: "postgresql://example",
        EMPTY: null,
        API_TOKEN: "",
      }),
    ).toEqual(["API_TOKEN", "DATABASE_URL", "ZOO"]);
  });

  it("passes env vars to provider deploy without surfacing values", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: null, liveUrl: null },
    ]);
    const deployApp = vi.fn().mockResolvedValue({
      projectId: "proj_123",
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_123",
        liveUrl: "https://hello-world.prisma.app",
      },
      deployment: {
        id: "dep_123",
        status: "running",
        url: "https://hello-world.prisma.app",
      },
    });

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        removeApp: vi.fn(),
        promoteDeployment: vi.fn(),
        deployApp,
        updateAppEnv: vi.fn(),
        listAppEnvNames: vi.fn(),
        listDeployments: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppDeploy } = await import("../src/controllers/app");
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

    const result = await runAppDeploy(
      context,
      "hello-world",
      {
        projectRef: "proj_123",
        framework: "hono",
        envAssignments: ["DATABASE_URL=postgresql://example", "FEATURE_FLAG=enabled", "EMPTY="],
      },
    );

    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_123",
        appId: "app_1",
        envVars: {
          DATABASE_URL: "postgresql://example",
          FEATURE_FLAG: "enabled",
          EMPTY: "",
        },
      }),
    );
    expect(JSON.stringify(result.result)).not.toContain("postgresql://example");
    expect(JSON.stringify(result.result)).not.toContain("enabled");
  });

  it("parses deploy build, port, explicit project, and JSON output through the CLI command layer", async () => {
    const runAppDeploy = vi.fn().mockResolvedValue({
      command: "app.deploy",
      result: {
        workspace: {
          id: "ws_123",
          name: "Acme Inc",
        },
        project: {
          id: "proj_123",
          name: "Acme Dashboard",
        },
        branch: {
          name: "preview",
          kind: "preview",
        },
        resolution: {
          projectSource: "explicit",
        },
        app: {
          id: "app_1",
          name: "hello-world",
        },
        deployment: {
          id: "dep_123",
          status: "running",
          url: "https://hello-world.prisma.app",
        },
      },
      warnings: [],
      nextSteps: ["prisma-cli app list-deploys"],
    });

    vi.doMock("../src/controllers/app", async () => {
      const actual = await vi.importActual<typeof import("../src/controllers/app")>("../src/controllers/app");
      return {
        ...actual,
        runAppDeploy,
      };
    });

    const { createTempCwd, executeCli } = await import("./helpers");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: [
        "app",
        "deploy",
        "--app",
        "hello-world",
        "--build-type",
        "nextjs",
        "--http-port",
        "3000",
        "--env",
        "DATABASE_URL=postgresql://example",
        "--project",
        "proj_123",
        "--json",
      ],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "app.deploy",
      result: {
        workspace: {
          id: "ws_123",
          name: "Acme Inc",
        },
        project: {
          id: "proj_123",
          name: "Acme Dashboard",
        },
        branch: {
          name: "preview",
          kind: "preview",
        },
        app: {
          id: "app_1",
          name: "hello-world",
        },
        deployment: {
          id: "dep_123",
        },
      },
    });
    expect(runAppDeploy).toHaveBeenCalledWith(
      expect.anything(),
      "hello-world",
      {
        entrypoint: undefined,
        buildType: "nextjs",
        httpPort: "3000",
        envAssignments: ["DATABASE_URL=postgresql://example"],
        projectRef: "proj_123",
      },
    );
  });
});
