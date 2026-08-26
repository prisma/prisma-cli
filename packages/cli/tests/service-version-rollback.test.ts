import { describe, expect, it } from "vitest";

import {
  DEPLOYMENTS,
  makeServiceCli,
  page,
  presentedSummary,
  type Routes,
  releaseRoutes,
  SERVICE_DETAIL,
} from "./service-testkit";

const INTERACTIVE = { stdin: true, stdout: true, stderr: true };

/** A promote route that counts what reached it, for the runs that must
 *  never promote anything. */
function countPromoteCalls(): { routes: Routes; count: () => number } {
  let calls = 0;
  return {
    routes: {
      "POST /v1/apps/{appId}/promote": () => {
        calls += 1;
        return { data: { data: { appEndpointDomain: "hello.prisma.app" } } };
      },
    },
    count: () => calls,
  };
}

/** Nothing names a live deployment: the service record points at no
 *  deployment, the listing marks none live, and a fresh state dir has
 *  no cached pointer. */
function unknownLiveDeploymentRoutes(overrides: Routes = {}): Routes {
  return releaseRoutes({
    "GET /v1/apps/{appId}": () => ({
      data: { data: { ...SERVICE_DETAIL, latestDeploymentId: null } },
    }),
    ...overrides,
  });
}

describe("prisma service version rollback", () => {
  it("rolls back to the deployment before the live one by default", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "version",
        "rollback",
        "--project",
        "acme-app",
        "hello-world",
        "--confirm",
        "dep_1",
      ],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      service: { id: "svc_1", name: "hello-world" },
      version: { id: "dep_1", status: "running", live: true },
      previousLiveVersionId: "dep_2",
    });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "ok",
      text: "Rolled hello-world back to dep_1.",
    });
  });

  it("warns instead of rolling back when the target is already live", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "version",
        "rollback",
        "--to",
        "dep_2",
        "--project",
        "acme-app",
        "hello-world",
        "--confirm",
        "dep_2",
      ],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.diagnostics).toEqual([
      {
        code: "SERVICE.VERSION_ALREADY_LIVE",
        severity: "warn",
        summary: "The selected version is already live for this service.",
        nextActions: [],
      },
    ]);
    expect(result.events).toEqual([]);
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "ok",
      text: "dep_2 was already live for hello-world.",
    });
  });

  it("honors an explicit --to deployment", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "version",
        "rollback",
        "--to",
        "dep_1",
        "--project",
        "acme-app",
        "hello-world",
        "--confirm",
        "dep_1",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      version: { id: "dep_1" },
    });
  });

  it("brackets the SDK status transitions with the rollback step", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "version",
        "rollback",
        "--project",
        "acme-app",
        "hello-world",
        "--confirm",
        "dep_1",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.events[0]).toEqual({
      kind: "step-started",
      step: "rollback",
    });
    expect(result.events.at(-1)).toEqual({
      kind: "step-finished",
      step: "rollback",
      outcome: "ok",
    });
    const statuses = result.events
      .filter((event) => event.kind === "status")
      .map((event) => (event as { status: string }).status);
    expect(statuses).toEqual([
      "starting",
      "start-requested",
      "running",
      "promoting",
      "promoted",
    ]);
  });

  it("emits the completed json envelope with commandId service.version.rollback", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "version",
        "rollback",
        "--project",
        "acme-app",
        "hello-world",
        "--confirm",
        "dep_1",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.version.rollback");
    expect(frame.envelope.result).toMatchObject({
      version: { id: "dep_1" },
      previousLiveVersionId: "dep_2",
    });
  });

  it("asks for consent on the resolved deployment and rolls back once it is typed", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "version",
        "rollback",
        "--project",
        "acme-app",
        "hello-world",
      ],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: INTERACTIVE,
        // The run prompts exactly once, and only the deployment id
        // answers it: a scripted answer the prompt never asks for fails
        // the run, and a wrong one settles as a mismatch.
        answers: ["dep_1"],
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      version: { id: "dep_1" },
    });
  });

  it("settles a mistyped consent token as the engine mismatch error", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "version",
        "rollback",
        "--project",
        "acme-app",
        "hello-world",
      ],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: INTERACTIVE,
        answers: ["hello-world"],
      },
    );

    expect(result.exitCode).toBe(2);
    expect(result.events).toEqual([]);
  });

  it("settles non-interactive runs with the engine consent error, naming the deployment", async () => {
    const promoteCalls = countPromoteCalls();
    const harness = await makeServiceCli({
      routes: releaseRoutes(promoteCalls.routes),
    });

    const result = await harness.cli.run(
      [
        "service",
        "version",
        "rollback",
        "--project",
        "acme-app",
        "hello-world",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    expect(result.events).toEqual([]);
    expect(promoteCalls.count()).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("CLI.CONSENT_REQUIRED");
    expect(frame.envelope.error.summary).toContain(
      'Roll back Service "hello-world" to version dep_1 and make it live?',
    );
    expect(frame.envelope.error.summary).toContain("--confirm dep_1");
    expect(frame.envelope.error.meta).toMatchObject({
      consentToken: "dep_1",
    });
  });

  it("refuses a --confirm value that is not the target deployment id", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "version",
        "rollback",
        "--project",
        "acme-app",
        "hello-world",
        "--confirm",
        "hello-world",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    expect(result.events).toEqual([]);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("CLI.CONSENT_REQUIRED");
    expect(frame.envelope.error.meta).toMatchObject({
      consentToken: "dep_1",
    });
  });

  it("never lets --yes alone grant the rollback", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "version",
        "rollback",
        "--project",
        "acme-app",
        "hello-world",
        "--yes",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env, isTty: INTERACTIVE },
    );

    expect(result.exitCode).toBe(2);
    expect(result.events).toEqual([]);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("CLI.CONSENT_REQUIRED");
  });

  it("refuses to pick a target when nothing names the live deployment", async () => {
    const promoteCalls = countPromoteCalls();
    const harness = await makeServiceCli({
      routes: unknownLiveDeploymentRoutes(promoteCalls.routes),
    });

    const result = await harness.cli.run(
      [
        "service",
        "version",
        "rollback",
        "--project",
        "acme-app",
        "hello-world",
        "--json",
      ],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: INTERACTIVE,
        // dep_2 is the newest deployment, which is what picking "the
        // newest that is not the live one" returns while the live one is
        // unknown. Scripting consent for it means a run that guesses
        // again completes instead of failing here.
        answers: ["dep_2"],
      },
    );

    expect(result.exitCode).toBe(2);
    // Nothing was promoted and no step was opened: the refusal lands
    // before the command touches the service.
    expect(promoteCalls.count()).toBe(0);
    expect(result.events).toEqual([]);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.LIVE_VERSION_UNKNOWN");
    expect(frame.envelope.nextActions).toEqual([
      {
        kind: "run-command",
        label: "Roll back to a named version",
        command: "prisma service version rollback hello-world --to <version>",
      },
      {
        kind: "run-command",
        label: "List versions",
        command: "prisma service version list hello-world",
      },
    ]);
  });

  it("still rolls back to an explicit --to when the live deployment is unknown", async () => {
    const harness = await makeServiceCli({
      routes: unknownLiveDeploymentRoutes(),
    });

    const result = await harness.cli.run(
      [
        "service",
        "version",
        "rollback",
        "--to",
        "dep_1",
        "--project",
        "acme-app",
        "hello-world",
        "--confirm",
        "dep_1",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      version: { id: "dep_1" },
      previousLiveVersionId: null,
    });
    expect(result.events.at(-1)).toEqual({
      kind: "step-finished",
      step: "rollback",
      outcome: "ok",
    });
  });

  it("reports SERVICE.NO_PREVIOUS_VERSION when only the live deployment exists", async () => {
    const [, live] = DEPLOYMENTS;
    const harness = await makeServiceCli({
      routes: releaseRoutes({
        "GET /v1/apps/{appId}/deployments": () => ({ data: page([live]) }),
      }),
    });

    const result = await harness.cli.run(
      [
        "service",
        "version",
        "rollback",
        "--project",
        "acme-app",
        "hello-world",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.NO_PREVIOUS_VERSION");
    // The advice stays; the `service deploy` action is gone with the command.
    expect(frame.envelope.nextActions).toEqual([
      {
        kind: "user-choice",
        label:
          "Deploy a second version first, or pass --to <version-id> for a specific earlier version.",
      },
      {
        kind: "run-command",
        label: "List versions",
        command: "prisma service version list hello-world",
      },
    ]);
  });

  it("reports SERVICE.NO_PREVIOUS_VERSION for a service with no deployments at all", async () => {
    const harness = await makeServiceCli({
      routes: unknownLiveDeploymentRoutes({
        "GET /v1/apps/{appId}/deployments": () => ({ data: page([]) }),
      }),
    });

    const result = await harness.cli.run(
      [
        "service",
        "version",
        "rollback",
        "--project",
        "acme-app",
        "hello-world",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    // An empty listing has no live deployment either, and the emptiness
    // is the more useful answer of the two.
    expect(frame.envelope.error.code).toBe("SERVICE.NO_PREVIOUS_VERSION");
  });

  it("settles a failing promote call as SERVICE.DEPLOY_FAILED after a failed step", async () => {
    const harness = await makeServiceCli({
      routes: releaseRoutes({
        "POST /v1/apps/{appId}/promote": () => ({
          error: { error: { message: "boom" } },
          status: 500,
        }),
      }),
    });

    const result = await harness.cli.run(
      [
        "service",
        "version",
        "rollback",
        "--project",
        "acme-app",
        "hello-world",
        "--confirm",
        "dep_1",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    expect(result.events.at(-1)).toEqual({
      kind: "step-finished",
      step: "rollback",
      outcome: "failed",
    });
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOY_FAILED");
  });

  it("requires a service argument", async () => {
    const harness = await makeServiceCli({
      routes: releaseRoutes({ "GET /v1/apps": () => ({ data: page([]) }) }),
    });

    const result = await harness.cli.run(
      ["service", "version", "rollback", "--project", "acme-app", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.TARGET_REQUIRED");
    expect(frame.envelope.error.summary).toBe(
      'Command "service version rollback" requires a service',
    );
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({
      authenticated: false,
      routes: releaseRoutes(),
    });

    const result = await harness.cli.run(
      ["service", "version", "rollback", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});
