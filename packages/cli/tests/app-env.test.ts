import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  process.env.PRISMA_CLI_TEST_REMEMBER_PROJECT_ID = "proj_123";
  process.env.PRISMA_CLI_TEST_REMEMBER_PROJECT_NAME = "Acme Dashboard";
  process.env.PRISMA_CLI_TEST_REMEMBER_WORKSPACE_ID = "ws_123";
});

afterEach(() => {
  delete process.env.PRISMA_CLI_TEST_REMEMBER_PROJECT_ID;
  delete process.env.PRISMA_CLI_TEST_REMEMBER_PROJECT_NAME;
  delete process.env.PRISMA_CLI_TEST_REMEMBER_WORKSPACE_ID;

  vi.doUnmock("../src/lib/auth/auth-ops");
  vi.doUnmock("../src/lib/auth/guard");
  vi.doUnmock("../src/lib/app/preview-provider");
  vi.resetModules();
  vi.restoreAllMocks();
});

interface MockClient {
  GET: ReturnType<typeof vi.fn>;
  envGET: ReturnType<typeof vi.fn>;
  POST: ReturnType<typeof vi.fn>;
  PATCH: ReturnType<typeof vi.fn>;
  DELETE: ReturnType<typeof vi.fn>;
}

function createMockClient(): MockClient {
  const envGET = vi.fn();
  return {
    GET: vi.fn().mockImplementation((pathName: string, ...args: unknown[]) => {
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

      return envGET(pathName, ...args);
    }),
    envGET,
    POST: vi.fn(),
    PATCH: vi.fn(),
    DELETE: vi.fn(),
  };
}

function expectNoApiCalls(client: MockClient) {
  expect(client.GET).not.toHaveBeenCalled();
  expect(client.POST).not.toHaveBeenCalled();
  expect(client.PATCH).not.toHaveBeenCalled();
  expect(client.DELETE).not.toHaveBeenCalled();
}

async function loadControllers(client: MockClient, projectId: string) {
  vi.resetModules();
  void projectId;

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
    requireComputeAuth: vi.fn().mockResolvedValue(client),
  }));

  const { createTempCwd, createTestCommandContext } = await import("./helpers");
  const controllers = await import("../src/controllers/app-env");
  return { controllers, createTempCwd, createTestCommandContext };
}

function makeVariableRow(overrides: Partial<{
  id: string;
  key: string;
  branchId: string | null;
  class: "production" | "preview";
  isManagedBySystem: boolean;
  updatedAt: string;
}> = {}) {
  return {
    id: "envvar_v1",
    type: "environment-variable",
    url: "https://api.example/v1/environment-variables/envvar_v1",
    projectId: "proj_123",
    branchId: null,
    class: "production",
    key: "STRIPE_KEY",
    valueKid: "dek_v1",
    isManagedBySystem: false,
    createdAt: "2026-05-08T10:00:00.000Z",
    updatedAt: "2026-05-08T10:00:00.000Z",
    ...overrides,
  };
}

function makeBranchRow(overrides: Partial<{
  id: string;
  gitName: string;
  isDefault: boolean;
}> = {}) {
  return {
    id: "br_feature",
    gitName: "feature/foo",
    isDefault: false,
    ...overrides,
  };
}

