import type { PresentedResult } from "@prisma/cli-engine";
import { describe, expect, it } from "vitest";
import {
  activeRecord,
  certificateFailedRecord,
  customDomain,
  domainRecord,
  duplicateEntries,
  platformWorkRecord,
  provisioningRecord,
  type RawDomain,
  waitingForDnsRecord,
} from "./helpers/routing-url";
import {
  makeServiceCli,
  page,
  presentedSummary,
  type Routes,
  readFlowRoutes,
  SERVICE,
} from "./service-testkit";

const EXPECTED_TARGET = {
  workspace: { id: "ws_1", name: "Acme Inc" },
  project: { id: "proj_1", name: "acme-app" },
  branch: { name: "main", kind: "production" },
  service: { id: "svc_1", name: "hello-world" },
};

const TARGET_ROWS = [
  { label: "workspace", value: "Acme Inc" },
  { label: "project", value: "acme-app" },
  { label: "branch", value: "main" },
  { label: "service", value: "hello-world" },
];

const APEX_NOTE =
  "At an apex domain, publish the CNAME as an ALIAS, ANAME or flattened CNAME with the same target.";

const PUBLISH_BOTH_RECORDS = `Publish TXT _prisma-verification.shop.acme.com -> prisma-verification=3f9a and CNAME shop.acme.com -> switchboard.cdg.prisma.build at your DNS provider, then run prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch main. ${APEX_NOTE}`;

const PUBLISH_CNAME = `Publish CNAME shop.acme.com -> switchboard.cdg.prisma.build at your DNS provider, then run prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch main. ${APEX_NOTE}`;

function domainRoutes(overrides: Routes = {}): Routes {
  return readFlowRoutes({
    "GET /v1/services/{serviceId}/urls": () => ({
      data: { data: [domainRecord()] },
    }),
    ...overrides,
  });
}

function listing(entries: RawDomain[]): Routes {
  return {
    "GET /v1/services/{serviceId}/urls": () => ({ data: { data: entries } }),
  };
}

function fieldRows(presented: PresentedResult<unknown> | undefined) {
  const block = presented?.presentation.human.find(
    (candidate) => candidate.kind === "fields",
  );
  if (block?.kind !== "fields") {
    throw new Error("expected a fields block");
  }
  return block.rows;
}

const TARGET_ARGS = ["--project", "acme-app", "--service", "hello-world"];

it.each([
  "add",
  "show",
  "retry",
  "wait",
  "delete",
])("keeps the supplied branch in %s invalid-hostname recovery", async (command) => {
  const harness = await makeServiceCli({ routes: domainRoutes() });
  const result = await harness.cli.run(
    [
      "service",
      "domain",
      command,
      "not a hostname",
      ...TARGET_ARGS,
      "--branch",
      "feature/domain fix",
      "--json",
    ],
    { cwd: harness.cwd, env: harness.env },
  );

  const frame = result.json[result.json.length - 1];
  if (frame?.kind !== "result" || frame.envelope.ok)
    throw new Error("expected an errored envelope");
  expect(frame.envelope.error.code).toBe("SERVICE.DOMAIN_HOSTNAME_INVALID");
  expect(frame.envelope.nextActions).toContainEqual({
    kind: "run-command",
    label: "Add a domain",
    command:
      "prisma service domain add shop.acme.com --service <name> --branch 'feature/domain fix'",
  });
});

it.each([
  {
    branch: undefined,
    expected:
      "prisma service domain wait shop.acme.com --service <name> --timeout 15m",
  },
  {
    branch: "feature/domain fix",
    expected:
      "prisma service domain wait shop.acme.com --service <name> --timeout 15m --branch 'feature/domain fix'",
  },
])("keeps branch $branch in invalid-timeout recovery", async ({
  branch,
  expected,
}) => {
  const harness = await makeServiceCli({ routes: domainRoutes() });
  const result = await harness.cli.run(
    [
      "service",
      "domain",
      "wait",
      "shop.acme.com",
      ...TARGET_ARGS,
      "--timeout",
      "invalid",
      ...(branch === undefined ? [] : ["--branch", branch]),
      "--json",
    ],
    { cwd: harness.cwd, env: harness.env },
  );

  const frame = result.json[result.json.length - 1];
  if (frame?.kind !== "result" || frame.envelope.ok)
    throw new Error("expected an errored envelope");
  expect(frame.envelope.error.code).toBe("SERVICE.TIMEOUT_INVALID");
  expect(frame.envelope.nextActions).toEqual([
    {
      kind: "run-command",
      label: "Wait with a valid timeout",
      command: expected,
    },
  ]);
});

/** A project whose default branch is neither `main` nor `production`. */
function trunkDefaultBranchRoutes(
  askedBranches: unknown[],
  overrides: Routes,
): Routes {
  return domainRoutes({
    "GET /v1/projects/{projectId}/branches": () => ({
      data: page([
        {
          id: "br_feature",
          gitName: "feature/login",
          isDefault: false,
          role: "preview",
        },
        {
          id: "br_trunk",
          gitName: "trunk",
          isDefault: true,
          role: "production",
        },
      ]),
    }),
    "GET /v1/apps": (init) => {
      askedBranches.push(init.params?.query?.branchGitName);
      return { data: page([{ ...SERVICE, branchId: "br_trunk" }]) };
    },
    ...overrides,
  });
}

