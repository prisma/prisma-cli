import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTempCwd, createTestCommandContext } from "./helpers";

afterEach(() => {
  vi.doUnmock("../src/auth");
  vi.doUnmock("../src/auth/guard");
  vi.resetModules();
  vi.restoreAllMocks();
});

function createMockClient() {
  return {
    GET: vi
      .fn()
      .mockImplementation(
        (
          pathName: string,
          request?: { params?: { query?: { cursor?: string } } },
        ) => {
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
                  {
                    id: "br_feature",
                    gitName: "feature/auth",
                    role: "preview",
                  },
                ],
                pagination: { hasMore: true, nextCursor: "cursor_2" },
              },
              response: { status: 200 },
            };
          }

          throw new Error(`Unexpected path ${pathName}`);
        },
      ),
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

  vi.doMock("../src/auth", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/auth")>()),
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
  vi.doMock("../src/auth/guard", () => ({
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
        params: {
          path: { projectId: "proj_123" },
          query: { cursor: "cursor_2" },
        },
      }),
    );
    expect(result).toEqual({
      command: "branch.list",
      result: {
        projectId: "proj_123",
        projectName: "Acme Dashboard",
        verboseContext: expectedBranchVerboseContext(),
        branches: [
          {
            id: "br_main",
            name: "main",
            role: "production",
            envMap: "production",
          },
          {
            id: "br_feature",
            name: "feature/auth",
            role: "preview",
            envMap: "preview",
          },
        ],
      },
      warnings: [],
      nextSteps: [],
    });
  });
});
