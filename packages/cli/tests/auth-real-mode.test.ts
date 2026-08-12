import path from "node:path";

import stripAnsi from "strip-ansi";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderAuthWorkspaceList } from "../src/presenters/auth";
import { getCommandDescriptor } from "../src/shell/command-meta";

afterEach(() => {
  vi.doUnmock("../src/auth/operations");
  vi.doUnmock("@prisma/management-api-sdk");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("real auth mode", () => {
  it("uses real auth operations when fixture mode is not enabled", async () => {
    const performLogin = vi.fn().mockResolvedValue({
      token: "real-mode-access-token",
      refreshToken: undefined,
      expiresAt: undefined,
    });
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

    vi.doMock("../src/auth/operations", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth/operations")>()),
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
      },
    });

    const result = await runAuthLogin(context);

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

    vi.doMock("../src/auth/operations", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth/operations")>()),
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

    vi.doMock("../src/auth/operations", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/auth/operations")>()),
      performLogin: vi.fn(),
      readAuthState,
      performLogout: vi.fn(),
    }));

    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { FileTokenStorage } = await import("../src/auth/token-storage");
    const { runAuthWorkspaceList } = await import("../src/controllers/auth");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const authFilePath = path.join(cwd, "auth.json");
    const env = {
      ...process.env,
      PRISMA_COMPUTE_AUTH_FILE: authFilePath,
      PRISMA_SERVICE_TOKEN: "service-token",
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

    const { FileTokenStorage } = await import("../src/auth/token-storage");
    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAuthWorkspaceList } = await import("../src/controllers/auth");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const authFilePath = path.join(cwd, "auth.json");
    const env = {
      ...process.env,
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

    const { FileTokenStorage } = await import("../src/auth/token-storage");
    const { createTempCwd, createTestCommandContext } = await import(
      "./helpers"
    );
    const { runAuthWorkspaceList } = await import("../src/controllers/auth");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const authFilePath = path.join(cwd, "auth.json");
    const env = {
      ...process.env,
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

    const { FileTokenStorage } = await import("../src/auth/token-storage");
    const { createTempCwd, executeCli } = await import("./helpers");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const authFilePath = path.join(cwd, "auth.json");
    const env = {
      ...process.env,
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
});
