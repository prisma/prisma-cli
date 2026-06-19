import path from "node:path";

import stripAnsi from "strip-ansi";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MockApi } from "../src/adapters/mock-api";
import { renderAuthSuccess } from "../src/presenters/auth";
import { getCommandDescriptor } from "../src/shell/command-meta";

const fixturePath = path.resolve("fixtures/mock-api.json");

afterEach(() => {
  vi.doUnmock("../src/lib/auth/auth-ops");
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
