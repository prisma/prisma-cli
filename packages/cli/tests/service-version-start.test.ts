import { describe, expect, it } from "vitest";

import {
  makeServiceCli,
  presentedSummary,
  type Routes,
  releaseRoutes,
} from "./service-testkit";

function blocks(presented: unknown) {
  const value = presented as
    | { presentation: { human: Array<{ kind: string }> } }
    | undefined;
  return value?.presentation.human ?? [];
}

/**
 * Records which deployments the run asked the API to start, so a test
 * can prove the call was made — or skipped.
 *
 * `reportedStatus` is what the deployment reads back as afterwards.
 * The command re-reads rather than assuming, so a fixture that accepts
 * the start and still reports "stopped" is a case worth having.
 */
function startRoutes(
  overrides: Routes = {},
  reportedStatus = "running",
): {
  routes: Routes;
  started: string[];
} {
  const started: string[] = [];
  const statuses = new Map([
    ["dep_1", "stopped"],
    ["dep_2", "running"],
  ]);
  return {
    started,
    routes: releaseRoutes({
      "POST /v1/deployments/{deploymentId}/start": (init) => {
        const id = init.params?.path?.deploymentId as string;
        started.push(id);
        statuses.set(id, reportedStatus);
        return { data: { data: {} } };
      },
      "GET /v1/deployments/{deploymentId}": (init) => {
        const id = init.params?.path?.deploymentId as string;
        const status = statuses.get(id);
        if (!status) {
          return { error: { error: { message: "not found" } }, status: 404 };
        }
        return {
          data: {
            data: {
              id,
              status,
              createdAt: "2026-08-01T00:00:00.000Z",
              previewDomain: `${id}.prisma.app`,
            },
          },
        };
      },
      ...overrides,
    }),
  };
}
describe("prisma-cli service version start", () => {
  it("starts a stopped deployment and reports it running", async () => {
    const start = startRoutes();
    const harness = await makeServiceCli({ routes: start.routes });

    const result = await harness.cli.run(
      ["service", "version", "start", "dep_1"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(start.started).toEqual(["dep_1"]);
    expect(result.events[0]).toEqual({ kind: "step-started", step: "start" });
    expect(result.events.at(-1)).toEqual({
      kind: "step-finished",
      step: "start",
      outcome: "ok",
    });
    expect(result.presented?.data).toMatchObject({
      service: { id: "svc_1", name: "hello-world" },
      version: { id: "dep_1", status: "running" },
      alreadyInState: false,
    });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "ok",
      text: "Started dep_1.",
    });
    expect(
      blocks(result.presented).find((block) => block.kind === "fields"),
    ).toEqual({
      kind: "fields",
      rows: [
        { label: "service", value: "hello-world" },
        { label: "version", value: "dep_1" },
        { label: "status", value: "running" },
        // releaseRoutes serves each deployment's detail as
        // "<id>.prisma.app", and the listing reads those details.
        { label: "url", value: "https://dep_1.prisma.app" },
      ],
    });
  });

  /**
   * The start endpoint answers with nothing, so the status is read back
   * rather than assumed. A deployment still coming up reports the state
   * the API gives, not the one the command asked for.
   */
  it("reports the status the API reads back, not the one it requested", async () => {
    const start = startRoutes({}, "starting");
    const harness = await makeServiceCli({ routes: start.routes });

    const result = await harness.cli.run(
      ["service", "version", "start", "dep_1"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(start.started).toEqual(["dep_1"]);
    expect(result.presented?.data).toMatchObject({
      version: { id: "dep_1", status: "starting" },
      alreadyInState: false,
    });
  });

  it("warns instead of calling the API when the deployment already runs", async () => {
    const start = startRoutes();
    const harness = await makeServiceCli({ routes: start.routes });

    const result = await harness.cli.run(
      ["service", "version", "start", "dep_2"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(start.started).toEqual([]);
    expect(result.presented?.diagnostics).toEqual([
      {
        code: "SERVICE.VERSION_ALREADY_RUNNING",
        severity: "warn",
        summary: "The selected version is already running.",
        nextActions: [],
      },
    ]);
    expect(result.events).toEqual([]);
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "ok",
      text: "dep_2 was already running.",
    });
  });

  it("presents the API's own refusal when the artifact is not uploaded", async () => {
    const start = startRoutes({
      "POST /v1/deployments/{deploymentId}/start": () => ({
        error: {
          error: {
            message: "Deployment artifact has not been uploaded yet.",
          },
        },
        status: 409,
      }),
    });
    const harness = await makeServiceCli({ routes: start.routes });

    const result = await harness.cli.run(
      ["service", "version", "start", "dep_1", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOY_FAILED");
    expect(frame.envelope.error.summary).toBe("Failed to start version");
    // The CLI invents no precondition of its own: what the user reads is
    // the message the API sent back.
    expect(frame.envelope.error.why).toContain(
      "Deployment artifact has not been uploaded yet.",
    );
  });

  it("settles an unknown deployment id as SERVICE.VERSION_NOT_FOUND", async () => {
    const start = startRoutes();
    const harness = await makeServiceCli({ routes: start.routes });

    const result = await harness.cli.run(
      ["service", "version", "start", "dep_missing", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.VERSION_NOT_FOUND");
    expect(start.started).toEqual([]);
  });

  it("emits the completed json envelope with commandId service.version.start", async () => {
    const start = startRoutes();
    const harness = await makeServiceCli({ routes: start.routes });

    const result = await harness.cli.run(
      ["service", "version", "start", "dep_1", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.version.start");
    expect(frame.envelope.result).toMatchObject({
      version: { id: "dep_1", status: "running" },
    });
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const start = startRoutes();
    const harness = await makeServiceCli({
      routes: start.routes,
      authenticated: false,
    });

    const result = await harness.cli.run(
      ["service", "version", "start", "dep_1"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});
