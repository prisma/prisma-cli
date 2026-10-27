import type { ManagementApiClient } from "@prisma/management-api-sdk";
import { describe, expect, it } from "vitest";

import {
  consentToken,
  isNodeAddress,
  parseNodeAddress,
  resolveNodeAddress,
  resolveProjectAddress,
  resolveProjectSubject,
  resolveScopedSubject,
} from "../src/lib/address/node-address";
import {
  type AddressFixture,
  addressListing,
} from "./helpers/fake-address-api";

const WORKSPACE = { id: "wksp_cmjs0z06102rz2mgzk5zqj495", name: "Acme Inc" };

const FIXTURE: AddressFixture = {
  projects: [
    { id: "proj_shop", name: "Shop", logicalId: "shop", workspace: WORKSPACE },
    { id: "proj_blog", name: "Blog", logicalId: null, workspace: WORKSPACE },
  ],
  branches: {
    proj_shop: [
      {
        id: "br_main",
        gitName: "main",
        isDefault: true,
        role: "production",
      },
      {
        id: "br_pr42",
        gitName: "pr-42",
        isDefault: false,
        role: "preview",
      },
      {
        id: "br_named_production",
        gitName: "production",
        isDefault: false,
        role: "preview",
      },
    ],
  },
  services: [
    {
      id: "svc_api_main",
      name: "api",
      projectId: "proj_shop",
      branchId: "br_main",
      logicalId: "shop.api",
    },
    {
      id: "svc_api_pr42",
      name: "api",
      projectId: "proj_shop",
      branchId: "br_pr42",
      logicalId: "shop.api",
    },
    {
      id: "svc_api_named_production",
      name: "api",
      projectId: "proj_shop",
      branchId: "br_named_production",
      logicalId: "shop.api",
    },
  ],
  databases: [
    {
      id: "db_catalog_main",
      name: "catalog",
      projectId: "proj_shop",
      branchId: "br_main",
      logicalId: "shop.catalog",
    },
  ],
  buckets: [
    {
      id: "bkt_files_pr42",
      name: "files",
      projectId: "proj_shop",
      branchId: "br_pr42",
      logicalId: "shop.files",
    },
  ],
};

interface Call {
  readonly path: string;
  readonly query: Record<string, unknown>;
}

function fakeApi(
  fixture: AddressFixture = FIXTURE,
  override?: (path: string, query: Record<string, unknown>) => unknown,
): { api: ManagementApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const GET = async (
    path: string,
    init: {
      params?: {
        path?: Record<string, string>;
        query?: Record<string, unknown>;
      };
    } = {},
  ) => {
    const query = init.params?.query ?? {};
    calls.push({ path, query });
    const overridden = override?.(path, query);
    if (overridden !== undefined) {
      return overridden;
    }
    const data = addressListing(fixture, path, init.params);
    return data === undefined
      ? {
          error: { error: { message: `no route ${path}` } },
          response: new Response(null, { status: 404 }),
        }
      : { data, response: new Response(null, { status: 200 }) };
  };
  return { api: { GET } as unknown as ManagementApiClient, calls };
}

const signal = new AbortController().signal;

describe("parseNodeAddress", () => {
  it("reads an address with no environment as production", () => {
    expect(parseNodeAddress("@shop.api")).toEqual({
      text: "@shop.api",
      environment: undefined,
      address: "shop.api",
      appName: "shop",
    });
  });

  it("splits the environment off at the first colon", () => {
    expect(parseNodeAddress("@pr-42:shop.api.v2")).toEqual({
      text: "@pr-42:shop.api.v2",
      environment: "pr-42",
      address: "shop.api.v2",
      appName: "shop",
    });
  });

  it("reads the bare app name as the address of the app", () => {
    expect(parseNodeAddress("@shop")).toMatchObject({
      address: "shop",
      appName: "shop",
    });
  });

  it.each([
    ["@", "empty address"],
    ["@:shop.api", "empty environment"],
    ["@pr-42:", "empty address after the environment"],
    ["@shop .api", "whitespace"],
    ["@shop..api", "an empty part between dots"],
    ["@.api", "an empty app name"],
    ["@shop.", "a trailing dot"],
  ])("refuses %s (%s) as a usage error", (subject) => {
    expect(() => parseNodeAddress(subject)).toThrow(
      expect.objectContaining({
        code: "ADDRESS.USAGE_ERROR",
        meta: { address: subject },
      }),
    );
  });

  it("tells an address from an id or name by its leading @", () => {
    expect(isNodeAddress("@shop.api")).toBe(true);
    expect(isNodeAddress("db_catalog_main")).toBe(false);
    expect(isNodeAddress("shop.api")).toBe(false);
  });
});

