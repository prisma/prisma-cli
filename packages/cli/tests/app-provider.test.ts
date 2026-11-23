import { afterEach, describe, expect, it, vi } from "vitest";
import { activeRecord, domainRecord } from "./helpers/routing-url";

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

  it("adds the hostname with a domain ownership and returns it pending with the records to publish", async () => {
    const client = {
      GET: vi.fn(),
      POST: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/services/{serviceId}/urls") {
          return {
            data: { data: domainRecord({ id: "url_123" }) },
            response: { status: 201, headers: new Headers() },
          };
        }
        throw new Error(`Unexpected path ${pathName}`);
      }),
    };
    const { createAppProvider } = await importProvider();

    const domain = await createAppProvider(client as never).addDomain({
      appId: "svc_1",
      hostname: "shop.acme.com",
    });

    expect(domain).toMatchObject({
      id: "url_123",
      appId: "svc_1",
      status: "pending",
      state: "not_verified",
      firstUnmetCondition: "ownershipVerified",
      holdsHostname: false,
      dnsRecords: [
        { condition: "ownershipVerified", type: "TXT" },
        { condition: "dnsPointsAtSwitchboard", type: "CNAME" },
      ],
    });
    expect(client.POST).toHaveBeenCalledWith(
      "/v1/services/{serviceId}/urls",
      expect.objectContaining({
        params: { path: { serviceId: "svc_1" } },
        body: { hostname: "shop.acme.com", createDomainOwnership: true },
      }),
    );
    expect(client.GET).not.toHaveBeenCalled();
  });

  it("marks an entry that has a custom domain as the one holding the hostname", async () => {
    const client = {
      GET: vi.fn().mockResolvedValue({
        data: {
          data: [
            domainRecord({ id: "url_1" }),
            activeRecord({
              id: "url_2",
              customDomain: {
                id: "cd_1",
                status: "active",
                failureReason: null,
                certExpiresAt: "2026-11-01T00:00:00.000Z",
                lastSeenAt: "2026-08-01T00:05:00.000Z",
                certificateRetryRequestedAt: null,
                certificateIssuanceStuck: false,
              },
            }),
          ],
          pagination: { hasMore: false, nextCursor: null },
        },
        response: { status: 200, headers: new Headers() },
      }),
      POST: vi.fn(),
    };
    const { createAppProvider } = await importProvider();

    const domains = await createAppProvider(client as never).listDomains(
      "svc_1",
    );

    expect(
      domains.map(({ id, holdsHostname }) => ({ id, holdsHostname })),
    ).toEqual([
      { id: "url_1", holdsHostname: false },
      { id: "url_2", holdsHostname: true },
    ]);
  });

  it("rejects a refused add with the API's status and code", async () => {
    const client = {
      GET: vi.fn(),
      POST: vi.fn().mockResolvedValue({
        error: {
          error: {
            code: "quota-exceeded",
            message: "This workspace has 100 custom domains.",
          },
        },
        response: { status: 409, headers: new Headers() },
      }),
    };
    const { createAppProvider, DomainApiError } = await importProvider();

    const rejection = createAppProvider(client as never).addDomain({
      appId: "svc_1",
      hostname: "shop.acme.com",
    });

    await expect(rejection).rejects.toBeInstanceOf(DomainApiError);
    await expect(rejection).rejects.toMatchObject({
      status: 409,
      code: "quota-exceeded",
      apiMessage: "This workspace has 100 custom domains.",
    });
  });

  it.each([
    { header: "90", retryAfterSeconds: 90 },
    { header: undefined, retryAfterSeconds: null },
    { header: "Wed, 21 Oct 2026 07:28:00 GMT", retryAfterSeconds: null },
  ])("carries Retry-After $header from a 429 check as $retryAfterSeconds seconds", async ({
    header,
    retryAfterSeconds,
  }) => {
    const client = {
      GET: vi.fn(),
      POST: vi.fn().mockImplementation((pathName: string) => {
        if (pathName === "/v1/urls/{id}/check") {
          return {
            error: {
              error: {
                code: "rate-limited",
                message: "Too many certificate orders.",
              },
            },
            response: {
              status: 429,
              headers: new Headers(
                header === undefined ? {} : { "Retry-After": header },
              ),
            },
          };
        }
        throw new Error(`Unexpected path ${pathName}`);
      }),
    };
    const { createAppProvider } = await importProvider();

    await expect(
      createAppProvider(client as never).checkDomain("url_123"),
    ).rejects.toMatchObject({ status: 429, retryAfterSeconds });
    expect(client.POST).toHaveBeenCalledWith(
      "/v1/urls/{id}/check",
      expect.objectContaining({ params: { path: { id: "url_123" } } }),
    );
  });
});

async function importProvider() {
  vi.doMock("@prisma/compute-sdk", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@prisma/compute-sdk")>()),
    ApiError: { is: () => false },
    ComputeClient: class {},
  }));
  return import("../src/lib/app/app-provider");
}
