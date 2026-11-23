import { describe, expect, it } from "vitest";
import {
  activeRecord,
  certificateFailedRecord,
  customDomain,
  domainRecord,
  platformWorkRecord,
  type RawDomain,
  waitingForDnsRecord,
} from "./helpers/routing-url";
import { makeServiceCli, type Routes, readFlowRoutes } from "./service-testkit";

const TARGET_ARGS = ["--project", "acme-app", "--service", "hello-world"];

const APEX_NOTE =
  "At an apex domain, publish the CNAME as an ALIAS, ANAME or flattened CNAME with the same target.";

type Read = "show" | "check" | "check (429)";

/**
 * The listing returns `sequence[0]`; each later read of the hostname,
 * a show or a check, returns the next entry and then stays on the last.
 * `reads` records which kind of read each one was. A check answers 429
 * while `rateLimitedChecks` is above zero, and that read does not
 * advance the sequence.
 */
function waitRoutes(
  sequence: RawDomain[],
  reads: Read[] = [],
  options: { rateLimitedChecks?: number } = {},
): Routes {
  let rateLimitedChecks = options.rateLimitedChecks ?? 0;
  let served = 0;
  const next = (): RawDomain => {
    served += 1;
    return sequence[Math.min(served, sequence.length - 1)] as RawDomain;
  };
  return readFlowRoutes({
    "GET /v1/services/{serviceId}/urls": () => ({
      data: { data: [sequence[0]] },
    }),
    "GET /v1/urls/{id}": (init) => {
      expect(init.params?.path?.id).toBe("url_1");
      reads.push("show");
      return { data: { data: next() } };
    },
    "POST /v1/urls/{id}/check": (init) => {
      expect(init.params?.path?.id).toBe("url_1");
      if (rateLimitedChecks > 0) {
        rateLimitedChecks -= 1;
        reads.push("check (429)");
        return {
          status: 429,
          error: { error: { code: "rate-limited", message: "Slow down." } },
        };
      }
      reads.push("check");
      return { data: { data: next() } };
    },
  });
}

function provisioning(): RawDomain {
  return domainRecord({
    state: "provisioning_certificate",
    conditions: {
      ownershipVerified: "met",
      servicePresent: "met",
      liveDeployment: "met",
      dnsPointsAtSwitchboard: "met",
      customDomainBound: "met",
      certificateActive: "unmet",
    },
    firstUnmetCondition: "certificateActive",
    records: [],
  });
}

function waitEnv(env: Record<string, string | undefined>) {
  return { ...env, PRISMA_CLI_DOMAIN_WAIT_POLL_MS: "1" };
}

