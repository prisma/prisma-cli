import type { paths } from "@prisma/management-api-sdk";

/** A hostname on a service, as `GET /v1/urls/{id}` returns it. */
export type RawDomain =
  paths["/v1/urls/{id}"]["get"]["responses"][200]["content"]["application/json"]["data"];

/**
 * A hostname just added to `svc_1`: ownership not yet proven, so it
 * lists the TXT record that proves it and the CNAME that routes it.
 */
export function domainRecord(overrides: Partial<RawDomain> = {}): RawDomain {
  return {
    id: "url_1",
    type: "routingUrl",
    branchId: "br_1",
    serviceId: "svc_1",
    hostname: "shop.acme.com",
    logicalId: null,
    status: "pending",
    state: "not_verified",
    conditions: {
      ownershipVerified: "unmet",
      servicePresent: "met",
      liveDeployment: "met",
      dnsPointsAtSwitchboard: "unknown",
      customDomainBound: "unmet",
      certificateActive: "unmet",
    },
    firstUnmetCondition: "ownershipVerified",
    ownershipExpiry: null,
    records: [
      {
        condition: "ownershipVerified",
        type: "TXT",
        name: "_prisma-verification.shop.acme.com",
        value: "prisma-verification=3f9a",
        ttl: 300,
      },
      {
        condition: "dnsPointsAtSwitchboard",
        type: "CNAME",
        name: "shop.acme.com",
        value: "switchboard.cdg.prisma.build",
        ttl: 300,
      },
    ],
    heldBy: null,
    customDomain: null,
    customDomainSyncError: null,
    switchboardDns: null,
    setupUrl:
      "https://console.prisma.io/ws_1/proj_1/compute/svc_1/domains?setup=shop.acme.com",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A hostname whose ownership is proven and whose CNAME is still missing. */
export function waitingForDnsRecord(
  overrides: Partial<RawDomain> = {},
): RawDomain {
  return domainRecord({
    state: "waiting_for_dns",
    conditions: {
      ownershipVerified: "met",
      servicePresent: "met",
      liveDeployment: "met",
      dnsPointsAtSwitchboard: "unmet",
      customDomainBound: "unmet",
      certificateActive: "unmet",
    },
    firstUnmetCondition: "dnsPointsAtSwitchboard",
    records: [
      {
        condition: "dnsPointsAtSwitchboard",
        type: "CNAME",
        name: "shop.acme.com",
        value: "switchboard.cdg.prisma.build",
        ttl: 300,
      },
    ],
    ...overrides,
  });
}

/** A hostname that serves the service. */
export function activeRecord(overrides: Partial<RawDomain> = {}): RawDomain {
  return domainRecord({
    status: "active",
    state: "active",
    conditions: {
      ownershipVerified: "met",
      servicePresent: "met",
      liveDeployment: "met",
      dnsPointsAtSwitchboard: "met",
      customDomainBound: "met",
      certificateActive: "met",
    },
    firstUnmetCondition: null,
    records: [],
    setupUrl: null,
    ...overrides,
  });
}

type RawCustomDomain = NonNullable<RawDomain["customDomain"]>;

/** The Foundry custom domain an entry holds once it holds the hostname. */
export function customDomain(
  overrides: Partial<RawCustomDomain> = {},
): RawCustomDomain {
  return {
    id: "cd_1",
    status: "active",
    failureReason: null,
    certExpiresAt: "2026-11-01T00:00:00.000Z",
    lastSeenAt: "2026-08-02T00:05:00.000Z",
    certificateRetryRequestedAt: null,
    certificateIssuanceStuck: false,
    ...overrides,
  };
}

/**
 * Two entries a service can list for one hostname: an older one that
 * never proved ownership, and a newer one that holds the hostname and
 * serves it.
 */
export function duplicateEntries(): [RawDomain, RawDomain] {
  return [
    domainRecord({ id: "url_1", createdAt: "2026-08-01T00:00:00.000Z" }),
    activeRecord({
      id: "url_2",
      customDomain: customDomain(),
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    }),
  ];
}