describe("consentToken", () => {
  it("is the address as typed when the subject is an address", () => {
    expect(consentToken("@pr-42:shop.catalog", "db_catalog_pr42")).toBe(
      "@pr-42:shop.catalog",
    );
  });

  it("is the command's own token for an id or name", () => {
    expect(consentToken("catalog", "db_catalog_main")).toBe("db_catalog_main");
    expect(consentToken(undefined, "db_catalog_main")).toBe("db_catalog_main");
  });
});

describe("resolveNodeAddress", () => {
  it("finds the row on the default branch when the address names no environment", async () => {
    const { api, calls } = fakeApi();

    const node = await resolveNodeAddress(api, "service", "@shop.api", signal);

    expect(node).toEqual({
      id: "svc_api_main",
      project: { id: "proj_shop", name: "Shop" },
      branch: { id: "br_main", gitName: "main" },
    });
    expect(calls).toEqual([
      { path: "/v1/projects", query: { logicalId: "shop" } },
      { path: "/v1/projects/{projectId}/branches", query: {} },
      {
        path: "/v1/services",
        query: {
          projectId: "proj_shop",
          logicalId: "shop.api",
          branchId: "br_main",
        },
      },
    ]);
  });

  it("maps the production environment to the default branch, not a branch named production", async () => {
    const { api } = fakeApi();

    const node = await resolveNodeAddress(
      api,
      "service",
      "@production:shop.api",
      signal,
    );

    expect(node.id).toBe("svc_api_main");
    expect(node.branch).toEqual({ id: "br_main", gitName: "main" });
  });

  it("finds the row on the branch whose git name is the environment", async () => {
    const { api } = fakeApi();

    const node = await resolveNodeAddress(
      api,
      "service",
      "@pr-42:shop.api",
      signal,
    );

    expect(node.id).toBe("svc_api_pr42");
    expect(node.branch).toEqual({ id: "br_pr42", gitName: "pr-42" });
  });

  it("resolves databases and buckets from their own listings", async () => {
    const { api } = fakeApi();

    await expect(
      resolveNodeAddress(api, "database", "@shop.catalog", signal),
    ).resolves.toMatchObject({ id: "db_catalog_main" });
    await expect(
      resolveNodeAddress(api, "bucket", "@pr-42:shop.files", signal),
    ).resolves.toMatchObject({ id: "bkt_files_pr42" });
  });

  it("reports an app with no Project as not found", async () => {
    const { api } = fakeApi();

    await expect(
      resolveNodeAddress(api, "service", "@cart.api", signal),
    ).rejects.toMatchObject({
      code: "ADDRESS.NOT_FOUND",
      meta: { address: "@cart.api", app: "cart" },
    });
  });

  it("compares the app name to the Project's logical id exactly", async () => {
    // An API that ignored the filter would hand back every Project; only
    // an exact logical id may match.
    const { api } = fakeApi(FIXTURE, (path) =>
      path === "/v1/projects"
        ? {
            data: {
              data: [
                {
                  id: "proj_shop2",
                  name: "Shop 2",
                  logicalId: "shop-2",
                  workspace: WORKSPACE,
                },
                {
                  id: "proj_shop_upper",
                  name: "SHOP",
                  logicalId: "Shop",
                  workspace: WORKSPACE,
                },
              ],
              pagination: { hasMore: false, nextCursor: null },
            },
            response: new Response(null, { status: 200 }),
          }
        : undefined,
    );

    await expect(
      resolveNodeAddress(api, "service", "@shop.api", signal),
    ).rejects.toMatchObject({ code: "ADDRESS.NOT_FOUND" });
  });

  it("reports several Projects for one app as ambiguous", async () => {
    const { api } = fakeApi({
      ...FIXTURE,
      projects: [
        ...FIXTURE.projects,
        {
          id: "proj_shop_copy",
          name: "Shop copy",
          logicalId: "shop",
          workspace: WORKSPACE,
        },
      ],
    });

    await expect(
      resolveNodeAddress(api, "service", "@shop.api", signal),
    ).rejects.toMatchObject({
      code: "ADDRESS.AMBIGUOUS",
      meta: { projectIds: ["proj_shop", "proj_shop_copy"] },
    });
  });

  it("reports an environment with no branch as not found and points at branch list", async () => {
    const { api } = fakeApi();

    const error = await resolveNodeAddress(
      api,
      "service",
      "@pr-7:shop.api",
      signal,
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "ADDRESS.NOT_FOUND",
      meta: { environment: "pr-7", projectId: "proj_shop" },
      nextActions: expect.arrayContaining([
        expect.objectContaining({
          command: "prisma branch list --project proj_shop",
        }),
      ]),
    });
  });

  it("reports a Project with no default branch as not found for production", async () => {
    const { api } = fakeApi({
      ...FIXTURE,
      branches: {
        proj_shop: [
          {
            id: "br_pr42",
            gitName: "pr-42",
            isDefault: false,
            role: "preview",
          },
        ],
      },
    });

    await expect(
      resolveNodeAddress(api, "service", "@shop.api", signal),
    ).rejects.toMatchObject({
      code: "ADDRESS.NOT_FOUND",
      meta: { environment: "production" },
    });
  });

  it("reports an address nothing carries as not found after checking every kind", async () => {
    const { api, calls } = fakeApi();

    await expect(
      resolveNodeAddress(api, "service", "@shop.web", signal),
    ).rejects.toMatchObject({
      code: "ADDRESS.NOT_FOUND",
      meta: {
        address: "@shop.web",
        expected: "service",
        projectId: "proj_shop",
        branchId: "br_main",
      },
    });
    expect(calls.map((call) => call.path)).toEqual([
      "/v1/projects",
      "/v1/projects/{projectId}/branches",
      "/v1/services",
      "/v1/databases",
      "/v1/buckets",
    ]);
  });

  it("reports an address that names a row of another kind as the wrong kind", async () => {
    const { api } = fakeApi();

    const error = await resolveNodeAddress(
      api,
      "service",
      "@shop.catalog",
      signal,
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "ADDRESS.WRONG_KIND",
      meta: { expected: "service", actual: "database" },
      nextActions: expect.arrayContaining([
        expect.objectContaining({ command: "prisma postgres --help" }),
      ]),
    });
  });

  it("reports the bare app name as the Project's address before asking the API anything", async () => {
    const { api, calls } = fakeApi();

    await expect(
      resolveNodeAddress(api, "database", "@pr-42:shop", signal),
    ).rejects.toMatchObject({
      code: "ADDRESS.WRONG_KIND",
      meta: { expected: "database", actual: "project" },
    });
    expect(calls).toEqual([]);
  });

  it("reports several rows with the address on one branch as ambiguous", async () => {
    const { api } = fakeApi({
      ...FIXTURE,
      databases: [
        ...(FIXTURE.databases ?? []),
        {
          id: "db_catalog_copy",
          name: "catalog-copy",
          projectId: "proj_shop",
          branchId: "br_main",
          logicalId: "shop.catalog",
        },
      ],
    });

    await expect(
      resolveNodeAddress(api, "database", "@shop.catalog", signal),
    ).rejects.toMatchObject({
      code: "ADDRESS.AMBIGUOUS",
      meta: {
        matches: [
          { id: "db_catalog_main", name: "catalog" },
          { id: "db_catalog_copy", name: "catalog-copy" },
        ],
      },
    });
  });

  it("follows the cursor through every page of a listing", async () => {
    const { api, calls } = fakeApi(FIXTURE, (path, query) => {
      if (path !== "/v1/projects") {
        return undefined;
      }
      const first = query.cursor === undefined;
      return {
        data: {
          data: first ? [FIXTURE.projects[1]] : [FIXTURE.projects[0]],
          pagination: {
            hasMore: first,
            nextCursor: first ? "cursor_2" : null,
          },
        },
        response: new Response(null, { status: 200 }),
      };
    });

    await expect(
      resolveNodeAddress(api, "service", "@shop.api", signal),
    ).resolves.toMatchObject({ id: "svc_api_main" });
    expect(
      calls.filter((call) => call.path === "/v1/projects").map((c) => c.query),
    ).toEqual([
      { logicalId: "shop", cursor: undefined },
      { logicalId: "shop", cursor: "cursor_2" },
    ]);
  });

  it("raises a refused listing as an API error with the API's code and status", async () => {
    const { api } = fakeApi(FIXTURE, (path) =>
      path === "/v1/projects"
        ? {
            error: { error: { code: "forbidden", message: "No access" } },
            response: new Response(null, { status: 403 }),
          }
        : undefined,
    );

    await expect(
      resolveNodeAddress(api, "service", "@shop.api", signal),
    ).rejects.toMatchObject({
      code: "ADDRESS.API_ERROR",
      why: "No access",
      meta: { status: 403, apiCode: "forbidden" },
    });
  });
});

