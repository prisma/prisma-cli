import { describe, expect, it } from "vitest";

import {
  type AddressFixture,
  addressListing,
} from "./helpers/fake-address-api";
import {
  makeServiceCli,
  PROJECT,
  page,
  type RouteHandler,
  releaseRoutes,
  SERVICE,
} from "./service-testkit";

const PREVIEW_SERVICE = { ...SERVICE, id: "svc_api_pr42", branchId: "br_pr42" };

const ADDRESSES: AddressFixture = {
  projects: [{ ...PROJECT, logicalId: "shop" }],
  branches: {
    proj_1: [
      { id: "br_1", gitName: "main", isDefault: true, role: "production" },
      { id: "br_pr42", gitName: "pr-42", isDefault: false, role: "preview" },
    ],
  },
  services: [
    {
      id: "svc_1",
      name: "hello-world",
      projectId: "proj_1",
      branchId: "br_1",
      logicalId: "shop.api",
    },
    {
      id: "svc_api_pr42",
      name: "hello-world",
      projectId: "proj_1",
      branchId: "br_pr42",
      logicalId: "shop.api",
    },
  ],
  databases: [
    {
      id: "db_catalog_main",
      name: "catalog",
      projectId: "proj_1",
      branchId: "br_1",
      logicalId: "shop.catalog",
    },
  ],
};

const listing =
  (path: string): RouteHandler =>
  (init) => ({ data: addressListing(ADDRESSES, path, init.params) });

/** The release routes, with every listing the address lookup reads and
 *  a `/v1/apps` listing that filters by branch git name. */
function addressRoutes(appListings: string[] = []) {
  return releaseRoutes({
    "GET /v1/projects": listing("/v1/projects"),
    "GET /v1/projects/{projectId}/branches": listing(
      "/v1/projects/{projectId}/branches",
    ),
    "GET /v1/services": listing("/v1/services"),
    "GET /v1/databases": listing("/v1/databases"),
    "GET /v1/buckets": listing("/v1/buckets"),
    "GET /v1/apps": (init) => {
      const branch = init.params?.query?.branchGitName as string;
      appListings.push(branch);
      return {
        data: page(branch === "pr-42" ? [PREVIEW_SERVICE] : [SERVICE]),
      };
    },
  });
}

describe("service commands given a deploy address", () => {
  it("acts on the service on the branch the environment names", async () => {
    const appListings: string[] = [];
    const harness = await makeServiceCli({
      routes: addressRoutes(appListings),
    });

    const result = await harness.cli.run(
      ["service", "version", "list", "@pr-42:shop.api", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(appListings).toEqual(["pr-42"]);
  });

  it("acts on the default branch's service when the address names no environment", async () => {
    const appListings: string[] = [];
    const harness = await makeServiceCli({
      routes: addressRoutes(appListings),
    });

    const result = await harness.cli.run(["service", "show", "@shop.api"], {
      cwd: harness.cwd,
      env: harness.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      projectId: "proj_1",
      service: { id: "svc_1" },
    });
    expect(appListings).toEqual(["main"]);
  });

  it("takes the address, not the service name, as the delete consent token", async () => {
    const harness = await makeServiceCli({ routes: addressRoutes() });

    const byName = await harness.cli.run(
      [
        "service",
        "delete",
        "@pr-42:shop.api",
        "--confirm",
        "hello-world",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );
    const frame = byName.json.at(-1);
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("CLI.CONSENT_REQUIRED");
    expect(frame.envelope.error.meta).toMatchObject({
      consentToken: "@pr-42:shop.api",
    });

    const byAddress = await harness.cli.run(
      ["service", "delete", "@pr-42:shop.api", "--confirm", "@pr-42:shop.api"],
      { cwd: harness.cwd, env: harness.env },
    );
    expect(byAddress.exitCode).toBe(0);
    expect(byAddress.presented?.data).toMatchObject({ deleted: true });
  });

  it("refuses --branch alongside an address", async () => {
    const harness = await makeServiceCli({ routes: addressRoutes() });

    const result = await harness.cli.run(
      ["service", "logs", "@shop.api", "--branch", "main", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json.at(-1);
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("ADDRESS.USAGE_ERROR");
  });

  it.each([
    ["@shop", "project"],
    ["@shop.catalog", "database"],
  ])("refuses %s as a service, naming it a %s", async (address, actual) => {
    const harness = await makeServiceCli({ routes: addressRoutes() });

    const result = await harness.cli.run(
      ["service", "show", address, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json.at(-1);
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error).toMatchObject({
      code: "ADDRESS.WRONG_KIND",
      meta: { expected: "service", actual },
    });
  });
});
