import { afterEach, describe, expect, it, vi } from "vitest";

import { writePrismaConfig } from "./helpers";

afterEach(() => {
  vi.doUnmock("../src/adapters/config");
  vi.doUnmock("../src/lib/auth/guard");
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

async function loadControllers(client: MockClient, projectId: string) {
  // Reset modules first so the dynamic import below picks up the fresh
  // mock registry — without this, ordering between tests can leave a
  // controllers module that already captured the unmocked guard.
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

describe("app env set", () => {
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

    const result = await controllers.runAppEnvSet(
      context,
      "STRIPE_KEY=sk_test_xxx",
      { className: "production" },
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
      scope: { kind: "class", class: "production" },
      replaced: false,
      variable: { key: "STRIPE_KEY", id: "envvar_v1" },
    });
    // The plaintext value never leaks into the result envelope: AC5 / FR15
    // protects readers of the API response, and the same surface contract
    // applies on the client side.
    expect(JSON.stringify(result)).not.toContain("sk_test_xxx");
  });

  it("replaces an existing variable's value via PATCH (upsert)", async () => {
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

    const result = await controllers.runAppEnvSet(
      context,
      "STRIPE_KEY=new-value",
      { className: "production" },
    );

    expect(client.POST).not.toHaveBeenCalled();
    expect(client.PATCH).toHaveBeenCalledWith(
      "/v1/environment-variables/{envVarId}",
      expect.objectContaining({
        params: { path: { envVarId: "envvar_v1" } },
        body: { value: "new-value" },
      }),
    );
    expect(result.result.replaced).toBe(true);
  });

  it("rejects --class and --branch supplied together", async () => {
    const client = createMockClient();
    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    await writePrismaConfig(cwd, "proj_123");
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runAppEnvSet(context, "STRIPE_KEY=sk", {
        className: "production",
        branchName: "feature-auth",
      }),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("mutually exclusive"),
    });
    expect(client.POST).not.toHaveBeenCalled();
  });

  it("rejects neither --class nor --branch (fail-fast on writes)", async () => {
    const client = createMockClient();
    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    await writePrismaConfig(cwd, "proj_123");
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runAppEnvSet(context, "STRIPE_KEY=sk", {}),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("requires --class or --branch"),
    });
    expect(client.POST).not.toHaveBeenCalled();
  });

  it("rejects malformed KEY=VALUE", async () => {
    const client = createMockClient();
    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    await writePrismaConfig(cwd, "proj_123");
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runAppEnvSet(context, "noequalshere", {
        className: "production",
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
      controllers.runAppEnvSet(context, "lowercase-key=value", {
        className: "production",
      }),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("POSIX env-var shape"),
    });
  });

  it("returns a feature-unavailable error for branch-override writes", async () => {
    // Branch-override creates require a future POST body extension; the
    // CLI surface stays honest until the API supports it.
    const client = createMockClient();
    client.GET
      .mockResolvedValueOnce({
        // Resolve branch name → branch id.
        data: {
          data: [
            {
              id: "branch_42",
              type: "branch",
              url: "https://api.example/v1/branches/branch_42",
              gitName: "feature-auth",
              isDefault: false,
              createdAt: "2026-05-08T10:00:00.000Z",
              updatedAt: "2026-05-08T10:00:00.000Z",
              project: {
                id: "proj_123",
                url: "https://api.example/v1/projects/proj_123",
                name: "demo",
              },
            },
          ],
          pagination: { hasMore: false, nextCursor: null },
        },
        response: { status: 200 },
      })
      .mockResolvedValueOnce({
        // Look up existing override row by natural key — none exist yet.
        data: { data: [], pagination: { hasMore: false, nextCursor: null } },
        response: { status: 200 },
      });

    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    await writePrismaConfig(cwd, "proj_123");
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runAppEnvSet(context, "STRIPE_KEY=override", {
        branchName: "feature-auth",
      }),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("Branch-override writes are not available yet"),
    });
    expect(client.POST).not.toHaveBeenCalled();
  });
});