describe("env add", () => {
  it("creates a new variable on the production template via POST", async () => {
    const client = createMockClient();
    client.envGET.mockResolvedValueOnce({
      data: { data: [], pagination: { hasMore: false, nextCursor: null } },
      response: { status: 200 },
    });
    client.POST.mockResolvedValueOnce({
      data: { data: makeVariableRow() },
      response: { status: 201 },
    });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    const result = await controllers.runEnvAdd(
      context,
      "STRIPE_KEY=sk_test_xxx",
      { roleName: "production" },
    );

    expect(client.POST).toHaveBeenCalledWith(
      "/v1/environment-variables",
      expect.objectContaining({
        body: {
          projectId: "proj_123",
          class: "production",
          key: "STRIPE_KEY",
          value: "sk_test_xxx",
        },
      }),
    );
    expect(result.result).toMatchObject({
      projectId: "proj_123",
      scope: { kind: "role", role: "production" },
      variable: { key: "STRIPE_KEY", id: "envvar_v1" },
    });
    expect(JSON.stringify(result)).not.toContain("sk_test_xxx");
  });

  it("reads KEY-only assignments from the current environment with explicit --project", async () => {
    const client = createMockClient();
    client.envGET.mockResolvedValueOnce({
      data: { data: [], pagination: { hasMore: false, nextCursor: null } },
      response: { status: 200 },
    });
    client.POST.mockResolvedValueOnce({
      data: { data: makeVariableRow({ key: "API_URL", class: "preview" }) },
      response: { status: 201 },
    });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({
      cwd,
      env: {
        ...process.env,
        API_URL: "https://api.example",
      },
    });

    await controllers.runEnvAdd(context, "API_URL", {
      roleName: "preview",
      projectRef: "proj_123",
    });

    expect(client.POST).toHaveBeenCalledWith(
      "/v1/environment-variables",
      expect.objectContaining({
        body: {
          projectId: "proj_123",
          class: "preview",
          key: "API_URL",
          value: "https://api.example",
        },
      }),
    );
  });

  it("fails when the variable already exists", async () => {
    const client = createMockClient();
    client.envGET.mockResolvedValueOnce({
      data: {
        data: [makeVariableRow()],
        pagination: { hasMore: false, nextCursor: null },
      },
      response: { status: 200 },
    });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runEnvAdd(context, "STRIPE_KEY=sk_test_xxx", {
        roleName: "production",
      }),
    ).rejects.toMatchObject({
      code: "ENV_VARIABLE_ALREADY_EXISTS",
      summary: expect.stringContaining("already exists"),
    });
    expect(client.POST).not.toHaveBeenCalled();
  });

  it("creates a preview branch override and warns when there is no preview default", async () => {
    const client = createMockClient();
    client.envGET
      .mockResolvedValueOnce({
        data: { data: [makeBranchRow()], pagination: { hasMore: false, nextCursor: null } },
        response: { status: 200 },
      })
      .mockResolvedValueOnce({
        data: { data: [], pagination: { hasMore: false, nextCursor: null } },
        response: { status: 200 },
      })
      .mockResolvedValueOnce({
        data: { data: [], pagination: { hasMore: false, nextCursor: null } },
        response: { status: 200 },
      });
    client.POST.mockResolvedValueOnce({
      data: {
        data: makeVariableRow({
          key: "DATABASE_URL",
          branchId: "br_feature",
          class: "preview",
        }),
      },
      response: { status: 201 },
    });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    const result = await controllers.runEnvAdd(
      context,
      "DATABASE_URL=postgresql://branch",
      { branchName: "feature/foo" },
    );

    expect(client.POST).toHaveBeenCalledWith(
      "/v1/environment-variables",
      expect.objectContaining({
        body: {
          projectId: "proj_123",
          class: "preview",
          branchId: "br_feature",
          key: "DATABASE_URL",
          value: "postgresql://branch",
        },
      }),
    );
    expect(result.result.scope).toEqual({
      kind: "branch",
      branchName: "feature/foo",
      branchId: "br_feature",
    });
    expect(result.warnings[0]).toContain("does not exist in preview");
    expect(JSON.stringify(result)).not.toContain("postgresql://branch");
  });

  it("creates the branch before adding its first override", async () => {
    const client = createMockClient();
    client.envGET
      .mockResolvedValueOnce({
        data: { data: [], pagination: { hasMore: false, nextCursor: null } },
        response: { status: 200 },
      })
      .mockResolvedValueOnce({
        data: {
          data: [makeBranchRow({ id: "br_main", gitName: "main", isDefault: true })],
          pagination: { hasMore: false, nextCursor: null },
        },
        response: { status: 200 },
      })
      .mockResolvedValueOnce({
        data: { data: [], pagination: { hasMore: false, nextCursor: null } },
        response: { status: 200 },
      })
      .mockResolvedValueOnce({
        data: { data: [], pagination: { hasMore: false, nextCursor: null } },
        response: { status: 200 },
      });
    client.POST
      .mockResolvedValueOnce({
        data: { data: makeBranchRow({ id: "br_new", gitName: "feature/new" }) },
        response: { status: 201 },
      })
      .mockResolvedValueOnce({
        data: {
          data: makeVariableRow({
            key: "DATABASE_URL",
            branchId: "br_new",
            class: "preview",
          }),
        },
        response: { status: 201 },
      });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    await controllers.runEnvAdd(context, "DATABASE_URL=postgresql://branch", {
      branchName: "feature/new",
    });

    expect(client.POST).toHaveBeenNthCalledWith(
      1,
      "/v1/projects/{projectId}/branches",
      expect.objectContaining({
        params: { path: { projectId: "proj_123" } },
        body: { gitName: "feature/new", isDefault: false },
      }),
    );
  });

  it("does not create a missing branch when the project has no default branch", async () => {
    const client = createMockClient();
    client.envGET
      .mockResolvedValueOnce({
        data: { data: [], pagination: { hasMore: false, nextCursor: null } },
        response: { status: 200 },
      })
      .mockResolvedValueOnce({
        data: { data: [], pagination: { hasMore: false, nextCursor: null } },
        response: { status: 200 },
      });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runEnvAdd(context, "DATABASE_URL=postgresql://branch", {
        branchName: "feature/new",
      }),
    ).rejects.toMatchObject({
      code: "ENV_BRANCH_CREATE_REQUIRES_DEFAULT_BRANCH",
      summary: expect.stringContaining("Cannot create branch"),
    });
    expect(client.POST).not.toHaveBeenCalled();
  });

  it("rejects mutually exclusive role and branch scopes", async () => {
    const client = createMockClient();
    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runEnvAdd(context, "STRIPE_KEY=sk", {
        roleName: "preview",
        branchName: "feature/foo",
      }),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("either --role or --branch"),
    });
    expectNoApiCalls(client);
  });

  it("rejects when --role is not provided (fail-fast on writes)", async () => {
    const client = createMockClient();
    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runEnvAdd(context, "STRIPE_KEY=sk", {}),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("requires --role or --branch"),
    });
    expectNoApiCalls(client);
  });

  it("rejects malformed KEY=VALUE", async () => {
    const client = createMockClient();
    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runEnvAdd(context, "noequalshere", {
        roleName: "production",
      }),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("missing the = separator"),
    });
    expectNoApiCalls(client);
  });

  it("rejects keys that don't match POSIX env-var shape", async () => {
    const client = createMockClient();
    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runEnvAdd(context, "lowercase-key=value", {
        roleName: "production",
      }),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("POSIX env-var shape"),
    });
    expectNoApiCalls(client);
  });
});

