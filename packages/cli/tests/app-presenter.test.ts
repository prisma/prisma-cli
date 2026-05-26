import { describe, expect, it } from "vitest";

import { getCommandDescriptor } from "../src/shell/command-meta";
import { renderAppDomainAdd, renderAppDomainShow } from "../src/presenters/app";
import type { AppDomainAddResult, AppDomainShowResult, AppDomainSummary } from "../src/types/app";
import { createTestCommandContext } from "./helpers";

function createDomain(overrides: Partial<AppDomainSummary> = {}): AppDomainSummary {
  return {
    id: "dom_123",
    type: "custom-domain",
    url: "https://api.prisma.io/v1/domains/dom_123",
    hostname: "shop.acme.com",
    computeServiceId: "app_1",
    status: "pending_dns",
    foundryStatus: "pending",
    failureReason: null,
    failureCategory: null,
    certExpiresAt: null,
    createdAt: "2026-05-22T09:14:00.000Z",
    updatedAt: "2026-05-22T09:14:00.000Z",
    dnsRecords: [
      {
        type: "CNAME",
        name: "shop.acme.com",
        value: "switchboard.fra.prisma.build",
        ttl: 300,
      },
    ],
    ...overrides,
  };
}

function createTarget() {
  return {
    workspace: { id: "ws_123", name: "Acme Inc" },
    project: { id: "proj_123", name: "Acme Dashboard" },
    branch: { name: "production", kind: "production" as const },
    app: { id: "app_1", name: "shop" },
  };
}

describe("app domain presenters", () => {
  it("shows when DNS records were not provided by the platform", async () => {
    const { context } = await createTestCommandContext({});
    const result: AppDomainAddResult = {
      ...createTarget(),
      domain: createDomain({ dnsRecords: [] }),
      existing: false,
    };

    const lines = renderAppDomainAdd(
      context,
      getCommandDescriptor("app.domain.add"),
      result,
    ).join("\n");

    expect(lines).toContain("dns record");
    expect(lines).toContain("not provided by platform");
    expect(lines).not.toContain("switchboard.fra.prisma.build");
  });

  it("does not print CNAME fixes for certificate failures", async () => {
    const { context } = await createTestCommandContext({});
    const result: AppDomainShowResult = {
      ...createTarget(),
      domain: createDomain({
        status: "failed",
        failureCategory: "acme",
        failureReason: "Certificate issuance failed",
      }),
    };

    const lines = renderAppDomainShow(
      context,
      getCommandDescriptor("app.domain.show"),
      result,
    ).join("\n");

    expect(lines).toContain("Retry TLS issuance");
    expect(lines).not.toContain("Add CNAME");
  });
});