describe("app env list", () => {
  it("returns metadata for a class scope and never includes values", async () => {
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

    const result = await controllers.runAppEnvList(context, {
      className: "production",
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
    expect(result.result.scope).toEqual({ kind: "class", class: "production" });
    expect(result.result.variables.map((v) => v.key)).toEqual([
      "STRIPE_KEY",
      "SENDGRID_KEY",
    ]);
    // Metadata-only contract: no field literally named `value` anywhere.
    const flattened = JSON.stringify(result.result);
    expect(flattened).not.toMatch(/"value"\s*:/);
  });

  it("defaults to --class production when no scope flag is provided", async () => {
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

    const result = await controllers.runAppEnvList(context, {});

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
    expect(result.result.scope).toEqual({ kind: "class", class: "production" });
  });

  it("resolves --branch to a branchId and lists overrides for that branch", async () => {
    const client = createMockClient();
    client.GET
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              id: "branch_42",
              type: "branch",
              url: "https://api.example/v1/branches/branch_42",
              gitName: "feature-auth",
              isDefault: false,
              createdAt: "2026-05-08T10:00:00.000Z",
              updatedAt: "2026-05-08T10:00:00.000Z",
              project: {
                id: "proj_123",
                url: "https://api.example/v1/projects/proj_123",
                name: "demo",
              },
            },
          ],
          pagination: { hasMore: false, nextCursor: null },
        },
        response: { status: 200 },
      })
      .mockResolvedValueOnce({
        data: {
          data: [
            makeVariableRow({
              id: "envvar_o1",
              key: "STRIPE_KEY",
              branchId: "branch_42",
              class: "preview",
            }),
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

    const result = await controllers.runAppEnvList(context, {
      branchName: "feature-auth",
    });

    expect(client.GET).toHaveBeenNthCalledWith(
      1,
      "/v1/projects/{projectId}/branches",
      expect.objectContaining({
        params: {
          path: { projectId: "proj_123" },
          query: { gitName: "feature-auth" },
        },
      }),
    );
    expect(client.GET).toHaveBeenNthCalledWith(
      2,
      "/v1/environment-variables",
      expect.objectContaining({
        params: {
          query: expect.objectContaining({
            projectId: "proj_123",
            class: "preview",
            branchId: "branch_42",
          }),
        },
      }),
    );
    expect(result.result.scope).toEqual({
      kind: "branch",
      name: "feature-auth",
      id: "branch_42",
    });
    expect(result.result.variables).toHaveLength(1);
  });

  it("rejects --class and --branch supplied together", async () => {
    // The mutex rule is enforced by a shared validator; pin it on
    // every verb so a future refactor can't regress just one entry
    // point silently.
    const client = createMockClient();
    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    await writePrismaConfig(cwd, "proj_123");
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runAppEnvList(context, {
        className: "production",
        branchName: "feature-auth",
      }),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("mutually exclusive"),
    });
    expect(client.GET).not.toHaveBeenCalled();
  });
});

describe("app env unset", () => {
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

    const result = await controllers.runAppEnvUnset(context, "STRIPE_KEY", {
      className: "production",
    });

    expect(client.DELETE).toHaveBeenCalledWith(
      "/v1/environment-variables/{envVarId}",
      expect.objectContaining({
        params: { path: { envVarId: "envvar_target" } },
      }),
    );
    expect(result.result).toEqual({
      projectId: "proj_123",
      scope: { kind: "class", class: "production" },
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
      controllers.runAppEnvUnset(context, "STRIPE_KEY", {
        className: "production",
      }),
    ).rejects.toMatchObject({
      code: "ENV_VARIABLE_NOT_FOUND",
    });
    expect(client.DELETE).not.toHaveBeenCalled();
  });

  it("rejects neither --class nor --branch (fail-fast on writes)", async () => {
    const client = createMockClient();
    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    await writePrismaConfig(cwd, "proj_123");
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runAppEnvUnset(context, "STRIPE_KEY", {}),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("requires --class or --branch"),
    });
    expect(client.DELETE).not.toHaveBeenCalled();
  });

  it("rejects --class and --branch supplied together", async () => {
    const client = createMockClient();
    const { controllers, createTempCwd, createTestCommandContext } =
      await loadControllers(client, "proj_123");
    const cwd = await createTempCwd();
    await writePrismaConfig(cwd, "proj_123");
    const { context } = await createTestCommandContext({ cwd });

    await expect(
      controllers.runAppEnvUnset(context, "STRIPE_KEY", {
        className: "production",
        branchName: "feature-auth",
      }),
    ).rejects.toMatchObject({
      summary: expect.stringContaining("mutually exclusive"),
    });
    expect(client.DELETE).not.toHaveBeenCalled();
  });
});

