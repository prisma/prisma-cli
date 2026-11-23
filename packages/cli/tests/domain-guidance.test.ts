import { describe, expect, it } from "vitest";
import type { DomainRecord } from "../src/lib/app/app-provider";
import {
  cannotBecomeActive,
  domainStateGuidance,
  waitsForPlatform,
  waitsForUserDns,
} from "../src/lib/app/domain-guidance";

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
    serviceId: "svc_1",
    state: "active",
    dnsRecords: [],
    failureReason: null,
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
      failed: false,
      waitingOn: "Proof in DNS that this workspace owns the domain.",
      fix: `Publish TXT _prisma-verification.shop.acme.com -> prisma-verification=3f9a and CNAME shop.acme.com -> switchboard.cdg.prisma.build at your DNS provider, then run prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch production. ${APEX_NOTE}`,
    });
  });

  it("says the service is gone", () => {
    expect(guidance(input({ state: "no_service" }))).toEqual({
      failed: false,
      waitingOn: "The service this hostname routed to was deleted.",
      fix: "Delete the hostname, then add it to the service that should serve it.",
    });
  });

  it("asks for a live version, and for the CNAME when one is listed", () => {
    expect(
      guidance(input({ state: "no_live_deployment", dnsRecords: [CNAME] })),
    ).toEqual({
      failed: false,
      waitingOn: "The service has no live version.",
      fix: `Deploy the service or promote one of its versions. Also publish CNAME shop.acme.com -> switchboard.cdg.prisma.build. ${APEX_NOTE}`,
    });
    expect(guidance(input({ state: "no_live_deployment" }))?.fix).toBe(
      "Deploy the service or promote one of its versions.",
    );
  });

  it("reports a failed update as a failure we cannot explain, with nothing for the user to fix", () => {
    expect(guidance(input({ state: "update_failed" }))).toEqual({
      failed: true,
      waitingOn:
        "The hostname's last update failed, and the platform is retrying it. You can try again, or contact support.",
      fix: null,
    });
  });

  it("names the service that holds the hostname and says to delete it there", () => {
    expect(
      guidance(
        input({
          state: "in_use_elsewhere",
          heldBy: {
            workspaceId: "wksp_ws_1",
            projectId: "proj_2",
            serviceId: "svc_2",
            message: null,
          },
        }),
      ),
    ).toEqual({
      failed: false,
      waitingOn:
        "Another service holds this hostname: service svc_2. This service takes it over once that one gives it up.",
      fix: "Delete the hostname from service svc_2.",
    });
  });

  it("says the service lists the hostname more than once when its own other entry holds it", () => {
    expect(
      guidance(
        input({
          state: "in_use_elsewhere",
          serviceId: "svc_1",
          heldBy: {
            workspaceId: "wksp_ws_1",
            projectId: "proj_1",
            serviceId: "svc_1",
            message: null,
          },
        }),
      ),
    ).toEqual({
      failed: false,
      waitingOn:
        "This service lists the hostname more than once, and another entry holds it.",
      fix: null,
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
      failed: false,
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
          dnsDetail: "the CNAME points at old.example.net",
        }),
      ),
    ).toEqual({
      failed: false,
      waitingOn:
        "The hostname's DNS does not point at Prisma. The platform reported: the CNAME points at old.example.net",
      fix: `Publish CNAME shop.acme.com -> switchboard.cdg.prisma.build at your DNS provider, then run prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch production. ${APEX_NOTE}`,
    });
  });

  it("still asks to point the hostname at Prisma when no CNAME is listed", () => {
    expect(
      guidance(input({ state: "waiting_for_dns", dnsRecords: [] })),
    ).toEqual({
      failed: false,
      waitingOn: "The hostname's DNS does not point at Prisma.",
      fix: "Point the hostname at Prisma, then run prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch production.",
    });
  });

  it("asks nothing while the certificate is issued", () => {
    expect(guidance(input({ state: "provisioning_certificate" }))).toEqual({
      failed: false,
      waitingOn: "The TLS certificate is being issued.",
      fix: null,
    });
  });

  it("relays the platform's reason a certificate failed exactly as given, with no advice", () => {
    expect(
      guidance(
        input({
          state: "certificate_failed",
          failureReason: "CAA record forbids the issuer",
        }),
      ),
    ).toEqual({
      failed: true,
      waitingOn:
        "Provisioning failed. The platform reported: CAA record forbids the issuer",
      fix: null,
    });
  });

  it("relays the platform's reason for refusing the DNS beside a failed certificate, each as given", () => {
    expect(
      guidance(
        input({
          state: "certificate_failed",
          failureReason: "dns: no CNAME found",
          dnsDetail: "the CNAME points at old.example.net",
        }),
      )?.waitingOn,
    ).toBe(
      "Provisioning failed. The platform reported: dns: no CNAME found About the hostname's DNS, the platform reported: the CNAME points at old.example.net",
    );
    expect(
      guidance(
        input({
          state: "certificate_failed",
          dnsDetail: "the CNAME points at old.example.net",
        }),
      )?.waitingOn,
    ).toBe(
      "Provisioning failed. About the hostname's DNS, the platform reported: the CNAME points at old.example.net",
    );
  });

  it("reports a certificate failure without a reason as a failure we cannot explain", () => {
    expect(guidance(input({ state: "certificate_failed" }))).toEqual({
      failed: true,
      waitingOn:
        "Provisioning failed for reasons we are not sure about. You can try again, or contact support.",
      fix: null,
    });
  });

  it("asks nothing while the platform updates the hostname", () => {
    expect(guidance(input({ state: "updating" }))).toEqual({
      failed: false,
      waitingOn: "The platform is bringing the hostname up to date.",
      fix: null,
    });
  });
});