describe("env update", () => {
  it("replaces an existing variable's value via PATCH", async () => {
    const client = createMockClient();
    client.envGET.mockResolvedValueOnce({
      data: {
        data: [makeVariableRow()],
        pagination: { hasMore: false, nextCursor: null },
      },
      response: { status: 200 },
    });
    client.PATCH.mockResolvedValueOnce({
      data: { data: makeVariableRow({ updatedAt: "2026-05-08T11:00:00.000Z" }) },
      response: { status: 200 },
    });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    const result = await controllers.runEnvUpdate(
      context,
      "STRIPE_KEY=new-value",
      { roleName: "production" },
    );

    expect(client.POST).not.toHaveBeenCalled();
    expect(client.PATCH).toHaveBeenCalledWith(
      "/v1/environment-variables/{envVarId}",
      expect.objectContaining({
        params: { path: { envVarId: "envvar_v1" } },
        body: { value: "new-value" },
      }),
    );
    expect(result.result).toMatchObject({
      projectId: "proj_123",
      scope: { kind: "role", role: "production" },
      variable: { key: "STRIPE_KEY", id: "envvar_v1" },
    });
  });

  it("fails when the variable does not exist", async () => {
    const client = createMockClient();
    client.envGET.mockResolvedValueOnce({
      data: { data: [], pagination: { hasMore: false, nextCursor: null } },
      response: { status: 200 },
    });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runEnvUpdate(context, "STRIPE_KEY=new-value", {
        roleName: "production",
      }),
    ).rejects.toMatchObject({
      code: "ENV_VARIABLE_NOT_FOUND",
      summary: expect.stringContaining("not found"),
    });
    expect(client.PATCH).not.toHaveBeenCalled();
  });

  it("updates an existing branch override", async () => {
    const client = createMockClient();
    client.envGET
      .mockResolvedValueOnce({
        data: { data: [makeBranchRow()], pagination: { hasMore: false, nextCursor: null } },
        response: { status: 200 },
      })
      .mockResolvedValueOnce({
        data: {
          data: [
            makeVariableRow({
              id: "envvar_branch",
              key: "DATABASE_URL",
              class: "preview",
              branchId: "br_feature",
            }),
          ],
          pagination: { hasMore: false, nextCursor: null },
        },
        response: { status: 200 },
      });
    client.PATCH.mockResolvedValueOnce({
      data: {
        data: makeVariableRow({
          id: "envvar_branch",
          key: "DATABASE_URL",
          class: "preview",
          branchId: "br_feature",
        }),
      },
      response: { status: 200 },
    });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    await controllers.runEnvUpdate(
      context,
      "DATABASE_URL=postgresql://new",
      { branchName: "feature/foo" },
    );

    expect(client.PATCH).toHaveBeenCalledWith(
      "/v1/environment-variables/{envVarId}",
      expect.objectContaining({
        params: { path: { envVarId: "envvar_branch" } },
        body: { value: "postgresql://new" },
      }),
    );
  });

  it("rejects when --role is not provided (fail-fast on writes)", async () => {
    const client = createMockClient();
    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runEnvUpdate(context, "STRIPE_KEY=sk", {}),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("requires --role or --branch"),
    });
    expectNoApiCalls(client);
  });
});

