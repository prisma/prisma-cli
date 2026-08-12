import { describe, expect, it } from "vitest";

import {
  domainRecord,
  makeServiceCli,
  page,
  presentedSummary,
  type Routes,
  readFlowRoutes,
} from "./v8-service-testkit";

const EXPECTED_TARGET = {
  workspace: { id: "ws_1", name: "Acme Inc" },
  project: { id: "proj_1", name: "acme-app" },
  branch: { name: "production", kind: "production" },
  service: { id: "svc_1", name: "hello-world" },
};

function domainRoutes(overrides: Routes = {}): Routes {
  return readFlowRoutes({
    "GET /v1/apps/{appId}/domains": () => ({
      data: { data: [domainRecord()] },
    }),
    ...overrides,
  });
}

const TARGET_ARGS = ["--project", "acme-app", "--service", "hello-world"];

describe("prisma-cli service domain add", () => {
  it("registers the domain and presents the target with dns records", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        "POST /v1/apps/{appId}/domains": () => ({
          data: { data: domainRecord() },
        }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "add", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      ...EXPECTED_TARGET,
      existing: false,
      domain: {
        id: "dom_1",
        hostname: "shop.acme.com",
        serviceId: "svc_1",
        status: "pending_dns",
        dnsRecords: [
          {
            type: "CNAME",
            name: "shop.acme.com",
            value: "edge.prisma.build",
            ttl: 300,
          },
        ],
      },
    });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "ok",
      text: "Added shop.acme.com to hello-world.",
    });
  });

  it("emits the completed json envelope with commandId service.domain.add", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        "POST /v1/apps/{appId}/domains": () => ({
          data: { data: domainRecord() },
        }),
      }),
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
    expect(frame.envelope.result).toMatchObject({
      ...EXPECTED_TARGET,
      existing: false,
      domain: { hostname: "shop.acme.com", serviceId: "svc_1" },
    });
  });

  it("reports an idempotent re-add as the existing domain", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        "POST /v1/apps/{appId}/domains": () => ({
          error: { error: { message: "already exists" } },
          status: 409,
        }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "add", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ existing: true });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "info",
      text: "Showing the existing custom domain for the selected service.",
    });
  });

  it("maps DNS preflight failures to SERVICE.DOMAIN_DNS_NOT_CONFIGURED", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        "POST /v1/apps/{appId}/domains": () => ({
          error: {
            error: {
              message: "DNS is not configured",
              hint: "Create a CNAME to edge.prisma.build first.",
            },
          },
          status: 422,
        }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "add", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DOMAIN_DNS_NOT_CONFIGURED");
    expect(frame.envelope.error.meta).toMatchObject({
      dnsRecord: "CNAME shop.acme.com -> edge.prisma.build",
    });
  });

  it("maps a 422 without a live production deployment to SERVICE.NO_DEPLOYMENTS", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        "POST /v1/apps/{appId}/domains": () => ({
          error: { error: { message: "no promoted deployment" } },
          status: 422,
        }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "add", "shop.acme.com", ...TARGET_ARGS, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.NO_DEPLOYMENTS");
    // No action suggests `service deploy --branch production`: the binary
    // does not answer to it. The advice carries what the user has to do
    // first, so the retry action is not the only thing offered.
    expect(frame.envelope.nextActions).toEqual([
      {
        kind: "user-choice",
        label:
          "Promote a deployment on the service's production branch, then add the domain again.",
      },
      {
        kind: "run-command",
        label: "Add the domain",
        command: "prisma-cli service domain add shop.acme.com",
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
  });

  it("rejects preview branches as SERVICE.BRANCH_NOT_DEPLOYABLE", async () => {
    const harness = await makeServiceCli({ routes: domainRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "add",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--branch",
        "feature/foo",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.BRANCH_NOT_DEPLOYABLE");
  });

  it("honors the PRISMA_SERVICE_ID environment override", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        "POST /v1/apps/{appId}/domains": (init) => {
          expect(init.params?.path?.appId).toBe("svc_1");
          return { data: { data: domainRecord() } };
        },
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "add", "shop.acme.com", "--project", "acme-app"],
      {
        cwd: harness.cwd,
        env: { ...harness.env, PRISMA_SERVICE_ID: "svc_1" },
      },
    );

    expect(result.exitCode).toBe(0);
  });

  it("rejects a PRISMA_SERVICE_ID the project does not have as SERVICE.SELECTION_INVALID", async () => {
    const harness = await makeServiceCli({ routes: domainRoutes() });

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
      {
        cwd: harness.cwd,
        env: { ...harness.env, PRISMA_SERVICE_ID: "svc_missing" },
      },
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
        label:
          "Unset PRISMA_SERVICE_ID, pass --service <name>, or deploy the service on the production branch.",
      },
    ]);
  });

  it("requires an existing service on the production branch", async () => {
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
    expect(frame.envelope.error.code).toBe("SERVICE.DOMAIN_TARGET_REQUIRED");
    expect(frame.envelope.nextActions).toEqual([
      {
        kind: "run-command",
        label: "Inspect the service",
        command: "prisma-cli service show",
      },
    ]);
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

describe("prisma-cli service domain show", () => {
  it("presents the domain detail", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        "GET /v1/domains/{domainId}": () => ({
          data: { data: domainRecord({ status: "verifying" }) },
        }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "show", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      ...EXPECTED_TARGET,
      domain: { hostname: "shop.acme.com", status: "verifying" },
    });
    // A command that only reports keeps the informational heading; the
    // success marker belongs to the commands that changed something.
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "info",
      text: "Showing custom domain status.",
    });
  });

  it("emits the completed json envelope with commandId service.domain.show", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        "GET /v1/domains/{domainId}": () => ({
          data: { data: domainRecord({ status: "active" }) },
        }),
      }),
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
      domain: { hostname: "shop.acme.com", status: "active" },
    });
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
      routes: domainRoutes({
        "GET /v1/apps/{appId}/domains": () => ({ data: { data: [] } }),
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

describe("prisma-cli service domain retry", () => {
  it("retries verification and presents the refreshed domain", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        "GET /v1/apps/{appId}/domains": () => ({
          data: { data: [domainRecord({ status: "failed" })] },
        }),
        "POST /v1/domains/{domainId}/retry": () => ({
          data: { data: domainRecord({ status: "verifying" }) },
        }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "domain", "retry", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      domain: { status: "verifying" },
    });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "ok",
      text: "Retried verification for shop.acme.com.",
    });
  });

  it("emits the completed json envelope with commandId service.domain.retry", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        "GET /v1/apps/{appId}/domains": () => ({
          data: { data: [domainRecord({ status: "failed" })] },
        }),
        "POST /v1/domains/{domainId}/retry": () => ({
          data: { data: domainRecord({ status: "verifying" }) },
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
      domain: { hostname: "shop.acme.com", status: "verifying" },
    });
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

  it("maps a retry conflict to SERVICE.DOMAIN_RETRY_NOT_ELIGIBLE", async () => {
    const harness = await makeServiceCli({
      routes: domainRoutes({
        "POST /v1/domains/{domainId}/retry": () => ({
          error: { error: { message: "verification in progress" } },
          status: 409,
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
    expect(frame.envelope.error.code).toBe("SERVICE.DOMAIN_RETRY_NOT_ELIGIBLE");
  });
});

describe("prisma-cli service domain remove", () => {
  /** `removed` collects the id of every domain the run deleted. */
  function removeRoutes(removed: string[] = []): Routes {
    return domainRoutes({
      "DELETE /v1/domains/{domainId}": (init) => {
        removed.push(String(init.params?.path?.domainId));
        return { data: { data: null } };
      },
    });
  }

  const INTERACTIVE = {
    isTty: { stdin: true, stdout: true, stderr: true },
  };

  it("removes the domain when --confirm carries the hostname non-interactively", async () => {
    const removed: string[] = [];
    const harness = await makeServiceCli({ routes: removeRoutes(removed) });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "remove",
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
      removed: true,
    });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "ok",
      text: "Removed shop.acme.com from hello-world.",
    });
    expect(removed).toEqual(["dom_1"]);
  });

  it("grants under --yes when --confirm carries the hostname", async () => {
    // --yes alone can never grant; --yes plus the matching token takes the
    // engine's non-interactive branch and grants without asking, so the run
    // completes with no scripted answer available.
    const harness = await makeServiceCli({ routes: removeRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "remove",
        "shop.acme.com",
        ...TARGET_ARGS,
        "--yes",
        "--confirm",
        "shop.acme.com",
      ],
      { cwd: harness.cwd, env: harness.env, ...INTERACTIVE, answers: [] },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ removed: true });
  });

  it("emits the completed json envelope for a non-interactive --confirm removal", async () => {
    const harness = await makeServiceCli({ routes: removeRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "remove",
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
    expect(frame.envelope.commandId).toBe("service.domain.remove");
    expect(frame.envelope.result).toMatchObject({
      hostname: "shop.acme.com",
      removed: true,
    });
  });

  it("still asks interactively when --confirm is present, and takes the typed token", async () => {
    // The grant is a non-interactive affordance: an interactive session
    // type-to-confirms regardless of --confirm.
    const harness = await makeServiceCli({ routes: removeRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "remove",
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
    expect(frame.envelope.commandId).toBe("service.domain.remove");
    expect(frame.envelope.result).toMatchObject({ removed: true });
  });

  it("removes the domain after interactive consent", async () => {
    const harness = await makeServiceCli({ routes: removeRoutes() });

    const result = await harness.cli.run(
      ["service", "domain", "remove", "shop.acme.com", ...TARGET_ARGS],
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
      removed: true,
    });
  });

  it("emits the completed json envelope with commandId service.domain.remove", async () => {
    // An interactive json run still prompts (the prompt UI writes to
    // stderr); consent is granted through the scripted answer.
    const harness = await makeServiceCli({ routes: removeRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "remove",
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
    expect(frame.envelope.commandId).toBe("service.domain.remove");
    expect(frame.envelope.result).toMatchObject({
      ...EXPECTED_TARGET,
      hostname: "shop.acme.com",
      removed: true,
    });
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({
      routes: removeRoutes(),
      authenticated: false,
    });

    const result = await harness.cli.run(
      ["service", "domain", "remove", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });

  it("settles a mistyped consent token as the engine mismatch error", async () => {
    const harness = await makeServiceCli({ routes: removeRoutes() });

    const result = await harness.cli.run(
      ["service", "domain", "remove", "shop.acme.com", ...TARGET_ARGS],
      {
        cwd: harness.cwd,
        env: harness.env,
        ...INTERACTIVE,
        answers: ["no"],
      },
    );

    expect(result.exitCode).toBe(2);
  });

  it("settles a non-interactive run as the engine consent-required error with exit 2", async () => {
    const harness = await makeServiceCli({ routes: removeRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "remove",
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
    const harness = await makeServiceCli({ routes: removeRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "remove",
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
    expect(frame.envelope.error.summary).toContain("--confirm shop.acme.com");
    expect(frame.envelope.error.meta).toMatchObject({
      consentToken: "shop.acme.com",
    });
  });

  it("cannot be granted by --yes under the engine consent rules (exit 2)", async () => {
    // Divergence from legacy: `--yes` used to skip the confirmation. The
    // engine rules consent structurally ungrantable by --yes; recorded in
    // parity-divergences-s2c.md and raised to the operator.
    const harness = await makeServiceCli({ routes: removeRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "remove",
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