const STATES: ReadonlyArray<{
  state: DomainRecord["state"];
  waitsForDns: boolean;
  waitsOnPlatform: boolean;
  stuck: boolean;
}> = [
  {
    state: "not_verified",
    waitsForDns: true,
    waitsOnPlatform: false,
    stuck: false,
  },
  {
    state: "no_service",
    waitsForDns: false,
    waitsOnPlatform: false,
    stuck: true,
  },
  {
    state: "no_live_deployment",
    waitsForDns: false,
    waitsOnPlatform: false,
    stuck: false,
  },
  {
    state: "update_failed",
    waitsForDns: false,
    waitsOnPlatform: true,
    stuck: false,
  },
  {
    state: "in_use_elsewhere",
    waitsForDns: false,
    waitsOnPlatform: false,
    stuck: false,
  },
  {
    state: "waiting_for_dns",
    waitsForDns: true,
    waitsOnPlatform: false,
    stuck: false,
  },
  {
    state: "provisioning_certificate",
    waitsForDns: false,
    waitsOnPlatform: true,
    stuck: false,
  },
  {
    state: "certificate_failed",
    waitsForDns: false,
    waitsOnPlatform: false,
    stuck: true,
  },
  {
    state: "updating",
    waitsForDns: false,
    waitsOnPlatform: true,
    stuck: false,
  },
  { state: "active", waitsForDns: false, waitsOnPlatform: false, stuck: false },
];

describe("waitsForUserDns", () => {
  it.each(STATES)("is $waitsForDns for $state", ({ state, waitsForDns }) => {
    expect(waitsForUserDns({ state })).toBe(waitsForDns);
  });
});

describe("waitsForPlatform", () => {
  it.each(STATES)("is $waitsOnPlatform for $state", ({
    state,
    waitsOnPlatform,
  }) => {
    expect(waitsForPlatform({ state })).toBe(waitsOnPlatform);
  });
});

describe("cannotBecomeActive", () => {
  it.each(STATES)("is $stuck for $state", ({ state, stuck }) => {
    expect(cannotBecomeActive({ state })).toBe(stuck);
  });
});
