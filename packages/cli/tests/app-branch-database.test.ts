import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { asSingleDeployResult } from "./helpers/deploy-result";
import {
  createProjectClient,
  createResolveBranch,
} from "./helpers/mock-factories";

beforeEach(() => {
  process.env.PRISMA_CLI_TEST_REMEMBER_PROJECT_ID = "proj_123";
  process.env.PRISMA_CLI_TEST_REMEMBER_PROJECT_NAME = "Acme Dashboard";
  process.env.PRISMA_CLI_TEST_REMEMBER_WORKSPACE_ID = "ws_123";

  vi.doMock("../src/auth/operations", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/auth/operations")>()),
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

  vi.doUnmock("../src/auth/operations");
  vi.doUnmock("../src/auth/guard");
  vi.doUnmock("../src/lib/app/app-provider");
  vi.doUnmock("../src/lib/app/branch-database");
  vi.doUnmock("../src/lib/app/branch-database-deploy");
  vi.doUnmock("../src/shell/prompt");
  vi.doUnmock("node:child_process");
  vi.resetModules();
  vi.restoreAllMocks();
});

async function writePrismaComputeSkillsLock(cwd: string): Promise<void> {
  await writeFile(
    path.join(cwd, "skills-lock.json"),
    JSON.stringify({
      version: 1,
      skills: {
        "prisma-compute": {
          source: "prisma/skills",
          sourceType: "github",
          skillPath: "prisma-compute/SKILL.md",
          computedHash: "test",
        },
      },
    }),
    "utf8",
  );
}

describe("app deploy branch database setup", () => {
  it("deploy --db creates a branch database and writes branch env overrides before deploying", async () => {
    const authenticatedManagementApiClient = vi
      .fn()
      .mockResolvedValue(createProjectClient());
    const branchId = "branch_feature_db";
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
    ]);
    const createBranchDatabase = vi.fn().mockResolvedValue({
      id: "db_1",
      name: "feature/db",
      branchId,
      databaseUrl: "postgres://pooled",
      directUrl: "postgres://direct",
    });
    const createEnvironmentVariable = vi
      .fn()
      .mockImplementation(
        async (options: {
          key: string;
          branchId?: string;
          className: string;
        }) => ({
          id: `env_${options.key.toLowerCase()}`,
          key: options.key,
          branchId: options.branchId ?? null,
          className: options.className,
          isManagedBySystem: false,
        }),
      );
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

    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));
    vi.doMock("../src/lib/app/branch-database", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/branch-database")>();
      return {
        ...actual,
      };
    });
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() => ({
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

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, "prisma"), { recursive: true });
    await writeFile(
      path.join(cwd, "prisma/schema.prisma"),
      'datasource db { provider = "postgresql" url = env("DATABASE_URL") }\n',
    );
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
    expect(createBranchDatabase.mock.invocationCallOrder[0]).toBeLessThan(
      deployApp.mock.invocationCallOrder[0],
    );
    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_123",
        appId: "app_1",
        envVars: undefined,
      }),
    );
    expect(asSingleDeployResult(result).result.branchDatabase).toEqual({
      status: "created",
      database: {
        id: "db_1",
        name: "feature/db",
      },
      envVars: ["DATABASE_URL", "DIRECT_URL"],
    });
  });

  it("deploy --db creates a database and writes production env vars on first production deploy", async () => {
    const authenticatedManagementApiClient = vi
      .fn()
      .mockResolvedValue(createProjectClient());
    const branchId = "branch_main";
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
    const createBranchDatabase = vi.fn().mockResolvedValue({
      id: "db_1",
      name: "main",
      branchId,
      databaseUrl: "postgres://pooled",
      directUrl: "postgres://direct",
    });
    const createEnvironmentVariable = vi
      .fn()
      .mockImplementation(
        async (options: {
          key: string;
          branchId?: string;
          className: string;
        }) => ({
          id: `env_${options.key.toLowerCase()}`,
          key: options.key,
          branchId: options.branchId ?? null,
          className: options.className,
          isManagedBySystem: false,
        }),
      );
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

    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));
    vi.doMock("../src/lib/app/branch-database", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/branch-database")>();
      return {
        ...actual,
      };
    });
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() => ({
        resolveBranch: vi.fn().mockResolvedValue({
          id: branchId,
          name: "main",
          role: "production",
        }),
        listApps,
        createBranchDatabase,
        listEnvironmentVariables: vi.fn().mockResolvedValue([]),
        createEnvironmentVariable,
        updateEnvironmentVariable: vi.fn(),
        deployApp,
        listDeployments,
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, "prisma"), { recursive: true });
    await writeFile(
      path.join(cwd, "prisma/schema.prisma"),
      'datasource db { provider = "postgresql" url = env("DATABASE_URL") }\n',
    );
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
      branchName: "main",
      framework: "hono",
      db: true,
    });

    expect(listDeployments).toHaveBeenCalledWith("app_1");
    expect(createBranchDatabase).toHaveBeenCalledWith({
      projectId: "proj_123",
      branchId,
      branchName: "main",
      signal: context.runtime.signal,
    });
    expect(createEnvironmentVariable.mock.calls[0]?.[0]).toEqual({
      projectId: "proj_123",
      className: "production",
      key: "DATABASE_URL",
      value: "postgres://pooled",
      signal: context.runtime.signal,
    });
    expect(createEnvironmentVariable.mock.calls[1]?.[0]).toEqual({
      projectId: "proj_123",
      className: "production",
      key: "DIRECT_URL",
      value: "postgres://direct",
      signal: context.runtime.signal,
    });
    expect(createBranchDatabase.mock.invocationCallOrder[0]).toBeLessThan(
      deployApp.mock.invocationCallOrder[0],
    );
    expect(asSingleDeployResult(result).result.branchDatabase).toEqual({
      status: "created",
      database: {
        id: "db_1",
        name: "main",
      },
      envVars: ["DATABASE_URL", "DIRECT_URL"],
    });
  });

  it("deploy --db creates a branch database and applies a Prisma Next config before deploying", async () => {
    const authenticatedManagementApiClient = vi
      .fn()
      .mockResolvedValue(createProjectClient());
    const branchId = "branch_feature_next";
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
    ]);
    const createBranchDatabase = vi.fn().mockResolvedValue({
      id: "db_1",
      name: "feature/next",
      branchId,
      databaseUrl: "postgres://pooled",
      directUrl: "postgres://direct",
    });
    const createEnvironmentVariable = vi
      .fn()
      .mockImplementation(
        async (options: {
          key: string;
          branchId?: string;
          className: string;
        }) => ({
          id: `env_${options.key.toLowerCase()}`,
          key: options.key,
          branchId: options.branchId ?? null,
          className: options.className,
          isManagedBySystem: false,
        }),
      );
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

    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));
    vi.doMock("../src/lib/app/branch-database", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/branch-database")>();
      return {
        ...actual,
      };
    });
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() => ({
        resolveBranch: vi.fn().mockResolvedValue({
          id: branchId,
          name: "feature/next",
          role: "preview",
        }),
        listApps,
        createBranchDatabase,
        listEnvironmentVariables: vi.fn().mockResolvedValue([]),
        createEnvironmentVariable,
        updateEnvironmentVariable: vi.fn(),
        deployApp,
        listDeployments: vi.fn(),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeFile(
      path.join(cwd, "prisma-next.config.ts"),
      [
        'import { defineConfig } from "@prisma-next/postgres/config";',
        "",
        "export default defineConfig({",
        "  db: { connection: process.env.DATABASE_URL! },",
        "});",
        "",
      ].join("\n"),
    );
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
      branchName: "feature/next",
      framework: "hono",
      db: true,
    });

    expect(createEnvironmentVariable).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "DATABASE_URL",
        value: "postgres://pooled",
      }),
    );
    expect(asSingleDeployResult(result).result.branchDatabase).toEqual({
      status: "created",
      database: {
        id: "db_1",
        name: "feature/next",
      },
      envVars: ["DATABASE_URL", "DIRECT_URL"],
    });
  });

  it("deploy --db leaves an existing branch DATABASE_URL override unchanged", async () => {
    const authenticatedManagementApiClient = vi
      .fn()
      .mockResolvedValue(createProjectClient());
    const branchId = "branch_feature_db";
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
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
    const listEnvironmentVariables = vi
      .fn()
      .mockImplementation(async (options: { key?: string }) => {
        if (options.key === "DATABASE_URL") {
          return [
            {
              id: "env_database_url",
              key: "DATABASE_URL",
              branchId,
              className: "preview",
              isManagedBySystem: false,
            },
          ];
        }
        return [];
      });

    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() => ({
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

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, "prisma"), { recursive: true });
    await writeFile(
      path.join(cwd, "prisma/schema.prisma"),
      'datasource db { provider = "postgresql" url = env("DATABASE_URL") }\n',
    );
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
    expect(asSingleDeployResult(result).result.branchDatabase).toEqual({
      status: "skipped",
      reason: "branch-env-exists",
      envVars: ["DATABASE_URL"],
    });
  });

  it("deploy --db treats existing production database env vars as BYO DB and leaves them unchanged", async () => {
    const authenticatedManagementApiClient = vi
      .fn()
      .mockResolvedValue(createProjectClient());
    const branchId = "branch_main";
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
    ]);
    const createBranchDatabase = vi.fn();
    const createEnvironmentVariable = vi.fn();
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
    const listEnvironmentVariables = vi
      .fn()
      .mockImplementation(
        async (options: { key?: string; className?: string }) => {
          if (options.className !== "production") {
            return [];
          }
          if (options.key === "DATABASE_URL") {
            return [
              {
                id: "env_database_url",
                key: "DATABASE_URL",
                branchId: null,
                className: "production",
                isManagedBySystem: false,
              },
            ];
          }
          if (options.key === "DIRECT_URL") {
            return [
              {
                id: "env_direct_url",
                key: "DIRECT_URL",
                branchId: null,
                className: "production",
                isManagedBySystem: false,
              },
            ];
          }
          return [];
        },
      );

    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() => ({
        resolveBranch: vi.fn().mockResolvedValue({
          id: branchId,
          name: "main",
          role: "production",
        }),
        listApps,
        createBranchDatabase,
        listEnvironmentVariables,
        createEnvironmentVariable,
        updateEnvironmentVariable,
        deployApp,
        listDeployments: vi.fn().mockResolvedValue({
          app: {
            id: "app_1",
            name: "hello-world",
            region: "eu-central-1",
            liveDeploymentId: null,
            liveUrl: null,
          },
          deployments: [],
        }),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    const result = await runAppDeploy(context, "hello-world", {
      projectRef: "proj_123",
      branchName: "main",
      framework: "hono",
      db: true,
    });

    expect(createBranchDatabase).not.toHaveBeenCalled();
    expect(createEnvironmentVariable).not.toHaveBeenCalled();
    expect(updateEnvironmentVariable).not.toHaveBeenCalled();
    expect(deployApp).toHaveBeenCalled();
    expect(asSingleDeployResult(result).result.branchDatabase).toEqual({
      status: "skipped",
      reason: "production-env-exists",
      envVars: ["DATABASE_URL", "DIRECT_URL"],
    });
  });

  it.each([
    {
      existingKey: "DATABASE_URL",
      envVarId: "env_database_url",
    },
    {
      existingKey: "DIRECT_URL",
      envVarId: "env_direct_url",
    },
  ] as const)("deploy --db treats an existing production $existingKey as BYO DB and leaves it unchanged", async ({
    existingKey,
    envVarId,
  }) => {
    const authenticatedManagementApiClient = vi
      .fn()
      .mockResolvedValue(createProjectClient());
    const branchId = "branch_main";
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
    ]);
    const createBranchDatabase = vi.fn();
    const createEnvironmentVariable = vi.fn();
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
    const listEnvironmentVariables = vi
      .fn()
      .mockImplementation(
        async (options: { key?: string; className?: string }) => {
          if (
            options.className !== "production" ||
            options.key !== existingKey
          ) {
            return [];
          }

          return [
            {
              id: envVarId,
              key: existingKey,
              branchId: null,
              className: "production",
              isManagedBySystem: false,
            },
          ];
        },
      );

    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() => ({
        resolveBranch: vi.fn().mockResolvedValue({
          id: branchId,
          name: "main",
          role: "production",
        }),
        listApps,
        createBranchDatabase,
        listEnvironmentVariables,
        createEnvironmentVariable,
        updateEnvironmentVariable,
        deployApp,
        listDeployments: vi.fn().mockResolvedValue({
          app: {
            id: "app_1",
            name: "hello-world",
            region: "eu-central-1",
            liveDeploymentId: null,
            liveUrl: null,
          },
          deployments: [],
        }),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    const result = await runAppDeploy(context, "hello-world", {
      projectRef: "proj_123",
      branchName: "main",
      framework: "hono",
      db: true,
    });

    expect(createBranchDatabase).not.toHaveBeenCalled();
    expect(createEnvironmentVariable).not.toHaveBeenCalled();
    expect(updateEnvironmentVariable).not.toHaveBeenCalled();
    expect(deployApp).toHaveBeenCalled();
    expect(asSingleDeployResult(result).result.branchDatabase).toEqual({
      status: "skipped",
      reason: "production-env-exists",
      envVars: [existingKey],
    });
  });

  it("deploy --db repairs a branch that only has DIRECT_URL", async () => {
    const authenticatedManagementApiClient = vi
      .fn()
      .mockResolvedValue(createProjectClient());
    const branchId = "branch_feature_db";
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
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
    const listEnvironmentVariables = vi
      .fn()
      .mockImplementation(async (options: { key?: string }) => {
        if (options.key === "DIRECT_URL") {
          return [
            {
              id: "env_direct_url",
              key: "DIRECT_URL",
              branchId,
              className: "preview",
              isManagedBySystem: false,
            },
          ];
        }
        return [];
      });

    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));
    vi.doMock("../src/lib/app/branch-database", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/branch-database")>();
      return {
        ...actual,
        runBranchDatabaseSchemaSetup: vi.fn().mockResolvedValue({
          command: "db-push",
          source: "prisma-orm",
          schemaPath: "prisma/schema.prisma",
        }),
      };
    });
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() => ({
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

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, "prisma"), { recursive: true });
    await writeFile(
      path.join(cwd, "prisma/schema.prisma"),
      'datasource db { provider = "postgresql" url = env("DATABASE_URL") }\n',
    );
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
    expect(asSingleDeployResult(result).result.branchDatabase).toMatchObject({
      status: "created",
      envVars: ["DATABASE_URL", "DIRECT_URL"],
    });
  });

  it("deploy --db removes stale DIRECT_URL when the new branch database has no direct URL", async () => {
    const authenticatedManagementApiClient = vi
      .fn()
      .mockResolvedValue(createProjectClient());
    const branchId = "branch_feature_db";
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
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
    const listEnvironmentVariables = vi
      .fn()
      .mockImplementation(async (options: { key?: string }) => {
        if (options.key === "DIRECT_URL") {
          return [
            {
              id: "env_direct_url",
              key: "DIRECT_URL",
              branchId,
              className: "preview",
              isManagedBySystem: false,
            },
          ];
        }
        return [];
      });

    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));
    vi.doMock("../src/lib/app/branch-database", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/branch-database")>();
      return {
        ...actual,
        runBranchDatabaseSchemaSetup: vi.fn().mockResolvedValue({
          command: "db-push",
          source: "prisma-orm",
          schemaPath: "prisma/schema.prisma",
        }),
      };
    });
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() => ({
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

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, "prisma"), { recursive: true });
    await writeFile(
      path.join(cwd, "prisma/schema.prisma"),
      'datasource db { provider = "postgresql" url = env("DATABASE_URL") }\n',
    );
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
    expect(asSingleDeployResult(result).result.branchDatabase).toMatchObject({
      status: "created",
      envVars: ["DATABASE_URL"],
    });
  });

  it("prompts for branch database setup when a preview deploy appears to use a database", async () => {
    const authenticatedManagementApiClient = vi
      .fn()
      .mockResolvedValue(createProjectClient());
    const branchId = "branch_feature_db";
    const confirmPrompt = vi.fn().mockResolvedValue(true);
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
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

    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));
    vi.doMock("../src/shell/prompt", async () => {
      const actual = await vi.importActual<
        typeof import("../src/shell/prompt")
      >("../src/shell/prompt");
      return {
        ...actual,
        confirmPrompt,
      };
    });
    vi.doMock("../src/lib/app/branch-database", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/branch-database")>();
      return {
        ...actual,
        runBranchDatabaseSchemaSetup: vi.fn().mockResolvedValue({
          command: "db-push",
          source: "prisma-orm",
          schemaPath: "prisma/schema.prisma",
        }),
      };
    });
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() => ({
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

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writePrismaComputeSkillsLock(cwd);
    await mkdir(path.join(cwd, "prisma"), { recursive: true });
    await writeFile(
      path.join(cwd, "prisma/schema.prisma"),
      'datasource db { provider = "postgresql" url = env("DATABASE_URL") }\n',
    );
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

  it("--yes alone does not create a database during first production deploy", async () => {
    const authenticatedManagementApiClient = vi
      .fn()
      .mockResolvedValue(createProjectClient());
    const branchId = "branch_main";
    const createBranchDatabase = vi.fn();
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

    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() => ({
        resolveBranch: vi.fn().mockResolvedValue({
          id: branchId,
          name: "main",
          role: "production",
        }),
        listApps: vi.fn().mockResolvedValue([
          {
            id: "app_1",
            name: "hello-world",
            region: "eu-central-1",
            liveDeploymentId: null,
            liveUrl: null,
          },
        ]),
        createBranchDatabase,
        listEnvironmentVariables: vi.fn().mockResolvedValue([]),
        createEnvironmentVariable: vi.fn(),
        updateEnvironmentVariable: vi.fn(),
        deployApp,
        listDeployments: vi.fn().mockResolvedValue({
          app: {
            id: "app_1",
            name: "hello-world",
            region: "eu-central-1",
            liveDeploymentId: null,
            liveUrl: null,
          },
          deployments: [],
        }),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, "prisma"), { recursive: true });
    await writeFile(
      path.join(cwd, "prisma/schema.prisma"),
      'datasource db { provider = "postgresql" url = env("DATABASE_URL") }\n',
    );
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
      branchName: "main",
      framework: "hono",
    });

    expect(createBranchDatabase).not.toHaveBeenCalled();
    expect(deployApp).toHaveBeenCalled();
    expect(asSingleDeployResult(result).result.branchDatabase).toBeUndefined();
  });

  it("rejects --db for production apps that already have a live deployment", async () => {
    const authenticatedManagementApiClient = vi
      .fn()
      .mockResolvedValue(createProjectClient());
    const branchId = "branch_main";
    const createBranchDatabase = vi.fn();
    const deployApp = vi.fn();

    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() => ({
        resolveBranch: vi.fn().mockResolvedValue({
          id: branchId,
          name: "main",
          role: "production",
        }),
        listApps: vi.fn().mockResolvedValue([
          {
            id: "app_1",
            name: "hello-world",
            region: "eu-central-1",
            liveDeploymentId: "dep_live",
            liveUrl: "https://hello-world.prisma.app",
          },
        ]),
        createBranchDatabase,
        listEnvironmentVariables: vi.fn().mockResolvedValue([]),
        createEnvironmentVariable: vi.fn(),
        updateEnvironmentVariable: vi.fn(),
        deployApp,
        listDeployments: vi.fn().mockResolvedValue({
          app: {
            id: "app_1",
            name: "hello-world",
            region: "eu-central-1",
            liveDeploymentId: "dep_live",
            liveUrl: "https://hello-world.prisma.app",
          },
          deployments: [
            {
              id: "dep_live",
              status: "running",
              createdAt: "2026-06-01T00:00:00.000Z",
              url: "https://hello-world.prisma.app",
              live: true,
            },
          ],
        }),
        showDeployment: vi.fn(),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    await expect(
      runAppDeploy(context, "hello-world", {
        projectRef: "proj_123",
        branchName: "main",
        framework: "hono",
        prod: true,
        db: true,
      }),
    ).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary:
        "Database setup is only available during the first production deploy",
    });
    expect(createBranchDatabase).not.toHaveBeenCalled();
    expect(deployApp).not.toHaveBeenCalled();
  });

  it("rejects --db when deploy also passes database env vars", async () => {
    const authenticatedManagementApiClient = vi
      .fn()
      .mockResolvedValue(createProjectClient());
    const createBranchDatabase = vi.fn();
    const deployApp = vi.fn();

    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() => ({
        resolveBranch: createResolveBranch(),
        listApps: vi.fn().mockResolvedValue([
          {
            id: "app_1",
            name: "hello-world",
            region: "eu-central-1",
            liveDeploymentId: null,
            liveUrl: null,
          },
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

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeFile(
      path.join(cwd, ".env"),
      "DATABASE_URL=postgresql://example\n",
    );
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

    await expect(
      runAppDeploy(context, "hello-world", {
        projectRef: "proj_123",
        branchName: "feature/db",
        framework: "hono",
        envAssignments: [".env"],
        db: true,
      }),
    ).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary:
        "Database setup cannot be combined with provided database env vars",
    });
    expect(createBranchDatabase).not.toHaveBeenCalled();
    expect(deployApp).not.toHaveBeenCalled();
  });

  it("cleans up the created branch database when env wiring fails", async () => {
    const authenticatedManagementApiClient = vi
      .fn()
      .mockResolvedValue(createProjectClient());
    const branchId = "branch_feature_db";
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
    ]);
    const createBranchDatabase = vi.fn().mockResolvedValue({
      id: "db_1",
      name: "feature/db",
      branchId,
      databaseUrl: "postgres://pooled",
      directUrl: null,
    });
    const deleteBranchDatabase = vi.fn().mockResolvedValue(undefined);
    const createEnvironmentVariable = vi
      .fn()
      .mockRejectedValue(new Error("env write failed"));
    const deployApp = vi.fn();

    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));
    vi.doMock("../src/lib/app/branch-database", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/branch-database")>();
      return {
        ...actual,
        runBranchDatabaseSchemaSetup: vi.fn().mockResolvedValue({
          command: "db-push",
          source: "prisma-orm",
          schemaPath: "prisma/schema.prisma",
        }),
      };
    });
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() => ({
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

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, "prisma"), { recursive: true });
    await writeFile(
      path.join(cwd, "prisma/schema.prisma"),
      'datasource db { provider = "postgresql" url = env("DATABASE_URL") }\n',
    );
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

    await expect(
      runAppDeploy(context, "hello-world", {
        projectRef: "proj_123",
        branchName: "feature/db",
        framework: "hono",
        db: true,
      }),
    ).rejects.toMatchObject({
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
    const { inspectBranchDatabaseSignal } = await import(
      "../src/lib/app/branch-database"
    );
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, "packages/a/prisma"), { recursive: true });
    await mkdir(path.join(cwd, "prisma"), { recursive: true });
    await writeFile(path.join(cwd, "packages/a/prisma/schema.prisma"), "");
    await writeFile(path.join(cwd, "prisma/schema.prisma"), "");

    const signal = await inspectBranchDatabaseSignal(
      cwd,
      new AbortController().signal,
    );

    expect(signal.schema?.path).toBe(path.join(cwd, "prisma/schema.prisma"));
  });

  it("ignores installed agent skills when scanning for DATABASE_URL references", async () => {
    const { createTempCwd } = await import("./helpers");
    const { hasBranchDatabaseSignal, inspectBranchDatabaseSignal } =
      await import("../src/lib/app/branch-database");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, ".agents/skills/prisma-compute/scripts"), {
      recursive: true,
    });
    await writeFile(
      path.join(
        cwd,
        ".agents/skills/prisma-compute/scripts/verify-compute-surface.mjs",
      ),
      "console.log('DATABASE_URL')\n",
    );

    const signal = await inspectBranchDatabaseSignal(
      cwd,
      new AbortController().signal,
    );

    expect(signal.databaseUrlReferences).toEqual([]);
    expect(hasBranchDatabaseSignal(signal)).toBe(false);
  });

  it("prefers a Prisma Next config over schema.prisma when both exist", async () => {
    const { createTempCwd } = await import("./helpers");
    const { inspectBranchDatabaseSignal } = await import(
      "../src/lib/app/branch-database"
    );
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, "prisma"), { recursive: true });
    await writeFile(
      path.join(cwd, "prisma/schema.prisma"),
      'datasource db { provider = "postgresql" url = env("DATABASE_URL") }\n',
    );
    await writeFile(
      path.join(cwd, "prisma-next.config.ts"),
      [
        'import { defineConfig } from "@prisma-next/postgres/config";',
        "",
        "export default defineConfig({",
        "  db: { connection: process.env.DATABASE_URL! },",
        "});",
        "",
      ].join("\n"),
    );

    const signal = await inspectBranchDatabaseSignal(
      cwd,
      new AbortController().signal,
    );

    expect(signal.schema).toMatchObject({
      kind: "prisma-next",
      path: path.join(cwd, "prisma-next.config.ts"),
      command: "prisma-next-db-init",
      target: "postgresql",
    });
    expect(signal.unsupportedSchema).toBeNull();
  });

  it("treats non-Postgres Prisma Next configs as unsupported branch database signals", async () => {
    const { createTempCwd } = await import("./helpers");
    const { hasBranchDatabaseSignal, inspectBranchDatabaseSignal } =
      await import("../src/lib/app/branch-database");
    const cwd = await createTempCwd();
    await writeFile(
      path.join(cwd, "prisma-next.config.ts"),
      [
        'import { defineConfig } from "@prisma-next/mongo/config";',
        "",
        "export default defineConfig({",
        "  db: { connection: process.env.DATABASE_URL! },",
        "});",
        "",
      ].join("\n"),
    );

    const signal = await inspectBranchDatabaseSignal(
      cwd,
      new AbortController().signal,
    );

    expect(signal.schema).toBeNull();
    expect(signal.unsupportedSchema).toMatchObject({
      kind: "prisma-next",
      path: path.join(cwd, "prisma-next.config.ts"),
      target: "mongodb",
    });
    expect(hasBranchDatabaseSignal(signal)).toBe(false);
  });

  it("rejects --db for non-Postgres Prisma Next configs before creating a branch database", async () => {
    const authenticatedManagementApiClient = vi
      .fn()
      .mockResolvedValue(createProjectClient());
    const createBranchDatabase = vi.fn();
    const deployApp = vi.fn();

    vi.doMock("../src/auth/guard", () => ({
      authenticatedManagementApiClient,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() => ({
        resolveBranch: createResolveBranch(),
        listApps: vi.fn().mockResolvedValue([
          {
            id: "app_1",
            name: "hello-world",
            region: "eu-central-1",
            liveDeploymentId: null,
            liveUrl: null,
          },
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

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeFile(
      path.join(cwd, "prisma-next.config.ts"),
      [
        'import { defineConfig } from "@prisma-next/sqlite/config";',
        "",
        "export default defineConfig({",
        "  db: { connection: process.env.DATABASE_URL! },",
        "});",
        "",
      ].join("\n"),
    );
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

    await expect(
      runAppDeploy(context, "hello-world", {
        projectRef: "proj_123",
        branchName: "feature/db",
        framework: "hono",
        db: true,
      }),
    ).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary: "Database setup is not available for this Prisma schema",
    });
    expect(createBranchDatabase).not.toHaveBeenCalled();
    expect(deployApp).not.toHaveBeenCalled();
  });
});
