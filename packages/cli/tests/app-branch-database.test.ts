import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProjectClient, createResolveBranch } from "./helpers/mock-factories";

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
    const updateEnvironmentVariable = vi.fn();
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
        updateEnvironmentVariable,
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
    const updateEnvironmentVariable = vi.fn();
    const deleteBranchDatabase = vi.fn();
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
        deleteBranchDatabase,
        listEnvironmentVariables,
        createEnvironmentVariable,
        updateEnvironmentVariable,
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
    expect(updateEnvironmentVariable).not.toHaveBeenCalled();
    expect(deleteBranchDatabase).not.toHaveBeenCalled();
    expect(deployApp).toHaveBeenCalled();
    expect(result.result.branchDatabase).toEqual({
      status: "skipped",
      reason: "branch-env-exists",
      envVars: ["DATABASE_URL"],
      schema: null,
    });
  });

  it("deploy --db repairs a branch that only has DIRECT_URL", async () => {
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
    const createEnvironmentVariable = vi.fn().mockResolvedValue({
      id: "env_database_url",
      key: "DATABASE_URL",
      branchId,
      className: "preview",
      isManagedBySystem: false,
    });
    const updateEnvironmentVariable = vi.fn().mockResolvedValue({
      id: "env_direct_url",
      key: "DIRECT_URL",
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
    const listEnvironmentVariables = vi.fn().mockImplementation(async (options: { key?: string }) => {
      if (options.key === "DIRECT_URL") {
        return [{
          id: "env_direct_url",
          key: "DIRECT_URL",
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
        listEnvironmentVariables,
        createEnvironmentVariable,
        updateEnvironmentVariable,
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

    expect(createBranchDatabase).toHaveBeenCalled();
    expect(createEnvironmentVariable).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "DATABASE_URL",
        value: "postgres://pooled",
      }),
    );
    expect(updateEnvironmentVariable).toHaveBeenCalledWith({
      envVarId: "env_direct_url",
      value: "postgres://direct",
      signal: context.runtime.signal,
    });
    expect(result.result.branchDatabase).toMatchObject({
      status: "created",
      envVars: ["DATABASE_URL", "DIRECT_URL"],
    });
  });

  it("deploy --db removes stale DIRECT_URL when the new branch database has no direct URL", async () => {
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
      directUrl: null,
    });
    const createEnvironmentVariable = vi.fn().mockResolvedValue({
      id: "env_database_url",
      key: "DATABASE_URL",
      branchId,
      className: "preview",
      isManagedBySystem: false,
    });
    const updateEnvironmentVariable = vi.fn();
    const deleteEnvironmentVariable = vi.fn().mockResolvedValue(undefined);
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
      if (options.key === "DIRECT_URL") {
        return [{
          id: "env_direct_url",
          key: "DIRECT_URL",
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
        listEnvironmentVariables,
        createEnvironmentVariable,
        updateEnvironmentVariable,
        deleteEnvironmentVariable,
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

    expect(createEnvironmentVariable).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "DATABASE_URL",
        value: "postgres://pooled",
      }),
    );
    expect(updateEnvironmentVariable).not.toHaveBeenCalled();
    expect(deleteEnvironmentVariable).toHaveBeenCalledWith({
      envVarId: "env_direct_url",
      signal: context.runtime.signal,
    });
    expect(result.result.branchDatabase).toMatchObject({
      status: "created",
      envVars: ["DATABASE_URL"],
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
    const updateEnvironmentVariable = vi.fn();
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
        updateEnvironmentVariable,
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
        updateEnvironmentVariable: vi.fn(),
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

  it("stops deploy when branch database schema setup fails", async () => {
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
    const deleteBranchDatabase = vi.fn().mockResolvedValue(undefined);
    const createEnvironmentVariable = vi.fn();
    const updateEnvironmentVariable = vi.fn();
    const deployApp = vi.fn();
    const runBranchDatabaseSchemaSetup = vi.fn().mockRejectedValue(new Error("Migration failed"));

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
        deleteBranchDatabase,
        listEnvironmentVariables: vi.fn().mockResolvedValue([]),
        createEnvironmentVariable,
        updateEnvironmentVariable,
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

    await expect(runAppDeploy(context, "hello-world", {
      projectRef: "proj_123",
      branchName: "feature/db",
      framework: "hono",
      db: true,
    })).rejects.toMatchObject({
      code: "SCHEMA_SETUP_FAILED",
      domain: "app",
    });
    expect(createBranchDatabase).toHaveBeenCalled();
    expect(deleteBranchDatabase).toHaveBeenCalledWith({
      databaseId: "db_1",
      signal: context.runtime.signal,
    });
    expect(createEnvironmentVariable).not.toHaveBeenCalled();
    expect(updateEnvironmentVariable).not.toHaveBeenCalled();
    expect(deployApp).not.toHaveBeenCalled();
  });

  it("cleans up the created branch database when env wiring fails", async () => {
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
      directUrl: null,
    });
    const deleteBranchDatabase = vi.fn().mockResolvedValue(undefined);
    const createEnvironmentVariable = vi.fn().mockRejectedValue(new Error("env write failed"));
    const deployApp = vi.fn();

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
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
        deleteBranchDatabase,
        listEnvironmentVariables: vi.fn().mockResolvedValue([]),
        createEnvironmentVariable,
        updateEnvironmentVariable: vi.fn(),
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

    await expect(runAppDeploy(context, "hello-world", {
      projectRef: "proj_123",
      branchName: "feature/db",
      framework: "hono",
      db: true,
    })).rejects.toMatchObject({
      code: "BRANCH_DATABASE_SETUP_FAILED",
      domain: "app",
    });
    expect(deleteBranchDatabase).toHaveBeenCalledWith({
      databaseId: "db_1",
      signal: context.runtime.signal,
    });
    expect(deployApp).not.toHaveBeenCalled();
  });

  it("chooses a deterministic schema.prisma when multiple schemas exist", async () => {
    const { createTempCwd } = await import("./helpers");
    const { inspectBranchDatabaseSignal } = await import("../src/lib/app/branch-database");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, "packages/a/prisma"), { recursive: true });
    await mkdir(path.join(cwd, "prisma"), { recursive: true });
    await writeFile(path.join(cwd, "packages/a/prisma/schema.prisma"), "");
    await writeFile(path.join(cwd, "prisma/schema.prisma"), "");

    const signal = await inspectBranchDatabaseSignal(cwd, new AbortController().signal);

    expect(signal.schema?.path).toBe(path.join(cwd, "prisma/schema.prisma"));
  });
});
