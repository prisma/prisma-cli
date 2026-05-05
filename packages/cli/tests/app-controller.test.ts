import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../src/adapters/config");
  vi.doUnmock("../src/lib/auth/guard");
  vi.doUnmock("../src/lib/app/preview-provider");
  vi.doUnmock("open");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("app controller", () => {
  it("deploy selects the correct existing app when --app is provided", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_2", name: "billing", region: "eu-west-3", liveDeploymentId: null },
      { id: "app_1", name: "hello-world", region: "eu-west-3", liveDeploymentId: "dep_live" },
    ]);
    const deployApp = vi.fn().mockResolvedValue({
      projectId: "proj_123",
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_123",
      },
      deployment: {
        id: "dep_123",
        status: "running",
        url: "https://hello-world.prisma.app",
      },
    });

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        listApps,
        deployApp,
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

    const result = await runAppDeploy(context, "hello-world");

    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_123",
        appId: "app_1",
      }),
    );
    expect(result.result).toEqual({
      projectId: "proj_123",
      app: {
        id: "app_1",
        name: "hello-world",
      },
      deployment: {
        id: "dep_123",
        status: "running",
        url: "https://hello-world.prisma.app",
      },
    });
    await expect(context.stateStore.readSelectedApp("proj_123")).resolves.toEqual({
      id: "app_1",
      name: "hello-world",
    });
  });

  it("forwards deploy build options and HTTP port overrides to the provider", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
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

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
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

    await runAppDeploy(context, "hello-world", {
      entrypoint: "server.ts",
      buildType: "bun",
      httpPort: "8080",
      envAssignments: ["DATABASE_URL=postgresql://example"],
    });

    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_123",
        appId: "app_1",
        entrypoint: "server.ts",
        buildType: "bun",
        portMapping: { http: 8080 },
        envVars: {
          DATABASE_URL: "postgresql://example",
        },
      }),
    );
  });

  it("rejects --entry together with --build-type nextjs for deploy", async () => {
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

    await expect(runAppDeploy(context, "hello-world", {
      buildType: "nextjs",
      entrypoint: "server.js",
    })).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary: "App deploy does not accept --entry with --build-type nextjs",
    });
  });

  it("rejects invalid --http-port values for deploy", async () => {
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

    await expect(runAppDeploy(context, "hello-world", {
      httpPort: "70000",
    })).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary: 'Invalid HTTP port "70000"',
    });
  });

  it("interactive first deploy can create a new app when none is selected", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([]);
    const deployApp = vi.fn().mockResolvedValue({
      projectId: "proj_123",
      app: {
        id: "app_new",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_123",
      },
      deployment: {
        id: "dep_123",
        status: "running",
        url: "https://hello-world.prisma.app",
      },
    });

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        listApps,
        deployApp,
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
      isTTY: true,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const result = await runAppDeploy(context, undefined);

    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_123",
        appId: undefined,
        appName: undefined,
        interaction: expect.any(Object),
      }),
    );
    expect(result.result.app).toEqual({
      id: "app_new",
      name: "hello-world",
    });
  });

  it("returns USAGE_ERROR for deploy without app selection in non-interactive mode", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([]);

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        listApps,
        deployApp: vi.fn(),
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
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(runAppDeploy(context, undefined)).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary: "App deploy requires an app selection in non-interactive mode",
    });
  });

  it("creates a named new app with the default Frankfurt region in non-interactive mode", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([]);
    const deployApp = vi.fn().mockResolvedValue({
      projectId: "proj_123",
      app: {
        id: "app_new",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_123",
      },
      deployment: {
        id: "dep_123",
        status: "running",
        url: "https://hello-world.prisma.app",
      },
    });

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        listApps,
        deployApp,
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
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await runAppDeploy(context, "hello-world");

    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_123",
        appId: undefined,
        appName: "hello-world",
        region: "eu-central-1",
        interaction: undefined,
      }),
    );
  });

  it("creates and links a project before first deploy when none is linked", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const createProject = vi.fn().mockResolvedValue({
      id: "proj_new",
      name: "next-smoke",
    });
    const listApps = vi.fn().mockResolvedValue([]);
    const deployApp = vi.fn().mockResolvedValue({
      projectId: "proj_new",
      app: {
        id: "app_new",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_123",
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
        createProject,
        listApps,
        deployApp,
        listDeployments: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext, readPrismaConfig } = await import("./helpers");
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const result = await runAppDeploy(context, "hello-world");

    expect(createProject).toHaveBeenCalledWith({
      name: path.basename(cwd),
    });
    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_new",
        appName: "hello-world",
      }),
    );
    await expect(readPrismaConfig(cwd)).resolves.toContain('project: "proj_new"');
    await expect(readPrismaConfig(cwd)).resolves.not.toContain("app:");
    await expect(context.stateStore.readSelectedApp("proj_new")).resolves.toEqual({
      id: "app_new",
      name: "hello-world",
    });
    expect(result.result.projectId).toBe("proj_new");
  });

  it("reuses the linked project on second deploy instead of creating another one", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const createProject = vi.fn().mockResolvedValue({
      id: "proj_new",
      name: "next-smoke",
    });
    const listApps = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "app_new", name: "hello-world", region: "eu-central-1", liveDeploymentId: "dep_123" },
      ]);
    const deployApp = vi
      .fn()
      .mockResolvedValueOnce({
        projectId: "proj_new",
        app: {
          id: "app_new",
          name: "hello-world",
          region: "eu-central-1",
          liveDeploymentId: "dep_123",
        },
        deployment: {
          id: "dep_123",
          status: "running",
          url: "https://hello-world.prisma.app",
        },
      })
      .mockResolvedValueOnce({
        projectId: "proj_new",
        app: {
          id: "app_new",
          name: "hello-world",
          region: "eu-central-1",
          liveDeploymentId: "dep_456",
        },
        deployment: {
          id: "dep_456",
          status: "running",
          url: "https://hello-world.prisma.app",
        },
      });

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject,
        listApps,
        deployApp,
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
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await runAppDeploy(context, "hello-world");
    await runAppDeploy(context, "hello-world");

    expect(createProject).toHaveBeenCalledTimes(1);
    expect(deployApp).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        projectId: "proj_new",
        appId: "app_new",
      }),
    );
  });

  it("fails before remote project creation when first-deploy config preflight is unsafe", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const createProject = vi.fn();

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject,
        listApps: vi.fn(),
        deployApp: vi.fn(),
        listDeployments: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));
    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId: vi.fn().mockResolvedValue(null),
        assertLinkedProjectIdWritable: vi.fn().mockRejectedValue(
          new actual.UnsafeConfigWriteError("The existing prisma.config.ts file could not be updated safely."),
        ),
      };
    });

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(runAppDeploy(context, "hello-world")).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary: "Project bootstrap requires a writable Prisma config",
    });
    expect(createProject).not.toHaveBeenCalled();
  });

  it("reuses the saved app selection on a second deploy", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-west-3", liveDeploymentId: "dep_live" },
    ]);
    const deployApp = vi.fn().mockResolvedValue({
      projectId: "proj_123",
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_123",
      },
      deployment: {
        id: "dep_123",
        status: "running",
        url: "https://hello-world.prisma.app",
      },
    });

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        listApps,
        deployApp,
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

    await context.stateStore.setSelectedApp("proj_123", {
      id: "app_1",
      name: "hello-world",
    });

    await runAppDeploy(context, undefined);

    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "app_1",
      }),
    );
  });

  it("list-deploys sorts deployments newest first for the selected app", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-west-3", liveDeploymentId: "dep_2" },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_2",
      },
      deployments: [
        {
          id: "dep_1",
          status: "running",
          url: "https://preview-1.prisma.app",
          createdAt: "2026-04-10T12:00:00.000Z",
          live: false,
        },
        {
          id: "dep_2",
          status: "running",
          url: "https://preview-2.prisma.app",
          createdAt: "2026-04-11T12:00:00.000Z",
          live: true,
        },
      ],
    });

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        listApps,
        deployApp: vi.fn(),
        listDeployments,
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppListDeploys } = await import("../src/controllers/app");
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

    const result = await runAppListDeploys(context, "hello-world");

    expect(result.result.deployments.map((deployment) => deployment.id)).toEqual(["dep_2", "dep_1"]);
  });

  it("returns PROJECT_NOT_FOUND when the linked project is not accessible in real mode", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockRejectedValue(new Error("Resource Not Found"));

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        listApps,
        deployApp: vi.fn(),
        listDeployments: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppListDeploys } = await import("../src/controllers/app");
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

    await expect(runAppListDeploys(context, undefined)).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
      domain: "project",
      summary: "Project not found",
    });
  });

  it("list-deploys uses the local known live deployment when the provider cannot confirm it", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-west-3", liveDeploymentId: null },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: null,
      },
      deployments: [
        {
          id: "dep_2",
          status: "running",
          url: "https://preview-2.prisma.app",
          createdAt: "2026-04-11T12:00:00.000Z",
          live: null,
        },
        {
          id: "dep_1",
          status: "running",
          url: "https://preview-1.prisma.app",
          createdAt: "2026-04-10T12:00:00.000Z",
          live: null,
        },
      ],
    });

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        listApps,
        deployApp: vi.fn(),
        listDeployments,
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppListDeploys } = await import("../src/controllers/app");
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

    await context.stateStore.setSelectedApp("proj_123", {
      id: "app_1",
      name: "hello-world",
    });
    await context.stateStore.setKnownLiveDeployment("proj_123", "app_1", "dep_1");

    const result = await runAppListDeploys(context, "hello-world");

    expect(result.result.deployments).toEqual([
      expect.objectContaining({ id: "dep_2", live: false }),
      expect.objectContaining({ id: "dep_1", live: true }),
    ]);
  });

  it("show returns undeployed state when the linked project has no apps", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([]);

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        deployApp: vi.fn(),
        listDeployments: vi.fn(),
        promoteDeployment: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppShow } = await import("../src/controllers/app");
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

    const result = await runAppShow(context, undefined);

    expect(result.result).toEqual({
      projectId: "proj_123",
      app: null,
      liveDeployment: null,
      liveUrl: null,
      recentDeployments: [],
    });
  });

  it("show returns selected app, live deployment, live URL, and recent deployments", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_2",
        liveUrl: "https://hello-world.prisma.app",
      },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_2",
        liveUrl: "https://hello-world.prisma.app",
      },
      deployments: [
        {
          id: "dep_1",
          status: "running",
          url: "https://preview-1.prisma.app",
          createdAt: "2026-04-10T12:00:00.000Z",
          live: null,
        },
        {
          id: "dep_2",
          status: "running",
          url: "https://preview-2.prisma.app",
          createdAt: "2026-04-11T12:00:00.000Z",
          live: null,
        },
      ],
    });

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        deployApp: vi.fn(),
        listDeployments,
        promoteDeployment: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppShow } = await import("../src/controllers/app");
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

    const result = await runAppShow(context, "hello-world");

    expect(result.result).toEqual({
      projectId: "proj_123",
      app: {
        id: "app_1",
        name: "hello-world",
      },
      liveDeployment: {
        id: "dep_2",
        status: "running",
        url: "https://preview-2.prisma.app",
        createdAt: "2026-04-11T12:00:00.000Z",
        live: true,
      },
      liveUrl: "https://hello-world.prisma.app",
      recentDeployments: [
        {
          id: "dep_2",
          status: "running",
          url: "https://preview-2.prisma.app",
          createdAt: "2026-04-11T12:00:00.000Z",
          live: true,
        },
        {
          id: "dep_1",
          status: "running",
          url: "https://preview-1.prisma.app",
          createdAt: "2026-04-10T12:00:00.000Z",
          live: false,
        },
      ],
    });
  });

  it("show uses the local known live hint when provider live state is incomplete", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: "https://hello-world.prisma.app",
      },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: "https://hello-world.prisma.app",
      },
      deployments: [
        {
          id: "dep_3",
          status: "running",
          url: "https://preview-3.prisma.app",
          createdAt: "2026-04-12T12:00:00.000Z",
          live: null,
        },
        {
          id: "dep_2",
          status: "running",
          url: "https://preview-2.prisma.app",
          createdAt: "2026-04-11T12:00:00.000Z",
          live: null,
        },
      ],
    });

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        deployApp: vi.fn(),
        listDeployments,
        promoteDeployment: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppShow } = await import("../src/controllers/app");
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

    await context.stateStore.setKnownLiveDeployment("proj_123", "app_1", "dep_2");

    const result = await runAppShow(context, "hello-world");

    expect(result.result.liveDeployment?.id).toBe("dep_2");
    expect(result.result.recentDeployments.find((deployment) => deployment.id === "dep_2")?.live).toBe(true);
    expect(result.result.recentDeployments.find((deployment) => deployment.id === "dep_3")?.live).toBe(false);
  });

  it("show-deploy returns deployment detail without branch inference", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const showDeployment = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_123",
      },
      deployment: {
        id: "dep_123",
        status: "running",
        url: "https://preview.prisma.app",
        createdAt: "2026-04-11T12:00:00.000Z",
        live: true,
      },
    });

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        listApps: vi.fn(),
        deployApp: vi.fn(),
        listDeployments: vi.fn(),
        showDeployment,
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppShowDeploy } = await import("../src/controllers/app");
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

    const result = await runAppShowDeploy(context, "dep_123");

    expect(result.result).toEqual({
      app: {
        id: "app_1",
        name: "hello-world",
      },
      deployment: {
        id: "dep_123",
        status: "running",
        url: "https://preview.prisma.app",
        createdAt: "2026-04-11T12:00:00.000Z",
        live: true,
      },
    });
  });

  it("show-deploy uses the local known live deployment when available", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const showDeployment = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: null,
      },
      deployment: {
        id: "dep_123",
        status: "running",
        url: "https://preview.prisma.app",
        createdAt: "2026-04-11T12:00:00.000Z",
        live: null,
      },
    });

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        listApps: vi.fn(),
        deployApp: vi.fn(),
        listDeployments: vi.fn(),
        showDeployment,
      })),
    }));

    const { createTempCwd, createTestCommandContext, writePrismaConfig } = await import("./helpers");
    const { runAppShowDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writePrismaConfig(cwd, "proj_123");
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await context.stateStore.setKnownLiveDeployment("proj_123", "app_1", "dep_123");

    const result = await runAppShowDeploy(context, "dep_123");

    expect(result.result.deployment.live).toBe(true);
  });

  it("show-deploy surfaces provider failures instead of reporting not found", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const showDeployment = vi.fn().mockRejectedValue(new Error("Missing or invalid authorization token"));

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        listApps: vi.fn(),
        deployApp: vi.fn(),
        listDeployments: vi.fn(),
        showDeployment,
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppShowDeploy } = await import("../src/controllers/app");
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

    await expect(runAppShowDeploy(context, "dep_123")).rejects.toMatchObject({
      code: "DEPLOY_FAILED",
      domain: "app",
      summary: "Failed to show deployment",
    });
  });

  it("open launches only in interactive human mode", async () => {
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_123",
        liveUrl: "https://hello-world.prisma.app",
      },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_123",
        liveUrl: "https://hello-world.prisma.app",
      },
      deployments: [
        {
          id: "dep_123",
          status: "running",
          url: "https://preview.prisma.app",
          createdAt: "2026-04-11T12:00:00.000Z",
          live: null,
        },
      ],
    });

    vi.doMock("open", () => ({
      default: openUrl,
    }));
    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        deployApp: vi.fn(),
        listDeployments,
        promoteDeployment: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppOpen } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: true,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const result = await runAppOpen(context, "hello-world");

    expect(openUrl).toHaveBeenCalledWith("https://hello-world.prisma.app");
    expect(result.result.opened).toBe(true);
  });

  it("open returns the URL without launching the browser in json mode", async () => {
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_123",
        liveUrl: "https://hello-world.prisma.app",
      },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_123",
        liveUrl: "https://hello-world.prisma.app",
      },
      deployments: [
        {
          id: "dep_123",
          status: "running",
          url: "https://preview.prisma.app",
          createdAt: "2026-04-11T12:00:00.000Z",
          live: null,
        },
      ],
    });

    vi.doMock("open", () => ({
      default: openUrl,
    }));
    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        deployApp: vi.fn(),
        listDeployments,
        promoteDeployment: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppOpen } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      flags: {
        json: true,
      },
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const result = await runAppOpen(context, "hello-world");

    expect(openUrl).not.toHaveBeenCalled();
    expect(result.result).toEqual({
      projectId: "proj_123",
      app: {
        id: "app_1",
        name: "hello-world",
      },
      url: "https://hello-world.prisma.app",
      opened: false,
    });
  });

  it("open returns NO_DEPLOYMENTS when the selected app has not been deployed yet", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
      deployments: [],
    });

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        deployApp: vi.fn(),
        listDeployments,
        promoteDeployment: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppOpen } = await import("../src/controllers/app");
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

    await expect(runAppOpen(context, "hello-world")).rejects.toMatchObject({
      code: "NO_DEPLOYMENTS",
      domain: "app",
    });
  });

  it("open returns FEATURE_UNAVAILABLE when deployments exist but no live URL is exposed", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_123",
        liveUrl: null,
      },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_123",
        liveUrl: null,
      },
      deployments: [
        {
          id: "dep_123",
          status: "running",
          url: "https://preview.prisma.app",
          createdAt: "2026-04-11T12:00:00.000Z",
          live: null,
        },
      ],
    });

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        deployApp: vi.fn(),
        listDeployments,
        promoteDeployment: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppOpen } = await import("../src/controllers/app");
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

    await expect(runAppOpen(context, "hello-world")).rejects.toMatchObject({
      code: "FEATURE_UNAVAILABLE",
      domain: "app",
      summary: "Live URL is not available for the selected app",
    });
  });

  it("promote switches the selected app to the requested deployment", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-west-3", liveDeploymentId: "dep_2" },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_2",
      },
      deployments: [
        {
          id: "dep_2",
          status: "running",
          url: "https://preview-2.prisma.app",
          createdAt: "2026-04-11T12:00:00.000Z",
          live: true,
        },
        {
          id: "dep_1",
          status: "stopped",
          url: "https://preview-1.prisma.app",
          createdAt: "2026-04-10T12:00:00.000Z",
          live: false,
        },
      ],
    });
    const promoteDeployment = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        promoteDeployment,
        deployApp: vi.fn(),
        listDeployments,
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppPromote } = await import("../src/controllers/app");
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

    const result = await runAppPromote(context, "dep_1", "hello-world");

    expect(promoteDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "app_1",
        deploymentId: "dep_1",
      }),
    );
    expect(result.result).toEqual({
      projectId: "proj_123",
      app: {
        id: "app_1",
        name: "hello-world",
      },
      deployment: {
        id: "dep_1",
        status: "running",
        url: "https://preview-1.prisma.app",
        createdAt: "2026-04-10T12:00:00.000Z",
        live: true,
      },
    });
  });

  it("promote returns a warning when the requested deployment is already live", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-west-3", liveDeploymentId: "dep_2" },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_2",
      },
      deployments: [
        {
          id: "dep_2",
          status: "running",
          url: "https://preview-2.prisma.app",
          createdAt: "2026-04-11T12:00:00.000Z",
          live: true,
        },
      ],
    });
    const promoteDeployment = vi.fn();

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        promoteDeployment,
        deployApp: vi.fn(),
        listDeployments,
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppPromote } = await import("../src/controllers/app");
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

    const result = await runAppPromote(context, "dep_2", "hello-world");

    expect(promoteDeployment).not.toHaveBeenCalled();
    expect(result.warnings).toEqual(["The selected deployment is already live for this app."]);
  });

  it("rollback chooses the previous deployment when no explicit target is provided", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-west-3", liveDeploymentId: "dep_2" },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_2",
      },
      deployments: [
        {
          id: "dep_2",
          status: "running",
          url: "https://preview-2.prisma.app",
          createdAt: "2026-04-11T12:00:00.000Z",
          live: true,
        },
        {
          id: "dep_1",
          status: "stopped",
          url: "https://preview-1.prisma.app",
          createdAt: "2026-04-10T12:00:00.000Z",
          live: false,
        },
      ],
    });
    const promoteDeployment = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        promoteDeployment,
        deployApp: vi.fn(),
        listDeployments,
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppRollback } = await import("../src/controllers/app");
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

    const result = await runAppRollback(context, "hello-world", undefined);

    expect(promoteDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "app_1",
        deploymentId: "dep_1",
      }),
    );
    expect(result.result).toEqual({
      projectId: "proj_123",
      app: {
        id: "app_1",
        name: "hello-world",
      },
      deployment: {
        id: "dep_1",
        status: "running",
        url: "https://preview-1.prisma.app",
        createdAt: "2026-04-10T12:00:00.000Z",
        live: true,
      },
      previousLiveDeploymentId: "dep_2",
    });
  });

  it("rollback uses the local known live deployment when the provider cannot confirm it", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-west-3", liveDeploymentId: null },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: null,
      },
      deployments: [
        {
          id: "dep_2",
          status: "running",
          url: "https://preview-2.prisma.app",
          createdAt: "2026-04-11T12:00:00.000Z",
          live: null,
        },
        {
          id: "dep_1",
          status: "running",
          url: "https://preview-1.prisma.app",
          createdAt: "2026-04-10T12:00:00.000Z",
          live: null,
        },
      ],
    });
    const promoteDeployment = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        promoteDeployment,
        deployApp: vi.fn(),
        listDeployments,
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppRollback } = await import("../src/controllers/app");
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

    await context.stateStore.setKnownLiveDeployment("proj_123", "app_1", "dep_1");

    const result = await runAppRollback(context, "hello-world", undefined);

    expect(promoteDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "app_1",
        deploymentId: "dep_2",
      }),
    );
    expect(result.result.previousLiveDeploymentId).toBe("dep_1");
    await expect(context.stateStore.readKnownLiveDeployment("proj_123", "app_1")).resolves.toBe("dep_2");
  });

  it("rollback uses an explicit deployment target when provided", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-west-3", liveDeploymentId: "dep_3" },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_3",
      },
      deployments: [
        {
          id: "dep_3",
          status: "running",
          url: "https://preview-3.prisma.app",
          createdAt: "2026-04-12T12:00:00.000Z",
          live: true,
        },
        {
          id: "dep_2",
          status: "stopped",
          url: "https://preview-2.prisma.app",
          createdAt: "2026-04-11T12:00:00.000Z",
          live: false,
        },
        {
          id: "dep_1",
          status: "stopped",
          url: "https://preview-1.prisma.app",
          createdAt: "2026-04-10T12:00:00.000Z",
          live: false,
        },
      ],
    });
    const promoteDeployment = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        promoteDeployment,
        deployApp: vi.fn(),
        listDeployments,
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppRollback } = await import("../src/controllers/app");
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

    const result = await runAppRollback(context, "hello-world", "dep_1");

    expect(promoteDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "app_1",
        deploymentId: "dep_1",
      }),
    );
    expect(result.result.deployment.id).toBe("dep_1");
  });

  it("rollback returns NO_PREVIOUS_DEPLOYMENT when only one deployment exists", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-west-3", liveDeploymentId: "dep_2" },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_2",
      },
      deployments: [
        {
          id: "dep_2",
          status: "running",
          url: "https://preview-2.prisma.app",
          createdAt: "2026-04-11T12:00:00.000Z",
          live: true,
        },
      ],
    });

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        promoteDeployment: vi.fn(),
        deployApp: vi.fn(),
        listDeployments,
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppRollback } = await import("../src/controllers/app");
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

    await expect(runAppRollback(context, "hello-world", undefined)).rejects.toMatchObject({
      code: "NO_PREVIOUS_DEPLOYMENT",
      domain: "app",
    });
  });

  it("does not reuse the wrong saved app when the linked project changes", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_456");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([]);

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        listApps,
        deployApp: vi.fn(),
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
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await context.stateStore.setSelectedApp("proj_123", {
      id: "app_1",
      name: "hello-world",
    });

    await expect(runAppDeploy(context, undefined)).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary: "App deploy requires an app selection in non-interactive mode",
    });
  });

  it("returns FEATURE_UNAVAILABLE for logs in real mode", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppLogs } = await import("../src/controllers/app");
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

    await expect(runAppLogs(context, undefined, undefined)).rejects.toMatchObject({
      code: "FEATURE_UNAVAILABLE",
      domain: "app",
    });
  });

  it("remove deletes the selected app when --yes is passed", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: "dep_2" },
    ]);
    const removeApp = vi.fn().mockResolvedValue({
      id: "app_1",
      name: "hello-world",
    });

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        removeApp,
        promoteDeployment: vi.fn(),
        deployApp: vi.fn(),
        listDeployments: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppRemove } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      flags: {
        yes: true,
      },
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await context.stateStore.setSelectedApp("proj_123", {
      id: "app_1",
      name: "hello-world",
    });
    await context.stateStore.setKnownLiveDeployment("proj_123", "app_1", "dep_2");

    const result = await runAppRemove(context, "hello-world");

    expect(removeApp).toHaveBeenCalledWith("app_1");
    expect(result.result).toEqual({
      projectId: "proj_123",
      app: {
        id: "app_1",
        name: "hello-world",
      },
      removed: true,
    });
    await expect(context.stateStore.readSelectedApp("proj_123")).resolves.toBeNull();
    await expect(context.stateStore.readKnownLiveDeployment("proj_123", "app_1")).resolves.toBeNull();
  });

  it("remove prompts for confirmation in interactive mode", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: "dep_2" },
    ]);
    const removeApp = vi.fn().mockResolvedValue({
      id: "app_1",
      name: "hello-world",
    });
    const textPrompt = vi.fn().mockResolvedValue("hello-world");

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/shell/prompt", async () => {
      const actual = await vi.importActual<typeof import("../src/shell/prompt")>("../src/shell/prompt");
      return {
        ...actual,
        textPrompt,
      };
    });
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        removeApp,
        promoteDeployment: vi.fn(),
        deployApp: vi.fn(),
        listDeployments: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppRemove } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: true,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await runAppRemove(context, "hello-world");

    expect(textPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Type hello-world to confirm app removal",
        placeholder: "hello-world",
      }),
    );
    expect(removeApp).toHaveBeenCalledWith("app_1");
  });

  it("remove returns CONFIRMATION_REQUIRED in non-interactive mode without --yes", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: "dep_2" },
    ]);
    const removeApp = vi.fn();

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        removeApp,
        promoteDeployment: vi.fn(),
        deployApp: vi.fn(),
        listDeployments: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppRemove } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(runAppRemove(context, "hello-world")).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED",
      domain: "app",
      summary: "App remove requires confirmation in the current mode",
    });
    expect(removeApp).not.toHaveBeenCalled();
  });

  it("remove returns REMOVE_FAILED when remote deletion fails", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: "dep_2" },
    ]);
    const removeApp = vi.fn().mockRejectedValue(new Error("Resource Not Found"));

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        removeApp,
        promoteDeployment: vi.fn(),
        deployApp: vi.fn(),
        listDeployments: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppRemove } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      flags: {
        yes: true,
      },
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(runAppRemove(context, "hello-world")).rejects.toMatchObject({
      code: "REMOVE_FAILED",
      domain: "app",
      summary: "Failed to remove app",
    });
  });

  it("remove returns a warning when local cleanup fails after remote deletion", async () => {
    const readLinkedProjectId = vi.fn().mockResolvedValue("proj_123");
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: "dep_2" },
    ]);
    const removeApp = vi.fn().mockResolvedValue({
      id: "app_1",
      name: "hello-world",
    });

    vi.doMock("../src/adapters/config", async () => {
      const actual = await vi.importActual<typeof import("../src/adapters/config")>("../src/adapters/config");
      return {
        ...actual,
        readLinkedProjectId,
      };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject: vi.fn(),
        listApps,
        removeApp,
        promoteDeployment: vi.fn(),
        deployApp: vi.fn(),
        listDeployments: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppRemove } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      flags: {
        yes: true,
      },
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    vi.spyOn(context.stateStore, "clearSelectedApp").mockRejectedValue(new Error("disk full"));
    vi.spyOn(context.stateStore, "clearKnownLiveDeployment").mockResolvedValue(await context.stateStore.read());

    const result = await runAppRemove(context, "hello-world");

    expect(result.warnings).toEqual([
      "The app was removed remotely, but the local selected app state could not be cleared: disk full",
    ]);
  });
});
