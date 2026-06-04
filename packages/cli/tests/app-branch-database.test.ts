import { mkdir, writeFile } from "node:fs/promises";
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
  vi.doUnmock("../src/lib/app/branch-database");
  vi.doUnmock("../src/lib/app/branch-database-deploy");
  vi.doUnmock("../src/shell/prompt");
  vi.resetModules();
  vi.restoreAllMocks();
});

function createProjectClient(
  projectId = "proj_123",
  options: {
    branchExists?: boolean;
    isDefault?: boolean;
  } = {},
) {
  const branchRecord = (branchName: string) => ({
    id: `branch_${branchName.replace(/[^a-z0-9]+/gi, "_")}`,
    gitName: branchName,
    isDefault: options.isDefault ?? branchName === "main",
    role: "preview",
  });

  return {
    token: "token",
    GET: vi.fn().mockImplementation((pathName: string, request?: { params?: { query?: { gitName?: string } } }) => {
      if (pathName === "/v1/projects") {
        return {
          data: {
            data: [
              {
                id: projectId,
                name: projectId === "proj_456" ? "Billing API" : "Acme Dashboard",
                slug: projectId === "proj_456" ? "billing-api" : "acme-dashboard",
                workspace: {
                  id: "ws_123",
                  name: "Acme Inc",
                },
              },
            ],
          },
        };
      }

      if (pathName === "/v1/projects/{projectId}/branches") {
        const branchName = request?.params?.query?.gitName ?? "main";
        return {
          data: {
            data: options.branchExists === false ? [] : [branchRecord(branchName)],
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    }),
    POST: vi.fn().mockImplementation((pathName: string, request?: { body?: { gitName?: string } }) => {
      if (pathName === "/v1/projects/{projectId}/branches") {
        const branchName = request?.body?.gitName ?? "main";
        return {
          data: {
            data: branchRecord(branchName),
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    }),
  };
}

function createResolveBranch(role: "preview" | "production" = "preview") {
  return vi.fn().mockImplementation((_projectId: string, options: { branchName: string }) => Promise.resolve({
    id: `branch_${options.branchName.replace(/[^a-z0-9]+/gi, "_")}`,
    name: options.branchName,
    role,
  }));
}

describe("app deploy branch database setup", () => {
  it("deploy --db creates a branch database, applies schema, and writes branch env overrides before deploying", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const branchId = "branch_feature_db";
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: null, liveUrl: null },
    ]);
    const createBranchDatabase = vi.fn().mockResolvedValue({
      id: "db_1",
      name: "feature/db",
      branchId,
      databaseUrl: "postgres://pooled",
      directUrl: "postgres://direct",
    });
    const createEnvironmentVariable = vi.fn().mockImplementation(async (options: { key: string; branchId?: string; className: string }) => ({
      id: `env_${options.key.toLowerCase()}`,
      key: options.key,
      branchId: options.branchId ?? null,
      className: options.className,
      isManagedBySystem: false,
    }));
    const listEnvironmentVariables = vi.fn().mockResolvedValue([]);
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
    const runBranchDatabaseSchemaSetup = vi.fn().mockResolvedValue({
      command: "db-push",
      schemaPath: "prisma/schema.prisma",
    });

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/branch-database", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/lib/app/branch-database")>();
      return {
        ...actual,
        runBranchDatabaseSchemaSetup,
      };
    });
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        resolveBranch: vi.fn().mockResolvedValue({
          id: branchId,
          name: "feature/db",
          role: "preview",
        }),
        listApps,
        createBranchDatabase,
        listEnvironmentVariables,
        createEnvironmentVariable,
        deployApp,
        listDeployments: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, "prisma"), { recursive: true });
    await writeFile(path.join(cwd, "prisma/schema.prisma"), "datasource db { provider = \"postgresql\" url = env(\"DATABASE_URL\") }\n");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir: path.join(cwd, ".state"),
      flags: {
        yes: true,
      },
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const result = await runAppDeploy(context, "hello-world", {
      projectRef: "proj_123",
      branchName: "feature/db",
      framework: "hono",
      db: true,
    });

    expect(createBranchDatabase).toHaveBeenCalledWith({
      projectId: "proj_123",
      branchId,
      branchName: "feature/db",
      signal: context.runtime.signal,
    });
    expect(runBranchDatabaseSchemaSetup.mock.calls[0]?.[0].context).toBe(context);
    expect(runBranchDatabaseSchemaSetup.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        databaseUrl: "postgres://pooled",
        directUrl: "postgres://direct",
      }),
    );
    expect(createEnvironmentVariable).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_123",
        branchId,
        className: "preview",
        key: "DATABASE_URL",
        value: "postgres://pooled",
      }),
    );
    expect(createEnvironmentVariable).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_123",
        branchId,
        className: "preview",
        key: "DIRECT_URL",
        value: "postgres://direct",
      }),
    );
    expect(createBranchDatabase.mock.invocationCallOrder[0]).toBeLessThan(deployApp.mock.invocationCallOrder[0]);
    expect(runBranchDatabaseSchemaSetup.mock.invocationCallOrder[0]).toBeLessThan(deployApp.mock.invocationCallOrder[0]);
    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_123",
        appId: "app_1",
        envVars: undefined,
      }),
    );
    expect(result.result.branchDatabase).toEqual({
      status: "created",
      database: {
        id: "db_1",
        name: "feature/db",
      },
      envVars: ["DATABASE_URL", "DIRECT_URL"],
      schema: {
        command: "db-push",
        path: "prisma/schema.prisma",
      },
    });
  });

  it("deploy --db leaves an existing branch DATABASE_URL override unchanged", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const branchId = "branch_feature_db";
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: null, liveUrl: null },
    ]);
    const createBranchDatabase = vi.fn();
    const createEnvironmentVariable = vi.fn();
    const deployApp = vi.fn().mockResolvedValue({
      projectId: "proj_123",
      app: {
        id: "app_1",
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
    const listEnvironmentVariables = vi.fn().mockImplementation(async (options: { key?: string }) => {
      if (options.key === "DATABASE_URL") {
        return [{
          id: "env_database_url",
          key: "DATABASE_URL",
          branchId,
          className: "preview",
          isManagedBySystem: false,
        }];
      }
      return [];
    });

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        resolveBranch: vi.fn().mockResolvedValue({
          id: branchId,
          name: "feature/db",
          role: "preview",
        }),
        listApps,
        createBranchDatabase,
        listEnvironmentVariables,
        createEnvironmentVariable,
        deployApp,
        listDeployments: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, "prisma"), { recursive: true });
    await writeFile(path.join(cwd, "prisma/schema.prisma"), "datasource db { provider = \"postgresql\" url = env(\"DATABASE_URL\") }\n");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir: path.join(cwd, ".state"),
      flags: {
        yes: true,
      },
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const result = await runAppDeploy(context, "hello-world", {
      projectRef: "proj_123",
      branchName: "feature/db",
      framework: "hono",
      db: true,
    });

    expect(createBranchDatabase).not.toHaveBeenCalled();
    expect(createEnvironmentVariable).not.toHaveBeenCalled();
    expect(deployApp).toHaveBeenCalled();
    expect(result.result.branchDatabase).toEqual({
      status: "skipped",
      reason: "branch-env-exists",
      envVars: ["DATABASE_URL"],
      schema: null,
    });
  });

  it("prompts for branch database setup when a preview deploy appears to use a database", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const branchId = "branch_feature_db";
    const confirmPrompt = vi.fn().mockResolvedValue(true);
    const listApps = vi.fn().mockResolvedValue([
      { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: null, liveUrl: null },
    ]);
    const createBranchDatabase = vi.fn().mockResolvedValue({
      id: "db_1",
      name: "feature/db",
      branchId,
      databaseUrl: "postgres://pooled",
      directUrl: "postgres://direct",
    });
    const createEnvironmentVariable = vi.fn().mockResolvedValue({
      id: "env_database_url",
      key: "DATABASE_URL",
      branchId,
      className: "preview",
      isManagedBySystem: false,
    });
    const deployApp = vi.fn().mockResolvedValue({
      projectId: "proj_123",
      app: {
        id: "app_1",
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
    vi.doMock("../src/shell/prompt", async () => {
      const actual = await vi.importActual<typeof import("../src/shell/prompt")>("../src/shell/prompt");
      return {
        ...actual,
        confirmPrompt,
      };
    });
    vi.doMock("../src/lib/app/branch-database", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/lib/app/branch-database")>();
      return {
        ...actual,
        runBranchDatabaseSchemaSetup: vi.fn().mockResolvedValue({
          command: "db-push",
          schemaPath: "prisma/schema.prisma",
        }),
      };
    });
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        resolveBranch: vi.fn().mockResolvedValue({
          id: branchId,
          name: "feature/db",
          role: "preview",
        }),
        listApps,
        createBranchDatabase,
        listEnvironmentVariables: vi.fn().mockResolvedValue([]),
        createEnvironmentVariable,
        deployApp,
        listDeployments: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, "prisma"), { recursive: true });
    await writeFile(path.join(cwd, "prisma/schema.prisma"), "datasource db { provider = \"postgresql\" url = env(\"DATABASE_URL\") }\n");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir: path.join(cwd, ".state"),
      isTTY: true,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await runAppDeploy(context, "hello-world", {
      projectRef: "proj_123",
      branchName: "feature/db",
      framework: "hono",
    });

    expect(confirmPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Create an isolated database for branch "feature/db"?',
        initialValue: false,
      }),
    );
    expect(createBranchDatabase).toHaveBeenCalled();
  });

  it("rejects --db when deploy also passes inline database env vars", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const createBranchDatabase = vi.fn();
    const deployApp = vi.fn();

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        resolveBranch: createResolveBranch(),
        listApps: vi.fn().mockResolvedValue([
          { id: "app_1", name: "hello-world", region: "eu-central-1", liveDeploymentId: null, liveUrl: null },
        ]),
        createBranchDatabase,
        listEnvironmentVariables: vi.fn().mockResolvedValue([]),
        createEnvironmentVariable: vi.fn(),
        deployApp,
        listDeployments: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({
      cwd,
      stateDir: path.join(cwd, ".state"),
      flags: {
        yes: true,
      },
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(runAppDeploy(context, "hello-world", {
      projectRef: "proj_123",
      branchName: "feature/db",
      framework: "hono",
      envAssignments: ["DATABASE_URL=postgresql://example"],
      db: true,
    })).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary: "Branch database setup cannot be combined with inline database env vars",
    });
    expect(createBranchDatabase).not.toHaveBeenCalled();
    expect(deployApp).not.toHaveBeenCalled();
  });
});
