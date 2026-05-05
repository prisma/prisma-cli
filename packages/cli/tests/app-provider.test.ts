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
});