describe("resolveProjectAddress", () => {
  it("finds the Project whose logical id is the app name", async () => {
    const { api } = fakeApi();

    await expect(resolveProjectAddress(api, "@shop", signal)).resolves.toEqual({
      id: "proj_shop",
      name: "Shop",
    });
  });

  it("refuses an address with an environment, since a Project spans every environment", async () => {
    const { api, calls } = fakeApi();

    await expect(
      resolveProjectAddress(api, "@pr-42:shop", signal),
    ).rejects.toMatchObject({
      code: "ADDRESS.WRONG_KIND",
      meta: { expected: "project" },
    });
    await expect(
      resolveProjectAddress(api, "@production:shop", signal),
    ).rejects.toMatchObject({ code: "ADDRESS.WRONG_KIND" });
    expect(calls).toEqual([]);
  });

  it("refuses the address of a node inside the app", async () => {
    const { api } = fakeApi();

    await expect(
      resolveProjectAddress(api, "@shop.api", signal),
    ).rejects.toMatchObject({
      code: "ADDRESS.WRONG_KIND",
      meta: { expected: "project" },
    });
  });

  it("passes an id or name through untouched", async () => {
    const { api, calls } = fakeApi();

    await expect(resolveProjectSubject(api, "Shop", signal)).resolves.toBe(
      "Shop",
    );
    await expect(resolveProjectSubject(api, "@shop", signal)).resolves.toBe(
      "proj_shop",
    );
    expect(calls).toHaveLength(1);
  });
});

