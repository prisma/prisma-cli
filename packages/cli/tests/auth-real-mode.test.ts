import path from "node:path";

import stripAnsi from "strip-ansi";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MockApi } from "../src/adapters/mock-api";
import {
  renderAuthSuccess,
  renderAuthWorkspaceList,
} from "../src/presenters/auth";
import { getCommandDescriptor } from "../src/shell/command-meta";

const fixturePath = path.resolve("fixtures/mock-api.json");

afterEach(() => {
  vi.doUnmock("../src/lib/auth/auth-ops");
  vi.doUnmock("@prisma/management-api-sdk");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("real auth mode", () => {
  it("uses real auth operations when fixture mode is not enabled", async () => {
    const performLogin = vi.fn().mockResolvedValue(undefined);
    const readAuthState = vi.fn().mockResolvedValue({
      authenticated: true,
      provider: null,
      user: {
        email: "real@example.com",
      },
      workspace: {
        id: "ws_real",
        name: "Real Workspace",
      },
    });
    const performLogout = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      performLogin,
      readAuthState,
      performLogout,
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAuthLogin } = await import("../src/controllers/auth");
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

    const result = await runAuthLogin(context, {});

    expect(performLogin).toHaveBeenCalledWith(
      context.runtime.env,
      context.runtime.signal,
    );
    expect(readAuthState).toHaveBeenCalledWith(
      context.runtime.env,
      context.runtime.signal,
    );
    expect(result.result).toMatchObject({
      authenticated: true,
      provider: null,
      workspace: {
        name: "Real Workspace",
      },
    });
  });

  it("does not let PRISMA_CLI_WORKSPACE_ID shadow the real auth login result", async () => {
    const performLogin = vi.fn().mockResolvedValue(undefined);
    const readAuthState = vi.fn().mockResolvedValue({
      authenticated: true,
      provider: null,
      user: {
        email: "real@example.com",
      },
      workspace: {
        id: "wksp_real",
        name: "Real Workspace",
      },
    });

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      performLogin,
      readAuthState,
      performLogout: vi.fn(),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAuthLogin } = await import("../src/controllers/auth");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
        PRISMA_CLI_WORKSPACE_ID: "wksp_old",
      },
    });

    const result = await runAuthLogin(context, {});

    expect(result.result).toMatchObject({
      authenticated: true,
      workspace: {
        id: "wksp_real",
        name: "Real Workspace",
      },
    });
    expect(result.nextSteps).toEqual([
      "PRISMA_CLI_WORKSPACE_ID=wksp_real prisma-cli auth whoami",
      "PRISMA_CLI_WORKSPACE_ID=wksp_real prisma-cli project list",
      "unset PRISMA_CLI_WORKSPACE_ID",
    ]);
    expect(performLogin).toHaveBeenCalledWith(
      context.runtime.env,
      context.runtime.signal,
    );
    const loginReadEnv = readAuthState.mock.calls[0]?.[0] as NodeJS.ProcessEnv;
    expect(loginReadEnv).not.toHaveProperty("PRISMA_CLI_WORKSPACE_ID");
    expect(readAuthState).toHaveBeenCalledWith(
      loginReadEnv,
      context.runtime.signal,
    );
    expect(context.runtime.env.PRISMA_CLI_WORKSPACE_ID).toBe("wksp_old");
  });

  it("does not let PRISMA_CLI_WORKSPACE_ID shadow the real auto-login result", async () => {
    const performLogin = vi.fn().mockResolvedValue(undefined);
    const readAuthState = vi
      .fn()
      .mockResolvedValueOnce({
        authenticated: false,
        provider: null,
        user: null,
        workspace: null,
        credential: null,
      })
      .mockResolvedValueOnce({
        authenticated: true,
        provider: null,
        user: {
          email: "real@example.com",
        },
        workspace: {
          id: "wksp_real",
          name: "Real Workspace",
        },
        credential: null,
      });

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      performLogin,
      readAuthState,
      performLogout: vi.fn(),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { requireAuthenticatedAuthState } = await import(
      "../src/controllers/auth"
    );
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: true,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
        PRISMA_CLI_WORKSPACE_ID: "wksp_old",
      },
    });

    const result = await requireAuthenticatedAuthState(context);

    expect(result).toMatchObject({
      authenticated: true,
      workspace: {
        id: "wksp_real",
        name: "Real Workspace",
      },
    });
    expect(readAuthState).toHaveBeenNthCalledWith(
      1,
      context.runtime.env,
      context.runtime.signal,
    );
    const reloginReadEnv = readAuthState.mock
      .calls[1]?.[0] as NodeJS.ProcessEnv;
    expect(reloginReadEnv).not.toHaveProperty("PRISMA_CLI_WORKSPACE_ID");
    expect(readAuthState).toHaveBeenNthCalledWith(
      2,
      reloginReadEnv,
      context.runtime.signal,
    );
  });

  it("stays in mock mode when fixture mode is enabled", async () => {
    const performLogin = vi.fn().mockResolvedValue(undefined);
    const readAuthState = vi.fn().mockResolvedValue(null);
    const performLogout = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      performLogin,
      readAuthState,
      performLogout,
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAuthLogin } = await import("../src/controllers/auth");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      fixturePath,
    });

    const result = await runAuthLogin(context, {
      provider: "github",
      user: "usr_456",
    });

    expect(performLogin).not.toHaveBeenCalled();
    expect(readAuthState).not.toHaveBeenCalled();
    expect(result.result).toMatchObject({
      authenticated: true,
      provider: "github",
      workspace: {
        name: "Acme Inc",
      },
    });
  });

  it("does not eagerly load fixtures in real mode", async () => {
    const loadSpy = vi.spyOn(MockApi, "load");
    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
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

    expect(loadSpy).not.toHaveBeenCalled();
    expect(() => context.api).toThrow(
      "context.api accessed in real mode. Set runtime.fixturePath or PRISMA_CLI_MOCK_FIXTURE_PATH to use fixture mode.",
    );
  });

  it("returns service-token identity in real auth JSON output", async () => {
    const readAuthState = vi.fn().mockResolvedValue({
      authenticated: true,
      provider: null,
      user: null,
      workspace: {
        id: "wksp_real",
        name: "Real Workspace",
      },
      credential: {
        type: "service_token",
        id: "itgr_ci",
        name: "ci-deploys-prod",
      },
    });

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      performLogin: vi.fn(),
      readAuthState,
      performLogout: vi.fn(),
    }));

    const { createTempCwd, executeCli } = await import("./helpers");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["auth", "whoami", "--json"],
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "auth.whoami",
      result: {
        authenticated: true,
        provider: null,
        user: null,
        workspace: {
          id: "wksp_real",
          name: "Real Workspace",
        },
        credential: {
          type: "service_token",
          id: "itgr_ci",
          name: "ci-deploys-prod",
        },
      },
      warnings: [],
      nextSteps: [],
      nextActions: [],
    });
  });

  it("lists cached OAuth workspaces while a service token is active", async () => {
    const readAuthState = vi.fn().mockResolvedValue({
      authenticated: true,
      provider: null,
      user: null,
      workspace: {
        id: "wksp_service",
        name: "Service Workspace",
      },
      credential: {
        type: "service_token",
        id: "itgr_ci",
        name: "ci-deploys-prod",
      },
    });

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      performLogin: vi.fn(),
      readAuthState,
      performLogout: vi.fn(),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { FileTokenStorage } = await import("../src/adapters/token-storage");
    const { runAuthWorkspaceList } = await import("../src/controllers/auth");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const authFilePath = path.join(cwd, "auth.json");
    const env = {
      ...process.env,
      PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
      PRISMA_SERVICE_TOKEN: "service-token",
      PRISMA_CLI_WORKSPACE_ID: "  ",
    };
    const storage = new FileTokenStorage(env);
    await storage.setTokens({
      workspaceId: "cmmxworkspace1",
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
    });
    await storage.rememberWorkspace("cmmxworkspace1", {
      id: "wksp_cmmxworkspace1",
      name: "Acme Inc",
    });
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env,
    });

    const result = await runAuthWorkspaceList(context);

    expect(result.result).toMatchObject({
      authSource: "service_token",
      activeWorkspace: {
        id: "wksp_service",
        name: "Service Workspace",
      },
      workspaces: [
        {
          id: "wksp_service",
          name: "Service Workspace",
          active: true,
          source: "service_token",
          switchable: false,
        },
        {
          id: "wksp_cmmxworkspace1",
          name: "Acme Inc",
          credentialWorkspaceId: "cmmxworkspace1",
          active: false,
          source: "oauth",
          switchable: false,
        },
      ],
    });
  });

  it("uses PRISMA_CLI_WORKSPACE_ID for real OAuth whoami without changing the stored active workspace", async () => {
    const get = vi.fn().mockImplementation((pathName: string) => {
      if (pathName === "/v1/me") {
        return {
          data: {
            data: {
              user: {
                id: "usr_123",
                email: "luan@example.com",
                name: "Luan",
              },
              workspace: {
                id: "wksp_cmmxworkspace2",
                name: "Prisma Labs",
              },
              credential: {
                type: "oauth",
                id: null,
                name: null,
              },
            },
          },
          response: { status: 200 },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    });

    vi.doMock("@prisma/management-api-sdk", () => ({
      AuthError: class SDKAuthError extends Error {},
      createManagementApiSdk: vi.fn().mockReturnValue({
        client: { GET: get },
      }),
    }));

    const { FileTokenStorage } = await import("../src/adapters/token-storage");
    const { createTempCwd, executeCli } = await import("./helpers");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const authFilePath = path.join(cwd, "auth.json");
    const baseEnv = {
      ...process.env,
      PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
      PRISMA_SERVICE_TOKEN: undefined,
    };
    const storage = new FileTokenStorage(baseEnv);
    await storage.setTokens({
      workspaceId: "cmmxworkspace1",
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
    });
    await storage.setTokens({
      workspaceId: "cmmxworkspace2",
      accessToken: "access-token-2",
      refreshToken: "refresh-token-2",
    });
    await storage.useWorkspace("cmmxworkspace1");

    const result = await executeCli({
      argv: ["auth", "whoami", "--json"],
      cwd,
      stateDir,
      env: {
        ...baseEnv,
        PRISMA_CLI_WORKSPACE_ID: "wksp_cmmxworkspace2",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "auth.whoami",
      result: {
        authenticated: true,
        workspace: {
          id: "wksp_cmmxworkspace2",
          name: "Prisma Labs",
        },
      },
    });
    await expect(storage.getTokens()).resolves.toMatchObject({
      workspaceId: "cmmxworkspace1",
    });
  });

  it("marks PRISMA_CLI_WORKSPACE_ID as active in the real OAuth workspace list without changing local context", async () => {
    const { FileTokenStorage } = await import("../src/adapters/token-storage");
    const { createTempCwd, executeCli } = await import("./helpers");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const authFilePath = path.join(cwd, "auth.json");
    const baseEnv = {
      ...process.env,
      PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
      PRISMA_SERVICE_TOKEN: undefined,
    };
    const storage = new FileTokenStorage(baseEnv);
    await storage.setTokens({
      workspaceId: "cmmxworkspace1",
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
    });
    await storage.setTokens({
      workspaceId: "cmmxworkspace2",
      accessToken: "access-token-2",
      refreshToken: "refresh-token-2",
    });
    await storage.rememberWorkspace("cmmxworkspace1", {
      id: "wksp_cmmxworkspace1",
      name: "Acme Inc",
    });
    await storage.rememberWorkspace("cmmxworkspace2", {
      id: "wksp_cmmxworkspace2",
      name: "Prisma Labs",
    });
    await storage.useWorkspace("wksp_cmmxworkspace1");

    const result = await executeCli({
      argv: ["auth", "workspace", "list", "--json"],
      cwd,
      stateDir,
      env: {
        ...baseEnv,
        PRISMA_CLI_WORKSPACE_ID: "wksp_cmmxworkspace2",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "auth.workspace.list",
      result: {
        context: {
          authSource: "oauth",
          activeWorkspaceId: "wksp_cmmxworkspace2",
          activeWorkspaceName: "Prisma Labs",
        },
        items: [
          expect.objectContaining({
            id: "wksp_cmmxworkspace1",
            status: null,
          }),
          expect.objectContaining({
            id: "wksp_cmmxworkspace2",
            status: "active",
          }),
        ],
      },
    });
    await expect(storage.getTokens()).resolves.toMatchObject({
      workspaceId: "cmmxworkspace1",
    });
  });

  it("hydrates placeholder OAuth workspace metadata before rendering the workspace list", async () => {
    const getWorkspace = vi.fn().mockResolvedValue({
      data: {
        data: {
          id: "wksp_acme",
          name: "Acme Inc",
        },
      },
      response: { status: 200 },
    });

    vi.doMock("@prisma/management-api-sdk", () => ({
      AuthError: class SDKAuthError extends Error {},
      createManagementApiSdk: vi.fn().mockReturnValue({
        client: { GET: getWorkspace },
      }),
    }));

    const { FileTokenStorage } = await import("../src/adapters/token-storage");
    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAuthWorkspaceList } = await import("../src/controllers/auth");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const authFilePath = path.join(cwd, "auth.json");
    const env = {
      ...process.env,
      PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
      PRISMA_SERVICE_TOKEN: undefined,
    };
    const storage = new FileTokenStorage(env);
    await storage.setTokens({
      workspaceId: "cmmxlp7ae1251zyfs8mdpnavm",
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env,
    });

    const result = await runAuthWorkspaceList(context);
    const output = stripAnsi(
      renderAuthWorkspaceList(
        context,
        getCommandDescriptor("auth.workspace.list"),
        result.result,
      ).join("\n"),
    );

    expect(getWorkspace).toHaveBeenCalledWith(
      "/v1/workspaces/{id}",
      expect.objectContaining({
        params: {
          path: { id: "cmmxlp7ae1251zyfs8mdpnavm" },
        },
      }),
    );
    expect(result.result.workspaces).toEqual([
      expect.objectContaining({
        id: "wksp_acme",
        name: "Acme Inc",
        credentialWorkspaceId: "cmmxlp7ae1251zyfs8mdpnavm",
        active: true,
      }),
    ]);
    expect(output).toContain("Acme Inc  wksp_acme  active");
    expect(output).not.toContain(
      "cmmxlp7ae1251zyfs8mdpnavm  cmmxlp7ae1251zyfs8mdpnavm",
    );
    await expect(storage.listWorkspaces()).resolves.toEqual([
      expect.objectContaining({
        id: "wksp_acme",
        name: "Acme Inc",
      }),
    ]);
  });

  it("keeps unresolved OAuth workspace sessions listable without using the credential id as the display name", async () => {
    vi.doMock("@prisma/management-api-sdk", () => ({
      AuthError: class SDKAuthError extends Error {},
      createManagementApiSdk: vi.fn().mockReturnValue({
        client: {
          GET: vi.fn().mockResolvedValue({
            data: null,
            response: { status: 404 },
          }),
        },
      }),
    }));

    const { FileTokenStorage } = await import("../src/adapters/token-storage");
    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAuthWorkspaceList } = await import("../src/controllers/auth");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const authFilePath = path.join(cwd, "auth.json");
    const env = {
      ...process.env,
      PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
      PRISMA_SERVICE_TOKEN: undefined,
    };
    const storage = new FileTokenStorage(env);
    await storage.setTokens({
      workspaceId: "cmmxlp7ae1251zyfs8mdpnavm",
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env,
    });

    const result = await runAuthWorkspaceList(context);
    const output = stripAnsi(
      renderAuthWorkspaceList(
        context,
        getCommandDescriptor("auth.workspace.list"),
        result.result,
      ).join("\n"),
    );

    expect(result.result.workspaces).toEqual([
      expect.objectContaining({
        id: "cmmxlp7ae1251zyfs8mdpnavm",
        name: "Unknown workspace",
        credentialWorkspaceId: "cmmxlp7ae1251zyfs8mdpnavm",
      }),
    ]);
    expect(output).toContain(
      "Unknown workspace  cmmxlp7ae1251zyfs8mdpnavm  active",
    );
    expect(output).not.toContain(
      "cmmxlp7ae1251zyfs8mdpnavm  cmmxlp7ae1251zyfs8mdpnavm",
    );
  });

  it("uses hydrated OAuth workspace names in the interactive workspace picker", async () => {
    const workspaces = new Map([
      [
        "cmmxworkspace1",
        {
          id: "wksp_workspace1",
          name: "Acme Inc",
        },
      ],
      [
        "cmmxworkspace2",
        {
          id: "wksp_workspace2",
          name: "Prisma Labs",
        },
      ],
    ]);
    const getWorkspace = vi
      .fn()
      .mockImplementation(
        (
          _pathName: string,
          request?: { params?: { path?: { id?: string } } },
        ) => ({
          data: {
            data: workspaces.get(request?.params?.path?.id ?? ""),
          },
          response: { status: 200 },
        }),
      );

    vi.doMock("@prisma/management-api-sdk", () => ({
      AuthError: class SDKAuthError extends Error {},
      createManagementApiSdk: vi.fn().mockReturnValue({
        client: { GET: getWorkspace },
      }),
    }));

    const { FileTokenStorage } = await import("../src/adapters/token-storage");
    const { createTempCwd, executeCli } = await import("./helpers");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const authFilePath = path.join(cwd, "auth.json");
    const env = {
      ...process.env,
      PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
      PRISMA_SERVICE_TOKEN: undefined,
    };
    const storage = new FileTokenStorage(env);
    await storage.setTokens({
      workspaceId: "cmmxworkspace1",
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
    });
    await storage.setTokens({
      workspaceId: "cmmxworkspace2",
      accessToken: "access-token-2",
      refreshToken: "refresh-token-2",
    });
    await storage.useWorkspace("cmmxworkspace1");

    const result = await executeCli({
      argv: ["auth", "workspace", "use"],
      cwd,
      stateDir,
      env,
      isTTY: true,
      stdinText: "\u001B[B\r",
    });
    const stderr = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(stderr).toContain("Acme Inc (wksp_workspace1) active");
    expect(stderr).toContain("Prisma Labs (wksp_workspace2)");
    expect(stderr).not.toContain("cmmxworkspace1 (cmmxworkspace1)");
    await expect(storage.getTokens()).resolves.toMatchObject({
      workspaceId: "cmmxworkspace2",
    });
  });

  it("omits empty provider and workspace rows in auth output", async () => {
    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      fixturePath,
    });

    const output = renderAuthSuccess(
      context,
      getCommandDescriptor("auth.login"),
      "auth.login",
      {
        authenticated: true,
        provider: null,
        user: {
          email: "real@example.com",
        },
        workspace: null,
        credential: null,
      },
    ).join("");

    const plain = stripAnsi(output);

    expect(plain).toContain("user:");
    expect(plain).not.toContain("provider:");
    expect(plain).not.toContain("workspace:");
  });

  it("omits the user row when a real auth state has no email", async () => {
    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      fixturePath,
    });

    const output = renderAuthSuccess(
      context,
      getCommandDescriptor("auth.whoami"),
      "auth.whoami",
      {
        authenticated: true,
        provider: null,
        user: null,
        workspace: {
          id: "ws_real",
          name: "Real Workspace",
        },
        credential: null,
      },
    ).join("");

    const plain = stripAnsi(output);

    expect(plain).toContain("status:     signed in");
    expect(plain).not.toContain("user:");
    expect(plain).not.toContain("<>");
  });

  it("shows service-token identity when no human user is present", async () => {
    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      fixturePath,
    });

    const output = renderAuthSuccess(
      context,
      getCommandDescriptor("auth.whoami"),
      "auth.whoami",
      {
        authenticated: true,
        provider: null,
        user: null,
        workspace: {
          id: "wksp_real",
          name: "Real Workspace",
        },
        credential: {
          type: "service_token",
          id: "itgr_ci",
          name: "ci-deploys-prod",
        },
      },
    ).join("");

    const plain = stripAnsi(output);

    expect(plain).toContain("status:     signed in");
    expect(plain).toContain("user:       <service token: ci-deploys-prod>");
    expect(plain).toContain("workspace:  Real Workspace");
  });
});
