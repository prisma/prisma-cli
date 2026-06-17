import { writeFile } from "node:fs/promises";
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
  vi.doUnmock("../src/lib/app/app-provider");
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

function createResolveBranch(role: "preview" | "production" = "preview") {
  return vi
    .fn()
    .mockImplementation((_projectId: string, options: { branchName: string }) =>
      Promise.resolve({
        id: `branch_${options.branchName.replace(/[^a-z0-9]+/gi, "_")}`,
        name: options.branchName,
        role,
      }),
    );
}

describe("app env vars", () => {
  it("parses dotenv file contents without expanding values", async () => {
    const { parseEnvFileContents } = await import("../src/lib/app/env-file");

    expect(
      parseEnvFileContents(
        [
          "# local settings",
          "API_URL=https://api.example",
          'QUOTED="hello world"',
          "export FEATURE_FLAG=enabled",
          "LITERAL=$" + "{API_URL}/v1",
        ].join("\n"),
        ".env",
        "add",
      ),
    ).toEqual([
      { key: "API_URL", value: "https://api.example" },
      { key: "QUOTED", value: "hello world" },
      { key: "FEATURE_FLAG", value: "enabled" },
      { key: "LITERAL", value: "$" + "{API_URL}/v1" },
    ]);
  });

  it("parses multiline dotenv values without treating nested KEY= text as assignments", async () => {
    const { parseEnvFileContents } = await import("../src/lib/app/env-file");

    expect(
      parseEnvFileContents(
        [
          'CERT="-----BEGIN CERT-----',
          "API_URL=https://inside.example",
          '-----END CERT-----"',
          "API_URL=https://api.example",
        ].join("\n"),
        ".env",
        "add",
      ),
    ).toEqual([
      {
        key: "CERT",
        value:
          "-----BEGIN CERT-----\nAPI_URL=https://inside.example\n-----END CERT-----",
      },
      { key: "API_URL", value: "https://api.example" },
    ]);
  });

  it("rejects invalid dotenv file entries without leaking values", async () => {
    const { parseEnvFileContents } = await import("../src/lib/app/env-file");

    expect(() =>
      parseEnvFileContents(
        "API_URL=https://first\nAPI_URL=https://second\n",
        ".env",
        "add",
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "USAGE_ERROR",
        summary: 'Duplicate environment variable "API_URL" in ".env"',
      }),
    );

    expect(() =>
      parseEnvFileContents("lowercase-key=secret\n", ".env", "add"),
    ).toThrowError(
      expect.objectContaining({
        code: "USAGE_ERROR",
        summary: 'Invalid environment variable "lowercase-key" in ".env"',
      }),
    );

    const longKey = `A${"B".repeat(256)}`;
    expect(() =>
      parseEnvFileContents(`${longKey}=secret\n`, ".env", "add"),
    ).toThrowError(
      expect.objectContaining({
        code: "USAGE_ERROR",
        why: expect.stringContaining("exceeds the 256-character limit"),
      }),
    );

    let emptyValueError: unknown;
    try {
      parseEnvFileContents("EMPTY=\n", ".env", "add");
    } catch (error) {
      emptyValueError = error;
    }

    expect(emptyValueError).toMatchObject({
      code: "USAGE_ERROR",
      summary: 'Environment variable "EMPTY" in ".env" has an empty value',
    });
    expect(JSON.stringify(emptyValueError)).not.toContain("secret");
  });

  it("parses repeated env assignments", async () => {
    const { parseEnvAssignments } = await import("../src/lib/app/env-vars");

    expect(
      parseEnvAssignments(
        ["DATABASE_URL=postgresql://example", "TOKEN=value=with=equals"],
        { commandName: "deploy" },
      ),
    ).toEqual({
      DATABASE_URL: "postgresql://example",
      TOKEN: "value=with=equals",
    });
  });

  it("parses deploy env inputs from assignments and dotenv files", async () => {
    const { createTempCwd } = await import("./helpers");
    const { parseEnvInputs } = await import("../src/lib/app/env-vars");
    const cwd = await createTempCwd();
    await writeFile(
      path.join(cwd, ".env"),
      ["DATABASE_URL=postgresql://example", "FEATURE_FLAG=enabled"].join("\n"),
    );

    await expect(
      parseEnvInputs(cwd, [".env", "INLINE_FLAG=enabled"], {
        commandName: "deploy",
      }),
    ).resolves.toEqual({
      DATABASE_URL: "postgresql://example",
      FEATURE_FLAG: "enabled",
      INLINE_FLAG: "enabled",
    });
  });

  it("rejects invalid env assignments without leaking values", async () => {
    const { parseEnvAssignments } = await import("../src/lib/app/env-vars");

    expect(() =>
      parseEnvAssignments(["DATABASE_URL"], { commandName: "deploy" }),
    ).toThrowError(
      expect.objectContaining({
        code: "USAGE_ERROR",
        summary: "Environment variable assignment must use NAME=VALUE",
      }),
    );
    expect(() =>
      parseEnvAssignments(["=secret"], { commandName: "deploy" }),
    ).toThrowError(
      expect.objectContaining({
        code: "USAGE_ERROR",
        summary: "Environment variable name is required",
      }),
    );
    expect(() =>
      parseEnvAssignments(["lowercase-key=secret"], { commandName: "deploy" }),
    ).toThrowError(
      expect.objectContaining({
        code: "USAGE_ERROR",
        summary: 'Invalid environment variable "lowercase-key"',
        why: expect.stringContaining("must match the POSIX env-var shape"),
      }),
    );
    expect(() =>
      parseEnvAssignments(["EMPTY="], { commandName: "deploy" }),
    ).toThrowError(
      expect.objectContaining({
        code: "USAGE_ERROR",
        summary: 'Environment variable "EMPTY" has an empty value',
      }),
    );

    expect(() =>
      parseEnvAssignments(
        ["DATABASE_URL=postgresql://first", "DATABASE_URL=postgresql://second"],
        { commandName: "deploy" },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "USAGE_ERROR",
        summary:
          'Environment variable "DATABASE_URL" was provided more than once',
      }),
    );
    expect(() =>
      parseEnvAssignments(
        ["DATABASE_URL=postgresql://first", "DATABASE_URL=postgresql://second"],
        { commandName: "deploy" },
      ),
    ).toThrowError(expect.not.stringContaining("postgresql://first"));
    expect(() =>
      parseEnvAssignments(
        ["DATABASE_URL=postgresql://first", "DATABASE_URL=postgresql://second"],
        { commandName: "deploy" },
      ),
    ).toThrowError(expect.not.stringContaining("postgresql://second"));
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

  it("project env list requires explicit or durable Project binding", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue(createProjectClient());

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runEnvList } = await import("../src/controllers/app-env");
    const cwd = await createTempCwd();
    await writeFile(
      path.join(cwd, "package.json"),
      `${JSON.stringify({ name: "acme-dashboard" }, null, 2)}\n`,
    );
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(runEnvList(context, {})).rejects.toMatchObject({
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
          "prisma-cli project env list --project <id-or-name>",
        ]),
      },
      nextActions: expect.arrayContaining([
        expect.objectContaining({
          kind: "user-choice",
          journey: "project-setup",
        }),
      ]),
    });
  });

  it("project env list uses an explicit Project", async () => {
    const client = {
      token: "token",
      GET: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/projects") {
          return createProjectClient().GET(pathName);
        }
        if (pathName === "/v1/environment-variables") {
          return {
            data: {
              data: [],
              pagination: {
                hasMore: false,
                nextCursor: null,
              },
            },
          };
        }
        throw new Error(`Unexpected path ${pathName}`);
      }),
    };
    const requireComputeAuth = vi.fn().mockResolvedValue(client);

    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runEnvList } = await import("../src/controllers/app-env");
    const cwd = await createTempCwd();
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

    const result = await runEnvList(context, { projectRef: "proj_123" });

    expect(result.result).toMatchObject({
      projectId: "proj_123",
      variables: [],
    });
  });

  it("parses project env add --file through the CLI command layer", async () => {
    const runEnvAdd = vi.fn().mockResolvedValue({
      command: "project.env.add",
      result: {
        projectId: "proj_123",
        scope: { kind: "role", role: "preview" },
        variables: [
          {
            id: "envvar_api",
            key: "API_URL",
            scope: { kind: "role", role: "preview" },
            source: "preview",
            isManagedBySystem: false,
            updatedAt: "2026-05-08T10:00:00.000Z",
          },
        ],
        file: {
          path: ".env",
          count: 1,
        },
      },
      warnings: [],
      nextSteps: [],
    });

    vi.doMock("../src/controllers/app-env", async () => {
      const actual = await vi.importActual<
        typeof import("../src/controllers/app-env")
      >("../src/controllers/app-env");
      return {
        ...actual,
        runEnvAdd,
      };
    });

    const { createTempCwd, executeCli } = await import("./helpers");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: [
        "project",
        "env",
        "add",
        "--file",
        ".env",
        "--role",
        "preview",
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
      command: "project.env.add",
      result: {
        file: {
          path: ".env",
          count: 1,
        },
        variables: [
          {
            key: "API_URL",
          },
        ],
      },
    });
    expect(runEnvAdd).toHaveBeenCalledWith(expect.anything(), undefined, {
      roleName: "preview",
      branchName: undefined,
      projectRef: "proj_123",
      filePath: ".env",
    });
  });

  it("passes env vars to provider deploy without surfacing values", async () => {
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
      createAppProvider: vi.fn(() => ({
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
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAppDeploy } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    await writeFile(path.join(cwd, ".env"), "FEATURE_FLAG=enabled\n");
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
      envAssignments: [
        "DATABASE_URL=postgresql://example",
        ".env",
        "INLINE_FLAG=enabled",
      ],
    });

    expect(deployApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_123",
        appId: "app_1",
        envVars: {
          DATABASE_URL: "postgresql://example",
          FEATURE_FLAG: "enabled",
          INLINE_FLAG: "enabled",
        },
      }),
    );
    expect(JSON.stringify(result.result)).not.toContain("postgresql://example");
    expect(JSON.stringify(result.result)).not.toContain("enabled");
  });

  it("parses deploy build, port, prod, explicit project, and JSON output through the CLI command layer", async () => {
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
        deploySettings: {
          config: {
            path: null,
            status: "inferred",
          },
          buildCommand: {
            value: "bun run build",
            source: null,
          },
          outputDirectory: {
            value: ".next/standalone",
            source: null,
          },
          framework: {
            key: "nextjs",
            buildType: "nextjs",
            name: "Next.js",
            source: "explicit",
          },
          entrypoint: null,
          httpPort: 3000,
          region: null,
          envVars: ["DATABASE_URL"],
        },
      },
      warnings: [],
      nextSteps: ["prisma-cli app list-deploys"],
    });

    vi.doMock("../src/controllers/app", async () => {
      const actual = await vi.importActual<
        typeof import("../src/controllers/app")
      >("../src/controllers/app");
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
        "--framework",
        "nextjs",
        "--http-port",
        "3000",
        "--env",
        "DATABASE_URL=postgresql://example",
        "--project",
        "proj_123",
        "--prod",
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
        deploySettings: {
          config: {
            path: null,
            status: "inferred",
          },
          buildCommand: {
            value: "bun run build",
            source: null,
          },
          outputDirectory: {
            value: ".next/standalone",
            source: null,
          },
        },
      },
    });
    expect(runAppDeploy).toHaveBeenCalledWith(
      expect.anything(),
      "hello-world",
      {
        entrypoint: undefined,
        framework: "nextjs",
        httpPort: "3000",
        envAssignments: ["DATABASE_URL=postgresql://example"],
        projectRef: "proj_123",
        prod: true,
      },
    );
  });
});
