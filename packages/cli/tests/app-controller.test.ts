import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  vi.doUnmock("../src/lib/app/app-provider");
  vi.doUnmock("../src/lib/app/branch-database");
  vi.doUnmock("../src/shell/prompt");
  vi.doUnmock("open");
  vi.resetModules();
  vi.restoreAllMocks();
});

function withBranchDatabaseProviderDefaults<T extends Record<string, unknown>>(
  provider: T,
) {
  return {
    createBranchDatabase: vi.fn(),
    deleteBranchDatabase: vi.fn(),
    listEnvironmentVariables: vi.fn().mockResolvedValue([]),
    createEnvironmentVariable: vi.fn(),
    updateEnvironmentVariable: vi.fn(),
    deleteEnvironmentVariable: vi.fn(),
    ...provider,
  };
}

function expectedAppVerboseContext() {
  return {
    workspace: {
      id: "ws_123",
      name: "Acme Inc",
    },
    project: {
      id: "proj_123",
      name: "Acme Dashboard",
    },
    branch: {
      id: "branch_main",
      name: "main",
      kind: "preview",
    },
    resolution: {
      projectSource: "local-pin",
      targetName: "Acme Dashboard",
      targetNameSource: "local-pin",
    },
  };
}

function createDomain(
  overrides: Partial<{
    id: string;
    hostname: string;
    computeServiceId: string;
    status:
      | "pending_dns"
      | "verifying"
      | "verified_routing_blocked"
      | "provisioning_tls"
      | "active"
      | "failed"
      | "removing";
    failureReason: string | null;
    failureCategory: "dns" | "acme" | "storage" | "unknown" | null;
    dnsRecords: Array<{
      type: string;
      name: string;
      value: string;
      ttl: number | null;
    }>;
  }> = {},
) {
  const hostname = overrides.hostname ?? "shop.acme.com";
  return {
    id: overrides.id ?? "dom_123",
    type: "custom-domain" as const,
    url: `https://api.prisma.io/v1/domains/${overrides.id ?? "dom_123"}`,
    hostname,
    computeServiceId: overrides.computeServiceId ?? "app_1",
    status: overrides.status ?? "pending_dns",
    foundryStatus: overrides.status ?? "pending_dns",
    failureReason: overrides.failureReason ?? null,
    failureCategory: overrides.failureCategory ?? null,
    certExpiresAt: null,
    createdAt: "2026-05-22T09:14:00.000Z",
    updatedAt: "2026-05-22T09:14:00.000Z",
    dnsRecords: overrides.dnsRecords ?? [
      {
        type: "CNAME",
        name: hostname,
        value: "switchboard.fra.prisma.build",
        ttl: 300,
      },
    ],
  };
}

async function writePackageJson(
  cwd: string,
  packageJson: {
    name?: string;
    module?: string;
    dependencies?: Record<string, string | undefined>;
    devDependencies?: Record<string, string | undefined>;
  },
): Promise<void> {
  await writeFile(
    path.join(cwd, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
}

async function writeGitBranch(cwd: string, branchName: string): Promise<void> {
  await mkdir(path.join(cwd, ".git"), { recursive: true });
  await writeFile(
    path.join(cwd, ".git", "HEAD"),
    `ref: refs/heads/${branchName}\n`,
  );
}

async function readLocalPin(cwd: string): Promise<unknown> {
  return JSON.parse(
    await readFile(path.join(cwd, ".prisma/local.json"), "utf8"),
  );
}

async function readPrismaAppConfig(cwd: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(cwd, "prisma.app.json"), "utf8"));
}

async function writeLocalPin(
  cwd: string,
  pin: unknown | string,
): Promise<void> {
  await mkdir(path.join(cwd, ".prisma"), { recursive: true });
  await writeFile(
    path.join(cwd, ".prisma/local.json"),
    typeof pin === "string" ? pin : `${JSON.stringify(pin, null, 2)}\n`,
  );
}

