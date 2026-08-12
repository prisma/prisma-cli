import { describe, expect, it } from "vitest";

import {
  makeServiceCli,
  presentedSummary,
  type Routes,
  releaseRoutes,
} from "./v8-service-testkit";

function blocks(presented: unknown) {
  const value = presented as
    | { presentation: { human: Array<{ kind: string }> } }
    | undefined;
  return value?.presentation.human ?? [];
}

/** Records which deployments the run asked the API to start, so a test
 *  can prove the call was made — or skipped. */
function startRoutes(overrides: Routes = {}): {
  routes: Routes;
  started: string[];
} {
  const started: string[] = [];
  return {
    started,
    routes: releaseRoutes({
      "POST /v1/deployments/{deploymentId}/start": (init) => {
        started.push(init.params?.path?.deploymentId as string);
        return { data: { data: {} } };
      },
      ...overrides,
    }),
  };
}

const TARGET = ["--project", "acme-app", "--service", "hello-world"];

describe("prisma-v8 service deployment start", () => {
  it("starts a stopped deployment and reports it running", async () => {
    const start = startRoutes();
    const harness = await makeServiceCli({ routes: start.routes });

    const result = await harness.cli.run(
      ["service", "deployment", "start", "dep_1", ...TARGET],
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
      projectId: "proj_1",
      service: { id: "svc_1", name: "hello-world" },
      deployment: { id: "dep_1", status: "running" },
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
        { label: "project", value: "proj_1" },
        { label: "service", value: "hello-world" },
        { label: "deployment", value: "dep_1" },
        { label: "status", value: "running" },
        // releaseRoutes serves each deployment's detail as
        // "<id>.prisma.app", and the listing reads those details.
        { label: "url", value: "https://dep_1.prisma.app" },
      ],
    });
  });

  it("warns instead of calling the API when the deployment already runs", async () => {
    const start = startRoutes();
    const harness = await makeServiceCli({ routes: start.routes });

    const result = await harness.cli.run(
      ["service", "deployment", "start", "dep_2", ...TARGET],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(start.started).toEqual([]);
    expect(result.presented?.diagnostics).toEqual([
      {
        code: "SERVICE.DEPLOYMENT_ALREADY_RUNNING",
        severity: "warn",
        summary: "The selected deployment is already running.",
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
      ["service", "deployment", "start", "dep_1", ...TARGET, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOY_FAILED");
    expect(frame.envelope.error.summary).toBe("Failed to start deployment");
    // The CLI invents no precondition of its own: what the user reads is
    // the message the API sent back.
    expect(frame.envelope.error.why).toContain(
      "Deployment artifact has not been uploaded yet.",
    );
  });

  it("settles an unknown deployment id as SERVICE.DEPLOYMENT_NOT_FOUND", async () => {
    const start = startRoutes();
    const harness = await makeServiceCli({ routes: start.routes });

    const result = await harness.cli.run(
      ["service", "deployment", "start", "dep_missing", ...TARGET, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOYMENT_NOT_FOUND");
    expect(start.started).toEqual([]);
  });

  it("emits the completed json envelope with commandId service.deployment.start", async () => {
    const start = startRoutes();
    const harness = await makeServiceCli({ routes: start.routes });

    const result = await harness.cli.run(
      ["service", "deployment", "start", "dep_1", ...TARGET, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.deployment.start");
    expect(frame.envelope.result).toMatchObject({
      deployment: { id: "dep_1", status: "running" },
    });
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const start = startRoutes();
    const harness = await makeServiceCli({
      routes: start.routes,
      authenticated: false,
    });

    const result = await harness.cli.run(
      ["service", "deployment", "start", "dep_1", ...TARGET],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});
