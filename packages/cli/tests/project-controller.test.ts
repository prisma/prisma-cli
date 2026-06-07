import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTempCwd, createTestCommandContext } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

afterEach(() => {
  vi.doUnmock("../src/lib/auth/auth-ops");
  vi.doUnmock("../src/lib/auth/guard");
  vi.doUnmock("../src/lib/app/preview-provider");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("project controller", () => {
  it("returns an unbound binding inspection when no durable Project source exists", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    await context.stateStore.setAuthSession({
      provider: "github",
      userId: "usr_456",
      workspaceId: "ws_123",
    });

    const { runProjectShow } = await import("../src/controllers/project");
    const result = await runProjectShow(context, undefined);

    expect(result.result).toMatchObject({
      project: null,
      resolution: {
        projectSource: "unbound",
      },
      localBinding: {
        status: "not-linked",
      },
      candidates: [],
      recoveryCommands: [
        "prisma-cli project link <id-or-name>",
        "prisma-cli project show --project <id-or-name>",
      ],
    });
    expect(result.nextActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "user-choice",
        journey: "project-setup",
      }),
    ]));
  });

  it("links an existing project and writes the local pin", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    await context.stateStore.setAuthSession({
      provider: "github",
      userId: "usr_456",
      workspaceId: "ws_123",
    });

    const { runProjectLink } = await import("../src/controllers/project");
    const result = await runProjectLink(context, "proj_123");

    expect(result.result).toMatchObject({
      project: {
        id: "proj_123",
        name: "Acme Dashboard",
      },
      localPin: {
        path: ".prisma/local.json",
        written: true,
      },
      action: "linked",
    });
    await expect(readFile(path.join(cwd, ".prisma/local.json"), "utf8")).resolves.toContain('"projectId": "proj_123"');
    await expect(readFile(path.join(cwd, ".gitignore"), "utf8")).resolves.toBe(".prisma/\n");
  });

  it("creates a project and writes the local pin", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const createProject = vi.fn().mockResolvedValue({
      id: "proj_new",
      name: "New Dashboard",
    });

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
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject,
      })),
    }));

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

    const { runProjectCreate } = await import("../src/controllers/project");
    const result = await runProjectCreate(context, "New Dashboard");

    expect(createProject).toHaveBeenCalledWith({
      name: "New Dashboard",
      signal: context.runtime.signal,
    });
    expect(result.result).toMatchObject({
      project: {
        id: "proj_new",
        name: "New Dashboard",
      },
      localPin: {
        path: ".prisma/local.json",
        written: true,
      },
      action: "created",
    });
    await expect(readFile(path.join(cwd, ".prisma/local.json"), "utf8")).resolves.toContain('"projectId": "proj_new"');
    await expect(readFile(path.join(cwd, ".gitignore"), "utf8")).resolves.toBe(".prisma/\n");
  });

  it("bare project link can create a new project from the interactive setup picker", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue({
      token: "token",
      GET: vi.fn().mockResolvedValue({
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
      }),
    });
    const createProject = vi.fn().mockResolvedValue({
      id: "proj_new",
      name: "Interactive Project",
    });

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
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject,
      })),
    }));

    const cwd = await createTempCwd();
    await writeFile(path.join(cwd, "package.json"), `${JSON.stringify({ name: "suggested-name" }, null, 2)}\n`, "utf8");
    const stateDir = path.join(cwd, ".state");
    const { context, stderr } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: true,
      stdinText: "\u001B[B\rInteractive Project\r",
      env: {
        ...process.env,
        PRISMA_CLI_TEST_REMEMBER_PROJECT_ID: "",
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    const { runProjectLink } = await import("../src/controllers/project");
    const result = await runProjectLink(context, undefined);

    expect(createProject).toHaveBeenCalledWith({
      name: "Interactive Project",
      signal: context.runtime.signal,
    });
    expect(result.result).toMatchObject({
      project: {
        id: "proj_new",
        name: "Interactive Project",
      },
      localPin: {
        path: ".prisma/local.json",
        written: true,
      },
      action: "created",
    });
    await expect(readFile(path.join(cwd, ".prisma/local.json"), "utf8")).resolves.toContain('"projectId": "proj_new"');
    expect(stderr.buffer).toContain("Which Project should this directory use?");
    expect(stderr.buffer).toContain("Project name");
    expect(stderr.buffer).toContain("suggested-name");
  });

  it("deletes an existing project by name with --yes flag, clearing the local pin", async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        data: [
          { id: "proj_123", name: "Acme Dashboard", workspace: { id: "ws_123", name: "Acme Inc" } },
        ],
      },
    });
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token", GET: get });
    const deleteProject = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState: vi.fn().mockResolvedValue({
        authenticated: true,
        provider: null,
        user: { email: "test@example.com" },
        workspace: { id: "ws_123", name: "Acme Inc" },
      }),
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({ deleteProject })),
    }));

    const cwd = await createTempCwd();
    await mkdir(path.join(cwd, ".prisma"), { recursive: true });
    await writeFile(path.join(cwd, ".prisma", "local.json"), JSON.stringify({ workspaceId: "ws_123", projectId: "proj_123" }), "utf8");
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      flags: { yes: true },
      isTTY: false,
      env: { ...process.env, PRISMA_CLI_MOCK_FIXTURE_PATH: undefined },
    });

    await context.stateStore.setAuthSession({
      provider: "github",
      userId: "usr_456",
      workspaceId: "ws_123",
    });

    const { runProjectDelete } = await import("../src/controllers/project");
    const result = await runProjectDelete(context, "Acme Dashboard");

    expect(deleteProject).toHaveBeenCalledWith({
      projectId: "proj_123",
      signal: context.runtime.signal,
    });
    expect(result.result).toMatchObject({
      project: { id: "proj_123", name: "Acme Dashboard" },
    });
    await expect(readFile(path.join(cwd, ".prisma", "local.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns PROJECT_NOT_FOUND when deleting a non-existent project", async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        data: [
          { id: "proj_123", name: "Acme Dashboard", workspace: { id: "ws_123", name: "Acme Inc" } },
        ],
      },
    });
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token", GET: get });
    const deleteProject = vi.fn();

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState: vi.fn().mockResolvedValue({
        authenticated: true,
        provider: null,
        user: { email: "test@example.com" },
        workspace: { id: "ws_123", name: "Acme Inc" },
      }),
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({ deleteProject })),
    }));

    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: false,
      env: { ...process.env, PRISMA_CLI_MOCK_FIXTURE_PATH: undefined },
    });

    await context.stateStore.setAuthSession({
      provider: "github",
      userId: "usr_456",
      workspaceId: "ws_123",
    });

    const { runProjectDelete } = await import("../src/controllers/project");
    await expect(runProjectDelete(context, "NonExistent")).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
      domain: "project",
      summary: "Project not found",
    });
  });

  it("returns PROJECT_DELETE_FAILED when the management API errors", async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        data: [
          { id: "proj_123", name: "Acme Dashboard", workspace: { id: "ws_123", name: "Acme Inc" } },
        ],
      },
    });
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token", GET: get });
    const deleteProject = vi.fn().mockRejectedValue(new Error("Internal Server Error (HTTP 503)"));

    vi.doMock("../src/lib/auth/auth-ops", () => ({
      readAuthState: vi.fn().mockResolvedValue({
        authenticated: true,
        provider: null,
        user: { email: "test@example.com" },
        workspace: { id: "ws_123", name: "Acme Inc" },
      }),
      performLogin: vi.fn(),
      performLogout: vi.fn(),
    }));
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({ deleteProject })),
    }));

    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      isTTY: false,
      env: { ...process.env, PRISMA_CLI_MOCK_FIXTURE_PATH: undefined },
    });

    await context.stateStore.setAuthSession({
      provider: "github",
      userId: "usr_456",
      workspaceId: "ws_123",
    });

    const { runProjectDelete } = await import("../src/controllers/project");
    await expect(runProjectDelete(context, "Acme Dashboard")).rejects.toMatchObject({
      code: "PROJECT_DELETE_FAILED",
      domain: "project",
      summary: expect.stringContaining('Could not delete Project "Acme Dashboard"'),
    });
  });

  it("returns PROJECT_CREATE_FAILED when project creation fails", async () => {
    const requireComputeAuth = vi.fn().mockResolvedValue({ token: "token" });
    const createProject = vi.fn().mockRejectedValue(new Error("Internal Server Error (HTTP 503)"));

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
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth,
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        createProject,
      })),
    }));

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

    const { runProjectCreate } = await import("../src/controllers/project");
    await expect(runProjectCreate(context, "New Dashboard")).rejects.toMatchObject({
      code: "PROJECT_CREATE_FAILED",
      domain: "project",
      summary: 'Could not create Project "New Dashboard"',
      why: expect.stringContaining("Internal Server Error"),
      nextSteps: expect.arrayContaining(["prisma-cli project link <id-or-name>"]),
    });
  });
});
