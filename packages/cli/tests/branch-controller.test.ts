import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTempCwd, createTestCommandContext } from "./helpers";

afterEach(() => {
  vi.doUnmock("../src/lib/auth/auth-ops");
  vi.doUnmock("../src/lib/auth/guard");
  vi.doUnmock("../src/lib/app/preview-provider");
  vi.resetModules();
  vi.restoreAllMocks();
});

function createMockClient() {
  return {
    GET: vi.fn().mockImplementation((pathName: string, request?: { params?: { query?: { cursor?: string } } }) => {
      if (pathName === "/v1/projects") {
        return {
          data: {
            data: [
              {
                id: "proj_123",
                name: "Acme Dashboard",
                slug: "acme-dashboard",
                workspace: { id: "ws_123", name: "Acme Inc" },
              },
            ],
          },
          response: { status: 200 },
        };
      }

      if (pathName === "/v1/projects/{projectId}/branches") {
        const cursor = request?.params?.query?.cursor;
        if (cursor === "cursor_2") {
          return {
            data: {
              data: [
                { id: "br_main", gitName: "main", role: "production" },
              ],
              pagination: { hasMore: false, nextCursor: null },
            },
            response: { status: 200 },
          };
        }

        return {
          data: {
            data: [
              { id: "br_feature", gitName: "feature/auth", role: "preview" },
            ],
            pagination: { hasMore: true, nextCursor: "cursor_2" },
          },
          response: { status: 200 },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    }),
    POST: vi.fn(),
    DELETE: vi.fn(),
    PATCH: vi.fn(),
  };
}

async function writeLocalPin(cwd: string, projectId = "proj_123") {
  await mkdir(path.join(cwd, ".prisma"), { recursive: true });
  await writeFile(
    path.join(cwd, ".prisma/local.json"),
    `${JSON.stringify({ workspaceId: "ws_123", projectId }, null, 2)}\n`,
    "utf8",
  );
}

function expectedBranchVerboseContext() {
  return {
    workspace: {
      id: "ws_123",
      name: "Acme Inc",
    },
    project: {
      id: "proj_123",
      name: "Acme Dashboard",
    },
    resolution: {
      projectSource: "local-pin",
      targetName: "Acme Dashboard",
      targetNameSource: "local-pin",
    },
  };
}

async function loadController(client: ReturnType<typeof createMockClient>) {
  vi.resetModules();

  vi.doMock("../src/lib/auth/auth-ops", () => ({
    readAuthState: vi.fn().mockResolvedValue({
      authenticated: true,
      provider: null,
      user: { email: "test@example.com" },
      workspace: { id: "ws_123", name: "Acme Inc" },
      credential: null,
    }),
    performLogin: vi.fn(),
    performLogout: vi.fn(),
  }));
  vi.doMock("../src/lib/auth/guard", () => ({
    requireComputeAuth: vi.fn().mockResolvedValue(client),
  }));

  return import("../src/controllers/branch");
}

describe("branch controller", () => {
  it("lists real Platform branches for the resolved project", async () => {
    const client = createMockClient();
    const { runBranchList } = await loadController(client);
    const cwd = await createTempCwd();
    await writeLocalPin(cwd);
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({ cwd, stateDir });

    const result = await runBranchList(context);

    expect(client.GET).toHaveBeenCalledWith(
      "/v1/projects/{projectId}/branches",
      expect.objectContaining({
        params: { path: { projectId: "proj_123" }, query: {} },
      }),
    );
    expect(client.GET).toHaveBeenCalledWith(
      "/v1/projects/{projectId}/branches",
      expect.objectContaining({
        params: { path: { projectId: "proj_123" }, query: { cursor: "cursor_2" } },
      }),
    );
    expect(result).toEqual({
      command: "branch.list",
      result: {
        projectId: "proj_123",
        projectName: "Acme Dashboard",
        verboseContext: expectedBranchVerboseContext(),
        branches: [
          { id: "br_main", name: "main", role: "production", envMap: "production" },
          { id: "br_feature", name: "feature/auth", role: "preview", envMap: "preview" },
        ],
      },
      warnings: [],
      nextSteps: [],
    });
  });

  it("creates a new branch on the resolved project", async () => {
    const client = createMockClient();
    client.POST = vi.fn().mockResolvedValue({
      data: { data: { id: "br_newfeat", gitName: "feat/new", role: "preview" } },
      response: { status: 201 },
    });
    const { runBranchCreate } = await loadController(client);
    const cwd = await createTempCwd();
    await writeLocalPin(cwd);
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: { ...process.env, PRISMA_CLI_MOCK_FIXTURE_PATH: undefined },
    });

    const result = await runBranchCreate(context, "feat/new");

    expect(client.POST).toHaveBeenCalledWith(
      "/v1/projects/{projectId}/branches",
      expect.objectContaining({
        params: { path: { projectId: "proj_123" } },
        body: { gitName: "feat/new" },
      }),
    );
    expect(result).toEqual({
      command: "branch.create",
      result: {
        projectId: "proj_123",
        projectName: "Acme Dashboard",
        verboseContext: expectedBranchVerboseContext(),
        branch: { id: "br_newfeat", name: "feat/new", role: "preview", envMap: "preview" },
      },
      warnings: [],
      nextSteps: ["prisma-cli app deploy"],
    });
  });

  it("returns BRANCH_CREATE_FAILED when branch creation errors", async () => {
    const client = createMockClient();
    client.POST = vi.fn().mockRejectedValue(new Error("Management API returned HTTP 500"));
    const { runBranchCreate } = await loadController(client);
    const cwd = await createTempCwd();
    await writeLocalPin(cwd);
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: { ...process.env, PRISMA_CLI_MOCK_FIXTURE_PATH: undefined },
    });

    await expect(runBranchCreate(context, "feat/new")).rejects.toMatchObject({
      code: "BRANCH_CREATE_FAILED",
      domain: "branch",
      summary: expect.stringContaining('Could not create Branch "feat/new"'),
    });
  });

  it("deletes a preview branch on the resolved project", async () => {
    const client = createMockClient();
    client.DELETE = vi.fn().mockResolvedValue({ response: { status: 204 } });
    const { runBranchDelete } = await loadController(client);
    const cwd = await createTempCwd();
    await writeLocalPin(cwd);
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: { ...process.env, PRISMA_CLI_MOCK_FIXTURE_PATH: undefined },
    });

    const result = await runBranchDelete(context, "feature/auth");

    expect(client.DELETE).toHaveBeenCalledWith(
      "/v1/projects/{projectId}/branches/{branchId}",
      expect.objectContaining({
        params: { path: { projectId: "proj_123", branchId: "br_feature" } },
      }),
    );
    expect(result).toEqual({
      command: "branch.delete",
      result: {
        projectId: "proj_123",
        projectName: "Acme Dashboard",
        branchName: "feature/auth",
      },
      warnings: [],
      nextSteps: [],
    });
  });

  it("refuses to delete the production branch", async () => {
    const client = createMockClient();
    client.DELETE = vi.fn();
    const { runBranchDelete } = await loadController(client);
    const cwd = await createTempCwd();
    await writeLocalPin(cwd);
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: { ...process.env, PRISMA_CLI_MOCK_FIXTURE_PATH: undefined },
    });

    await expect(runBranchDelete(context, "main")).rejects.toMatchObject({
      code: "BRANCH_DELETE_FAILED",
      domain: "branch",
      summary: "Cannot delete the production Branch",
    });
    expect(client.DELETE).not.toHaveBeenCalled();
  });

  it("returns BRANCH_DELETE_FAILED when delete errors", async () => {
    const client = createMockClient();
    client.DELETE = vi.fn().mockRejectedValue(new Error("Management API returned HTTP 500"));
    const { runBranchDelete } = await loadController(client);
    const cwd = await createTempCwd();
    await writeLocalPin(cwd);
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: { ...process.env, PRISMA_CLI_MOCK_FIXTURE_PATH: undefined },
    });

    await expect(runBranchDelete(context, "feature/auth")).rejects.toMatchObject({
      code: "BRANCH_DELETE_FAILED",
      domain: "branch",
      summary: expect.stringContaining('Could not delete Branch "feature/auth"'),
    });
  });

  it("renames a preview branch on the resolved project", async () => {
    const client = createMockClient();
    client.PATCH = vi.fn().mockResolvedValue({
      data: { data: { id: "br_feature", gitName: "feat/renamed", role: "preview" } },
      response: { status: 200 },
    });
    const { runBranchRename } = await loadController(client);
    const cwd = await createTempCwd();
    await writeLocalPin(cwd);
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: { ...process.env, PRISMA_CLI_MOCK_FIXTURE_PATH: undefined },
    });

    const result = await runBranchRename(context, "feature/auth", "feat/renamed");

    expect(client.PATCH).toHaveBeenCalledWith(
      "/v1/projects/{projectId}/branches/{branchId}",
      expect.objectContaining({
        params: { path: { projectId: "proj_123", branchId: "br_feature" } },
        body: { gitName: "feat/renamed" },
      }),
    );
    expect(result).toEqual({
      command: "branch.rename",
      result: {
        projectId: "proj_123",
        projectName: "Acme Dashboard",
        verboseContext: expectedBranchVerboseContext(),
        branch: { id: "br_feature", name: "feat/renamed", role: "preview", envMap: "preview" },
      },
      warnings: [],
      nextSteps: [],
    });
  });

  it("refuses to rename the production branch", async () => {
    const client = createMockClient();
    client.PATCH = vi.fn();
    const { runBranchRename } = await loadController(client);
    const cwd = await createTempCwd();
    await writeLocalPin(cwd);
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: { ...process.env, PRISMA_CLI_MOCK_FIXTURE_PATH: undefined },
    });

    await expect(runBranchRename(context, "main", "newname")).rejects.toMatchObject({
      code: "BRANCH_RENAME_FAILED",
      domain: "branch",
      summary: "Cannot rename the production Branch",
    });
    expect(client.PATCH).not.toHaveBeenCalled();
  });

  it("returns BRANCH_RENAME_FAILED when rename errors", async () => {
    const client = createMockClient();
    client.PATCH = vi.fn().mockRejectedValue(new Error("Management API returned HTTP 500"));
    const { runBranchRename } = await loadController(client);
    const cwd = await createTempCwd();
    await writeLocalPin(cwd);
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: { ...process.env, PRISMA_CLI_MOCK_FIXTURE_PATH: undefined },
    });

    await expect(runBranchRename(context, "feature/auth", "feat/renamed")).rejects.toMatchObject({
      code: "BRANCH_RENAME_FAILED",
      domain: "branch",
      summary: expect.stringContaining('Could not rename Branch "feature/auth"'),
    });
  });
});