describe("env list", () => {
  it("returns metadata for a role scope and never includes values", async () => {
    const client = createMockClient();
    client.envGET.mockResolvedValueOnce({
      data: {
        data: [
          makeVariableRow({ id: "envvar_a", key: "STRIPE_KEY" }),
          makeVariableRow({ id: "envvar_b", key: "SENDGRID_KEY" }),
        ],
        pagination: { hasMore: false, nextCursor: null },
      },
      response: { status: 200 },
    });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    const result = await controllers.runEnvList(context, {
      roleName: "production",
    });

    expect(client.GET).toHaveBeenCalledWith(
      "/v1/environment-variables",
      expect.objectContaining({
        params: {
          query: expect.objectContaining({
            projectId: "proj_123",
            class: "production",
          }),
        },
      }),
    );
    expect(result.result.scope).toEqual({ kind: "role", role: "production" });
    expect(result.result.variables.map((v) => v.key)).toEqual([
      "STRIPE_KEY",
      "SENDGRID_KEY",
    ]);
    const flattened = JSON.stringify(result.result);
    expect(flattened).not.toMatch(/"value"\s*:/);
  });

  it("defaults to --role production when no scope flag is provided", async () => {
    const client = createMockClient();
    client.envGET.mockResolvedValueOnce({
      data: { data: [], pagination: { hasMore: false, nextCursor: null } },
      response: { status: 200 },
    });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    const result = await controllers.runEnvList(context, {});

    expect(client.GET).toHaveBeenCalledWith(
      "/v1/environment-variables",
      expect.objectContaining({
        params: {
          query: expect.objectContaining({
            projectId: "proj_123",
            class: "production",
          }),
        },
      }),
    );
    expect(result.result.scope).toEqual({ kind: "role", role: "production" });
  });

  it("lists a resolved branch view with preview defaults and branch overrides", async () => {
    const client = createMockClient();
    client.envGET
      .mockResolvedValueOnce({
        data: { data: [makeBranchRow()], pagination: { hasMore: false, nextCursor: null } },
        response: { status: 200 },
      })
      .mockResolvedValueOnce({
        data: {
          data: [
            makeVariableRow({
              id: "envvar_preview",
              key: "DATABASE_URL",
              class: "preview",
              branchId: null,
            }),
            makeVariableRow({
              id: "envvar_api",
              key: "API_URL",
              class: "preview",
              branchId: null,
            }),
            makeVariableRow({
              id: "envvar_branch",
              key: "DATABASE_URL",
              class: "preview",
              branchId: "br_feature",
            }),
          ],
          pagination: { hasMore: false, nextCursor: null },
        },
        response: { status: 200 },
      });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    const result = await controllers.runEnvList(context, {
      branchName: "feature/foo",
    });

    expect(result.result.scope).toEqual({
      kind: "branch",
      branchName: "feature/foo",
      branchId: "br_feature",
    });
    expect(result.result.variables.map((variable) => ({
      key: variable.key,
      id: variable.id,
      source: variable.source,
    }))).toEqual([
      { key: "API_URL", id: "envvar_api", source: "preview" },
      { key: "DATABASE_URL", id: "envvar_branch", source: "branch:feature/foo" },
    ]);
  });
});