describe("app controller", () => {
  it("deploy with a multi-app config and no target deploys every target in order", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([]);
    const deployApp = vi
      .fn()
      .mockImplementation((options: { appName?: string }) =>
        Promise.resolve({
          projectId: "proj_123",
          app: {
            id: `app_${options.appName}`,
            name: options.appName,
            region: "eu-west-3",
            liveDeploymentId: `dep_${options.appName}`,
          },
          deployment: {
            id: `dep_${options.appName}`,
            status: "running",
            url: `https://${options.appName}.prisma.app`,
          },
        }),
      );

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, ".git"), { recursive: true });
    await mkdir(path.join(cwd, "apps", "api"), { recursive: true });
    await mkdir(path.join(cwd, "apps", "web"), { recursive: true });
    await writeFile(
      path.join(cwd, "prisma.compute.ts"),
      [
        "export default {",
        "  apps: {",
        '    api: { root: "apps/api", framework: "hono", entry: "src/index.ts" },',
        '    web: { root: "apps/web", framework: "bun", entry: "server.ts" },',
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    const { context } = await createTestCommandContext({
      cwd,
      stateDir: path.join(cwd, ".state"),
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const result = await runAppDeploy(context, undefined, {
      projectRef: "proj_123",
    });

    expect(deployApp).toHaveBeenCalledTimes(2);
    expect(deployApp.mock.calls[0]?.[0]).toMatchObject({ appName: "api" });
    expect(deployApp.mock.calls[1]?.[0]).toMatchObject({ appName: "web" });
    expect(result.result).toMatchObject({
      deployments: [
        {
          target: "api",
          result: { deployment: { url: "https://api.prisma.app" } },
        },
        {
          target: "web",
          result: { deployment: { url: "https://web.prisma.app" } },
        },
      ],
    });
  });

  it("deploy-all stops at the first failing target and reports the rest", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([]);
    const deployApp = vi.fn().mockRejectedValue(new Error("upload exploded"));

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, ".git"), { recursive: true });
    await mkdir(path.join(cwd, "apps", "api"), { recursive: true });
    await mkdir(path.join(cwd, "apps", "web"), { recursive: true });
    await writeFile(
      path.join(cwd, "prisma.compute.ts"),
      [
        "export default {",
        "  apps: {",
        '    api: { root: "apps/api", framework: "hono", entry: "src/index.ts" },',
        '    web: { root: "apps/web", framework: "bun", entry: "server.ts" },',
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    const { context } = await createTestCommandContext({
      cwd,
      stateDir: path.join(cwd, ".state"),
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(
      runAppDeploy(context, undefined, { projectRef: "proj_123" }),
    ).rejects.toMatchObject({
      meta: expect.objectContaining({
        deployAll: {
          failedTarget: "api",
          completed: [],
          notAttempted: ["web"],
        },
      }),
    });
    expect(deployApp).toHaveBeenCalledTimes(1);
  });

  it("deploy-all rejects per-app flags", async () => {
    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, ".git"), { recursive: true });
    await writeFile(
      path.join(cwd, "prisma.compute.ts"),
      [
        "export default {",
        "  apps: {",
        '    api: { root: "apps/api" },',
        '    web: { root: "apps/web" },',
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    const { context } = await createTestCommandContext({
      cwd,
      stateDir: path.join(cwd, ".state"),
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(
      runAppDeploy(context, undefined, { framework: "hono" }),
    ).rejects.toMatchObject({
      code: "USAGE_ERROR",
      summary: expect.stringContaining("--framework"),
    });
  });

  it("show run from inside a target root uses the root project pin and the config app name", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_api",
        name: "api",
        region: "eu-west-3",
        liveDeploymentId: "dep_api",
        liveUrl: null,
      },
      {
        id: "app_web",
        name: "web",
        region: "eu-west-3",
        liveDeploymentId: "dep_web",
        liveUrl: null,
      },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_api",
        name: "api",
        region: "eu-west-3",
        liveDeploymentId: "dep_api",
        liveUrl: "https://api.prisma.app",
      },
      deployments: [
        {
          id: "dep_api",
          status: "running",
          url: "https://api.prisma.app",
          createdAt: "2026-06-10T00:00:00.000Z",
          live: true,
        },
      ],
    });

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          listDeployments,
          deployApp: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppShow } = await import("../src/controllers/app");
    const repoDir = await createTempCwd();
    const appCwd = path.join(repoDir, "apps", "api");
    await mkdir(path.join(repoDir, ".git"), { recursive: true });
    await mkdir(path.join(repoDir, ".prisma"), { recursive: true });
    await mkdir(appCwd, { recursive: true });
    await writeFile(
      path.join(repoDir, "prisma.compute.ts"),
      [
        "export default {",
        "  apps: {",
        '    api: { root: "apps/api", framework: "hono" },',
        '    web: { root: "apps/web", framework: "nextjs" },',
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(repoDir, ".prisma", "local.json"),
      `${JSON.stringify({ workspaceId: "ws_123", projectId: "proj_123" })}\n`,
      "utf8",
    );
    const { context } = await createTestCommandContext({
      cwd: appCwd,
      stateDir: path.join(repoDir, ".state"),
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const result = await runAppShow(context, undefined, undefined, undefined);

    expect(listDeployments).toHaveBeenCalledWith("app_api", expect.anything());
    expect(result.result.app).toEqual({
      id: "app_api",
      name: "api",
    });
  });

  it("deploy selects the correct existing app when --app is provided", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_2",
        name: "billing",
        region: "eu-west-3",
        liveDeploymentId: null,
      },
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_live",
      },
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

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    const result = await runAppDeploy(context, "hello-world", {
      projectRef: "proj_123",
      framework: "hono",
    });

    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_123",
        appId: "app_1",
      }),
    );
    expect(result.result).toMatchObject({
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      project: {
        id: "proj_123",
        name: "Acme Dashboard",
      },
      branch: {
        name: "main",
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
    });
    await expect(
      context.stateStore.readSelectedApp("proj_123"),
    ).resolves.toEqual({
      id: "app_1",
      name: "hello-world",
    });
  });

  it("does not treat branch name as production authority", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const app = {
      id: "app_1",
      name: "hello-world",
      region: "eu-west-3",
      liveDeploymentId: "dep_live",
      liveUrl: null,
    };
    const listApps = vi.fn().mockResolvedValue([app]);
    const listDeployments = vi.fn();
    const deployApp = vi.fn().mockResolvedValue({
      projectId: "proj_123",
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_new",
      },
      deployment: {
        id: "dep_new",
        status: "running",
        url: "https://hello-world.prisma.app",
      },
    });

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments,
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({
      cwd,
      stateDir: path.join(cwd, ".state"),
    });

    const result = await runAppDeploy(context, "hello-world", {
      projectRef: "proj_123",
      branchName: "production",
      framework: "hono",
    });

    expect(asSingleDeployResult(result).result.branch).toEqual({
      id: "branch_production",
      name: "production",
      kind: "preview",
    });
    expect(listDeployments).not.toHaveBeenCalled();
    expect(deployApp).toHaveBeenCalled();
  });

  it("forwards deploy build options and HTTP port overrides to the provider", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
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
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          removeApp: vi.fn(),
          promoteDeployment: vi.fn(),
          deployApp,
          updateAppEnv: vi.fn(),
          listAppEnvNames: vi.fn(),
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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
      projectRef: "proj_123",
      entrypoint: "server.ts",
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

  it("add_on_active_domain_does_not_retrigger_verification", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const activeDomain = createDomain({ status: "active" });
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "shop",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
        liveUrl: "https://shop.prisma.app",
      },
    ]);
    const addDomain = vi.fn().mockResolvedValue({
      domain: activeDomain,
      existing: true,
    });
    const retryDomain = vi.fn();

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/app-provider")>();
      return {
        ...actual,
        createAppProvider: vi.fn(() =>
          withBranchDatabaseProviderDefaults({
            resolveBranch: createResolveBranch(),
            listApps,
            listDomains: vi.fn(),
            addDomain,
            retryDomain,
          }),
        ),
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDomainAdd } = await import("../src/controllers/app");
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

    const result = await runAppDomainAdd(context, "Shop.Acme.com.", {
      projectRef: "proj_123",
      appName: "shop",
    });

    expect(addDomain).toHaveBeenCalledWith({
      appId: "app_1",
      hostname: "shop.acme.com",
      signal: context.runtime.signal,
    });
    expect(retryDomain).not.toHaveBeenCalled();
    expect(result.result).toMatchObject({
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      project: {
        id: "proj_123",
        name: "Acme Dashboard",
      },
      branch: {
        name: "production",
        kind: "production",
      },
      app: {
        id: "app_1",
        name: "shop",
      },
      domain: {
        hostname: "shop.acme.com",
        status: "active",
        dnsRecords: [
          {
            type: "CNAME",
            name: "shop.acme.com",
            value: "switchboard.fra.prisma.build",
            ttl: 300,
          },
        ],
      },
      existing: true,
    });
  });

  it("domain add lets explicit --project skip stale local pins", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const domain = createDomain({ status: "active" });
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "shop",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
        liveUrl: "https://shop.prisma.app",
      },
    ]);
    const addDomain = vi.fn().mockResolvedValue({
      domain,
      existing: false,
    });

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/app-provider")>();
      return {
        ...actual,
        createAppProvider: vi.fn(() =>
          withBranchDatabaseProviderDefaults({
            resolveBranch: createResolveBranch(),
            listApps,
            addDomain,
          }),
        ),
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDomainAdd } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, {
      workspaceId: "ws_123",
      projectId: "proj_stale",
      unsupportedKey: "not-supported",
    });
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const result = await runAppDomainAdd(context, "shop.acme.com", {
      projectRef: "proj_123",
      appName: "shop",
    });

    expect(addDomain).toHaveBeenCalledWith({
      appId: "app_1",
      hostname: "shop.acme.com",
      signal: context.runtime.signal,
    });
    expect(result.result.project.id).toBe("proj_123");
  });

  it("domain add requires Project setup instead of entering interactive setup", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const createProject = vi.fn();
    const listApps = vi.fn();
    const addDomain = vi.fn();

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/app-provider")>();
      return {
        ...actual,
        createAppProvider: vi.fn(() =>
          withBranchDatabaseProviderDefaults({
            resolveBranch: createResolveBranch(),
            createProject,
            listApps,
            addDomain,
          }),
        ),
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDomainAdd } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writePackageJson(cwd, { name: "acme-dashboard" });
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

    await expect(
      runAppDomainAdd(context, "shop.acme.com", {
        appName: "shop",
      }),
    ).rejects.toMatchObject({
      code: "PROJECT_SETUP_REQUIRED",
      domain: "project",
      meta: {
        suggestedProjectName: "acme-dashboard",
        suggestedProjectNameSource: "package-name",
        candidates: [
          {
            id: "proj_123",
            name: "Acme Dashboard",
          },
        ],
        recoveryCommands: expect.arrayContaining([
          "prisma-cli project link <id-or-name>",
          "prisma-cli app domain add shop.acme.com --project <id-or-name>",
        ]),
      },
    });
    expect(createProject).not.toHaveBeenCalled();
    expect(listApps).not.toHaveBeenCalled();
    expect(addDomain).not.toHaveBeenCalled();
  });

  it("domain add does not synthesize DNS records when the API omits them", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "shop",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
        liveUrl: "https://shop.fra.prisma.build",
      },
    ]);
    const addDomain = vi.fn().mockResolvedValue({
      domain: createDomain({ status: "pending_dns", dnsRecords: [] }),
      existing: false,
    });

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/app-provider")>();
      return {
        ...actual,
        createAppProvider: vi.fn(() =>
          withBranchDatabaseProviderDefaults({
            resolveBranch: createResolveBranch(),
            listApps,
            addDomain,
          }),
        ),
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDomainAdd } = await import("../src/controllers/app");
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

    const result = await runAppDomainAdd(context, "shop.acme.com", {
      projectRef: "proj_123",
      appName: "shop",
    });

    expect(result.result.domain.dnsRecords).toEqual([]);
  });

  it("domain add maps quota conflicts to DOMAIN_QUOTA_EXCEEDED", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "shop",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
        liveUrl: "https://shop.fra.prisma.build",
      },
    ]);

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/app-provider")>();
      const addDomain = vi.fn().mockRejectedValue(
        new actual.DomainApiError({
          summary: "Failed to add custom domain",
          status: 409,
          message: "Domain quota exceeded.",
          hint: "This compute service has reached the maximum of 3 custom domains.",
        }),
      );
      return {
        ...actual,
        createAppProvider: vi.fn(() =>
          withBranchDatabaseProviderDefaults({
            resolveBranch: createResolveBranch(),
            listApps,
            addDomain,
          }),
        ),
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDomainAdd } = await import("../src/controllers/app");
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
      runAppDomainAdd(context, "shop.acme.com", {
        projectRef: "proj_123",
        appName: "shop",
      }),
    ).rejects.toMatchObject({
      code: "DOMAIN_QUOTA_EXCEEDED",
      domain: "app",
    });
  });

  it("domain add maps already-registered conflicts to DOMAIN_ALREADY_REGISTERED", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "shop",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
        liveUrl: "https://shop.fra.prisma.build",
      },
    ]);

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/app-provider")>();
      const addDomain = vi.fn().mockRejectedValue(
        new actual.DomainApiError({
          summary: "Failed to add custom domain",
          status: 409,
          message: "Hostname already registered.",
          hint: "This hostname is already registered to another compute service.",
        }),
      );
      return {
        ...actual,
        createAppProvider: vi.fn(() =>
          withBranchDatabaseProviderDefaults({
            resolveBranch: createResolveBranch(),
            listApps,
            addDomain,
          }),
        ),
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDomainAdd } = await import("../src/controllers/app");
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
      runAppDomainAdd(context, "shop.acme.com", {
        projectRef: "proj_123",
        appName: "shop",
      }),
    ).rejects.toMatchObject({
      code: "DOMAIN_ALREADY_REGISTERED",
      domain: "app",
      summary: 'Custom domain "shop.acme.com" is already registered',
      fix: "Select the app that owns this hostname and remove it there, or contact support if you cannot access it.",
      nextSteps: [
        "Select the owning app and remove shop.acme.com there.",
        "Contact Prisma support if you cannot access the owning app.",
      ],
    });
  });

  it("domain add maps DNS preflight failures to DOMAIN_DNS_NOT_CONFIGURED", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "shop",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
        liveUrl: "https://shop.fra.prisma.build",
      },
    ]);

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/app-provider")>();
      const addDomain = vi.fn().mockRejectedValue(
        new actual.DomainApiError({
          summary: "Failed to add custom domain",
          status: 400,
          message: "No CNAME or A/AAAA records found for hostname.",
          hint: "DNS verification failed: ensure the hostname CNAMEs to switchboard.fra.prisma.build.",
        }),
      );
      return {
        ...actual,
        createAppProvider: vi.fn(() =>
          withBranchDatabaseProviderDefaults({
            resolveBranch: createResolveBranch(),
            listApps,
            addDomain,
          }),
        ),
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDomainAdd } = await import("../src/controllers/app");
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
      runAppDomainAdd(context, "compute-test.amanv.dev", {
        projectRef: "proj_123",
        appName: "shop",
      }),
    ).rejects.toMatchObject({
      code: "DOMAIN_DNS_NOT_CONFIGURED",
      domain: "app",
      fix: "Add CNAME compute-test.amanv.dev -> switchboard.fra.prisma.build at your DNS provider, then rerun the domain command.",
      nextSteps: [
        "add CNAME compute-test.amanv.dev -> switchboard.fra.prisma.build",
        "prisma-cli app domain add compute-test.amanv.dev",
      ],
    });
  });

  it("domain add does not invent a DNS target when the API omits one", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "shop",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
        liveUrl: "https://shop.fra.prisma.build",
      },
    ]);

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/app-provider")>();
      const addDomain = vi.fn().mockRejectedValue(
        new actual.DomainApiError({
          summary: "Failed to add custom domain",
          status: 400,
          message: "DNS is not configured for hostname compute-test.amanv.dev.",
          hint: "DNS verification failed.",
        }),
      );
      return {
        ...actual,
        createAppProvider: vi.fn(() =>
          withBranchDatabaseProviderDefaults({
            resolveBranch: createResolveBranch(),
            listApps,
            addDomain,
          }),
        ),
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDomainAdd } = await import("../src/controllers/app");
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
      runAppDomainAdd(context, "compute-test.amanv.dev", {
        projectRef: "proj_123",
        appName: "shop",
      }),
    ).rejects.toMatchObject({
      code: "DOMAIN_DNS_NOT_CONFIGURED",
      domain: "app",
      fix: "The platform did not return the required DNS target. Re-run with --trace for the underlying API response details.",
      nextSteps: ["prisma-cli app domain add compute-test.amanv.dev --trace"],
    });
  });

  it("domain remove reports list-domain failures with the remove command label", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "shop",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
        liveUrl: "https://shop.fra.prisma.build",
      },
    ]);
    const listDomains = vi.fn().mockRejectedValue(new Error("list failed"));

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/app-provider")>();
      return {
        ...actual,
        createAppProvider: vi.fn(() =>
          withBranchDatabaseProviderDefaults({
            resolveBranch: createResolveBranch(),
            listApps,
            listDomains,
          }),
        ),
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDomainRemove } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      flags: { yes: true },
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(
      runAppDomainRemove(context, "shop.acme.com", {
        projectRef: "proj_123",
        appName: "shop",
      }),
    ).rejects.toMatchObject({
      code: "DEPLOY_FAILED",
      summary: "Custom domain remove failed",
    });
  });

  it("domain add rejects preview branches", async () => {
    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDomainAdd } = await import("../src/controllers/app");
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
      runAppDomainAdd(context, "shop.acme.com", {
        projectRef: "proj_123",
        appName: "shop",
        branchName: "feat/login",
      }),
    ).rejects.toMatchObject({
      code: "BRANCH_NOT_DEPLOYABLE",
      domain: "branch",
      exitCode: 2,
    });
  });

  it("domain retry maps API 409 to DOMAIN_RETRY_NOT_ELIGIBLE", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "shop",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
        liveUrl: "https://shop.prisma.app",
      },
    ]);
    const listDomains = vi
      .fn()
      .mockResolvedValue([createDomain({ status: "provisioning_tls" })]);

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/app-provider")>();
      const retryDomain = vi.fn().mockRejectedValue(
        new actual.DomainApiError({
          summary: "Failed to retry custom domain",
          status: 409,
          message: "Domain is not eligible for retry.",
        }),
      );
      return {
        ...actual,
        createAppProvider: vi.fn(() =>
          withBranchDatabaseProviderDefaults({
            resolveBranch: createResolveBranch(),
            listApps,
            listDomains,
            retryDomain,
          }),
        ),
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDomainRetry } = await import("../src/controllers/app");
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
      runAppDomainRetry(context, "shop.acme.com", {
        projectRef: "proj_123",
        appName: "shop",
      }),
    ).rejects.toMatchObject({
      code: "DOMAIN_RETRY_NOT_ELIGIBLE",
      domain: "app",
    });
  });

  it("domain wait supports poll-once timeout mode", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "shop",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
        liveUrl: "https://shop.prisma.app",
      },
    ]);
    const listDomains = vi
      .fn()
      .mockResolvedValue([createDomain({ status: "verifying" })]);
    const showDomain = vi.fn();

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/lib/app/app-provider")>();
      return {
        ...actual,
        createAppProvider: vi.fn(() =>
          withBranchDatabaseProviderDefaults({
            resolveBranch: createResolveBranch(),
            listApps,
            listDomains,
            showDomain,
          }),
        ),
      };
    });

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDomainWait } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context, stdout } = await createTestCommandContext({
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

    await expect(
      runAppDomainWait(context, "shop.acme.com", {
        projectRef: "proj_123",
        appName: "shop",
        timeout: "0",
      }),
    ).rejects.toMatchObject({
      code: "DOMAIN_VERIFICATION_TIMEOUT",
      domain: "app",
      exitCode: 1,
    });
    expect(showDomain).not.toHaveBeenCalled();
    expect(stdout.buffer).toContain('"command":"app.domain.wait"');
    expect(stdout.buffer).toContain('"status":"verifying"');
  });

  it("uses an explicit project, branch, app, framework, and runtime for a first deploy", async () => {
    const client = {
      token: "token",
      GET: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/projects") {
          return {
            data: {
              data: [
                {
                  id: "proj_my_app",
                  name: "my-app",
                  slug: "my-app",
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
          return {
            data: {
              data: [
                {
                  id: "branch_feat_j1",
                  gitName: "feat-j1",
                  isDefault: false,
                  role: "preview",
                },
              ],
            },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
      POST: vi.fn(),
    };
    const requireComputeAuth = vi.fn().mockResolvedValue(client);
    const listApps = vi.fn().mockResolvedValue([]);
    const deployApp = vi
      .fn()
      .mockImplementation(async (options: { appName?: string }) => ({
        projectId: "proj_my_app",
        app: {
          id: "app_new",
          name: options.appName ?? "my-app",
          region: "eu-central-1",
          liveDeploymentId: "dep_123",
        },
        deployment: {
          id: "dep_123",
          status: "running",
          url: "https://my-app.prisma.app",
        },
      }));

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writePackageJson(cwd, {
      name: "my-app",
      dependencies: {
        next: "15.0.0",
      },
    });
    await writeGitBranch(cwd, "feat-j1");
    const stateDir = path.join(cwd, ".state");
    const { context, stderr } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const result = await runAppDeploy(context, undefined, {
      projectRef: "proj_my_app",
    });

    expect(listApps).toHaveBeenCalledWith("proj_my_app", {
      branchName: "feat-j1",
      signal: context.runtime.signal,
    });
    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_my_app",
        branchName: "feat-j1",
        appName: "my-app",
        buildType: "nextjs",
        buildSettings: {
          buildCommand: "next build",
          buildCommandSource: "Next.js default",
          outputDirectory: ".next/standalone",
          outputDirectorySource: "Next.js output",
        },
        portMapping: { http: 3000 },
        signal: context.runtime.signal,
      }),
    );
    expect(result.result).toMatchObject({
      project: {
        id: "proj_my_app",
        name: "my-app",
      },
      branch: {
        name: "feat-j1",
        kind: "preview",
      },
      resolution: {
        projectSource: "explicit",
        targetName: "proj_my_app",
        targetNameSource: "explicit",
      },
      app: {
        id: "app_new",
        name: "my-app",
      },
      deploySettings: {
        config: {
          path: null,
          status: "inferred",
        },
        buildCommand: {
          value: "next build",
          source: "Next.js default",
        },
        outputDirectory: {
          value: ".next/standalone",
          source: "Next.js output",
        },
      },
      localPin: {
        path: ".prisma/local.json",
        written: true,
      },
    });
    expect(stderr.buffer).toContain(
      `Linked "./${path.basename(cwd)}" to Project "my-app"`,
    );
    expect(stderr.buffer).toContain("Saved .prisma/local.json");
    expect(stderr.buffer).toContain("Deploying to my-app / feat-j1 / my-app");
    expect(stderr.buffer).toContain("Build settings");
    expect(stderr.buffer).toContain("Build Command");
    expect(stderr.buffer).toContain("next build");
    expect(stderr.buffer).toContain("Output Directory");
    expect(stderr.buffer).toContain(".next/standalone");
    await expect(readPrismaAppConfig(cwd)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readLocalPin(cwd)).resolves.toEqual({
      workspaceId: "ws_123",
      projectId: "proj_my_app",
    });
    await expect(readFile(path.join(cwd, ".gitignore"), "utf8")).resolves.toBe(
      ".prisma/\n",
    );
  });

  it("uses and renders configured build entrypoints for custom deploys", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([]);
    const deployApp = vi.fn().mockResolvedValue({
      projectId: "proj_123",
      app: {
        id: "app_new",
        name: "frontend",
        region: "eu-central-1",
        liveDeploymentId: "dep_123",
      },
      deployment: {
        id: "dep_123",
        status: "running",
        url: "https://frontend.prisma.app",
      },
    });

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeFile(
      path.join(cwd, "prisma.compute.ts"),
      [
        "export default {",
        "  app: {",
        '    name: "frontend",',
        '    framework: "custom",',
        "    build: {",
        '      outputDirectory: "dist",',
        '      entrypoint: "server.js",',
        "    },",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    const { context, stderr } = await createTestCommandContext({
      cwd,
      stateDir: path.join(cwd, ".state"),
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const result = await runAppDeploy(context, undefined, {
      projectRef: "proj_123",
    });

    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        appName: "frontend",
        buildType: "custom",
        entrypoint: undefined,
        buildSettings: {
          buildCommand: null,
          buildCommandSource: null,
          outputDirectory: "dist",
          outputDirectorySource: "set by prisma.compute.ts",
          entrypoint: "server.js",
          entrypointSource: "set by prisma.compute.ts",
        },
      }),
    );
    expect(asSingleDeployResult(result).result.deploySettings).toMatchObject({
      config: {
        path: "prisma.compute.ts",
        status: "config",
      },
      entrypoint: "server.js",
    });
    expect(stderr.buffer).toContain("Using prisma.compute.ts");
    expect(stderr.buffer).toContain("Entrypoint");
    expect(stderr.buffer).toContain("server.js");
  });

  it("returns LOCAL_STATE_WRITE_FAILED when deploy cannot store the local binding", async () => {
    const requireComputeAuth = vi
      .fn()
      .mockResolvedValue(createProjectClient("proj_my_app"));

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps: vi.fn(),
          deployApp: vi.fn(),
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, ".gitignore"), { recursive: true });
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

    await expect(
      runAppDeploy(context, undefined, {
        projectRef: "proj_my_app",
      }),
    ).rejects.toMatchObject({
      code: "LOCAL_STATE_WRITE_FAILED",
      domain: "project",
      meta: {
        gitignorePath: ".gitignore",
        operation: "read",
      },
    });
    await expect(readLocalPin(cwd)).resolves.toEqual({
      workspaceId: "ws_123",
      projectId: "proj_my_app",
    });
  });

  it("fails with migration guidance for a customized prisma.app.json", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
    ]);
    const deployApp = vi.fn();

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writePackageJson(cwd, {
      name: "hello-world",
      dependencies: {
        next: "15.0.0",
      },
    });
    await writeFile(
      path.join(cwd, "prisma.app.json"),
      `${JSON.stringify(
        {
          buildCommand: "bun run custom-build",
          outputDirectory: "dist",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const { context } = await createTestCommandContext({
      cwd,
      stateDir: path.join(cwd, ".state"),
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(
      runAppDeploy(context, "hello-world", {
        projectRef: "proj_123",
        framework: "nextjs",
      }),
    ).rejects.toMatchObject({
      code: "BUILD_SETTINGS_MIGRATION_REQUIRED",
      fix: expect.stringContaining(
        'command: "bun run custom-build",   outputDirectory: "dist",',
      ),
    });
    expect(deployApp).not.toHaveBeenCalled();
  });

  it("warns about and ignores a matching prisma.app.json", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
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
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listEnvironmentVariables: vi.fn().mockResolvedValue([]),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writePackageJson(cwd, {
      name: "hello-world",
      dependencies: {
        next: "15.0.0",
      },
    });
    await writeFile(
      path.join(cwd, "prisma.app.json"),
      `${JSON.stringify(
        {
          buildCommand: "next build",
          outputDirectory: ".next/standalone",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const { context } = await createTestCommandContext({
      cwd,
      stateDir: path.join(cwd, ".state"),
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const result = await runAppDeploy(context, "hello-world", {
      projectRef: "proj_123",
      framework: "nextjs",
    });

    expect(result.warnings.join(" ")).toContain(
      "prisma.app.json is no longer used",
    );
    expect(asSingleDeployResult(result).result.deploySettings.config).toEqual({
      path: null,
      status: "inferred",
    });
  });

  it("writes the local binding before build failures and renders build-failure copy", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([]);
    const deployApp = vi
      .fn()
      .mockImplementation(
        async (options: { progress?: { onBuildStart?: () => void } }) => {
          options.progress?.onBuildStart?.();
          throw new Error("next build exited with code 1");
        },
      );

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context, stderr } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(
      runAppDeploy(context, "hello-world", {
        projectRef: "proj_123",
        framework: "hono",
      }),
    ).rejects.toMatchObject({
      code: "BUILD_FAILED",
      humanLines: [
        "Build failed locally.",
        "",
        "✗ Built       next build exited with code 1",
        "",
        "Fix: Inspect the build output above, fix the error, and redeploy.",
      ],
    });
    await expect(readLocalPin(cwd)).resolves.toEqual({
      workspaceId: "ws_123",
      projectId: "proj_123",
    });
    expect(stderr.buffer).toContain(
      `Linked "./${path.basename(cwd)}" to Project "Acme Dashboard"`,
    );
    expect(stderr.buffer).toContain("Saved .prisma/local.json");
    expect(stderr.buffer).toContain("Building locally...");
  });

  it("surfaces a concrete Next.js standalone-output recovery action", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([]);
    const deployApp = vi
      .fn()
      .mockImplementation(
        async (options: { progress?: { onBuildStart?: () => void } }) => {
          options.progress?.onBuildStart?.();
          throw new Error(
            'Next.js build did not produce standalone output. Add output: "standalone" to your next.config file.',
          );
        },
      );

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    await expect(
      runAppDeploy(context, "hello-world", {
        projectRef: "proj_123",
        framework: "nextjs",
      }),
    ).rejects.toMatchObject({
      code: "BUILD_FAILED",
      fix: 'Add output: "standalone" to next.config.*, then rerun deploy.',
      humanLines: [
        "Build failed locally.",
        "",
        '✗ Built       Next.js build did not produce standalone output. Add output: "standalone" to your next.config file.',
        "",
        'Fix: Add output: "standalone" to next.config.*, then rerun deploy.',
      ],
      nextSteps: [
        'Add output: "standalone" to next.config.*, then rerun prisma-cli app deploy',
      ],
      nextActions: [
        expect.objectContaining({
          kind: "edit-file",
          journey: "deploy-app",
          label: "Add Next.js standalone output",
        }),
        expect.objectContaining({
          kind: "run-command",
          command: "prisma-cli app deploy",
        }),
      ],
    });
  });

  it("renders runtime-failure copy with deployment logs after the container starts", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    let appName = "";
    const listApps = vi.fn().mockImplementation(async () => [
      {
        id: "app_1",
        name: appName,
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
    ]);
    const deployApp = vi.fn().mockImplementation(
      async (options: {
        progress?: {
          onBuildStart?: () => void;
          onBuildComplete?: () => void;
          onArchiveCreating?: () => void;
          onArchiveReady?: (byteLength: number) => void;
          onUploadStart?: () => void;
          onDeploymentCreated?: (deploymentId: string) => void;
          onUploadComplete?: () => void;
          onStartRequested?: () => void;
          onRunning?: (url?: string) => void;
        };
      }) => {
        options.progress?.onBuildStart?.();
        options.progress?.onBuildComplete?.();
        options.progress?.onArchiveCreating?.();
        options.progress?.onArchiveReady?.(11_114_905);
        options.progress?.onUploadStart?.();
        options.progress?.onDeploymentCreated?.("dep_failed");
        options.progress?.onUploadComplete?.();
        options.progress?.onStartRequested?.();
        options.progress?.onRunning?.("https://cv-example.fra.prisma.build");
        throw new Error("Internal Server Error");
      },
    );

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    appName = path.basename(cwd);
    await writeLocalPin(cwd, {
      workspaceId: "ws_123",
      projectId: "proj_123",
    });
    const stateDir = path.join(cwd, ".state");
    const { context, stderr } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(
      runAppDeploy(context, undefined, {
        framework: "hono",
      }),
    ).rejects.toMatchObject({
      code: "DEPLOY_FAILED",
      humanLines: expect.arrayContaining([
        "The deployment started, but the app is not ready yet.",
        "This is usually a missing env var, a failed DB connection,",
        "or a crash on startup.",
        "See what happened",
        "prisma-cli app logs --deployment dep_failed",
        "URL",
        "https://cv-example.fra.prisma.build",
      ]),
    });
    expect(stderr.buffer).toContain(
      `Deploying ./${path.basename(cwd)} to Acme Dashboard / main / ${path.basename(cwd)}`,
    );
    expect(stderr.buffer).toContain("  Built      10.6 MB");
    expect(stderr.buffer).toContain("  Uploaded");
    expect(stderr.buffer).toContain("Deploying...");
    expect(stderr.buffer).toContain("  Deployed");
    expect(stderr.buffer).not.toContain("Status: running");
    expect(stderr.buffer).not.toContain("Deployment is running at");
    expect(stderr.buffer).not.toContain("Checking runtime health");
  });

  it("renders deploy-failure copy when failure happens before runtime starts", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    let appName = "";
    const listApps = vi.fn().mockImplementation(async () => [
      {
        id: "app_1",
        name: appName,
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
    ]);
    const deployApp = vi.fn().mockImplementation(
      async (options: {
        progress?: {
          onBuildStart?: () => void;
          onBuildComplete?: () => void;
          onArchiveCreating?: () => void;
          onArchiveReady?: (byteLength: number) => void;
          onUploadStart?: () => void;
        };
      }) => {
        options.progress?.onBuildStart?.();
        options.progress?.onBuildComplete?.();
        options.progress?.onArchiveCreating?.();
        options.progress?.onArchiveReady?.(11_114_905);
        options.progress?.onUploadStart?.();
        throw new Error("Upload failed");
      },
    );

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    appName = path.basename(cwd);
    await writeLocalPin(cwd, {
      workspaceId: "ws_123",
      projectId: "proj_123",
    });
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

    await expect(
      runAppDeploy(context, undefined, {
        framework: "hono",
      }),
    ).rejects.toMatchObject({
      code: "DEPLOY_FAILED",
      summary: "Deploy failed after the build completed.",
      humanLines: expect.arrayContaining([
        "Deploy failed after the build completed.",
        "The app built locally, but the artifact did not finish uploading.",
        "Fix",
        "Retry the command, or rerun with --trace for more detailed diagnostics.",
      ]),
    });
  });

  it.each([
    {
      name: "Next.js from package.json",
      packageJson: { dependencies: { next: "15.0.0" } },
      expectedBuildType: "nextjs",
    },
    {
      name: "Next.js from next.config.mts",
      files: { "next.config.mts": 'export default { output: "standalone" }\n' },
      expectedBuildType: "nextjs",
    },
    {
      name: "Hono from package.json",
      packageJson: { dependencies: { hono: "4.0.0" } },
      files: {
        "src/index.ts": "export default { fetch: () => new Response('ok') }\n",
      },
      expectedEntrypoint: "src/index.ts",
      expectedBuildType: "bun",
    },
    {
      name: "Bun from --entry",
      entrypoint: "src/server.ts",
      expectedBuildType: "bun",
    },
    {
      name: "Bun from --framework bun with --entry",
      framework: "bun",
      entrypoint: "src/server.ts",
      expectedBuildType: "bun",
    },
    {
      name: "Bun from --framework bun with package.json main",
      packageJson: { main: "index.ts" },
      framework: "bun",
      expectedEntrypoint: "index.ts",
      expectedBuildType: "bun",
    },
    {
      name: "TanStack Start React from package.json",
      packageJson: { dependencies: { "@tanstack/react-start": "1.0.0" } },
      expectedBuildType: "tanstack-start",
    },
    {
      name: "TanStack Start Solid from package.json",
      packageJson: { dependencies: { "@tanstack/solid-start": "1.0.0" } },
      expectedBuildType: "tanstack-start",
    },
  ])("detects deploy framework: $name", async ({
    packageJson,
    files,
    framework,
    entrypoint,
    expectedEntrypoint,
    expectedBuildType,
  }) => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
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
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    if (packageJson) {
      await writePackageJson(cwd, packageJson);
    }
    for (const [fileName, content] of Object.entries(files ?? {})) {
      const filePath = path.join(cwd, fileName);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }
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
      projectRef: "proj_123",
      framework,
      entrypoint,
    });

    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        entrypoint: expectedEntrypoint ?? entrypoint,
        buildType: expectedBuildType,
        portMapping: { http: 3000 },
      }),
    );
  });

  it("lets PRISMA_PROJECT_ID skip the local pin and resolve the project", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([]);
    const deployApp = vi
      .fn()
      .mockImplementation(async (options: { appName?: string }) => ({
        projectId: "proj_123",
        app: {
          id: "app_env",
          name: options.appName ?? "env-app",
          region: "eu-central-1",
          liveDeploymentId: "dep_123",
          liveUrl: "https://env-app.prisma.app",
        },
        deployment: {
          id: "dep_123",
          status: "running",
          url: "https://env-app.prisma.app",
        },
      }));

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, {
      workspaceId: "ws_123",
      projectId: "proj_stale",
    });
    const stateDir = path.join(cwd, ".state");
    const { context, stderr } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_PROJECT_ID: "proj_123",
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const result = await runAppDeploy(context, undefined, {
      framework: "hono",
    });

    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_123",
        appName: path.basename(cwd),
      }),
    );
    expect(asSingleDeployResult(result).result.project.id).toBe("proj_123");
    expect(asSingleDeployResult(result).result.resolution.projectSource).toBe(
      "env",
    );
    expect(asSingleDeployResult(result).result.localPin).toBeUndefined();
    await expect(readLocalPin(cwd)).resolves.toEqual({
      workspaceId: "ws_123",
      projectId: "proj_stale",
    });
    expect(stderr.buffer).toContain(
      `Deploying ./${path.basename(cwd)} to Acme Dashboard / main / ${path.basename(cwd)}`,
    );
    expect(stderr.buffer).not.toContain("from PRISMA_PROJECT_ID");
  });

  it("returns PROJECT_SETUP_REQUIRED for non-interactive unbound deploy without mutating local state", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const createProject = vi.fn();
    const listApps = vi.fn();
    const deployApp = vi.fn();

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject,
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: false,
      flags: {
        json: true,
        yes: true,
      },
      env: {
        ...process.env,
        PRISMA_CLI_TEST_REMEMBER_PROJECT_ID: "",
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(
      runAppDeploy(context, "hello-world", {
        framework: "hono",
      }),
    ).rejects.toMatchObject({
      code: "PROJECT_SETUP_REQUIRED",
      domain: "project",
      meta: {
        candidates: [{ id: "proj_123", name: "Acme Dashboard" }],
        suggestedProjectName: path.basename(cwd),
        suggestedProjectNameSource: "directory-name",
        recoveryCommands: expect.arrayContaining([
          "prisma-cli app deploy --project <id-or-name>",
          `prisma-cli app deploy --create-project ${path.basename(cwd)}`,
        ]),
      },
      nextActions: [
        expect.objectContaining({
          kind: "user-choice",
          journey: "project-setup",
        }),
        expect.objectContaining({
          kind: "run-command",
          command: "prisma-cli project link <id-or-name>",
        }),
        expect.objectContaining({
          kind: "run-command",
          command: `prisma-cli app deploy --create-project ${path.basename(cwd)}`,
        }),
        expect.objectContaining({
          kind: "run-command",
          command: "prisma-cli app deploy --project <id-or-name>",
        }),
      ],
    });
    expect(createProject).not.toHaveBeenCalled();
    expect(listApps).not.toHaveBeenCalled();
    expect(deployApp).not.toHaveBeenCalled();
    await expect(
      readFile(path.join(cwd, ".prisma/local.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(path.join(cwd, ".gitignore"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects mutually exclusive Project sources before resolving deploy context", async () => {
    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    await expect(
      runAppDeploy(context, "hello-world", {
        projectRef: "proj_123",
        createProjectName: "new-project",
        framework: "hono",
      }),
    ).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "project",
      summary: "Project selection is ambiguous",
      why: expect.stringContaining("--project, --create-project"),
    });

    const { context: envContext } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_PROJECT_ID: "proj_123",
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(
      runAppDeploy(envContext, "hello-world", {
        projectRef: "proj_456",
        framework: "hono",
      }),
    ).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "project",
      summary: "Project selection is ambiguous",
      why: expect.stringContaining("PRISMA_PROJECT_ID"),
    });
  });

  it("interactive first deploy can select an existing Project and write the local pin", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const createProject = vi.fn();
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

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject,
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context, stderr } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: true,
      stdinText: "\r",
      env: {
        ...process.env,
        PRISMA_CLI_TEST_REMEMBER_PROJECT_ID: "",
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const result = await runAppDeploy(context, "hello-world", {
      framework: "hono",
    });

    expect(createProject).not.toHaveBeenCalled();
    expect(asSingleDeployResult(result).result.resolution.projectSource).toBe(
      "prompt",
    );
    expect(asSingleDeployResult(result).result.localPin).toEqual({
      path: ".prisma/local.json",
      written: true,
    });
    await expect(readLocalPin(cwd)).resolves.toEqual({
      workspaceId: "ws_123",
      projectId: "proj_123",
    });
    expect(stderr.buffer).toContain("Which Project should this directory use?");
    expect(stderr.buffer).toContain(
      `Linked "./${path.basename(cwd)}" to Project "Acme Dashboard"`,
    );
  });

  it("interactive first deploy previews detected framework and runtime before the customization prompt", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const createProject = vi.fn();
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

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          createProject,
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writePackageJson(cwd, {
      name: "hello-world",
      dependencies: {
        next: "15.0.0",
      },
    });
    const stateDir = path.join(cwd, ".state");
    const { context, stderr } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: true,
      stdinText: "\r\r",
      env: {
        ...process.env,
        PRISMA_CLI_TEST_REMEMBER_PROJECT_ID: "",
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await runAppDeploy(context, "hello-world");

    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        buildType: "nextjs",
        portMapping: { http: 3000 },
      }),
    );

    const targetIndex = stderr.buffer.indexOf(
      "Deploying to Acme Dashboard / main / hello-world",
    );
    const detectedIndex = stderr.buffer.indexOf("Detected Next.js");
    const promptIndex = stderr.buffer.indexOf("Customize build settings?");

    expect(targetIndex).toBeGreaterThanOrEqual(0);
    expect(detectedIndex).toBeGreaterThan(targetIndex);
    expect(stderr.buffer).toContain("framework:");
    expect(stderr.buffer).toContain("runtime:");
    expect(stderr.buffer).toContain("Next.js");
    expect(stderr.buffer).toContain("HTTP 3000");
    expect(stderr.buffer).not.toContain("Using deploy settings:");
    expect(stderr.buffer).not.toContain("build:");
    expect(promptIndex).toBeGreaterThan(detectedIndex);
  });

  it("interactive first deploy can create a new Project from an editable suggested name", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const createProject = vi.fn().mockResolvedValue({
      id: "proj_new",
      name: "interactive-project",
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
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject,
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writePackageJson(cwd, {
      name: "suggested-name",
    });
    const stateDir = path.join(cwd, ".state");
    const { context, stderr } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: true,
      stdinText: "\u001B[B\rinteractive-project\r",
      env: {
        ...process.env,
        PRISMA_CLI_TEST_REMEMBER_PROJECT_ID: "",
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const result = await runAppDeploy(context, "hello-world", {
      framework: "hono",
    });

    expect(createProject).toHaveBeenCalledWith({
      name: "interactive-project",
      signal: context.runtime.signal,
    });
    expect(result.result).toMatchObject({
      project: {
        id: "proj_new",
        name: "interactive-project",
      },
      resolution: {
        projectSource: "created",
        targetName: "interactive-project",
        targetNameSource: "prompt",
      },
      localPin: {
        path: ".prisma/local.json",
        written: true,
      },
    });
    await expect(readLocalPin(cwd)).resolves.toEqual({
      workspaceId: "ws_123",
      projectId: "proj_new",
    });
    expect(stderr.buffer).toContain("Project name");
    expect(stderr.buffer).toContain("suggested-name");
  });

  it("returns FRAMEWORK_NOT_DETECTED before deploy when framework inference fails", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps: vi.fn(),
          deployApp: vi.fn(),
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    await expect(
      runAppDeploy(context, "hello-world", {
        projectRef: "proj_123",
      }),
    ).rejects.toMatchObject({
      code: "FRAMEWORK_NOT_DETECTED",
      domain: "app",
      exitCode: 2,
    });
  });

  it("returns LOCAL_PROJECT_WORKSPACE_MISMATCH when deploy pin belongs to another workspace", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn();
    const deployApp = vi.fn();

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, {
      workspaceId: "ws_other",
      projectId: "proj_123",
    });
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

    await expect(
      runAppDeploy(context, undefined, {
        framework: "hono",
      }),
    ).rejects.toMatchObject({
      code: "LOCAL_PROJECT_WORKSPACE_MISMATCH",
      domain: "project",
      meta: {
        pinPath: ".prisma/local.json",
        pinnedWorkspaceId: "ws_other",
        pinnedProjectId: "proj_123",
        activeWorkspaceId: "ws_123",
      },
      nextSteps: [
        "prisma-cli auth workspace use ws_other",
        "prisma-cli project list",
        "prisma-cli project link <id-or-name>",
      ],
    });
    expect(listApps).not.toHaveBeenCalled();
    expect(deployApp).not.toHaveBeenCalled();
  });

  it("returns LOCAL_STATE_STALE when the pinned project is gone", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn();
    const deployApp = vi.fn();

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, {
      workspaceId: "ws_123",
      projectId: "proj_missing",
    });
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

    await expect(
      runAppDeploy(context, undefined, {
        framework: "hono",
      }),
    ).rejects.toMatchObject({
      code: "LOCAL_STATE_STALE",
      domain: "project",
      meta: {
        pinPath: ".prisma/local.json",
      },
      fix: "Delete .prisma/local.json, then choose a Project explicitly.",
    });
    expect(listApps).not.toHaveBeenCalled();
    expect(deployApp).not.toHaveBeenCalled();
  });

  it("returns LOCAL_STATE_STALE when the local pin has unsupported keys", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn();
    const deployApp = vi.fn();

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, {
      workspaceId: "ws_123",
      projectId: "proj_123",
      unsupportedKey: "not-supported",
    });
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

    await expect(
      runAppDeploy(context, undefined, {
        framework: "hono",
      }),
    ).rejects.toMatchObject({
      code: "LOCAL_STATE_STALE",
      meta: {
        pinPath: ".prisma/local.json",
      },
    });
    expect(listApps).not.toHaveBeenCalled();
    expect(deployApp).not.toHaveBeenCalled();
  });

  it("returns LOCAL_STATE_STALE when the local pin cannot be parsed", async () => {
    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, "{ nope");
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

    await expect(
      runAppDeploy(context, undefined, {
        framework: "hono",
      }),
    ).rejects.toMatchObject({
      code: "LOCAL_STATE_STALE",
      meta: {
        pinPath: ".prisma/local.json",
      },
    });
  });

  it("returns APP_AMBIGUOUS for duplicate app names in non-interactive mode", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
      {
        id: "app_2",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
    ]);
    const deployApp = vi.fn();

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    await expect(
      runAppDeploy(context, "hello-world", {
        projectRef: "proj_123",
        framework: "hono",
      }),
    ).rejects.toMatchObject({
      code: "APP_AMBIGUOUS",
      domain: "app",
      exitCode: 2,
      meta: {
        candidates: [
          { id: "app_1", name: "hello-world" },
          { id: "app_2", name: "hello-world" },
        ],
      },
    });
    expect(deployApp).not.toHaveBeenCalled();
  });

  it("rejects --entry together with --framework nextjs for deploy", async () => {
    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    await expect(
      runAppDeploy(context, "hello-world", {
        framework: "nextjs",
        entrypoint: "server.js",
      }),
    ).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary: "App deploy does not accept --entry with Next.js",
    });
  });

  it("rejects invalid --http-port values for deploy", async () => {
    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    await expect(
      runAppDeploy(context, "hello-world", {
        httpPort: "70000",
      }),
    ).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "app",
      summary: 'Invalid HTTP port "70000"',
    });
  });

  it("interactive first deploy can create a new app when none is selected", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([]);
    const deployApp = vi
      .fn()
      .mockImplementation(async (options: { appName?: string }) => ({
        projectId: "proj_123",
        app: {
          id: "app_new",
          name: options.appName ?? "hello-world",
          region: "eu-west-3",
          liveDeploymentId: "dep_123",
        },
        deployment: {
          id: "dep_123",
          status: "running",
          url: "https://hello-world.prisma.app",
        },
      }));

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    const result = await runAppDeploy(context, undefined, {
      projectRef: "proj_123",
      framework: "hono",
    });

    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_123",
        appId: undefined,
        appName: path.basename(cwd),
        interaction: undefined,
      }),
    );
    expect(asSingleDeployResult(result).result.app).toEqual({
      id: "app_new",
      name: path.basename(cwd),
    });
  });

  it("auto-creates the inferred app without prompting in non-interactive mode", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([]);
    const deployApp = vi
      .fn()
      .mockImplementation(async (options: { appName?: string }) => ({
        projectId: "proj_123",
        app: {
          id: "app_new",
          name: options.appName ?? "created-app",
          region: "eu-central-1",
          liveDeploymentId: "dep_123",
        },
        deployment: {
          id: "dep_123",
          status: "running",
          url: "https://created-app.prisma.app",
        },
      }));

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    await runAppDeploy(context, undefined, {
      projectRef: "proj_123",
      framework: "hono",
    });

    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        appName: path.basename(cwd),
        interaction: undefined,
      }),
    );
  });

  it("creates a named new app with the default Frankfurt region in non-interactive mode", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
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

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    await runAppDeploy(context, "hello-world", {
      projectRef: "proj_123",
      framework: "hono",
    });

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

  it("creates a project before first deploy when --create-project is provided", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const createProject = vi.fn(async (options: { name: string }) => ({
      id: "proj_new",
      name: options.name,
    }));
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
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject,
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext, readPrismaConfig } =
      await import("./helpers");
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_TEST_REMEMBER_PROJECT_ID: "",
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const result = await runAppDeploy(context, "hello-world", {
      createProjectName: "launchpad",
      framework: "hono",
    });

    expect(createProject).toHaveBeenCalledWith({
      name: "launchpad",
      signal: context.runtime.signal,
    });
    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_new",
        appName: "hello-world",
      }),
    );
    await expect(readPrismaConfig(cwd)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      context.stateStore.readSelectedApp("proj_new"),
    ).resolves.toEqual({
      id: "app_new",
      name: "hello-world",
    });
    expect(result.result).toMatchObject({
      project: {
        id: "proj_new",
        name: "launchpad",
      },
      resolution: {
        projectSource: "created",
        targetName: "launchpad",
        targetNameSource: "explicit",
      },
      localPin: {
        path: ".prisma/local.json",
        written: true,
      },
    });
    await expect(readLocalPin(cwd)).resolves.toEqual({
      workspaceId: "ws_123",
      projectId: "proj_new",
    });
    await expect(readFile(path.join(cwd, ".gitignore"), "utf8")).resolves.toBe(
      ".prisma/\n",
    );
  });

  it("reuses the created project on second deploy instead of creating another one", async () => {
    const client = createProjectClient();
    const requireComputeAuth = vi.fn().mockResolvedValue(client);
    const createProject = vi.fn().mockResolvedValue({
      id: "proj_new",
      name: "next-smoke",
    });
    const listApps = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "app_new",
          name: "hello-world",
          region: "eu-central-1",
          liveDeploymentId: "dep_123",
        },
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
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject,
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context, stderr } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_TEST_REMEMBER_PROJECT_ID: "",
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const firstResult = await runAppDeploy(context, "hello-world", {
      createProjectName: "next-smoke",
      framework: "hono",
    });
    expect(asSingleDeployResult(firstResult).result.localPin).toEqual({
      path: ".prisma/local.json",
      written: true,
    });
    await expect(readLocalPin(cwd)).resolves.toEqual({
      workspaceId: "ws_123",
      projectId: "proj_new",
    });
    stderr.buffer = "";
    client.GET.mockImplementation(
      (
        pathName: string,
        request?: { params?: { query?: { gitName?: string } } },
      ) => {
        if (pathName === "/v1/projects") {
          return {
            data: {
              data: [
                {
                  id: "proj_new",
                  name: path.basename(cwd),
                  slug: path.basename(cwd),
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
              data: [
                {
                  id: `branch_${branchName.replace(/[^a-z0-9]+/gi, "_")}`,
                  gitName: branchName,
                  isDefault: branchName === "main",
                  role: "preview",
                },
              ],
            },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      },
    );
    const secondResult = await runAppDeploy(context, "hello-world", {
      framework: "hono",
    });

    expect(createProject).toHaveBeenCalledTimes(1);
    expect(asSingleDeployResult(secondResult).result.localPin).toBeUndefined();
    expect(stderr.buffer).toContain(`Deploying ./${path.basename(cwd)}`);
    expect(stderr.buffer).not.toContain("Set up");
    await expect(readFile(path.join(cwd, ".gitignore"), "utf8")).resolves.toBe(
      ".prisma/\n",
    );
    expect(deployApp).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        projectId: "proj_new",
        appId: "app_new",
      }),
    );
  });

  it("creates an explicit deploy-time project without depending on repo config preflight", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const createProject = vi.fn().mockResolvedValue({
      id: "proj_new",
      name: "next-smoke",
    });
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
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject,
          listApps: vi.fn().mockResolvedValue([]),
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext, readPrismaConfig } =
      await import("./helpers");
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_TEST_REMEMBER_PROJECT_ID: "",
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(
      runAppDeploy(context, "hello-world", {
        createProjectName: "next-smoke",
        framework: "hono",
      }),
    ).resolves.toMatchObject({
      result: {
        project: {
          id: "proj_new",
        },
        resolution: {
          projectSource: "created",
          targetName: "next-smoke",
          targetNameSource: "explicit",
        },
      },
    });
    expect(createProject).toHaveBeenCalledWith({
      name: "next-smoke",
      signal: context.runtime.signal,
    });
    await expect(readPrismaConfig(cwd)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("returns PROJECT_CREATE_FAILED when explicit deploy-time project creation is rejected with 401", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const createProject = vi
      .fn()
      .mockRejectedValue(new Error("Authentication failed (HTTP 401)"));

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject,
          listApps: vi.fn().mockResolvedValue([]),
          deployApp: vi.fn(),
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_TEST_REMEMBER_PROJECT_ID: "",
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(
      runAppDeploy(context, "hello-world", {
        createProjectName: "next-smoke",
        framework: "hono",
      }),
    ).rejects.toMatchObject({
      code: "PROJECT_CREATE_FAILED",
      domain: "project",
      summary: 'Could not create Project "next-smoke"',
      why: expect.stringContaining("HTTP 401"),
      fix: expect.stringContaining("--project"),
      nextSteps: expect.arrayContaining([
        "prisma-cli app deploy --project <id-or-name>",
      ]),
    });
  });

  it("returns PROJECT_CREATE_FAILED when explicit deploy-time project creation fails", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const createProject = vi
      .fn()
      .mockRejectedValue(new Error("Internal Server Error (HTTP 503)"));

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject,
          listApps: vi.fn().mockResolvedValue([]),
          deployApp: vi.fn(),
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_TEST_REMEMBER_PROJECT_ID: "",
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(
      runAppDeploy(context, "hello-world", {
        createProjectName: "next-smoke",
        framework: "hono",
      }),
    ).rejects.toMatchObject({
      code: "PROJECT_CREATE_FAILED",
      domain: "project",
      summary: 'Could not create Project "next-smoke"',
      why: expect.stringContaining("Internal Server Error"),
      fix: expect.stringContaining("--project"),
      nextSteps: expect.arrayContaining([
        "prisma-cli app deploy --project <id-or-name>",
      ]),
    });
  });

  it("does not use saved app selection as the deploy target source", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_live",
      },
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

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    await runAppDeploy(context, undefined, {
      projectRef: "proj_123",
      framework: "hono",
    });

    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: undefined,
        appName: path.basename(cwd),
      }),
    );
  });

  it("list-deploys sorts deployments newest first for the selected app", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_2",
      },
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

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp: vi.fn(),
          listDeployments,
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppListDeploys } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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

    expect(
      result.result.deployments.map((deployment) => deployment.id),
    ).toEqual(["dep_2", "dep_1"]);
  });

  it("returns PROJECT_NOT_FOUND when the resolved project is not accessible in real mode", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockRejectedValue(new Error("Resource Not Found"));

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppListDeploys } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: null,
      },
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

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp: vi.fn(),
          listDeployments,
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppListDeploys } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
    await context.stateStore.setKnownLiveDeployment(
      "proj_123",
      "app_1",
      "dep_1",
    );

    const result = await runAppListDeploys(context, "hello-world");

    expect(result.result.deployments).toEqual([
      expect.objectContaining({ id: "dep_2", live: false }),
      expect.objectContaining({ id: "dep_1", live: true }),
    ]);
  });

  it("show requires Project setup even when package name matches a Project", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn();

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          deployApp: vi.fn(),
          listDeployments: vi.fn(),
          promoteDeployment: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppShow } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writePackageJson(cwd, { name: "acme-dashboard" });
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_TEST_REMEMBER_PROJECT_ID: "",
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(runAppShow(context, "hello-world")).rejects.toMatchObject({
      code: "PROJECT_SETUP_REQUIRED",
      domain: "project",
      meta: {
        suggestedProjectName: "acme-dashboard",
        suggestedProjectNameSource: "package-name",
        candidates: [
          {
            id: "proj_123",
            name: "Acme Dashboard",
          },
        ],
      },
      nextActions: expect.arrayContaining([
        expect.objectContaining({
          kind: "user-choice",
          journey: "project-setup",
        }),
      ]),
    });
    expect(listApps).not.toHaveBeenCalled();
  });

  it("show returns undeployed state when the resolved project has no apps", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([]);

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          deployApp: vi.fn(),
          listDeployments: vi.fn(),
          promoteDeployment: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppShow } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
      verboseContext: expectedAppVerboseContext(),
      app: null,
      liveDeployment: null,
      liveUrl: null,
      recentDeployments: [],
    });
  });

  it("show returns selected app, live deployment, live URL, and recent deployments", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
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

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          deployApp: vi.fn(),
          listDeployments,
          promoteDeployment: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppShow } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
      verboseContext: expectedAppVerboseContext(),
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
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
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

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          deployApp: vi.fn(),
          listDeployments,
          promoteDeployment: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppShow } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await context.stateStore.setKnownLiveDeployment(
      "proj_123",
      "app_1",
      "dep_2",
    );

    const result = await runAppShow(context, "hello-world");

    expect(result.result.liveDeployment?.id).toBe("dep_2");
    expect(
      result.result.recentDeployments.find(
        (deployment) => deployment.id === "dep_2",
      )?.live,
    ).toBe(true);
    expect(
      result.result.recentDeployments.find(
        (deployment) => deployment.id === "dep_3",
      )?.live,
    ).toBe(false);
  });

  it("show-deploy returns deployment detail without branch inference", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
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
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps: vi.fn(),
          deployApp: vi.fn(),
          listDeployments: vi.fn(),
          showDeployment,
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
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
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps: vi.fn(),
          deployApp: vi.fn(),
          listDeployments: vi.fn(),
          showDeployment,
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    await context.stateStore.setKnownLiveDeployment(
      "proj_123",
      "app_1",
      "dep_123",
    );

    const result = await runAppShowDeploy(context, "dep_123");

    expect(result.result.deployment.live).toBe(true);
  });

  it("show-deploy ignores known live deployments from another workspace", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
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
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps: vi.fn(),
          deployApp: vi.fn(),
          listDeployments: vi.fn(),
          showDeployment,
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    await context.stateStore.setRememberedProject({
      id: "proj_other",
      name: "Other Project",
      workspaceId: "ws_other",
    });
    await context.stateStore.setKnownLiveDeployment(
      "proj_other",
      "app_1",
      "dep_123",
    );

    const result = await runAppShowDeploy(context, "dep_123");

    expect(result.result.deployment.live).toBe(null);
  });

  it("show-deploy surfaces provider failures instead of reporting not found", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const showDeployment = vi
      .fn()
      .mockRejectedValue(new Error("Missing or invalid authorization token"));

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps: vi.fn(),
          deployApp: vi.fn(),
          listDeployments: vi.fn(),
          showDeployment,
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
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
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          deployApp: vi.fn(),
          listDeployments,
          promoteDeployment: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppOpen } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
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
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          deployApp: vi.fn(),
          listDeployments,
          promoteDeployment: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppOpen } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
      verboseContext: expectedAppVerboseContext(),
      app: {
        id: "app_1",
        name: "hello-world",
      },
      url: "https://hello-world.prisma.app",
      opened: false,
    });
  });

  it("open returns NO_DEPLOYMENTS when the selected app has not been deployed yet", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
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

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          deployApp: vi.fn(),
          listDeployments,
          promoteDeployment: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppOpen } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
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

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          deployApp: vi.fn(),
          listDeployments,
          promoteDeployment: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppOpen } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_2",
      },
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

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          promoteDeployment,
          deployApp: vi.fn(),
          listDeployments,
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppPromote } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
      verboseContext: expectedAppVerboseContext(),
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
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_2",
      },
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

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          promoteDeployment,
          deployApp: vi.fn(),
          listDeployments,
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppPromote } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
    expect(result.warnings).toEqual([
      "The selected deployment is already live for this app.",
    ]);
  });

  it("rollback chooses the previous deployment when no explicit target is provided", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_2",
      },
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

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          promoteDeployment,
          deployApp: vi.fn(),
          listDeployments,
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppRollback } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
      verboseContext: expectedAppVerboseContext(),
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
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: null,
      },
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

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          promoteDeployment,
          deployApp: vi.fn(),
          listDeployments,
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppRollback } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await context.stateStore.setKnownLiveDeployment(
      "proj_123",
      "app_1",
      "dep_1",
    );

    const result = await runAppRollback(context, "hello-world", undefined);

    expect(promoteDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "app_1",
        deploymentId: "dep_2",
      }),
    );
    expect(result.result.previousLiveDeploymentId).toBe("dep_1");
    await expect(
      context.stateStore.readKnownLiveDeployment("proj_123", "app_1"),
    ).resolves.toBe("dep_2");
  });

  it("rollback uses an explicit deployment target when provided", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_3",
      },
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

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          promoteDeployment,
          deployApp: vi.fn(),
          listDeployments,
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppRollback } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-west-3",
        liveDeploymentId: "dep_2",
      },
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

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          promoteDeployment: vi.fn(),
          deployApp: vi.fn(),
          listDeployments,
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppRollback } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
      runAppRollback(context, "hello-world", undefined),
    ).rejects.toMatchObject({
      code: "NO_PREVIOUS_DEPLOYMENT",
      domain: "app",
    });
  });

  it("does not reuse the wrong saved app when the resolved project changes", async () => {
    const requireComputeAuth = vi
      .fn()
      .mockResolvedValue(createProjectClient("proj_456"));
    const listApps = vi.fn().mockResolvedValue([]);
    const deployApp = vi
      .fn()
      .mockImplementation(async (options: { appName?: string }) => ({
        projectId: "proj_456",
        app: {
          id: "app_new",
          name: options.appName ?? "created-app",
          region: "eu-central-1",
          liveDeploymentId: "dep_123",
        },
        deployment: {
          id: "dep_123",
          status: "running",
          url: "https://created-app.prisma.app",
        },
      }));

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          deployApp,
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: false,
      env: {
        ...process.env,
        PRISMA_CLI_TEST_REMEMBER_PROJECT_ID: "proj_456",
        PRISMA_CLI_TEST_REMEMBER_PROJECT_NAME: "Billing API",
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await context.stateStore.setSelectedApp("proj_123", {
      id: "app_1",
      name: "hello-world",
    });

    await runAppDeploy(context, undefined, {
      projectRef: "proj_456",
      framework: "hono",
    });

    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_456",
        appName: path.basename(cwd),
      }),
    );
  });

  it("logs streams the live deployment for the selected app", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
      },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
      },
      deployments: [
        {
          id: "dep_old",
          status: "stopped",
          createdAt: "2026-05-01T00:00:00Z",
          url: null,
          live: null,
        },
        {
          id: "dep_live",
          status: "running",
          createdAt: "2026-05-02T00:00:00Z",
          url: "https://example.prisma.app",
          live: null,
        },
      ],
    });
    const streamDeploymentLogs = vi
      .fn()
      .mockImplementation(
        async (options: { onRecord(record: unknown): void }) => {
          options.onRecord({
            type: "log",
            text: "hello from live\n",
            byteStart: 0,
            byteEnd: 16,
          });
        },
      );

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          listDeployments,
          showDeployment: vi.fn(),
          streamDeploymentLogs,
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppLogs } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const stdout = context.output.stdout as unknown as { buffer: string };

    await runAppLogs(context, "hello-world", undefined);

    expect(streamDeploymentLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "dep_live",
        signal: context.runtime.signal,
      }),
    );
    expect(stdout.buffer).toBe("hello from live\n");
  });

  it("logs streams an explicit deployment for the selected app", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
      },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
      },
      deployments: [
        {
          id: "dep_old",
          status: "stopped",
          createdAt: "2026-05-01T00:00:00Z",
          url: null,
          live: null,
        },
        {
          id: "dep_live",
          status: "running",
          createdAt: "2026-05-02T00:00:00Z",
          url: "https://example.prisma.app",
          live: null,
        },
      ],
    });
    const streamDeploymentLogs = vi
      .fn()
      .mockImplementation(
        async (options: { onRecord(record: unknown): void }) => {
          options.onRecord({
            type: "log",
            text: "old log\n",
            byteStart: 0,
            byteEnd: 8,
          });
        },
      );

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          listDeployments,
          showDeployment: vi.fn(),
          streamDeploymentLogs,
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppLogs } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
    const stateDir = path.join(cwd, ".state");
    const { context, stdout } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await runAppLogs(context, "hello-world", "dep_old");

    expect(streamDeploymentLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "dep_old",
      }),
    );
    expect(stdout.buffer).toBe("old log\n");
  });

  it("logs rejects an explicit deployment that does not belong to the selected app", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
      },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
      },
      deployments: [
        {
          id: "dep_live",
          status: "running",
          createdAt: "2026-05-02T00:00:00Z",
          url: "https://example.prisma.app",
          live: null,
        },
      ],
    });
    const streamDeploymentLogs = vi.fn();

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          listDeployments,
          showDeployment: vi.fn(),
          streamDeploymentLogs,
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppLogs } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
      runAppLogs(context, "hello-world", "dep_other"),
    ).rejects.toMatchObject({
      code: "DEPLOYMENT_NOT_FOUND",
      domain: "app",
    });
    expect(streamDeploymentLogs).not.toHaveBeenCalled();
  });

  it("logs emits newline-delimited JSON events in --json mode", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
      },
    ]);
    const listDeployments = vi.fn().mockResolvedValue({
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
      },
      deployments: [
        {
          id: "dep_live",
          status: "running",
          createdAt: "2026-05-02T00:00:00Z",
          url: "https://example.prisma.app",
          live: null,
        },
      ],
    });
    const streamDeploymentLogs = vi
      .fn()
      .mockImplementation(
        async (options: { onRecord(record: unknown): void }) => {
          options.onRecord({
            type: "log",
            text: "json log\n",
            byteStart: 0,
            byteEnd: 9,
          });
          options.onRecord({
            type: "terminal",
            kind: "end",
            code: "done",
            message: "done",
            retryable: false,
            cursor: null,
          });
        },
      );

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          listApps,
          listDeployments,
          showDeployment: vi.fn(),
          streamDeploymentLogs,
        }),
      ),
    }));

    const { createTempCwd, executeCli } = await import("./helpers");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["app", "logs", "--app", "hello-world", "--json"],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_SERVICE_TOKEN: "token",
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const events = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      type: "log",
      command: "app.logs",
      data: {
        text: "json log\n",
      },
    });
    expect(events[1]).toMatchObject({
      type: "terminal",
      command: "app.logs",
    });
    expect(events[2]).toMatchObject({
      type: "success",
      command: "app.logs",
    });
  });

  it("remove deletes the selected app when --yes is passed", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_2",
      },
    ]);
    const removeApp = vi.fn().mockResolvedValue({
      id: "app_1",
      name: "hello-world",
    });

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          removeApp,
          promoteDeployment: vi.fn(),
          deployApp: vi.fn(),
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppRemove } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
    await context.stateStore.setKnownLiveDeployment(
      "proj_123",
      "app_1",
      "dep_2",
    );

    const result = await runAppRemove(context, "hello-world");

    expect(removeApp).toHaveBeenCalledWith("app_1", {
      signal: context.runtime.signal,
    });
    expect(result.result).toEqual({
      projectId: "proj_123",
      verboseContext: expectedAppVerboseContext(),
      app: {
        id: "app_1",
        name: "hello-world",
      },
      removed: true,
    });
    await expect(
      context.stateStore.readSelectedApp("proj_123"),
    ).resolves.toBeNull();
    await expect(
      context.stateStore.readKnownLiveDeployment("proj_123", "app_1"),
    ).resolves.toBeNull();
  });

  it("remove prompts for confirmation in interactive mode", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_2",
      },
    ]);
    const removeApp = vi.fn().mockResolvedValue({
      id: "app_1",
      name: "hello-world",
    });
    const textPrompt = vi.fn().mockResolvedValue("hello-world");

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/shell/prompt", async () => {
      const actual = await vi.importActual<
        typeof import("../src/shell/prompt")
      >("../src/shell/prompt");
      return {
        ...actual,
        textPrompt,
      };
    });
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          removeApp,
          promoteDeployment: vi.fn(),
          deployApp: vi.fn(),
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppRemove } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
    expect(removeApp).toHaveBeenCalledWith("app_1", {
      signal: context.runtime.signal,
    });
  });

  it("remove returns CONFIRMATION_REQUIRED in non-interactive mode without --yes", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_2",
      },
    ]);
    const removeApp = vi.fn();

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          removeApp,
          promoteDeployment: vi.fn(),
          deployApp: vi.fn(),
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppRemove } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_2",
      },
    ]);
    const removeApp = vi
      .fn()
      .mockRejectedValue(new Error("Resource Not Found"));

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          removeApp,
          promoteDeployment: vi.fn(),
          deployApp: vi.fn(),
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppRemove } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());
    const listApps = vi.fn().mockResolvedValue([
      {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_2",
      },
    ]);
    const removeApp = vi.fn().mockResolvedValue({
      id: "app_1",
      name: "hello-world",
    });

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/app-provider", () => ({
      createAppProvider: vi.fn(() =>
        withBranchDatabaseProviderDefaults({
          resolveBranch: createResolveBranch(),
          createProject: vi.fn(),
          listApps,
          removeApp,
          promoteDeployment: vi.fn(),
          deployApp: vi.fn(),
          listDeployments: vi.fn(),
          showDeployment: vi.fn(),
        }),
      ),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppRemove } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, { workspaceId: "ws_123", projectId: "proj_123" });
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

    vi.spyOn(context.stateStore, "clearSelectedApp").mockRejectedValue(
      new Error("disk full"),
    );
    vi.spyOn(context.stateStore, "clearKnownLiveDeployment").mockResolvedValue(
      await context.stateStore.read(),
    );

    const result = await runAppRemove(context, "hello-world");

    expect(result.warnings).toEqual([
      "The app was removed remotely, but the local selected app state could not be cleared: disk full",
    ]);
  });
});
