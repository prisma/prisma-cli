import { describe, expect, it } from "vitest";
import type { DomainRecord } from "../src/lib/app/app-provider";
import { domainStateGuidance } from "../src/lib/app/domain-guidance";

type GuidanceInput = Parameters<typeof domainStateGuidance>[0];

const TXT: DomainRecord["dnsRecords"][number] = {
  condition: "ownershipVerified",
  type: "TXT",
  name: "_prisma-verification.shop.acme.com",
  value: "prisma-verification=3f9a",
  ttl: 300,
};

const CNAME: DomainRecord["dnsRecords"][number] = {
  condition: "dnsPointsAtSwitchboard",
  type: "CNAME",
  name: "shop.acme.com",
  value: "switchboard.cdg.prisma.build",
  ttl: 300,
};

const APEX_NOTE =
  "At an apex domain, publish the CNAME as an ALIAS, ANAME or flattened CNAME with the same target.";

function input(overrides: Partial<GuidanceInput>): GuidanceInput {
  return {
    hostname: "shop.acme.com",
    state: "active",
    dnsRecords: [],
    failureReason: null,
    syncError: null,
    dnsDetail: null,
    heldBy: null,
    ...overrides,
  };
}

const RETRY =
  "prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch production";

function guidance(domain: GuidanceInput) {
  return domainStateGuidance(domain, RETRY);
}

describe("domainStateGuidance", () => {
  it("has nothing to say about an active hostname", () => {
    expect(guidance(input({ state: "active" }))).toBeNull();
  });

  it("asks for every listed record while ownership is not verified", () => {
    expect(
      guidance(input({ state: "not_verified", dnsRecords: [TXT, CNAME] })),
    ).toEqual({
      waitingOn: "Proof in DNS that this workspace owns the domain.",
      fix: `Publish TXT _prisma-verification.shop.acme.com -> prisma-verification=3f9a and CNAME shop.acme.com -> switchboard.cdg.prisma.build at your DNS provider, then run prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch production. ${APEX_NOTE}`,
    });
  });

  it("says to add the hostname again when no record proves ownership", () => {
    expect(guidance(input({ state: "not_verified", dnsRecords: [] }))).toEqual({
      waitingOn: "Proof in DNS that this workspace owns the domain.",
      fix: "No domain ownership in this workspace covers shop.acme.com. Delete the hostname and add it again to create one.",
    });
  });

  it("says the service is gone", () => {
    expect(guidance(input({ state: "no_service" }))).toEqual({
      waitingOn: "The service this hostname routed to was deleted.",
      fix: "Delete the hostname, then add it to the service that should serve it.",
    });
  });

  it("asks for a live version, and for the CNAME when one is listed", () => {
    expect(
      guidance(input({ state: "no_live_deployment", dnsRecords: [CNAME] })),
    ).toEqual({
      waitingOn: "The service has no live version.",
      fix: `Deploy the service or promote one of its versions. Also publish CNAME shop.acme.com -> switchboard.cdg.prisma.build. ${APEX_NOTE}`,
    });
    expect(guidance(input({ state: "no_live_deployment" }))?.fix).toBe(
      "Deploy the service or promote one of its versions.",
    );
  });

  it("explains a failed update with the platform's error and asks nothing of the user", () => {
    expect(
      guidance(
        input({
          state: "update_failed",
          syncError: "Foundry answered HTTP 503",
        }),
      ),
    ).toEqual({
      waitingOn:
        "The platform could not bring the hostname up to date: Foundry answered HTTP 503. It tries again on its own.",
      fix: null,
    });
    expect(guidance(input({ state: "update_failed" }))?.waitingOn).toBe(
      "The platform could not bring the hostname up to date. It tries again on its own.",
    );
  });

  it("names the service that holds the hostname and says to delete it there", () => {
    expect(
      guidance(
        input({
          state: "in_use_elsewhere",
          heldBy: {
            workspaceId: "ws_1",
            projectId: "proj_2",
            serviceId: "svc_2",
            message: null,
          },
        }),
      ),
    ).toEqual({
      waitingOn:
        "Another service holds this hostname: service svc_2. This service takes it over once that one gives it up.",
      fix: "Delete the hostname from service svc_2.",
    });
  });

  it("passes on the API's message when the holder is in a workspace the caller cannot see", () => {
    expect(
      guidance(
        input({
          state: "in_use_elsewhere",
          heldBy: {
            workspaceId: null,
            projectId: null,
            serviceId: null,
            message: "held by another workspace",
          },
        }),
      ),
    ).toEqual({
      waitingOn:
        "Another service holds this hostname: held by another workspace. This service takes it over once that one gives it up.",
      fix: null,
    });
  });

  it("asks for the CNAME while DNS does not point at Prisma", () => {
    expect(
      guidance(
        input({
          state: "waiting_for_dns",
          dnsRecords: [CNAME],
          dnsDetail: "The hostname resolves to 203.0.113.9.",
        }),
      ),
    ).toEqual({
      waitingOn:
        "The hostname's DNS does not point at Prisma: The hostname resolves to 203.0.113.9.",
      fix: `Publish CNAME shop.acme.com -> switchboard.cdg.prisma.build at your DNS provider, then run prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch production. ${APEX_NOTE}`,
    });
  });

  it("still asks to point the hostname at Prisma when no CNAME is listed", () => {
    expect(
      guidance(input({ state: "waiting_for_dns", dnsRecords: [] })),
    ).toEqual({
      waitingOn: "The hostname's DNS does not point at Prisma.",
      fix: "Point the hostname at Prisma, then run prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch production.",
    });
  });

  it("asks nothing while the certificate is issued", () => {
    expect(guidance(input({ state: "provisioning_certificate" }))).toEqual({
      waitingOn: "The TLS certificate is being issued.",
      fix: null,
    });
  });

  it("gives the reason a certificate failed and says to retry", () => {
    expect(
      guidance(
        input({
          state: "certificate_failed",
          failureReason: "CAA record forbids the issuer",
        }),
      ),
    ).toEqual({
      waitingOn:
        "The TLS certificate could not be issued: CAA record forbids the issuer.",
      fix: "Fix what made it fail, then run prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch production.",
    });
  });

  it("asks nothing while the platform updates the hostname", () => {
    expect(guidance(input({ state: "updating" }))).toEqual({
      waitingOn: "The platform is bringing the hostname up to date.",
      fix: null,
    });
  });
});