describe("prisma service domain wait", () => {
  it("emits a status event per state change and completes when the hostname is active", async () => {
    const reads: Read[] = [];
    const harness = await makeServiceCli({
      routes: waitRoutes(
        [waitingForDnsRecord(), provisioning(), activeRecord()],
        reads,
      ),
    });

    const result = await harness.cli.run(
      ["service", "domain", "wait", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: waitEnv(harness.env) },
    );

    expect(result.exitCode).toBe(0);
    const statusEvents = result.events.filter(
      (event) => event.kind === "status",
    );
    expect(
      statusEvents.map((event) => ({
        subject: event.subject,
        status: event.status,
        from: "from" in event ? event.from : undefined,
      })),
    ).toEqual([
      { subject: "shop.acme.com", status: "waiting_for_dns", from: undefined },
      {
        subject: "shop.acme.com",
        status: "provisioning_certificate",
        from: "waiting_for_dns",
      },
      {
        subject: "shop.acme.com",
        status: "active",
        from: "provisioning_certificate",
      },
    ]);
    expect(result.presented?.data).toMatchObject({
      hostname: "shop.acme.com",
      status: "active",
      state: "active",
      liveUrl: "https://shop.acme.com",
    });
    expect(result.stdout).toBe("https://shop.acme.com\n");
    expect(reads).toEqual(["check", "show"]);
  });

  it("does not repeat status events while the state is unchanged", async () => {
    const reads: Read[] = [];
    const harness = await makeServiceCli({
      routes: waitRoutes(
        [provisioning(), provisioning(), provisioning(), activeRecord()],
        reads,
      ),
    });

    const result = await harness.cli.run(
      ["service", "domain", "wait", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: waitEnv(harness.env) },
    );

    expect(result.exitCode).toBe(0);
    const statuses = result.events
      .filter((event) => event.kind === "status")
      .map((event) => event.status);
    expect(statuses).toEqual(["provisioning_certificate", "active"]);
    expect(reads).toEqual(["show", "show", "show"]);
  });

  it("checks the DNS on the first re-read and every sixth read after it while the hostname waits for records", async () => {
    const reads: Read[] = [];
    const notVerified = Array.from({ length: 8 }, () => domainRecord());
    const harness = await makeServiceCli({
      routes: waitRoutes([...notVerified, activeRecord()], reads),
    });

    const result = await harness.cli.run(
      ["service", "domain", "wait", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: waitEnv(harness.env) },
    );

    expect(result.exitCode).toBe(0);
    expect(reads).toEqual([
      "check",
      "show",
      "show",
      "show",
      "show",
      "show",
      "check",
      "show",
    ]);
  });

  it("reads the hostname instead when the check is rate limited", async () => {
    const reads: Read[] = [];
    const harness = await makeServiceCli({
      routes: waitRoutes([waitingForDnsRecord(), activeRecord()], reads, {
        rateLimitedChecks: 1,
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "wait", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: waitEnv(harness.env) },
    );

    expect(result.exitCode).toBe(0);
    expect(reads).toEqual(["check (429)", "show"]);
    expect(result.presented?.data).toMatchObject({ state: "active" });
  });

  it("fails at once when the certificate failed, relaying the platform's reason and offering the retry", async () => {
    const reads: Read[] = [];
    const harness = await makeServiceCli({
      routes: waitRoutes(
        [
          provisioning(),
          certificateFailedRecord("CAA record forbids the issuer"),
          activeRecord(),
        ],
        reads,
      ),
    });

    const result = await harness.cli.run(
      ["service", "domain", "wait", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: waitEnv(harness.env) },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error).toMatchObject({
      code: "SERVICE.DOMAIN_VERIFICATION_FAILED",
      summary: 'Custom domain "shop.acme.com" cannot become active',
      why: "Provisioning failed. The platform reported: CAA record forbids the issuer",
      meta: { state: "certificate_failed" },
    });
    expect(frame.envelope.error.nextActions).toEqual([
      {
        kind: "run-command",
        label: "Show the domain",
        command:
          "prisma service domain show shop.acme.com --service svc_1 --project proj_1 --branch production",
      },
      {
        kind: "run-command",
        label: "Retry the certificate",
        command:
          "prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch production",
      },
    ]);
    expect(JSON.stringify(frame.envelope.error)).not.toContain(
      "prisma-cli app ",
    );
    expect(reads).toEqual(["show"]);
  });

  it("fails at once when the hostname's service is gone, without offering a retry", async () => {
    const reads: Read[] = [];
    const harness = await makeServiceCli({
      routes: waitRoutes(
        [
          domainRecord({
            state: "no_service",
            serviceId: null,
            setupUrl: null,
          }),
        ],
        reads,
      ),
    });

    const result = await harness.cli.run(
      ["service", "domain", "wait", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: waitEnv(harness.env) },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error).toMatchObject({
      code: "SERVICE.DOMAIN_VERIFICATION_FAILED",
      why: "The service this hostname routed to was deleted.",
      meta: { state: "no_service" },
    });
    expect(frame.envelope.error.nextActions).toEqual([
      {
        kind: "user-choice",
        label:
          "Delete the hostname, then add it to the service that should serve it.",
      },
      {
        kind: "run-command",
        label: "Show the domain",
        command:
          "prisma service domain show shop.acme.com --service svc_1 --project proj_1 --branch production",
      },
    ]);
    expect(reads).toEqual([]);
  });

  it("reads once with --timeout 0, never re-fetches or checks, and says on timeout what the hostname waits on", async () => {
    const reads: Read[] = [];
    const harness = await makeServiceCli({
      routes: waitRoutes(
        [
          waitingForDnsRecord({
            switchboardDns: {
              accepted: false,
              detail: "the CNAME points at old.example.net",
              lastSeenAt: "2026-08-01T00:05:00.000Z",
            },
          }),
        ],
        reads,
      ),
    });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "wait",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--timeout",
        "0",
        "--json",
      ],
      { cwd: harness.cwd, env: waitEnv(harness.env) },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error).toMatchObject({
      code: "SERVICE.DOMAIN_VERIFICATION_TIMEOUT",
      why: 'The domain is still "waiting_for_dns". The hostname\'s DNS does not point at Prisma. The platform reported: the CNAME points at old.example.net',
      meta: { state: "waiting_for_dns" },
    });
    expect(frame.envelope.error.nextActions).toEqual([
      {
        kind: "user-choice",
        label: `Publish CNAME shop.acme.com -> switchboard.cdg.prisma.build at your DNS provider, then run prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch production. ${APEX_NOTE}`,
      },
      {
        kind: "run-command",
        label: "Show the domain",
        command:
          "prisma service domain show shop.acme.com --service svc_1 --project proj_1 --branch production",
      },
      { kind: "user-choice", label: "Retry wait with a longer --timeout." },
    ]);
    expect(reads).toEqual([]);
  });

  it.each([
    {
      state: "provisioning_certificate",
      domain: provisioning(),
      why: 'The domain is still "provisioning_certificate". The TLS certificate is being issued.',
      advice:
        "Retry wait with a longer --timeout. If the domain stays in this state, contact support.",
    },
    {
      state: "updating",
      domain: platformWorkRecord({ state: "updating" }),
      why: 'The domain is still "updating". The platform is bringing the hostname up to date.',
      advice:
        "Retry wait with a longer --timeout. If the domain stays in this state, contact support.",
    },
    {
      state: "update_failed",
      domain: platformWorkRecord({
        state: "update_failed",
        customDomainSyncError: "Foundry answered HTTP 503",
      }),
      why: `The domain is still "update_failed". The hostname's last update failed, and the platform is retrying it. You can try again, or contact support.`,
      advice: "Retry wait with a longer --timeout.",
      tryAgain: [
        {
          kind: "run-command",
          label: "Try again",
          command:
            "prisma service domain retry shop.acme.com --service svc_1 --project proj_1 --branch production",
        },
      ],
    },
  ])("on timeout in $state, which the platform has to move, reports the state and what to do", async ({
    state,
    domain,
    why,
    advice,
    tryAgain = [],
  }) => {
    const harness = await makeServiceCli({ routes: waitRoutes([domain]) });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "wait",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--timeout",
        "0",
        "--json",
      ],
      { cwd: harness.cwd, env: waitEnv(harness.env) },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error).toMatchObject({
      code: "SERVICE.DOMAIN_VERIFICATION_TIMEOUT",
      summary: 'Timed out waiting for "shop.acme.com" to become active',
      why,
      meta: { state },
    });
    expect(frame.envelope.error.nextActions).toEqual([
      {
        kind: "run-command",
        label: "Show the domain",
        command:
          "prisma service domain show shop.acme.com --service svc_1 --project proj_1 --branch production",
      },
      ...tryAgain,
      { kind: "user-choice", label: advice },
    ]);
    expect(JSON.stringify(frame.envelope)).not.toContain(
      "Foundry answered HTTP 503",
    );
  });

  it("times out after polling a hostname the platform is still provisioning", async () => {
    const reads: Read[] = [];
    const harness = await makeServiceCli({
      routes: waitRoutes([provisioning()], reads),
    });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "wait",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--timeout",
        "20ms",
        "--json",
      ],
      { cwd: harness.cwd, env: waitEnv(harness.env) },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error).toMatchObject({
      code: "SERVICE.DOMAIN_VERIFICATION_TIMEOUT",
      why: 'The domain is still "provisioning_certificate". The TLS certificate is being issued.',
    });
    expect(reads.length).toBeGreaterThan(0);
  });

  it("rejects an invalid --timeout as SERVICE.TIMEOUT_INVALID", async () => {
    const harness = await makeServiceCli({
      routes: waitRoutes([domainRecord()]),
    });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "wait",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--timeout",
        "soon",
        "--json",
      ],
      { cwd: harness.cwd, env: waitEnv(harness.env) },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.TIMEOUT_INVALID");
  });

  it("frames status events on the json stream before the terminal result", async () => {
    const harness = await makeServiceCli({
      routes: waitRoutes([provisioning(), activeRecord()]),
    });

    const result = await harness.cli.run(
      ["service", "domain", "wait", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: waitEnv(harness.env) },
    );

    expect(result.exitCode).toBe(0);
    const kinds = result.json.map((frame) => frame.kind);
    expect(kinds.filter((kind) => kind === "status")).toHaveLength(2);
    const last = result.json[result.json.length - 1];
    if (last?.kind !== "result" || !last.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(last.envelope.commandId).toBe("service.domain.wait");
    expect(last.envelope.result).toMatchObject({
      hostname: "shop.acme.com",
      status: "active",
      state: "active",
      liveUrl: "https://shop.acme.com",
    });
  });

  it("waits on the entry that holds the hostname when the service lists it more than once", async () => {
    const readIds: string[] = [];
    const holding: RawDomain = {
      ...provisioning(),
      id: "url_2",
      customDomain: customDomain({
        status: "provisioning",
        certExpiresAt: null,
      }),
      createdAt: "2026-08-02T00:00:00.000Z",
    };
    const harness = await makeServiceCli({
      routes: readFlowRoutes({
        "GET /v1/services/{serviceId}/urls": () => ({
          data: {
            data: [
              domainRecord({
                id: "url_1",
                createdAt: "2026-08-01T00:00:00.000Z",
              }),
              holding,
            ],
          },
        }),
        "GET /v1/urls/{id}": (init) => {
          readIds.push(String(init.params?.path?.id));
          return {
            data: {
              data: activeRecord({
                id: "url_2",
                customDomain: customDomain(),
                createdAt: "2026-08-02T00:00:00.000Z",
              }),
            },
          };
        },
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "wait", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: waitEnv(harness.env) },
    );

    expect(result.exitCode).toBe(0);
    expect(readIds).toEqual(["url_2"]);
    expect(result.presented?.data).toMatchObject({ state: "active" });
  });

  it("moves to the entry that takes the hostname when the one it followed loses it", async () => {
    const older = waitingForDnsRecord({ id: "url_1" });
    const newer = waitingForDnsRecord({
      id: "url_2",
      createdAt: "2026-08-02T00:00:00.000Z",
    });
    const heldByNewer: RawDomain = {
      ...older,
      state: "in_use_elsewhere",
      heldBy: {
        workspaceId: "wksp_ws_1",
        projectId: "proj_1",
        serviceId: "svc_1",
        message: null,
      },
    };
    const listings: RawDomain[][] = [
      [older, newer],
      [
        heldByNewer,
        activeRecord({
          id: "url_2",
          customDomain: customDomain(),
          createdAt: "2026-08-02T00:00:00.000Z",
        }),
      ],
    ];
    const requests: string[] = [];
    const harness = await makeServiceCli({
      routes: readFlowRoutes({
        "GET /v1/services/{serviceId}/urls": () => {
          requests.push("list");
          return { data: { data: listings.shift() ?? [] } };
        },
        "POST /v1/urls/{id}/check": (init) => {
          requests.push(`check ${String(init.params?.path?.id)}`);
          return { data: { data: heldByNewer } };
        },
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "wait", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: waitEnv(harness.env) },
    );

    expect(result.exitCode).toBe(0);
    expect(requests).toEqual(["list", "check url_1", "list"]);
    expect(
      result.events
        .filter((event) => event.kind === "status")
        .map((event) => event.status),
    ).toEqual(["waiting_for_dns", "in_use_elsewhere", "active"]);
  });

  it.each([
    {
      holder: "svc_1",
      why: 'The domain is still "in_use_elsewhere". This service lists the hostname more than once, and another entry holds it.',
      fix: [],
    },
    {
      holder: "svc_2",
      why: 'The domain is still "in_use_elsewhere". Another service holds this hostname: service svc_2. This service takes it over once that one gives it up.',
      fix: [
        {
          kind: "user-choice",
          label: "Delete the hostname from service svc_2.",
        },
      ],
    },
  ])("says on timeout who holds a hostname held by $holder", async ({
    holder,
    why,
    fix,
  }) => {
    const harness = await makeServiceCli({
      routes: waitRoutes([
        domainRecord({
          state: "in_use_elsewhere",
          heldBy: {
            workspaceId: "wksp_ws_1",
            projectId: "proj_1",
            serviceId: holder,
            message: null,
          },
        }),
      ]),
    });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "wait",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--timeout",
        "0",
        "--json",
      ],
      { cwd: harness.cwd, env: waitEnv(harness.env) },
    );

    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.why).toBe(why);
    expect(frame.envelope.error.nextActions.slice(0, fix.length)).toEqual(fix);
    expect(frame.envelope.error.nextActions).toHaveLength(fix.length + 2);
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({
      routes: waitRoutes([activeRecord()]),
      authenticated: false,
    });

    const result = await harness.cli.run(
      ["service", "domain", "wait", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: waitEnv(harness.env), isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});
