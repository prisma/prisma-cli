import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@prisma/compute-sdk");
  vi.resetModules();
  vi.restoreAllMocks();
});

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
