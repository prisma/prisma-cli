import { afterEach, describe, expect, it, vi } from "vitest";

import { writePrismaConfig } from "./helpers";

afterEach(() => {
  vi.doUnmock("../src/adapters/config");
  vi.doUnmock("../src/lib/auth/guard");
  vi.doUnmock("../src/lib/app/preview-provider");
  vi.resetModules();
  vi.restoreAllMocks();
});

interface MockClient {
  GET: ReturnType<typeof vi.fn>;
  POST: ReturnType<typeof vi.fn>;
  PATCH: ReturnType<typeof vi.fn>;
  DELETE: ReturnType<typeof vi.fn>;
}

function createMockClient(): MockClient {
  return {
    GET: vi.fn(),
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

  vi.doMock("../src/adapters/config", async () => {
    const actual =
      await vi.importActual<typeof import("../src/adapters/config")>(
        "../src/adapters/config",
      );
    return {
      ...actual,
      readLinkedProjectId: vi.fn().mockResolvedValue(projectId),
    };
  });
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

describe("env add", () => {
  it("creates a new variable on the production template via POST", async () => {
    const client = createMockClient();
    client.GET.mockResolvedValueOnce({
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
    await writePrismaConfig(cwd, "proj_123");
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

  it("fails when the variable already exists", async () => {
    const client = createMockClient();
    client.GET.mockResolvedValueOnce({
      data: {
        data: [makeVariableRow()],
        pagination: { hasMore: false, nextCursor: null },
      },
      response: { status: 200 },
    });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    await writePrismaConfig(cwd, "proj_123");
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

  it("rejects when --role is not provided (fail-fast on writes)", async () => {
    const client = createMockClient();
    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    await writePrismaConfig(cwd, "proj_123");
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runEnvAdd(context, "STRIPE_KEY=sk", {}),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("requires --role"),
    });
    expectNoApiCalls(client);
  });

  it("rejects malformed KEY=VALUE", async () => {
    const client = createMockClient();
    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    await writePrismaConfig(cwd, "proj_123");
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runEnvAdd(context, "noequalshere", {
        roleName: "production",
      }),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("missing the = separator"),
    });
  });

  it("rejects keys that don't match POSIX env-var shape", async () => {
    const client = createMockClient();
    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    await writePrismaConfig(cwd, "proj_123");
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runEnvAdd(context, "lowercase-key=value", {
        roleName: "production",
      }),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("POSIX env-var shape"),
    });
  });
});

describe("env update", () => {
  it("replaces an existing variable's value via PATCH", async () => {
    const client = createMockClient();
    client.GET.mockResolvedValueOnce({
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
    await writePrismaConfig(cwd, "proj_123");
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
    client.GET.mockResolvedValueOnce({
      data: { data: [], pagination: { hasMore: false, nextCursor: null } },
      response: { status: 200 },
    });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    await writePrismaConfig(cwd, "proj_123");
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

  it("rejects when --role is not provided (fail-fast on writes)", async () => {
    const client = createMockClient();
    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    await writePrismaConfig(cwd, "proj_123");
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runEnvUpdate(context, "STRIPE_KEY=sk", {}),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("requires --role"),
    });
    expectNoApiCalls(client);
  });
});

describe("env list", () => {
  it("returns metadata for a role scope and never includes values", async () => {
    const client = createMockClient();
    client.GET.mockResolvedValueOnce({
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
    await writePrismaConfig(cwd, "proj_123");
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
    client.GET.mockResolvedValueOnce({
      data: { data: [], pagination: { hasMore: false, nextCursor: null } },
      response: { status: 200 },
    });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    await writePrismaConfig(cwd, "proj_123");
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
});

describe("env rm", () => {
  it("looks up the row and DELETEs it on the happy path", async () => {
    const client = createMockClient();
    client.GET.mockResolvedValueOnce({
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
    await writePrismaConfig(cwd, "proj_123");
    const { context } = await createTestCommandContext({ cwd });

    const result = await controllers.runEnvRm(context, "STRIPE_KEY", {
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
    client.GET.mockResolvedValueOnce({
      data: { data: [], pagination: { hasMore: false, nextCursor: null } },
      response: { status: 200 },
    });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    await writePrismaConfig(cwd, "proj_123");
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runEnvRm(context, "STRIPE_KEY", {
        roleName: "production",
      }),
    ).rejects.toMatchObject({
      code: "ENV_VARIABLE_NOT_FOUND",
    });
    expect(client.DELETE).not.toHaveBeenCalled();
  });

  it("rejects when --role is not provided (fail-fast on writes)", async () => {
    const client = createMockClient();
    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    await writePrismaConfig(cwd, "proj_123");
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runEnvRm(context, "STRIPE_KEY", {}),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("requires --role"),
    });
    expectNoApiCalls(client);
  });
});

/**
 * Shared scaffolding for the legacy `app update-env` / `app list-env`
 * deprecation tests. The two flows share an auth gate, project-link
 * lookup, and preview-provider seam; centralizing the mock keeps the
 * tests focused on the deprecation banner contract instead of the
 * provider stub shape, and means a future change to either of those
 * underlying dependencies needs to be reflected in exactly one place.
 */
function mockLegacyEnvDependencies(
  overrides: {
    updateAppEnv?: ReturnType<typeof vi.fn>;
    listAppEnvNames?: ReturnType<typeof vi.fn>;
  } = {},
): void {
  vi.doMock("../src/adapters/config", async () => {
    const actual =
      await vi.importActual<typeof import("../src/adapters/config")>(
        "../src/adapters/config",
      );
    return {
      ...actual,
      readLinkedProjectId: vi.fn().mockResolvedValue("proj_123"),
    };
  });
  vi.doMock("../src/lib/auth/guard", () => ({
    requireComputeAuth: vi.fn().mockResolvedValue({ token: "t" }),
  }));

  const appRecord = {
    id: "app_1",
    name: "hello-world",
    region: null,
    liveDeploymentId: "dep_1",
    liveUrl: null,
  };
  const deploymentRecord = {
    id: "dep_1",
    status: "running",
    createdAt: "2026-05-08T10:00:00.000Z",
    url: null,
    live: null,
  };

  vi.doMock("../src/lib/app/preview-provider", () => ({
    createPreviewAppProvider: vi.fn(() => ({
      listApps: vi.fn().mockResolvedValue([appRecord]),
      listDeployments: vi.fn().mockResolvedValue({
        app: appRecord,
        deployments: [deploymentRecord],
      }),
      ...(overrides.updateAppEnv ? { updateAppEnv: overrides.updateAppEnv } : {}),
      ...(overrides.listAppEnvNames
        ? { listAppEnvNames: overrides.listAppEnvNames }
        : {}),
    })),
  }));
}

const legacyEnvProviderResponse = () => ({
  projectId: "proj_123",
  app: {
    id: "app_1",
    name: "hello-world",
    region: null,
    liveDeploymentId: "dep_1",
    liveUrl: null,
  },
  deployment: {
    id: "dep_1",
    status: "running",
    createdAt: "2026-05-08T10:00:00.000Z",
    url: null,
    live: true,
  },
  variables: ["FOO"],
});

const updateAppEnvHappyPath = () =>
  vi.fn().mockResolvedValue(legacyEnvProviderResponse());

const listAppEnvNamesHappyPath = () =>
  vi.fn().mockResolvedValue(legacyEnvProviderResponse());

describe("legacy env command deprecation warnings", () => {
  it("prints a deprecation banner to stderr from `app update-env`", async () => {
    mockLegacyEnvDependencies({ updateAppEnv: updateAppEnvHappyPath() });

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppUpdateEnv } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const { context, stderr } = await createTestCommandContext({ cwd });

    await runAppUpdateEnv(context, "hello-world", ["FOO=bar"]);

    expect(stderr.buffer).toContain("[deprecation]");
    expect(stderr.buffer).toContain("prisma-cli app update-env");
    expect(stderr.buffer).toContain("prisma-cli env add");
  });

  it("suppresses the deprecation banner under --json", async () => {
    mockLegacyEnvDependencies({ updateAppEnv: updateAppEnvHappyPath() });

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppUpdateEnv } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const { context, stderr } = await createTestCommandContext({
      cwd,
      flags: { json: true },
    });

    await runAppUpdateEnv(context, "hello-world", ["FOO=bar"]);

    expect(stderr.buffer).not.toContain("[deprecation]");
  });

  it("prints a deprecation banner to stderr from `app list-env`", async () => {
    mockLegacyEnvDependencies({ listAppEnvNames: listAppEnvNamesHappyPath() });

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppListEnv } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const { context, stderr } = await createTestCommandContext({ cwd });

    await runAppListEnv(context, "hello-world");

    expect(stderr.buffer).toContain("[deprecation]");
    expect(stderr.buffer).toContain("prisma-cli app list-env");
    expect(stderr.buffer).toContain("prisma-cli env list");
  });

  it("suppresses the `app list-env` deprecation banner under --json", async () => {
    mockLegacyEnvDependencies({ listAppEnvNames: listAppEnvNamesHappyPath() });

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppListEnv } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const { context, stderr } = await createTestCommandContext({
      cwd,
      flags: { json: true },
    });

    await runAppListEnv(context, "hello-world");

    expect(stderr.buffer).not.toContain("[deprecation]");
  });
});
