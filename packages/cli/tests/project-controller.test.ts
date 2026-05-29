import { readFile } from "node:fs/promises";
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
  it("returns PROJECT_UNRESOLVED when automatic resolution cannot choose a project", async () => {
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
    await expect(runProjectShow(context, undefined)).rejects.toMatchObject({
      code: "PROJECT_UNRESOLVED",
      domain: "project",
    });
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

    expect(createProject).toHaveBeenCalledWith({ name: "New Dashboard" });
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
});