describe("env remove", () => {
  it("looks up the row and DELETEs it on the happy path", async () => {
    const client = createMockClient();
    client.envGET.mockResolvedValueOnce({
      data: {
        data: [makeVariableRow({ id: "envvar_target", key: "STRIPE_KEY" })],
        pagination: { hasMore: false, nextCursor: null },
      },
      response: { status: 200 },
    });
    client.DELETE.mockResolvedValueOnce({
      data: undefined,
      response: { status: 204 },
    });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    const result = await controllers.runEnvRemove(context, "STRIPE_KEY", {
      roleName: "production",
    });

    expect(client.DELETE).toHaveBeenCalledWith(
      "/v1/environment-variables/{envVarId}",
      expect.objectContaining({
        params: { path: { envVarId: "envvar_target" } },
      }),
    );
    expect(result.result).toEqual({
      projectId: "proj_123",
      scope: { kind: "role", role: "production" },
      key: "STRIPE_KEY",
    });
  });

  it("returns a focused not-found error when the row does not exist", async () => {
    const client = createMockClient();
    client.envGET.mockResolvedValueOnce({
      data: { data: [], pagination: { hasMore: false, nextCursor: null } },
      response: { status: 200 },
    });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runEnvRemove(context, "STRIPE_KEY", {
        roleName: "production",
      }),
    ).rejects.toMatchObject({
      code: "ENV_VARIABLE_NOT_FOUND",
    });
    expect(client.DELETE).not.toHaveBeenCalled();
  });

  it("removes a branch override without touching the preview default", async () => {
    const client = createMockClient();
    client.envGET
      .mockResolvedValueOnce({
        data: { data: [makeBranchRow()], pagination: { hasMore: false, nextCursor: null } },
        response: { status: 200 },
      })
      .mockResolvedValueOnce({
        data: {
          data: [
            makeVariableRow({
              id: "envvar_preview",
              key: "DATABASE_URL",
              class: "preview",
              branchId: null,
            }),
            makeVariableRow({
              id: "envvar_branch",
              key: "DATABASE_URL",
              class: "preview",
              branchId: "br_feature",
            }),
          ],
          pagination: { hasMore: false, nextCursor: null },
        },
        response: { status: 200 },
      });
    client.DELETE.mockResolvedValueOnce({
      data: undefined,
      response: { status: 204 },
    });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    await controllers.runEnvRemove(context, "DATABASE_URL", {
      branchName: "feature/foo",
    });

    expect(client.DELETE).toHaveBeenCalledWith(
      "/v1/environment-variables/{envVarId}",
      expect.objectContaining({
        params: { path: { envVarId: "envvar_branch" } },
      }),
    );
  });

  it("rejects when --role is not provided (fail-fast on writes)", async () => {
    const client = createMockClient();
    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runEnvRemove(context, "STRIPE_KEY", {}),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("requires --role or --branch"),
    });
    expectNoApiCalls(client);
  });
});
