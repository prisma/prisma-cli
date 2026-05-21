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

  it("returns NO_DEPLOYMENTS when updating env vars for an app without deployments", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: null, liveUrl: null },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: null, liveUrl: null },
      deployments: [],
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
        deployApp: vi.fn(),
        updateAppEnv: vi.fn(),
        listAppEnvNames: vi.fn(),
        listDeployments,
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppUpdateEnv } = await import("../src/controllers/app");
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
      runAppUpdateEnv(context, "hello-world", ["DATABASE_URL=postgresql://example"]),
    ).rejects.toMatchObject({
      code: "NO_DEPLOYMENTS",
      domain: "app",
    });
  });

  it("updates env vars, stores the new live deployment, and returns variable names only", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: "dep_old", liveUrl: "https://hello-world.prisma.app" },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: "dep_old", liveUrl: "https://hello-world.prisma.app" },
      deployments: [
        { id: "dep_old", status: "running", createdAt: "2026-04-14T10:00:00.000Z", url: "https://preview-old.prisma.app", live: true },
      ],
    });
    const updateAppEnv = vi.fn().mockResolvedValue({
      projectId: "proj_123",
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_new",
        liveUrl: "https://hello-world.prisma.app",
      },
      deployment: {
        id: "dep_new",
        status: "running",
        createdAt: "2026-04-14T11:00:00.000Z",
        url: "https://preview-new.prisma.app",
        live: true,
      },
      variables: ["DATABASE_URL", "FEATURE_FLAG"],
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
        deployApp: vi.fn(),
        updateAppEnv,
        listAppEnvNames: vi.fn(),
        listDeployments,
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppUpdateEnv } = await import("../src/controllers/app");
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

    const result = await runAppUpdateEnv(
      context,
      "hello-world",
      ["DATABASE_URL=postgresql://example", "FEATURE_FLAG=enabled"],
    );

    expect(updateAppEnv).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "app_1",
        envVars: {
          DATABASE_URL: "postgresql://example",
          FEATURE_FLAG: "enabled",
        },
      }),
    );
    expect(result.result).toEqual({
      projectId: "proj_123",
      app: {
        id: "app_1",
        name: "hello-world",
      },
      deployment: {
        id: "dep_new",
        status: "running",
        createdAt: "2026-04-14T11:00:00.000Z",
        url: "https://preview-new.prisma.app",
        live: true,
      },
      variables: ["DATABASE_URL", "FEATURE_FLAG"],
    });
    expect(JSON.stringify(result.result)).not.toContain("postgresql://example");
    expect(JSON.stringify(result.result)).not.toContain("enabled");
    await expect(context.stateStore.readKnownLiveDeployment("proj_123", "app_1")).resolves.toBe("dep_new");
  });

  it("lists variable names for the resolved live deployment", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: null, liveUrl: "https://hello-world.prisma.app" },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: null, liveUrl: "https://hello-world.prisma.app" },
      deployments: [
        { id: "dep_old", status: "running", createdAt: "2026-04-14T09:00:00.000Z", url: "https://preview-old.prisma.app", live: null },
        { id: "dep_live", status: "running", createdAt: "2026-04-14T10:00:00.000Z", url: "https://preview-live.prisma.app", live: null },
      ],
    });
    const listAppEnvNames = vi.fn().mockResolvedValue({
      projectId: "proj_123",
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
        liveUrl: "https://hello-world.prisma.app",
      },
      deployment: {
        id: "dep_live",
        status: "running",
        createdAt: "2026-04-14T10:00:00.000Z",
        url: "https://preview-live.prisma.app",
        live: true,
      },
      variables: ["DATABASE_URL", "FEATURE_FLAG"],
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
        deployApp: vi.fn(),
        updateAppEnv: vi.fn(),
        listAppEnvNames,
        listDeployments,
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppListEnv } = await import("../src/controllers/app");
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

    await context.stateStore.setKnownLiveDeployment("proj_123", "app_1", "dep_live");

    const result = await runAppListEnv(context, "hello-world");

    expect(listAppEnvNames).toHaveBeenCalledWith({
      appId: "app_1",
      deploymentId: "dep_live",
    });
    expect(result.result).toEqual({
      projectId: "proj_123",
      app: {
        id: "app_1",
        name: "hello-world",
      },
      deployment: {
        id: "dep_live",
        status: "running",
        createdAt: "2026-04-14T10:00:00.000Z",
        url: "https://preview-live.prisma.app",
        live: true,
      },
      variables: ["DATABASE_URL", "FEATURE_FLAG"],
    });
  });

  it("uses the saved known-live deployment when provider version listing lags", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: null, liveUrl: "https://hello-world.prisma.app" },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: null, liveUrl: "https://hello-world.prisma.app" },
      deployments: [
        { id: "dep_old", status: "running", createdAt: "2026-04-14T09:00:00.000Z", url: "https://preview-old.prisma.app", live: null },
      ],
    });
    const listAppEnvNames = vi.fn().mockResolvedValue({
      projectId: "proj_123",
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_new",
        liveUrl: "https://hello-world.prisma.app",
      },
      deployment: {
        id: "dep_new",
        status: "running",
        createdAt: "2026-04-14T11:00:00.000Z",
        url: "https://preview-new.prisma.app",
        live: true,
      },
      variables: ["DATABASE_URL"],
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
        deployApp: vi.fn(),
        updateAppEnv: vi.fn(),
        listAppEnvNames,
        listDeployments,
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppListEnv } = await import("../src/controllers/app");
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

    await context.stateStore.setKnownLiveDeployment("proj_123", "app_1", "dep_new");

    const result = await runAppListEnv(context, "hello-world");

    expect(listAppEnvNames).toHaveBeenCalledWith({
      appId: "app_1",
      deploymentId: "dep_new",
    });
    expect(result.result.deployment?.id).toBe("dep_new");
    expect(result.result.variables).toEqual(["DATABASE_URL"]);
  });

  it("returns an empty success state when listing env vars before any app exists", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([]);

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        removeApp: vi.fn(),
        promoteDeployment: vi.fn(),
        deployApp: vi.fn(),
        updateAppEnv: vi.fn(),
        listAppEnvNames: vi.fn(),
        listDeployments: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppListEnv } = await import("../src/controllers/app");
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

    await expect(runAppListEnv(context, undefined)).resolves.toMatchObject({
      result: {
        projectId: "proj_123",
        app: null,
        deployment: null,
        variables: [],
      },
    });
  });

  it("renders app update-env successfully through the CLI command layer", async () => {
    const runAppUpdateEnv = vi.fn().mockResolvedValue({
      command: "app.update-env",
      result: {
        projectId: "proj_123",
        app: {
          id: "app_1",
          name: "hello-world",
        },
        deployment: {
          id: "dep_123",
          status: "running",
          createdAt: "2026-04-14T11:00:00.000Z",
          url: "https://preview.prisma.app",
          live: true,
        },
        variables: ["DATABASE_URL"],
      },
      warnings: [],
      nextSteps: ["prisma-cli app list-env"],
    });

    vi.doMock("../src/controllers/app", async () => {
      const actual = await vi.importActual<typeof import("../src/controllers/app")>("../src/controllers/app");
      return {
        ...actual,
        runAppUpdateEnv,
      };
    });

    const { createTempCwd, executeCli } = await import("./helpers");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["app", "update-env", "--app", "hello-world", "--env", "DATABASE_URL=postgresql://example"],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("app update-env");
    expect(result.stderr).toContain("DATABASE_URL");
    expect(result.stderr).not.toContain("postgresql://example");
    expect(runAppUpdateEnv).toHaveBeenCalledWith(
      expect.anything(),
      "hello-world",
      ["DATABASE_URL=postgresql://example"],
      undefined,
    );
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
