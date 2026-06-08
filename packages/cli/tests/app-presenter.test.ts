import { describe, expect, it } from "vitest";

import { getCommandDescriptor } from "../src/shell/command-meta";
import { renderAppDeploy, renderAppDomainAdd, renderAppDomainRetry, renderAppDomainShow, serializeAppDeploy } from "../src/presenters/app";
import type {
  AppDeployResult,
  AppDomainAddResult,
  AppDomainRetryResult,
  AppDomainShowResult,
  AppDomainSummary,
} from "../src/types/app";
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

function createDeployResult(): AppDeployResult {
  return {
    workspace: { id: "wksp_123", name: "Prisma Team" },
    project: { id: "proj_123", name: "Billing API" },
    branch: { id: "br_main", name: "main", kind: "production" },
    resolution: {
      projectSource: "local-pin",
      targetName: "Billing API",
      targetNameSource: "local-pin",
    },
    app: { id: "app_123", name: "api" },
    deployment: {
      id: "dep_123",
      status: "running",
      url: "https://api.prisma.build",
    },
    deploySettings: {
      config: {
        path: "prisma.app.json",
        status: "used",
      },
      buildCommand: {
        value: "bun run build",
        source: null,
      },
      outputDirectory: {
        value: ".",
        source: null,
      },
      framework: {
        key: "hono",
        buildType: "bun",
        name: "Hono",
        source: "detected from package.json",
      },
      entrypoint: "src/index.ts",
      httpPort: 8080,
      region: "fra",
      envVars: ["DATABASE_URL"],
    },
    durationMs: 12_345,
    localPin: {
      path: ".prisma/local.json",
      written: true,
    },
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

  it("renders failure categories without reasons as errors", async () => {
    const { context } = await createTestCommandContext({});
    context.ui.error = (text) => `error(${text})`;
    context.ui.dim = (text) => `dim(${text})`;
    const result: AppDomainShowResult = {
      ...createTarget(),
      domain: createDomain({
        status: "failed",
        failureCategory: "acme",
        failureReason: null,
      }),
    };

    const lines = renderAppDomainShow(
      context,
      getCommandDescriptor("app.domain.show"),
      result,
    ).join("\n");

    expect(lines).toContain("error(acme)");
    expect(lines).not.toContain("dim(acme)");
  });

  it("includes DNS and recovery guidance in retry output", async () => {
    const { context } = await createTestCommandContext({});
    const result: AppDomainRetryResult = {
      ...createTarget(),
      domain: createDomain({
        status: "failed",
        failureCategory: "dns",
        failureReason: "CNAME record not found",
      }),
    };

    const lines = renderAppDomainRetry(
      context,
      getCommandDescriptor("app.domain.retry"),
      result,
    ).join("\n");

    expect(lines).toContain("dns record");
    expect(lines).toContain("CNAME shop.acme.com -> switchboard.fra.prisma.build ttl 300");
    expect(lines).toContain("Add CNAME shop.acme.com -> switchboard.fra.prisma.build, then run prisma-cli app domain retry shop.acme.com.");
  });
});

describe("app deploy presenter", () => {
  it("adds safe resolved context when verbose output is enabled", async () => {
    const { context } = await createTestCommandContext({
      flags: { verbose: true },
      env: { ...process.env, HOME: "/Users/aman" },
      cwd: "/Users/aman/dev/app",
    });
    const result = createDeployResult();

    const lines = renderAppDeploy(
      context,
      getCommandDescriptor("app.deploy"),
      result,
    ).join("\n");

    expect(lines).toContain("Resolved context:");
    expect(lines).toContain("workspace:");
    expect(lines).toContain("Prisma Team");
    expect(lines).toContain("project source:");
    expect(lines).toContain(".prisma/local.json");
    expect(lines).toContain("branch id:");
    expect(lines).toContain("br_main");
    expect(lines).toContain("deploy duration:");
    expect(lines).toContain("Deploy settings:");
    expect(lines).toContain("framework:");
    expect(lines).toContain("Hono (bun)");
    expect(lines).toContain("entrypoint:");
    expect(lines).toContain("src/index.ts");
    expect(lines).toContain("http port:");
    expect(lines).toContain("8080");
    expect(lines).toContain("env vars:");
    expect(lines).toContain("DATABASE_URL");
    expect(lines).not.toContain("postgresql://");
  });

  it("keeps verbose-only deploy details out of JSON serialization", () => {
    const json = JSON.parse(JSON.stringify(serializeAppDeploy(createDeployResult())));

    expect(json.deploySettings).toEqual({
      config: {
        path: "prisma.app.json",
        status: "used",
      },
      buildCommand: {
        value: "bun run build",
        source: null,
      },
      outputDirectory: {
        value: ".",
        source: null,
      },
    });
    expect(json.deploySettings).not.toHaveProperty("framework");
    expect(json.deploySettings).not.toHaveProperty("entrypoint");
    expect(json.deploySettings).not.toHaveProperty("httpPort");
    expect(json).not.toHaveProperty("localPin");
    expect(json.branch).toEqual({
      name: "main",
      kind: "production",
    });
    expect(json.branch).not.toHaveProperty("id");
  });
});
