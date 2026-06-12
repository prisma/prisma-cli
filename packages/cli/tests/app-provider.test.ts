import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@prisma/compute-sdk");
  vi.doUnmock("../src/lib/app/preview-build");
  vi.resetModules();
  vi.restoreAllMocks();
});

function mockPreviewBuildStrategy() {
  return vi.fn().mockImplementation(function (options: object) {
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

    vi.doMock("@prisma/compute-sdk", () => ({
      ApiError: { is: () => false },
      ComputeClient: class {},
    }));

    const { createPreviewAppProvider } = await import(
      "../src/lib/app/preview-provider"
    );

    const provider = createPreviewAppProvider(client as never);
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
        serviceId: "app_1",
        serviceName: "hello-world",
        region: "eu-central-1",
        versionId: "dep_123",
        versionEndpointDomain: "cv-123.fra.prisma.build",
        serviceEndpointDomain: "hello-world.fra.prisma.build",
      },
    });
    const PreviewBuildStrategy = mockPreviewBuildStrategy();

    vi.doMock("../src/lib/app/preview-build", () => ({
      PreviewBuildStrategy,
    }));
    vi.doMock("@prisma/compute-sdk", () => ({
      ApiError: { is: () => false },
      ComputeClient: class {
        deploy = deploy;
      },
    }));

    const { createPreviewAppProvider } = await import(
      "../src/lib/app/preview-provider"
    );

    const provider = createPreviewAppProvider({} as never);
    const cwd = path.resolve("/tmp/next-smoke");

    await provider.deployApp({
      cwd,
      projectId: "proj_123",
      appName: "hello-world",
      buildType: "nextjs",
      entrypoint: undefined,
      portMapping: { http: 3000 },
    });

    expect(PreviewBuildStrategy).toHaveBeenCalledWith({
      appPath: cwd,
      entrypoint: undefined,
      buildType: "nextjs",
    });
    expect(deploy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_123",
        serviceName: "hello-world",
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
        serviceId: "svc_branch",
        serviceName: "hello-world",
        region: "eu-central-1",
        versionId: "dep_123",
        versionEndpointDomain: "cv-123.fra.prisma.build",
        serviceEndpointDomain: "hello-world.fra.prisma.build",
      },
    });
    const PreviewBuildStrategy = mockPreviewBuildStrategy();
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

        if (pathName === "/v1/compute-services") {
          return {
            data: {
              data: {
                id: "svc_branch",
                name: "hello-world",
                region: { id: "eu-central-1", name: "Europe (Frankfurt)" },
                projectId: "proj_123",
                branchId: "br_billing",
                latestVersionId: null,
                serviceEndpointDomain: "hello-world.fra.prisma.build",
              },
            },
            response: { status: 201 },
          };
        }

        throw new Error(`Unexpected path ${pathName}`);
      }),
    };

    vi.doMock("../src/lib/app/preview-build", () => ({
      PreviewBuildStrategy,
    }));
    vi.doMock("@prisma/compute-sdk", () => ({
      ApiError: { is: () => false },
      ComputeClient: class {
        deploy = deploy;
      },
    }));

    const { createPreviewAppProvider } = await import(
      "../src/lib/app/preview-provider"
    );

    const provider = createPreviewAppProvider(client as never);
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
      "/v1/compute-services",
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
        serviceId: "svc_branch",
        serviceName: "hello-world",
        portMapping: { http: 3000 },
      }),
    );
  });

  it("uses an existing branch-scoped service when app creation races", async () => {
    const deploy = vi.fn().mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: {
        projectId: "proj_123",
        serviceId: "svc_branch",
        serviceName: "hello-world",
        region: "eu-central-1",
        versionId: "dep_123",
        versionEndpointDomain: "cv-123.fra.prisma.build",
        serviceEndpointDomain: "hello-world.fra.prisma.build",
      },
    });
    const PreviewBuildStrategy = mockPreviewBuildStrategy();
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

        if (pathName === "/v1/compute-services") {
          return {
            data: {
              data: [
                {
                  id: "svc_branch",
                  name: "hello-world",
                  region: { id: "eu-central-1", name: "Europe (Frankfurt)" },
                  projectId: "proj_123",
                  branchId: "br_billing",
                  latestVersionId: null,
                  serviceEndpointDomain: "hello-world.fra.prisma.build",
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
        if (pathName === "/v1/compute-services") {
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

    vi.doMock("../src/lib/app/preview-build", () => ({
      PreviewBuildStrategy,
    }));
    vi.doMock("@prisma/compute-sdk", () => ({
      ApiError: { is: () => false },
      ComputeClient: class {
        deploy = deploy;
      },
    }));

    const { createPreviewAppProvider } = await import(
      "../src/lib/app/preview-provider"
    );

    const provider = createPreviewAppProvider(client as never);
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
      "/v1/compute-services",
      expect.objectContaining({
        body: {
          projectId: "proj_123",
          branchId: "br_billing",
          displayName: "hello-world",
        },
      }),
    );
    expect(client.GET).toHaveBeenCalledWith(
      "/v1/compute-services",
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
        serviceId: "svc_branch",
        serviceName: "hello-world",
        portMapping: { http: 3000 },
      }),
    );
  });

  it("treats re-adding an existing custom domain as idempotent", async () => {
    const client = {
      GET: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/compute-services/{computeServiceId}/domains") {
          return {
            data: {
              data: [
                {
                  id: "dom_123",
                  type: "custom-domain",
                  url: "https://api.prisma.io/v1/domains/dom_123",
                  hostname: "shop.acme.com",
                  computeServiceId: "app_1",
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
        if (pathName === "/v1/compute-services/{computeServiceId}/domains") {
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

    vi.doMock("@prisma/compute-sdk", () => ({
      ApiError: { is: () => false },
      ComputeClient: class {},
    }));

    const { createPreviewAppProvider } = await import(
      "../src/lib/app/preview-provider"
    );

    const provider = createPreviewAppProvider(client as never);
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
      "/v1/compute-services/{computeServiceId}/domains",
      expect.objectContaining({
        params: {
          path: { computeServiceId: "app_1" },
        },
        body: {
          hostname: "Shop.Acme.com",
        },
      }),
    );
    expect(client.GET).toHaveBeenCalledWith(
      "/v1/compute-services/{computeServiceId}/domains",
      expect.objectContaining({
        params: {
          path: { computeServiceId: "app_1" },
        },
      }),
    );
  });

  it("surfaces domain conflicts when the hostname is not on the selected app", async () => {
    const client = {
      GET: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/compute-services/{computeServiceId}/domains") {
          return {
            data: {
              data: [
                {
                  id: "dom_123",
                  type: "custom-domain",
                  url: "https://api.prisma.io/v1/domains/dom_123",
                  hostname: "other.acme.com",
                  computeServiceId: "app_1",
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
        if (pathName === "/v1/compute-services/{computeServiceId}/domains") {
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

    vi.doMock("@prisma/compute-sdk", () => ({
      ApiError: { is: () => false },
      ComputeClient: class {},
    }));

    const { createPreviewAppProvider } = await import(
      "../src/lib/app/preview-provider"
    );

    const provider = createPreviewAppProvider(client as never);

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
