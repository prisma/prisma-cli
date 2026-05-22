import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@prisma/compute-sdk");
  vi.doUnmock("../src/lib/app/preview-build");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("preview app provider", () => {
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
    const PreviewBuildStrategy = vi.fn().mockImplementation((options: object) => ({ options }));

    vi.doMock("../src/lib/app/preview-build", () => ({
      PreviewBuildStrategy,
    }));
    vi.doMock("@prisma/compute-sdk", () => ({
      ApiError: { is: () => false },
      ComputeClient: class {
        deploy = deploy;
      },
    }));

    const { createPreviewAppProvider } = await import("../src/lib/app/preview-provider");

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
    const PreviewBuildStrategy = vi.fn().mockImplementation((options: object) => ({ options }));
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

    const { createPreviewAppProvider } = await import("../src/lib/app/preview-provider");

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
          isDefault: false,
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
});