it.each([
  { command: "add", extra: [] },
  { command: "show", extra: [] },
  { command: "retry", extra: [] },
  { command: "wait", extra: ["--timeout", "0"] },
  { command: "delete", extra: ["--confirm", "shop.acme.com"] },
])("without --branch, $command uses the project's default branch", async ({
  command,
  extra,
}) => {
  const askedBranches: unknown[] = [];
  const harness = await makeServiceCli({
    routes: trunkDefaultBranchRoutes(askedBranches, {
      ...listing([activeRecord()]),
      "GET /v1/urls/{id}": () => ({ data: { data: activeRecord() } }),
      "POST /v1/urls/{id}/check": () => ({ data: { data: activeRecord() } }),
      "DELETE /v1/urls/{id}": () => ({ data: undefined }),
    }),
  });

  const result = await harness.cli.run(
    ["service", "domain", command, "shop.acme.com", ...TARGET_ARGS, ...extra],
    { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
  );

  expect(result.exitCode).toBe(0);
  expect(askedBranches).toEqual(["trunk"]);
  expect(result.presented?.data).toMatchObject({
    branch: { name: "trunk", kind: "production" },
    service: { id: "svc_1", name: "hello-world" },
  });
});

it("without --branch, add names the default branch in the commands it offers next", async () => {
  const harness = await makeServiceCli({
    routes: trunkDefaultBranchRoutes([], {
      ...listing([]),
      "POST /v1/services/{serviceId}/urls": () => ({
        data: { data: domainRecord() },
      }),
    }),
  });

  const result = await harness.cli.run(
    ["service", "domain", "add", "shop.acme.com", ...TARGET_ARGS],
    { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
  );

  expect(result.exitCode).toBe(0);
  expect(result.presented?.presentation.next).toContainEqual({
    kind: "run-command",
    label: "Wait for activation",
    command:
      "prisma service domain wait shop.acme.com --service svc_1 --project proj_1 --branch trunk",
  });
  expect(result.presented?.presentation.next).toContainEqual({
    kind: "user-choice",
    label: `Publish TXT _prisma-verification.shop.acme.com -> prisma-verification=3f9a and CNAME shop.acme.com -> switchboard.cdg.prisma.build at your DNS provider, then run prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch trunk. ${APEX_NOTE}`,
  });
});

it.each(
  ["add", "show", "retry", "wait", "delete"].flatMap((command) =>
    [
      { blank: "empty", branch: "" },
      { blank: "only spaces", branch: "  " },
    ].map((value) => ({ command, ...value })),
  ),
)("$command rejects a --branch that is $blank as SERVICE.BRANCH_INVALID", async ({
  command,
  branch,
}) => {
  const harness = await makeServiceCli({ routes: domainRoutes() });

  const result = await harness.cli.run(
    [
      "service",
      "domain",
      command,
      "shop.acme.com",
      ...TARGET_ARGS,
      "--branch",
      branch,
      "--json",
    ],
    { cwd: harness.cwd, env: harness.env },
  );

  expect(result.exitCode).toBe(2);
  const frame = result.json[result.json.length - 1];
  if (frame?.kind !== "result" || frame.envelope.ok)
    throw new Error("expected an errored envelope");
  expect(frame.envelope.error.code).toBe("SERVICE.BRANCH_INVALID");
});

describe("prisma service domain add", () => {
  function addRoutes(
    posted: unknown[] = [],
    added: RawDomain = domainRecord(),
  ): Routes {
    return domainRoutes({
      ...listing([activeRecord({ id: "url_9", hostname: "other.acme.com" })]),
      "POST /v1/services/{serviceId}/urls": (init) => {
        posted.push({ path: init.params?.path, body: init.body });
        return { data: { data: added } };
      },
    });
  }

  it("adds the hostname before DNS is set up and says which records to publish", async () => {
    const posted: unknown[] = [];
    const harness = await makeServiceCli({ routes: addRoutes(posted) });

    const result = await harness.cli.run(
      ["service", "domain", "add", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(posted).toEqual([
      {
        path: { serviceId: "svc_1" },
        body: { hostname: "shop.acme.com", createDomainOwnership: true },
      },
    ]);
    expect(result.presented?.data).toMatchObject({
      ...EXPECTED_TARGET,
      existing: false,
      domain: {
        id: "url_1",
        hostname: "shop.acme.com",
        status: "pending",
        state: "not_verified",
        firstUnmetCondition: "ownershipVerified",
      },
    });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "ok",
      text: "Added shop.acme.com to hello-world.",
    });
    expect(fieldRows(result.presented)).toEqual([
      ...TARGET_ROWS,
      { label: "hostname", value: "shop.acme.com" },
      { label: "status", value: "pending" },
      { label: "state", value: "not_verified" },
      {
        label: "waiting on",
        value: "Proof in DNS that this workspace owns the domain.",
      },
      {
        label: "dns TXT",
        value:
          "_prisma-verification.shop.acme.com -> prisma-verification=3f9a (ttl 300)",
      },
      {
        label: "dns CNAME",
        value: "shop.acme.com -> switchboard.cdg.prisma.build (ttl 300)",
      },
    ]);
    expect(result.presented?.presentation.next).toEqual([
      { kind: "user-choice", label: PUBLISH_BOTH_RECORDS },
      {
        kind: "run-command",
        label: "Wait for activation",
        command:
          "prisma service domain wait shop.acme.com --service svc_1 --project proj_1 --branch main",
      },
      {
        kind: "run-command",
        label: "Show the domain",
        command:
          "prisma service domain show shop.acme.com --service svc_1 --project proj_1 --branch main",
      },
    ]);
    expect(result.presented?.presentation.stdout).toEqual([
      "TXT\t_prisma-verification.shop.acme.com\tprisma-verification=3f9a",
      "CNAME\tshop.acme.com\tswitchboard.cdg.prisma.build",
    ]);
  });

  it("emits the completed json envelope with commandId service.domain.add and the whole domain summary", async () => {
    const harness = await makeServiceCli({
      routes: addRoutes(
        [],
        certificateFailedRecord("CAA record forbids the issuer", {
          id: "url_42",
          customDomain: customDomain({
            status: "failed",
            failureReason: "CAA record forbids the issuer",
            certExpiresAt: "2026-11-01T00:00:00.000Z",
          }),
          customDomainSyncError: "Foundry answered HTTP 503",
          switchboardDns: {
            accepted: true,
            detail: "the CNAME points at switchboard.cdg.prisma.build",
            lastSeenAt: "2026-08-01T00:05:00.000Z",
          },
          ownershipExpiry: { expiresAt: "2026-09-01T00:00:00.000Z" },
          records: [
            {
              condition: "ownershipVerified",
              type: "TXT",
              name: "_prisma-verification.shop.acme.com",
              value: "prisma-verification=3f9a",
              ttl: 300,
            },
          ],
          updatedAt: "2026-08-01T00:05:00.000Z",
        }),
      ),
    });

    const result = await harness.cli.run(
      ["service", "domain", "add", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.domain.add");
    expect(frame.envelope.result).toEqual({
      ...EXPECTED_TARGET,
      existing: false,
      domain: {
        id: "url_42",
        hostname: "shop.acme.com",
        serviceId: "svc_1",
        status: "pending",
        state: "certificate_failed",
        conditions: {
          ownershipVerified: "met",
          servicePresent: "met",
          liveDeployment: "met",
          dnsPointsAtSwitchboard: "met",
          customDomainBound: "met",
          certificateActive: "unmet",
        },
        firstUnmetCondition: "certificateActive",
        failureReason: "CAA record forbids the issuer",
        dnsDetail: "the CNAME points at switchboard.cdg.prisma.build",
        certExpiresAt: "2026-11-01T00:00:00.000Z",
        ownershipExpiresAt: "2026-09-01T00:00:00.000Z",
        heldBy: null,
        setupUrl:
          "https://console.prisma.io/ws_1/proj_1/compute/svc_1/domains?setup=shop.acme.com",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:05:00.000Z",
        dnsRecords: [
          {
            condition: "ownershipVerified",
            type: "TXT",
            name: "_prisma-verification.shop.acme.com",
            value: "prisma-verification=3f9a",
            ttl: 300,
          },
        ],
      },
    });
    const serialized = JSON.stringify(frame.envelope.result);
    expect(serialized).not.toContain("holdsHostname");
    expect(serialized).not.toContain("syncError");
    expect(serialized).not.toContain("Foundry answered HTTP 503");
  });

  it("shows the entry that holds the hostname when the service lists it more than once, without adding it again", async () => {
    const posted: unknown[] = [];
    const harness = await makeServiceCli({
      routes: domainRoutes({
        ...listing(duplicateEntries()),
        "POST /v1/services/{serviceId}/urls": (init) => {
          posted.push(init.body);
          return { data: { data: domainRecord() } };
        },
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "add", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(posted).toEqual([]);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.result).toMatchObject({
      existing: true,
      domain: { id: "url_2", state: "active" },
    });
  });

  it("shows a hostname the service already has as it stands, without adding it again", async () => {
    const posted: unknown[] = [];
    const harness = await makeServiceCli({
      routes: domainRoutes({
        ...listing([
          activeRecord({ id: "url_9", hostname: "other.acme.com" }),
          waitingForDnsRecord({ id: "url_7" }),
        ]),
        "POST /v1/services/{serviceId}/urls": (init) => {
          posted.push(init.body);
          return { data: { data: domainRecord() } };
        },
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "add", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(posted).toEqual([]);
    expect(result.presented?.data).toMatchObject({
      existing: true,
      domain: { id: "url_7", state: "waiting_for_dns" },
    });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "info",
      text: "Showing the existing custom domain on hello-world.",
    });
    expect(result.presented?.presentation.next).toContainEqual({
      kind: "user-choice",
      label: PUBLISH_CNAME,
    });
  });

  it("offers nothing to do next when the hostname the service already has is active", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes(listing([activeRecord()])),
    });

    const result = await harness.cli.run(
      ["service", "domain", "add", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ existing: true });
    expect(result.presented?.presentation.next).toEqual([]);
    expect(fieldRows(result.presented)).not.toContainEqual(
      expect.objectContaining({ label: "waiting on" }),
    );
  });

  it.each([
    {
      name: "invalid-hostname",
      status: 422,
      body: {
        error: {
          code: "invalid-hostname",
          message: "The hostname is a Prisma domain.",
        },
      },
      code: "SERVICE.DOMAIN_HOSTNAME_INVALID",
      why: "Failed to add custom domain: The hostname is a Prisma domain.",
    },
    {
      name: "a validation error",
      status: 400,
      body: { error: [{ path: ["hostname"], message: "Invalid" }] },
      code: "SERVICE.DOMAIN_HOSTNAME_INVALID",
      why: "Failed to add custom domain: Management API returned HTTP 400.",
    },
    {
      name: "quota-exceeded",
      status: 409,
      body: {
        error: {
          code: "quota-exceeded",
          message: "This workspace has 100 custom domains.",
        },
      },
      code: "SERVICE.DOMAIN_QUOTA_EXCEEDED",
      why: "Failed to add custom domain: This workspace has 100 custom domains.",
    },
    {
      name: "any other conflict",
      status: 409,
      body: { error: { code: "conflict", message: "Try again." } },
      code: "SERVICE.DEPLOY_FAILED",
      why: "Failed to add custom domain: Try again.",
    },
    {
      name: "a server error",
      status: 500,
      body: { error: { code: "internal", message: "Boom." } },
      code: "SERVICE.DEPLOY_FAILED",
      why: "The operation failed for reasons we are not sure about. You can try again, or contact support.",
    },
  ])("settles $name as $code", async ({ status, body, code, why }) => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        ...listing([]),
        "POST /v1/services/{serviceId}/urls": () => ({ status, error: body }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "add", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).not.toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok)
      throw new Error("expected an errored envelope");
    expect(frame.envelope.error.code).toBe(code);
    expect(frame.envelope.error.why).toBe(why);
  });

  it("keeps the selected target in the rejected-hostname recovery command", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        ...listing([]),
        "POST /v1/services/{serviceId}/urls": () => ({
          status: 422,
          error: {
            error: { code: "invalid-hostname", message: "Not allowed." },
          },
        }),
      }),
    });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "add",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--branch",
        "feature/customer's-test",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok)
      throw new Error("expected an errored envelope");
    expect(frame.envelope.error.code).toBe("SERVICE.DOMAIN_HOSTNAME_INVALID");
    expect(frame.envelope.nextActions).toEqual([
      { kind: "user-choice", label: "Pass a hostname like shop.acme.com." },
      {
        kind: "run-command",
        label: "Add a domain",
        command:
          "prisma service domain add shop.acme.com --service svc_1 --project proj_1 --branch 'feature/customer'\\''s-test'",
      },
    ]);
  });

  it("passes on the API's hint when the domain quota is used up", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        ...listing([]),
        "POST /v1/services/{serviceId}/urls": () => ({
          status: 409,
          error: {
            error: {
              code: "quota-exceeded",
              message: "This workspace has 100 custom domains.",
              hint: "Delete a custom domain in this workspace first.",
            },
          },
        }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "add", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok)
      throw new Error("expected an errored envelope");
    expect(frame.envelope.error.code).toBe("SERVICE.DOMAIN_QUOTA_EXCEEDED");
    expect(frame.envelope.nextActions).toEqual([
      {
        kind: "user-choice",
        label: "Delete a custom domain in this workspace first.",
      },
    ]);
  });

  it("rejects invalid hostnames as SERVICE.DOMAIN_HOSTNAME_INVALID", async () => {
    const harness = await makeServiceCli({ routes: domainRoutes() });

    const result = await harness.cli.run(
      ["service", "domain", "add", "not a hostname", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DOMAIN_HOSTNAME_INVALID");
    expect(frame.envelope.nextActions).toContainEqual({
      kind: "run-command",
      label: "Add a domain",
      command: "prisma service domain add shop.acme.com --service <name>",
    });
  });

  it.each([
    "feature/foo",
    "staging",
  ])("registers a domain on branch %s", async (branchName) => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        "GET /v1/apps": (init) => {
          expect(init.params?.query?.branchGitName).toBe(branchName);
          return {
            data: page([
              {
                id: "svc_preview",
                name: "hello-world",
                region: { id: "eu-central-1" },
                branchId: "br_preview",
                latestDeploymentId: "dep_preview",
                appEndpointDomain: "preview.prisma.build",
              },
            ]),
          };
        },
        "GET /v1/services/{serviceId}/urls": (init) => {
          expect(init.params?.path?.serviceId).toBe("svc_preview");
          return { data: { data: [] } };
        },
        "POST /v1/services/{serviceId}/urls": (init) => {
          expect(init.params?.path?.serviceId).toBe("svc_preview");
          return {
            data: {
              data: domainRecord({
                serviceId: "svc_preview",
                branchId: "br_preview",
              }),
            },
          };
        },
      }),
    });
    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "add",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--branch",
        branchName,
      ],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );
    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      branch: { name: branchName, kind: "preview" },
      service: { id: "svc_preview", name: "hello-world" },
      domain: { serviceId: "svc_preview" },
    });
    expect(presentedSummary(result.presented)?.status).toBe("ok");
  });

  it("accepts a service id in --service", async () => {
    const posted: unknown[] = [];
    const harness = await makeServiceCli({ routes: addRoutes(posted) });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "add",
        "shop.acme.com",
        "--service",
        "svc_1",
        "--project",
        "acme-app",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(posted).toEqual([
      {
        path: { serviceId: "svc_1" },
        body: { hostname: "shop.acme.com", createDomainOwnership: true },
      },
    ]);
  });

  it("rejects a service id the project does not have as SERVICE.SELECTION_INVALID", async () => {
    const harness = await makeServiceCli({ routes: domainRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "add",
        "shop.acme.com",
        "--service",
        "svc_missing",
        "--project",
        "acme-app",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.SELECTION_INVALID");
    expect(frame.envelope.nextActions).toEqual([
      {
        kind: "user-choice",
        label: "Pass the id or name of an existing service.",
      },
      {
        kind: "run-command",
        label: "List services",
        command: "prisma service list",
      },
    ]);
  });

  it("requires a service", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({ "GET /v1/apps": () => ({ data: page([]) }) }),
    });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "add",
        "shop.acme.com",
        "--project",
        "acme-app",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.TARGET_REQUIRED");
    expect(frame.envelope.error.summary).toContain("requires a service");
    expect(frame.envelope.nextActions).toContainEqual({
      kind: "run-command",
      label: "List services",
      command: "prisma service list",
    });
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes(),
      authenticated: false,
    });

    const result = await harness.cli.run(
      ["service", "domain", "add", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});

