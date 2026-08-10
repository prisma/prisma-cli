import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  domainRecord,
  makeServiceCli,
  type Routes,
  readFlowRoutes,
} from "./v8-service-testkit";

const TARGET_ARGS = ["--project", "acme-app", "--service", "hello-world"];

function waitRoutes(statusSequence: string[]): Routes {
  let polls = 0;
  return readFlowRoutes({
    "GET /v1/apps/{appId}/domains": () => ({
      data: { data: [domainRecord({ status: statusSequence[0] })] },
    }),
    "GET /v1/domains/{domainId}": () => {
      polls += 1;
      const status = statusSequence[Math.min(polls, statusSequence.length - 1)];
      return { data: { data: domainRecord({ status }) } };
    },
  });
}

function waitEnv(env: Record<string, string | undefined>) {
  return { ...env, PRISMA_CLI_DOMAIN_WAIT_POLL_MS: "1" };
}

describe("prisma-v8 service domain wait", () => {
  it("emits a status event per transition and completes when the domain activates", async () => {
    const harness = await makeServiceCli({
      routes: waitRoutes(["pending_dns", "verifying", "active"]),
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
      { subject: "shop.acme.com", status: "pending_dns", from: undefined },
      { subject: "shop.acme.com", status: "verifying", from: "pending_dns" },
      { subject: "shop.acme.com", status: "active", from: "verifying" },
    ]);
    expect(result.presented?.data).toMatchObject({
      hostname: "shop.acme.com",
      status: "active",
      liveUrl: "https://shop.acme.com",
    });
  });

  it("does not repeat status events while the status is unchanged", async () => {
    const harness = await makeServiceCli({
      routes: waitRoutes(["verifying", "verifying", "verifying", "active"]),
    });

    const result = await harness.cli.run(
      ["service", "domain", "wait", "shop.acme.com", ...TARGET_ARGS],
      { cwd: harness.cwd, env: waitEnv(harness.env) },
    );

    expect(result.exitCode).toBe(0);
    const statuses = result.events
      .filter((event) => event.kind === "status")
      .map((event) => event.status);
    expect(statuses).toEqual(["verifying", "active"]);
  });

  it("settles a failed domain as SERVICE.DOMAIN_VERIFICATION_FAILED with exit 2", async () => {
    const harness = await makeServiceCli({
      routes: waitRoutes(["verifying", "failed"]),
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
    expect(frame.envelope.error.code).toBe(
      "SERVICE.DOMAIN_VERIFICATION_FAILED",
    );
  });

  it("polls exactly once with --timeout 0 and settles as a verification timeout", async () => {
    const harness = await makeServiceCli({
      routes: waitRoutes(["pending_dns"]),
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
    expect(frame.envelope.error.code).toBe(
      "SERVICE.DOMAIN_VERIFICATION_TIMEOUT",
    );
    expect(frame.envelope.error.why).toBe('The domain is still "pending_dns".');
  });

  it("rejects an invalid --timeout as SERVICE.TIMEOUT_INVALID", async () => {
    const harness = await makeServiceCli({
      routes: waitRoutes(["pending_dns"]),
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
      routes: waitRoutes(["verifying", "active"]),
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
      liveUrl: "https://shop.acme.com",
    });
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({
      routes: waitRoutes(["active"]),
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