describe("resolveScopedSubject", () => {
  it("hands over the row id, Project id and branch git name an address names", async () => {
    const { api } = fakeApi();

    await expect(
      resolveScopedSubject(api, "bucket", "@pr-42:shop.files", {}, signal),
    ).resolves.toEqual({
      ref: "bkt_files_pr42",
      project: "proj_shop",
      branch: "pr-42",
    });
  });

  it("passes an id or name through with the flags it came with", async () => {
    const { api, calls } = fakeApi();

    await expect(
      resolveScopedSubject(
        api,
        "database",
        "catalog",
        { project: "Shop", branch: "pr-42" },
        signal,
      ),
    ).resolves.toEqual({ ref: "catalog", project: "Shop", branch: "pr-42" });
    expect(calls).toEqual([]);
  });

  it.each([
    [{ project: "proj_shop" }, ["--project"]],
    [{ branch: "main" }, ["--branch"]],
    [{ project: "proj_shop", branch: "main" }, ["--project", "--branch"]],
  ])("refuses an address combined with %o", async (scope, flags) => {
    const { api, calls } = fakeApi();

    await expect(
      resolveScopedSubject(api, "service", "@shop.api", scope, signal),
    ).rejects.toMatchObject({
      code: "ADDRESS.USAGE_ERROR",
      meta: { address: "@shop.api", flags },
    });
    expect(calls).toEqual([]);
  });
});
