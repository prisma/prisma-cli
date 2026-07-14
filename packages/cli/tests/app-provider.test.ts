import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@prisma/compute-sdk");
  vi.doUnmock("../src/lib/app/build");
  vi.resetModules();
  vi.restoreAllMocks();
});

function mockAppBuildStrategy() {
  return vi.fn().mockImplementation(function AppBuildStrategyMock(
    options: object,
  ) {
    return { options };
  });
}

describe("preview app provider", () => {
  it("resolves branch role from the API without deriving it from name or isDefault", async () => {
    const client = {
      GET: vi.fn().mockResolvedValue({
        data: {
          data: [
            {
              id: "br_production",
              gitName: "production",
              isDefault: true,
              role: "preview",
            },
          ],
          pagination: { hasMore: false, nextCursor: null },
        },
        response: { status: 200 },
      }),
      POST: vi.fn(),
    };

    vi.doMock("@prisma/compute-sdk", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@prisma/compute-sdk")>()),
      ApiError: { is: () => false },
      ComputeClient: class {},
    }));

    const { createAppProvider } = await import("../src/lib/app/app-provider");

    const provider = createAppProvider(client as never);
    await expect(
      provider.resolveBranch("proj_123", {
        branchName: "production",
      }),
    ).resolves.toEqual({
      id: "br_production",
      name: "production",
      role: "preview",
    });
    expect(client.POST).not.toHaveBeenCalled();
  });

  it("forwards build strategy options and port mapping into compute deploy", async () => {
    const deploy = vi.fn().mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: {
        projectId: "proj_123",
        appId: "app_1",
        appName: "hello-world",
        region: "eu-central-1",
        deploymentId: "dep_123",
        deploymentEndpointDomain: "cv-123.fra.prisma.build",
        appEndpointDomain: "hello-world.fra.prisma.build",
      },
    });
    const AppBuildStrategy = mockAppBuildStrategy();

    vi.doMock("../src/lib/app/build", () => ({
      AppBuildStrategy,
    }));
    vi.doMock("@prisma/compute-sdk", () => ({
      ApiError: { is: () => false },
      ComputeClient: class {
        deploy = deploy;
      },
    }));

    const { createAppProvider } = await import("../src/lib/app/app-provider");

    const provider = createAppProvider({} as never);
    const cwd = path.resolve("/tmp/next-smoke");

    await provider.deployApp({
      cwd,
      projectId: "proj_123",
      appName: "hello-world",
      buildType: "nextjs",
      entrypoint: undefined,
      portMapping: { http: 3000 },
    });

    expect(AppBuildStrategy).toHaveBeenCalledWith({
      appPath: cwd,
      entrypoint: undefined,
      buildType: "nextjs",
    });
    expect(deploy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_123",
        appName: "hello-world",
        portMapping: { http: 3000 },
      }),
    );
  });

  it("creates a branch-scoped service before deploying a new branch app", async () => {
    const deploy = vi.fn().mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: {
        projectId: "proj_123",
        appId: "svc_branch",
        appName: "hello-world",
        region: "eu-central-1",
        deploymentId: "dep_123",
        deploymentEndpointDomain: "cv-123.fra.prisma.build",
        appEndpointDomain: "hello-world.fra.prisma.build",
      },
    });
    const AppBuildStrategy = mockAppBuildStrategy();
    const client = {
      GET: vi.fn().mockResolvedValue({
        data: {
          data: [],
          pagination: { hasMore: false, nextCursor: null },
        },
        response: { status: 200 },
      }),
      POST: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/projects/{projectId}/branches") {
          return {
            data: {
              data: {
                id: "br_billing",
                gitName: "feat/billing",
                isDefault: false,
                role: "preview",
              },
            },
            response: { status: 201 },
          };
        }

        if (pathName === "/v1/apps") {
          return {
            data: {
              data: {
                id: "svc_branch",
                type: "app",
                name: "hello-world",
                region: { id: "eu-central-1", name: "Europe (Frankfurt)" },
                projectId: "proj_123",
                branchId: "br_billing",
                latestDeploymentId: null,
                appEndpointDomain: "hello-world.fra.prisma.build",
              },
            },
            response: { status: 201 },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
    };

    vi.doMock("../src/lib/app/build", () => ({
      AppBuildStrategy,
    }));
    vi.doMock("@prisma/compute-sdk", () => ({
      ApiError: { is: () => false },
      ComputeClient: class {
        deploy = deploy;
      },
    }));

    const { createAppProvider } = await import("../src/lib/app/app-provider");

    const provider = createAppProvider(client as never);
    const cwd = path.resolve("/tmp/next-smoke");

    await provider.deployApp({
      cwd,
      projectId: "proj_123",
      branchName: "feat/billing",
      appName: "hello-world",
      buildType: "nextjs",
      portMapping: { http: 3000 },
    });

    expect(client.GET).toHaveBeenCalledWith(
      "/v1/projects/{projectId}/branches",
      expect.objectContaining({
        params: {
          path: { projectId: "proj_123" },
          query: { gitName: "feat/billing" },
        },
      }),
    );
    expect(client.POST).toHaveBeenCalledWith(
      "/v1/projects/{projectId}/branches",
      expect.objectContaining({
        body: {
          gitName: "feat/billing",
        },
      }),
    );
    expect(client.POST).toHaveBeenCalledWith(
      "/v1/apps",
      expect.objectContaining({
        body: {
          projectId: "proj_123",
          branchId: "br_billing",
          displayName: "hello-world",
        },
      }),
    );
    expect(deploy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_123",
        appId: "svc_branch",
        appName: "hello-world",
        portMapping: { http: 3000 },
      }),
    );
  });

  it("includes regionId in app POST body when region is specified", async () => {
    const deploy = vi.fn().mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: {
        projectId: "proj_123",
        appId: "svc_branch",
        appName: "hello-world",
        region: "us-east-1",
        deploymentId: "dep_123",
        deploymentEndpointDomain: "cv-123.iad.prisma.build",
        appEndpointDomain: "hello-world.iad.prisma.build",
      },
    });
    const AppBuildStrategy = mockAppBuildStrategy();
    const client = {
      GET: vi.fn().mockResolvedValue({
        data: {
          data: [],
          pagination: { hasMore: false, nextCursor: null },
        },
        response: { status: 200 },
      }),
      POST: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/projects/{projectId}/branches") {
          return {
            data: {
              data: {
                id: "br_billing",
                gitName: "feat/billing",
                isDefault: false,
                role: "preview",
              },
            },
            response: { status: 201 },
          };
        }

        if (pathName === "/v1/apps") {
          return {
            data: {
              data: {
                id: "svc_branch",
                type: "app",
                name: "hello-world",
                region: { id: "us-east-1", name: "US East (N. Virginia)" },
                projectId: "proj_123",
                branchId: "br_billing",
                latestDeploymentId: null,
                appEndpointDomain: "hello-world.iad.prisma.build",
              },
            },
            response: { status: 201 },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
    };

    vi.doMock("../src/lib/app/build", () => ({
      AppBuildStrategy,
    }));
    vi.doMock("@prisma/compute-sdk", () => ({
      ApiError: { is: () => false },
      ComputeClient: class {
        deploy = deploy;
      },
    }));

    const { createAppProvider } = await import("../src/lib/app/app-provider");

    const provider = createAppProvider(client as never);
    const cwd = path.resolve("/tmp/next-smoke");

    await provider.deployApp({
      cwd,
      projectId: "proj_123",
      branchName: "feat/billing",
      appName: "hello-world",
      region: "us-east-1",
      buildType: "nextjs",
      portMapping: { http: 3000 },
    });

    expect(client.POST).toHaveBeenCalledWith(
      "/v1/apps",
      expect.objectContaining({
        body: {
          projectId: "proj_123",
          branchId: "br_billing",
          displayName: "hello-world",
          regionId: "us-east-1",
        },
      }),
    );
  });

  it("uses an existing branch-scoped service when app creation races", async () => {
    const deploy = vi.fn().mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: {
        projectId: "proj_123",
        appId: "svc_branch",
        appName: "hello-world",
        region: "eu-central-1",
        deploymentId: "dep_123",
        deploymentEndpointDomain: "cv-123.fra.prisma.build",
        appEndpointDomain: "hello-world.fra.prisma.build",
      },
    });
    const AppBuildStrategy = mockAppBuildStrategy();
    const client = {
      GET: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/projects/{projectId}/branches") {
          return {
            data: {
              data: [
                {
                  id: "br_billing",
                  gitName: "feat/billing",
                  isDefault: false,
                  role: "preview",
                },
              ],
              pagination: { hasMore: false, nextCursor: null },
            },
            response: { status: 200 },
          };
        }

        if (pathName === "/v1/apps") {
          return {
            data: {
              data: [
                {
                  id: "svc_branch",
                  type: "app",
                  name: "hello-world",
                  region: { id: "eu-central-1", name: "Europe (Frankfurt)" },
                  projectId: "proj_123",
                  branchId: "br_billing",
                  latestDeploymentId: null,
                  appEndpointDomain: "hello-world.fra.prisma.build",
                },
              ],
              pagination: { hasMore: false, nextCursor: null },
            },
            response: { status: 200 },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
      POST: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/apps") {
          return {
            error: {
              error: {
                code: "CONFLICT",
                message: "Compute service already exists.",
              },
            },
            response: { status: 409 },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
    };

    vi.doMock("../src/lib/app/build", () => ({
      AppBuildStrategy,
    }));
    vi.doMock("@prisma/compute-sdk", () => ({
      ApiError: { is: () => false },
      ComputeClient: class {
        deploy = deploy;
      },
    }));

    const { createAppProvider } = await import("../src/lib/app/app-provider");

    const provider = createAppProvider(client as never);
    const cwd = path.resolve("/tmp/next-smoke");

    await provider.deployApp({
      cwd,
      projectId: "proj_123",
      branchName: "feat/billing",
      appName: "hello-world",
      buildType: "nextjs",
      portMapping: { http: 3000 },
    });

    expect(client.POST).toHaveBeenCalledWith(
      "/v1/apps",
      expect.objectContaining({
        body: {
          projectId: "proj_123",
          branchId: "br_billing",
          displayName: "hello-world",
        },
      }),
    );
    expect(client.GET).toHaveBeenCalledWith(
      "/v1/apps",
      expect.objectContaining({
        params: {
          query: {
            projectId: "proj_123",
            branchGitName: "feat/billing",
            cursor: undefined,
          },
        },
      }),
    );
    expect(deploy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_123",
        appId: "svc_branch",
        appName: "hello-world",
        portMapping: { http: 3000 },
      }),
    );
  });

  it("forwards skipPromote and maps a promotionless deploy to the candidate", async () => {
    const deploy = vi.fn().mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: {
        projectId: "proj_123",
        appId: "app_1",
        appName: "hello-world",
        region: "eu-central-1",
        deploymentId: "dep_new",
        deploymentEndpointDomain: "dep-new.fra.prisma.build",
        appEndpointDomain: null,
        promoted: false,
        previousDeploymentId: "dep_live",
        previousDeploymentAction: "still-active",
      },
    });
    const AppBuildStrategy = mockAppBuildStrategy();

    vi.doMock("../src/lib/app/build", () => ({
      AppBuildStrategy,
    }));
    vi.doMock("@prisma/compute-sdk", () => ({
      ApiError: { is: () => false },
      ComputeClient: class {
        deploy = deploy;
      },
    }));

    const { createAppProvider } = await import("../src/lib/app/app-provider");

    const provider = createAppProvider({} as never);
    const cwd = path.resolve("/tmp/next-smoke");

    const record = await provider.deployApp({
      cwd,
      projectId: "proj_123",
      appId: "app_1",
      appName: "hello-world",
      buildType: "nextjs",
      portMapping: { http: 3000 },
      skipPromote: true,
    });

    expect(deploy).toHaveBeenCalledWith(
      expect.objectContaining({ skipPromote: true }),
    );
    expect(record).toEqual({
      projectId: "proj_123",
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_live",
        liveUrl: null,
      },
      deployment: {
        id: "dep_new",
        status: "running",
        url: "https://dep-new.fra.prisma.build",
        live: false,
      },
      promoted: false,
    });
  });

  it("maps a promoted deploy to the live app URL", async () => {
    const deploy = vi.fn().mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: {
        projectId: "proj_123",
        appId: "app_1",
        appName: "hello-world",
        region: "eu-central-1",
        deploymentId: "dep_new",
        deploymentEndpointDomain: "dep-new.fra.prisma.build",
        appEndpointDomain: "hello-world.fra.prisma.build",
        promoted: true,
        previousDeploymentId: "dep_live",
        previousDeploymentAction: "stopped",
      },
    });
    const AppBuildStrategy = mockAppBuildStrategy();

    vi.doMock("../src/lib/app/build", () => ({
      AppBuildStrategy,
    }));
    vi.doMock("@prisma/compute-sdk", () => ({
      ApiError: { is: () => false },
      ComputeClient: class {
        deploy = deploy;
      },
    }));

    const { createAppProvider } = await import("../src/lib/app/app-provider");

    const provider = createAppProvider({} as never);

    const record = await provider.deployApp({
      cwd: path.resolve("/tmp/next-smoke"),
      projectId: "proj_123",
      appId: "app_1",
      appName: "hello-world",
      buildType: "nextjs",
      portMapping: { http: 3000 },
    });

    expect(deploy).toHaveBeenCalledWith(
      expect.objectContaining({ skipPromote: undefined }),
    );
    expect(record).toEqual({
      projectId: "proj_123",
      app: {
        id: "app_1",
        name: "hello-world",
        region: "eu-central-1",
        liveDeploymentId: "dep_new",
        liveUrl: "https://hello-world.fra.prisma.build",
      },
      deployment: {
        id: "dep_new",
        status: "running",
        url: "https://hello-world.fra.prisma.build",
        live: true,
      },
      promoted: true,
    });
  });

  it("treats re-adding an existing custom domain as idempotent", async () => {
    const client = {
      GET: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/apps/{appId}/domains") {
          return {
            data: {
              data: [
                {
                  id: "dom_123",
                  type: "custom-domain",
                  url: "https://api.prisma.io/v1/domains/dom_123",
                  hostname: "shop.acme.com",
                  appId: "app_1",
                  status: "active",
                  foundryStatus: "active",
                  failureReason: null,
                  failureCategory: null,
                  certExpiresAt: null,
                  createdAt: "2026-05-22T09:14:00.000Z",
                  updatedAt: "2026-05-22T09:14:00.000Z",
                },
              ],
              pagination: { hasMore: false, nextCursor: null },
            },
            response: { status: 200 },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
      POST: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/apps/{appId}/domains") {
          return {
            error: {
              error: {
                code: "CONFLICT",
                message: "Hostname already registered.",
              },
            },
            response: { status: 409 },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
    };

    vi.doMock("@prisma/compute-sdk", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@prisma/compute-sdk")>()),
      ApiError: { is: () => false },
      ComputeClient: class {},
    }));

    const { createAppProvider } = await import("../src/lib/app/app-provider");

    const provider = createAppProvider(client as never);
    const result = await provider.addDomain({
      appId: "app_1",
      hostname: "Shop.Acme.com",
    });

    expect(result).toMatchObject({
      existing: true,
      domain: {
        id: "dom_123",
        hostname: "shop.acme.com",
        status: "active",
      },
    });
    expect(client.POST).toHaveBeenCalledWith(
      "/v1/apps/{appId}/domains",
      expect.objectContaining({
        params: {
          path: { appId: "app_1" },
        },
        body: {
          hostname: "Shop.Acme.com",
        },
      }),
    );
    expect(client.GET).toHaveBeenCalledWith(
      "/v1/apps/{appId}/domains",
      expect.objectContaining({
        params: {
          path: { appId: "app_1" },
        },
      }),
    );
  });

  it("surfaces domain conflicts when the hostname is not on the selected app", async () => {
    const client = {
      GET: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/apps/{appId}/domains") {
          return {
            data: {
              data: [
                {
                  id: "dom_123",
                  type: "custom-domain",
                  url: "https://api.prisma.io/v1/domains/dom_123",
                  hostname: "other.acme.com",
                  appId: "app_1",
                  status: "active",
                  foundryStatus: "active",
                  failureReason: null,
                  failureCategory: null,
                  certExpiresAt: null,
                  createdAt: "2026-05-22T09:14:00.000Z",
                  updatedAt: "2026-05-22T09:14:00.000Z",
                },
              ],
              pagination: { hasMore: false, nextCursor: null },
            },
            response: { status: 200 },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
      POST: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/apps/{appId}/domains") {
          return {
            error: {
              error: {
                code: "CONFLICT",
                message: "Hostname already registered.",
              },
            },
            response: { status: 409 },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
    };

    vi.doMock("@prisma/compute-sdk", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@prisma/compute-sdk")>()),
      ApiError: { is: () => false },
      ComputeClient: class {},
    }));

    const { createAppProvider } = await import("../src/lib/app/app-provider");

    const provider = createAppProvider(client as never);

    await expect(
      provider.addDomain({
        appId: "app_1",
        hostname: "shop.acme.com",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
  });
});