describe("prisma service domain show", () => {
  /** `shownIds` collects the id of every hostname entry the run read. */
  function showRoutes(
    entries: RawDomain[],
    shownIds: string[] = [],
    detail: (id: string) => RawDomain = (id) =>
      entries.find((entry) => entry.id === id) as RawDomain,
  ): Routes {
    return domainRoutes({
      ...listing(entries),
      "GET /v1/urls/{id}": (init) => {
        const id = String(init.params?.path?.id);
        shownIds.push(id);
        return { data: { data: detail(id) } };
      },
    });
  }

  it("presents what the hostname waits on and the record still to publish", async () => {
    const harness = await makeServiceCli({
      routes: showRoutes([
        waitingForDnsRecord({
          switchboardDns: {
            accepted: false,
            detail: "the CNAME points at old.example.net",
            lastSeenAt: "2026-08-01T00:05:00.000Z",
          },
        }),
      ]),
    });

    const result = await harness.cli.run(
      ["service", "domain", "show", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      ...EXPECTED_TARGET,
      domain: {
        hostname: "shop.acme.com",
        status: "pending",
        state: "waiting_for_dns",
        dnsDetail: "the CNAME points at old.example.net",
      },
    });
    // A command that only reports keeps the informational heading; the
    // success marker belongs to the commands that changed something.
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "info",
      text: "Showing custom domain status.",
    });
    expect(fieldRows(result.presented)).toEqual([
      ...TARGET_ROWS,
      { label: "hostname", value: "shop.acme.com" },
      { label: "status", value: "pending" },
      { label: "state", value: "waiting_for_dns" },
      {
        label: "waiting on",
        value:
          "The hostname's DNS does not point at Prisma. The platform reported: the CNAME points at old.example.net",
      },
      { label: "cert expires", value: "not yet issued" },
      { label: "created", value: "2026-08-01T00:00:00.000Z" },
      {
        label: "dns CNAME",
        value: "shop.acme.com -> switchboard.cdg.prisma.build (ttl 300)",
      },
    ]);
    expect(result.presented?.presentation.next).toEqual([
      { kind: "user-choice", label: PUBLISH_CNAME },
      {
        kind: "run-command",
        label: "Wait for activation",
        command:
          "prisma service domain wait shop.acme.com --service svc_1 --project proj_1 --branch main",
      },
    ]);
    expect(result.presented?.presentation.stdout).toEqual([
      "hostname\tshop.acme.com",
      "status\tpending",
      "state\twaiting_for_dns",
      "created\t2026-08-01T00:00:00.000Z",
      "dns\tCNAME\tshop.acme.com\tswitchboard.cdg.prisma.build",
    ]);
  });

  it("shows when an expiring ownership keeps an active hostname serving, and offers nothing to do", async () => {
    const harness = await makeServiceCli({
      routes: showRoutes([
        activeRecord({
          ownershipExpiry: { expiresAt: "2026-09-01T00:00:00.000Z" },
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
      ]),
    });

    const result = await harness.cli.run(
      ["service", "domain", "show", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(fieldRows(result.presented)).toEqual([
      ...TARGET_ROWS,
      { label: "hostname", value: "shop.acme.com" },
      { label: "status", value: "active" },
      { label: "state", value: "active" },
      { label: "cert expires", value: "2026-11-01T00:00:00.000Z" },
      { label: "ownership expires", value: "2026-09-01T00:00:00.000Z" },
      { label: "created", value: "2026-08-01T00:00:00.000Z" },
    ]);
    expect(result.presented?.presentation.next).toEqual([]);
  });

  it.each([
    {
      name: "a DNS refusal of a certificate retry once, though the API carries its text twice",
      domain: {
        ...certificateFailedRecord("dns: no CNAME found"),
        switchboardDns: {
          accepted: false,
          detail: "dns: no CNAME found",
          lastSeenAt: "2026-08-01T00:05:00.000Z",
        },
      },
      failure:
        "Provisioning failed. The platform reported: dns: no CNAME found",
      next: [
        {
          kind: "run-command",
          label: "Retry the certificate",
          command:
            "prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch main",
        },
      ],
    },
    {
      name: "the platform's reason for a failed certificate, exactly as given",
      domain: certificateFailedRecord("CAA record forbids the issuer"),
      failure:
        "Provisioning failed. The platform reported: CAA record forbids the issuer",
      next: [
        {
          kind: "run-command",
          label: "Retry the certificate",
          command:
            "prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch main",
        },
      ],
    },
    {
      name: "a failure it cannot explain when the platform's update failed, without the platform's error",
      domain: platformWorkRecord({
        state: "update_failed",
        customDomainSyncError: "Foundry answered HTTP 503",
      }),
      failure:
        "The hostname's last update failed, and the platform is retrying it. You can try again, or contact support.",
      next: [
        {
          kind: "run-command",
          label: "Try again",
          command:
            "prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch main",
        },
      ],
    },
  ])("labels $name as the failure", async ({ domain, failure, next }) => {
    const harness = await makeServiceCli({ routes: showRoutes([domain]) });

    const result = await harness.cli.run(
      ["service", "domain", "show", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    const rows = fieldRows(result.presented);
    expect(rows).toContainEqual({ label: "failure", value: failure });
    expect(rows).not.toContainEqual(
      expect.objectContaining({ label: "waiting on" }),
    );
    expect(result.presented?.presentation.next).toEqual(next);
    expect(JSON.stringify(result.presented?.presentation)).not.toContain(
      "Foundry answered HTTP 503",
    );
  });

  it("offers no wait when the hostname's service is gone, only the fix", async () => {
    const harness = await makeServiceCli({
      routes: showRoutes([
        domainRecord({ state: "no_service", serviceId: null, setupUrl: null }),
      ]),
    });

    const result = await harness.cli.run(
      ["service", "domain", "show", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "user-choice",
        label:
          "Delete the hostname, then add it to the service that should serve it.",
      },
    ]);
  });

  it("reports which service holds the hostname in --json", async () => {
    const harness = await makeServiceCli({
      routes: showRoutes([
        domainRecord({
          state: "in_use_elsewhere",
          conditions: {
            ownershipVerified: "met",
            servicePresent: "met",
            liveDeployment: "met",
            dnsPointsAtSwitchboard: "met",
            customDomainBound: "unmet",
            certificateActive: "unmet",
          },
          firstUnmetCondition: "customDomainBound",
          records: [],
          heldBy: {
            workspaceId: "wksp_ws_1",
            projectId: "proj_2",
            serviceId: "svc_2",
            message: null,
          },
        }),
      ]),
    });

    const result = await harness.cli.run(
      ["service", "domain", "show", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.result).toMatchObject({
      domain: {
        state: "in_use_elsewhere",
        heldBy: {
          workspaceId: "wksp_ws_1",
          projectId: "proj_2",
          serviceId: "svc_2",
          message: null,
        },
      },
    });
  });

  it("emits the completed json envelope with commandId service.domain.show", async () => {
    const harness = await makeServiceCli({
      routes: showRoutes([activeRecord()]),
    });

    const result = await harness.cli.run(
      ["service", "domain", "show", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.domain.show");
    expect(frame.envelope.result).toMatchObject({
      ...EXPECTED_TARGET,
      domain: {
        id: "url_1",
        hostname: "shop.acme.com",
        status: "active",
        state: "active",
      },
    });
  });

  it("reads the detail the API answers, not the listed entry", async () => {
    const harness = await makeServiceCli({
      routes: showRoutes([domainRecord()], [], () => activeRecord()),
    });

    const result = await harness.cli.run(
      ["service", "domain", "show", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.result).toMatchObject({
      domain: { state: "active" },
    });
  });

  it.each([
    {
      name: "the newer entry that holds the hostname over an older one that never proved ownership",
      entries: duplicateEntries(),
      expected: "url_2",
    },
    {
      name: "the entry that holds the hostname whatever order the service lists them in",
      entries: [...duplicateEntries()].reverse(),
      expected: "url_2",
    },
    {
      name: "the older entry that holds the hostname over a newer one waiting to take it over",
      entries: [
        activeRecord({
          id: "url_1",
          customDomain: customDomain(),
          createdAt: "2026-08-01T00:00:00.000Z",
        }),
        domainRecord({
          id: "url_2",
          state: "in_use_elsewhere",
          heldBy: {
            workspaceId: "wksp_ws_1",
            projectId: "proj_1",
            serviceId: "svc_1",
            message: null,
          },
          createdAt: "2026-08-02T00:00:00.000Z",
        }),
      ],
      expected: "url_1",
    },
    {
      name: "the oldest entry when none holds the hostname",
      entries: [
        domainRecord({ id: "url_1", createdAt: "2026-08-03T00:00:00.000Z" }),
        domainRecord({
          id: "url_2",
          hostname: "SHOP.acme.com",
          createdAt: "2026-08-01T00:00:00.000Z",
        }),
      ],
      expected: "url_2",
    },
  ])("reads $name when the service lists the hostname more than once", async ({
    entries,
    expected,
  }) => {
    const shownIds: string[] = [];
    const harness = await makeServiceCli({
      routes: showRoutes(
        [activeRecord({ id: "url_9", hostname: "other.acme.com" }), ...entries],
        shownIds,
      ),
    });

    const result = await harness.cli.run(
      ["service", "domain", "show", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(shownIds).toEqual([expected]);
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes(),
      authenticated: false,
    });

    const result = await harness.cli.run(
      ["service", "domain", "show", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });

  it("settles an unknown hostname as SERVICE.DOMAIN_NOT_FOUND", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes(
        listing([activeRecord({ id: "url_9", hostname: "other.acme.com" })]),
      ),
    });

    const result = await harness.cli.run(
      ["service", "domain", "show", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DOMAIN_NOT_FOUND");
  });

  it("settles a hostname deleted between the listing and the read as SERVICE.DOMAIN_NOT_FOUND", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        "GET /v1/urls/{id}": () => ({
          status: 404,
          error: { error: { code: "not-found", message: "No such URL." } },
        }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "show", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DOMAIN_NOT_FOUND");
  });
});

describe("prisma service domain retry", () => {
  function certificateFailed(): RawDomain {
    return certificateFailedRecord("CAA record forbids the issuer");
  }

  function provisioning(): RawDomain {
    return provisioningRecord();
  }

  function rateLimitedRoutes(
    listed: RawDomain,
    headers: Record<string, string>,
    message = "Too many checks for this hostname.",
  ): Routes {
    return domainRoutes({
      ...listing([listed]),
      "POST /v1/urls/{id}/check": () => ({
        status: 429,
        headers,
        error: { error: { code: "rate-limited", message } },
      }),
    });
  }

  it("checks the hostname again and presents what it waits on now", async () => {
    const checkedIds: string[] = [];
    const harness = await makeServiceCli({
      routes: domainRoutes({
        ...listing([certificateFailed()]),
        "POST /v1/urls/{id}/check": (init) => {
          checkedIds.push(String(init.params?.path?.id));
          return { data: { data: provisioning() } };
        },
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "retry", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(checkedIds).toEqual(["url_1"]);
    expect(result.presented?.data).toMatchObject({
      domain: { state: "provisioning_certificate" },
    });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "ok",
      text: "Checked shop.acme.com again.",
    });
    expect(fieldRows(result.presented)).toContainEqual({
      label: "waiting on",
      value: "The TLS certificate is being issued.",
    });
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "Wait for activation",
        command:
          "prisma service domain wait shop.acme.com --service svc_1 --project proj_1 --branch main",
      },
    ]);
  });

  it("emits the completed json envelope with commandId service.domain.retry", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        ...listing([certificateFailed()]),
        "POST /v1/urls/{id}/check": () => ({
          data: { data: provisioning() },
        }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "retry", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.domain.retry");
    expect(frame.envelope.result).toMatchObject({
      ...EXPECTED_TARGET,
      domain: {
        hostname: "shop.acme.com",
        state: "provisioning_certificate",
      },
    });
  });

  it("checks the entry that holds the hostname when the service lists it more than once", async () => {
    const checkedIds: string[] = [];
    const harness = await makeServiceCli({
      routes: domainRoutes({
        ...listing(duplicateEntries()),
        "POST /v1/urls/{id}/check": (init) => {
          checkedIds.push(String(init.params?.path?.id));
          return { data: { data: duplicateEntries()[1] } };
        },
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "retry", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(checkedIds).toEqual(["url_2"]);
  });

  it("relays the API's message and hint when a retry is rate limited", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        ...listing([certificateFailed()]),
        "POST /v1/urls/{id}/check": () => ({
          status: 429,
          headers: { "Retry-After": "120" },
          error: {
            error: {
              code: "rate-limited",
              message:
                "This workspace has ordered its 50 certificates for this hour.",
              hint: "Certificates are counted per workspace.",
            },
          },
        }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "retry", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).not.toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error).toMatchObject({
      code: "SERVICE.DOMAIN_RETRY_RATE_LIMITED",
      summary: '"shop.acme.com" was not retried: a limit was reached',
      why: "This workspace has ordered its 50 certificates for this hour.",
      meta: { status: 429, apiCode: "rate-limited", retryAfterSeconds: 120 },
    });
    expect(frame.envelope.error.meta).not.toHaveProperty("certificateFailed");
    expect(frame.envelope.nextActions).toEqual([
      { kind: "user-choice", label: "Certificates are counted per workspace." },
      { kind: "user-choice", label: "Run the retry again in 2 minute(s)." },
      {
        kind: "run-command",
        label: "Retry the domain",
        command:
          "prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch main",
      },
    ]);
  });

  it("relays the API's message without advice of its own when a rate limit gives no hint", async () => {
    const harness = await makeServiceCli({
      routes: rateLimitedRoutes(waitingForDnsRecord(), { "Retry-After": "30" }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "retry", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error).toMatchObject({
      code: "SERVICE.DOMAIN_RETRY_RATE_LIMITED",
      summary: '"shop.acme.com" was not retried: a limit was reached',
      why: "Too many checks for this hostname.",
      meta: { retryAfterSeconds: 30 },
    });
    expect(frame.envelope.nextActions).toEqual([
      { kind: "user-choice", label: "Run the retry again in 1 minute(s)." },
      {
        kind: "run-command",
        label: "Retry the domain",
        command:
          "prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch main",
      },
    ]);
  });

  it("says to retry later when a rate limit gives no Retry-After", async () => {
    const harness = await makeServiceCli({
      routes: rateLimitedRoutes(certificateFailed(), {}),
    });

    const result = await harness.cli.run(
      ["service", "domain", "retry", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.meta).toMatchObject({
      retryAfterSeconds: null,
    });
    expect(frame.envelope.nextActions).toEqual([
      { kind: "user-choice", label: "Run the retry again later." },
      {
        kind: "run-command",
        label: "Retry the domain",
        command:
          "prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch main",
      },
    ]);
  });

  it("settles a hostname the check cannot find as SERVICE.DOMAIN_NOT_FOUND", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        "POST /v1/urls/{id}/check": () => ({
          status: 404,
          error: { error: { code: "not-found", message: "No such URL." } },
        }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "retry", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DOMAIN_NOT_FOUND");
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes(),
      authenticated: false,
    });

    const result = await harness.cli.run(
      ["service", "domain", "retry", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});

describe("prisma service domain delete", () => {
  /** `deletedIds` collects the id of every hostname entry the run deleted. */
  function deleteRoutes(
    deletedIds: string[] = [],
    entries: RawDomain[] = [domainRecord()],
  ): Routes {
    return domainRoutes({
      ...listing(entries),
      "DELETE /v1/urls/{id}": (init) => {
        deletedIds.push(String(init.params?.path?.id));
        return { data: undefined };
      },
    });
  }

  const INTERACTIVE = {
    isTty: { stdin: true, stdout: true, stderr: true },
  };

  it("deletes the domain when --confirm carries the hostname non-interactively", async () => {
    const deletedIds: string[] = [];
    const harness = await makeServiceCli({ routes: deleteRoutes(deletedIds) });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "delete",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--confirm",
        "shop.acme.com",
      ],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      ...EXPECTED_TARGET,
      hostname: "shop.acme.com",
      deleted: true,
    });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "ok",
      text: "Deleted shop.acme.com from hello-world.",
    });
    expect(deletedIds).toEqual(["url_1"]);
  });

  it("deletes every entry the service lists for the hostname and no other, the one that holds it last", async () => {
    const deletedIds: string[] = [];
    const harness = await makeServiceCli({
      routes: deleteRoutes(deletedIds, [
        activeRecord({ id: "url_1", customDomain: customDomain() }),
        activeRecord({ id: "url_9", hostname: "other.acme.com" }),
        domainRecord({
          id: "url_2",
          hostname: "Shop.Acme.com",
          state: "in_use_elsewhere",
        }),
      ]),
    });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "delete",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--confirm",
        "shop.acme.com",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(deletedIds).toEqual(["url_2", "url_1"]);
  });

  it("skips an entry someone else deleted meanwhile and still deletes the rest", async () => {
    const deleteAttempts: string[] = [];
    const harness = await makeServiceCli({
      routes: domainRoutes({
        ...listing(duplicateEntries()),
        "DELETE /v1/urls/{id}": (init) => {
          const id = String(init.params?.path?.id);
          deleteAttempts.push(id);
          return id === "url_1"
            ? {
                status: 404,
                error: {
                  error: { code: "not-found", message: "No such URL." },
                },
              }
            : { data: undefined };
        },
      }),
    });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "delete",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--confirm",
        "shop.acme.com",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(deleteAttempts).toEqual(["url_1", "url_2"]);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.result).toMatchObject({ deleted: true });
  });

  it("stops at a delete that fails for another reason", async () => {
    const deleteAttempts: string[] = [];
    const harness = await makeServiceCli({
      routes: domainRoutes({
        ...listing(duplicateEntries()),
        "DELETE /v1/urls/{id}": (init) => {
          deleteAttempts.push(String(init.params?.path?.id));
          return {
            status: 500,
            error: { error: { code: "internal", message: "Boom." } },
          };
        },
      }),
    });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "delete",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--confirm",
        "shop.acme.com",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).not.toBe(0);
    expect(deleteAttempts).toEqual(["url_1"]);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOY_FAILED");
  });

  it("settles an unknown hostname as SERVICE.DOMAIN_NOT_FOUND without deleting anything", async () => {
    const deletedIds: string[] = [];
    const harness = await makeServiceCli({
      routes: deleteRoutes(deletedIds, [
        activeRecord({ id: "url_9", hostname: "other.acme.com" }),
      ]),
    });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "delete",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--confirm",
        "shop.acme.com",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DOMAIN_NOT_FOUND");
    expect(deletedIds).toEqual([]);
  });

  it("grants under --yes when --confirm carries the hostname", async () => {
    // --yes alone can never grant; --yes plus the matching token takes the
    // engine's non-interactive branch and grants without asking, so the run
    // completes with no scripted answer available.
    const harness = await makeServiceCli({ routes: deleteRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "delete",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--yes",
        "--confirm",
        "shop.acme.com",
      ],
      { cwd: harness.cwd, env: harness.env, ...INTERACTIVE, answers: [] },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ deleted: true });
  });

  it("emits the completed json envelope for a non-interactive --confirm deletion", async () => {
    const harness = await makeServiceCli({ routes: deleteRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "delete",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--confirm",
        "shop.acme.com",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.domain.delete");
    expect(frame.envelope.result).toMatchObject({
      hostname: "shop.acme.com",
      deleted: true,
    });
  });

  it("still asks interactively when --confirm is present, and takes the typed token", async () => {
    // The grant is a non-interactive affordance: an interactive session
    // type-to-confirms regardless of --confirm.
    const harness = await makeServiceCli({ routes: deleteRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "delete",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--confirm",
        "shop.acme.com",
        "--json",
      ],
      {
        cwd: harness.cwd,
        env: harness.env,
        ...INTERACTIVE,
        answers: ["shop.acme.com"],
      },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.domain.delete");
    expect(frame.envelope.result).toMatchObject({ deleted: true });
  });

  it("deletes the domain after interactive consent", async () => {
    const harness = await makeServiceCli({ routes: deleteRoutes() });

    const result = await harness.cli.run(
      ["service", "domain", "delete", "shop.acme.com", ...TARGET_ARGS],
      {
        cwd: harness.cwd,
        env: harness.env,
        ...INTERACTIVE,
        answers: ["shop.acme.com"],
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      ...EXPECTED_TARGET,
      hostname: "shop.acme.com",
      deleted: true,
    });
  });

  it("emits the completed json envelope with commandId service.domain.delete", async () => {
    // An interactive json run still prompts (the prompt UI writes to
    // stderr); consent is granted through the scripted answer.
    const harness = await makeServiceCli({ routes: deleteRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "delete",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--json",
      ],
      {
        cwd: harness.cwd,
        env: harness.env,
        ...INTERACTIVE,
        answers: ["shop.acme.com"],
      },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.domain.delete");
    expect(frame.envelope.result).toMatchObject({
      ...EXPECTED_TARGET,
      hostname: "shop.acme.com",
      deleted: true,
    });
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({
      routes: deleteRoutes(),
      authenticated: false,
    });

    const result = await harness.cli.run(
      ["service", "domain", "delete", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });

  it("settles a mistyped consent token as the engine mismatch error", async () => {
    const deletedIds: string[] = [];
    const harness = await makeServiceCli({ routes: deleteRoutes(deletedIds) });

    const result = await harness.cli.run(
      ["service", "domain", "delete", "shop.acme.com", ...TARGET_ARGS],
      {
        cwd: harness.cwd,
        env: harness.env,
        ...INTERACTIVE,
        answers: ["no"],
      },
    );

    expect(result.exitCode).toBe(2);
    expect(deletedIds).toEqual([]);
  });

  it("settles a non-interactive run as the engine consent-required error with exit 2", async () => {
    const harness = await makeServiceCli({ routes: deleteRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "delete",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("CLI.CONSENT_REQUIRED");
  });

  it("refuses a --confirm value that is not the hostname, naming the expected value", async () => {
    const harness = await makeServiceCli({ routes: deleteRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "delete",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--confirm",
        "other.example.com",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("CLI.CONSENT_REQUIRED");
    expect(frame.envelope.error.nextActions?.[0]?.label).toContain(
      "--confirm shop.acme.com",
    );
    expect(frame.envelope.error.meta).toMatchObject({
      consentToken: "shop.acme.com",
    });
  });

  it("cannot be granted by --yes under the engine consent rules (exit 2)", async () => {
    // Divergence from legacy: `--yes` used to skip the confirmation. The
    // engine rules consent structurally ungrantable by --yes; recorded in
    // parity-divergences-s2c.md and raised to the operator.
    const harness = await makeServiceCli({ routes: deleteRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "delete",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--yes",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("CLI.CONSENT_REQUIRED");
  });
});

it.each([
  "show",
  "retry",
  "wait",
  "delete",
])("manages a staging domain with %s", async (command) => {
  const stagingDomain = activeRecord({
    id: "url_staging",
    branchId: "br_staging",
    serviceId: "svc_staging",
  });
  const harness = await makeServiceCli({
    routes: domainRoutes({
      "GET /v1/apps": (init) => {
        expect(init.params?.query?.branchGitName).toBe("staging");
        return {
          data: page([
            {
              id: "svc_staging",
              name: "hello-world",
              region: { id: "eu-central-1" },
              branchId: "br_staging",
              latestDeploymentId: "dep_staging",
              appEndpointDomain: "staging.prisma.build",
            },
          ]),
        };
      },
      "GET /v1/services/{serviceId}/urls": (init) => {
        expect(init.params?.path?.serviceId).toBe("svc_staging");
        return { data: { data: [stagingDomain] } };
      },
      "GET /v1/urls/{id}": (init) => {
        expect(init.params?.path?.id).toBe("url_staging");
        return { data: { data: stagingDomain } };
      },
      "POST /v1/urls/{id}/check": (init) => {
        expect(init.params?.path?.id).toBe("url_staging");
        return { data: { data: stagingDomain } };
      },
      "DELETE /v1/urls/{id}": (init) => {
        expect(init.params?.path?.id).toBe("url_staging");
        return { data: undefined };
      },
    }),
  });
  const result = await harness.cli.run(
    [
      "service",
      "domain",
      command,
      "shop.acme.com",
      ...TARGET_ARGS,
      "--branch",
      "staging",
      "--json",
      ...(command === "delete" ? ["--confirm", "shop.acme.com"] : []),
    ],
    { cwd: harness.cwd, env: harness.env },
  );
  expect(result.exitCode).toBe(0);
  const frame = result.json[result.json.length - 1];
  if (frame?.kind !== "result" || !frame.envelope.ok) {
    throw new Error("expected a completed envelope");
  }
  expect(frame.envelope.result).toMatchObject({
    branch: { name: "staging", kind: "preview" },
    service: { id: "svc_staging", name: "hello-world" },
  });
});

it.each([
  "add",
  "show",
  "retry",
  "wait",
  "delete",
])("hides every detail of a server error behind one plain sentence in %s", async (command) => {
  const serverError = () => ({
    status: 502,
    error: {
      error: {
        code: "foundry-unavailable",
        message: "Foundry upstream timed out after 30s.",
        hint: "Check the Foundry status page.",
      },
    },
  });
  const harness = await makeServiceCli({
    routes: domainRoutes({
      ...listing(command === "add" ? [] : [waitingForDnsRecord()]),
      "POST /v1/services/{serviceId}/urls": serverError,
      "GET /v1/urls/{id}": serverError,
      "POST /v1/urls/{id}/check": serverError,
      "DELETE /v1/urls/{id}": serverError,
    }),
  });

  const result = await harness.cli.run(
    [
      "service",
      "domain",
      command,
      "shop.acme.com",
      ...TARGET_ARGS,
      "--branch",
      "feature/customer's-test",
      "--json",
      ...(command === "delete" ? ["--confirm", "shop.acme.com"] : []),
    ],
    {
      cwd: harness.cwd,
      env: { ...harness.env, PRISMA_CLI_DOMAIN_WAIT_POLL_MS: "1" },
    },
  );

  expect(result.exitCode).not.toBe(0);
  const frame = result.json[result.json.length - 1];
  if (frame?.kind !== "result" || frame.envelope.ok)
    throw new Error("expected an errored envelope");
  expect(frame.envelope.error).toMatchObject({
    code: "SERVICE.DEPLOY_FAILED",
    why: "The operation failed for reasons we are not sure about. You can try again, or contact support.",
  });
  expect(frame.envelope.error.meta).toEqual({ status: 502 });
  expect(frame.envelope.nextActions).toEqual([
    {
      kind: "run-command",
      label: "Show the domain",
      command:
        "prisma service domain show shop.acme.com --service svc_1 --project proj_1 --branch 'feature/customer'\\''s-test'",
    },
  ]);
  const serialized = JSON.stringify(frame.envelope);
  expect(serialized).not.toContain("Foundry upstream timed out");
  expect(serialized).not.toContain("foundry-unavailable");
  expect(serialized).not.toContain("Check the Foundry status page");
});

it("shows the API's message for a client error the CLI does not handle on its own", async () => {
  const harness = await makeServiceCli({
    routes: domainRoutes({
      "GET /v1/urls/{id}": () => ({
        status: 403,
        error: {
          error: {
            code: "forbidden",
            message: "This token cannot read hostnames.",
          },
        },
      }),
    }),
  });

  const result = await harness.cli.run(
    ["service", "domain", "show", "shop.acme.com", ...TARGET_ARGS, "--json"],
    { cwd: harness.cwd, env: harness.env },
  );

  expect(result.exitCode).not.toBe(0);
  const frame = result.json[result.json.length - 1];
  if (frame?.kind !== "result" || frame.envelope.ok)
    throw new Error("expected an errored envelope");
  expect(frame.envelope.error).toMatchObject({
    code: "SERVICE.DEPLOY_FAILED",
    why: "Failed to show custom domain: This token cannot read hostnames.",
    meta: { status: 403, apiCode: "forbidden" },
  });
});