describe("legacy env command deprecation warnings", () => {
  it("prints a deprecation banner to stderr from `app update-env`", async () => {
    const updateAppEnv = vi.fn().mockResolvedValue({
      projectId: "proj_123",
      app: { id: "app_1", name: "hello-world", region: null, liveDeploymentId: "dep_1", liveUrl: null },
      deployment: {
        id: "dep_1",
        status: "running",
        url: null,
        createdAt: "2026-05-08T10:00:00.000Z",
        live: true,
      },
      variables: ["FOO"],
    });

    vi.doMock("../src/adapters/config", async () => {
      const actual =
        await vi.importActual<typeof import("../src/adapters/config")>(
          "../src/adapters/config",
        );
      return { ...actual, readLinkedProjectId: vi.fn().mockResolvedValue("proj_123") };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn().mockResolvedValue({ token: "t" }),
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        listApps: vi.fn().mockResolvedValue([
          { id: "app_1", name: "hello-world", region: null, liveDeploymentId: "dep_1", liveUrl: null },
        ]),
        listDeployments: vi.fn().mockResolvedValue({
          app: { id: "app_1", name: "hello-world", region: null, liveDeploymentId: "dep_1", liveUrl: null },
          deployments: [
            { id: "dep_1", status: "running", createdAt: "2026-05-08T10:00:00.000Z", url: null, live: null },
          ],
        }),
        updateAppEnv,
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppUpdateEnv } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const { context, stderr } = await createTestCommandContext({ cwd });

    await runAppUpdateEnv(context, "hello-world", ["FOO=bar"]);

    expect(stderr.buffer).toContain("[deprecation]");
    expect(stderr.buffer).toContain("prisma app update-env");
    expect(stderr.buffer).toContain("prisma app env set");
  });

  it("suppresses the deprecation banner under --json", async () => {
    const updateAppEnv = vi.fn().mockResolvedValue({
      projectId: "proj_123",
      app: { id: "app_1", name: "hello-world", region: null, liveDeploymentId: "dep_1", liveUrl: null },
      deployment: {
        id: "dep_1",
        status: "running",
        url: null,
        createdAt: "2026-05-08T10:00:00.000Z",
        live: true,
      },
      variables: ["FOO"],
    });

    vi.doMock("../src/adapters/config", async () => {
      const actual =
        await vi.importActual<typeof import("../src/adapters/config")>(
          "../src/adapters/config",
        );
      return { ...actual, readLinkedProjectId: vi.fn().mockResolvedValue("proj_123") };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn().mockResolvedValue({ token: "t" }),
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        listApps: vi.fn().mockResolvedValue([
          { id: "app_1", name: "hello-world", region: null, liveDeploymentId: "dep_1", liveUrl: null },
        ]),
        listDeployments: vi.fn().mockResolvedValue({
          app: { id: "app_1", name: "hello-world", region: null, liveDeploymentId: "dep_1", liveUrl: null },
          deployments: [
            { id: "dep_1", status: "running", createdAt: "2026-05-08T10:00:00.000Z", url: null, live: null },
          ],
        }),
        updateAppEnv,
      })),
    }));

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
    // Parity with the `app update-env` deprecation test: the legacy
    // `app list-env` command shares the same deprecation policy, so we
    // pin it here too to guard against future drift in either direction.
    vi.doMock("../src/adapters/config", async () => {
      const actual =
        await vi.importActual<typeof import("../src/adapters/config")>(
          "../src/adapters/config",
        );
      return { ...actual, readLinkedProjectId: vi.fn().mockResolvedValue("proj_123") };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn().mockResolvedValue({ token: "t" }),
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        listApps: vi.fn().mockResolvedValue([
          { id: "app_1", name: "hello-world", region: null, liveDeploymentId: "dep_1", liveUrl: null },
        ]),
        listDeployments: vi.fn().mockResolvedValue({
          app: { id: "app_1", name: "hello-world", region: null, liveDeploymentId: "dep_1", liveUrl: null },
          deployments: [
            { id: "dep_1", status: "running", createdAt: "2026-05-08T10:00:00.000Z", url: null, live: null },
          ],
        }),
        listAppEnvNames: vi.fn().mockResolvedValue({
          projectId: "proj_123",
          app: { id: "app_1", name: "hello-world", region: null, liveDeploymentId: "dep_1", liveUrl: null },
          deployment: {
            id: "dep_1",
            status: "running",
            createdAt: "2026-05-08T10:00:00.000Z",
            url: null,
            live: true,
          },
          variables: ["FOO"],
        }),
      })),
    }));

    const { createTempCwd, createTestCommandContext } = await import("./helpers");
    const { runAppListEnv } = await import("../src/controllers/app");
    const cwd = await createTempCwd();
    const { context, stderr } = await createTestCommandContext({ cwd });

    await runAppListEnv(context, "hello-world");

    expect(stderr.buffer).toContain("[deprecation]");
    expect(stderr.buffer).toContain("prisma app list-env");
    expect(stderr.buffer).toContain("prisma app env list");
  });

  it("suppresses the `app list-env` deprecation banner under --json", async () => {
    vi.doMock("../src/adapters/config", async () => {
      const actual =
        await vi.importActual<typeof import("../src/adapters/config")>(
          "../src/adapters/config",
        );
      return { ...actual, readLinkedProjectId: vi.fn().mockResolvedValue("proj_123") };
    });
    vi.doMock("../src/lib/auth/guard", () => ({
      requireComputeAuth: vi.fn().mockResolvedValue({ token: "t" }),
    }));
    vi.doMock("../src/lib/app/preview-provider", () => ({
      createPreviewAppProvider: vi.fn(() => ({
        listApps: vi.fn().mockResolvedValue([
          { id: "app_1", name: "hello-world", region: null, liveDeploymentId: "dep_1", liveUrl: null },
        ]),
        listDeployments: vi.fn().mockResolvedValue({
          app: { id: "app_1", name: "hello-world", region: null, liveDeploymentId: "dep_1", liveUrl: null },
          deployments: [
            { id: "dep_1", status: "running", createdAt: "2026-05-08T10:00:00.000Z", url: null, live: null },
          ],
        }),
        listAppEnvNames: vi.fn().mockResolvedValue({
          projectId: "proj_123",
          app: { id: "app_1", name: "hello-world", region: null, liveDeploymentId: "dep_1", liveUrl: null },
          deployment: {
            id: "dep_1",
            status: "running",
            createdAt: "2026-05-08T10:00:00.000Z",
            url: null,
            live: true,
          },
          variables: ["FOO"],
        }),
      })),
    }));

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
