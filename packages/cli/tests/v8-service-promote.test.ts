import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  makeServiceCli,
  page,
  presentedSummary,
  releaseRoutes,
} from "./v8-service-testkit";

describe("prisma-v8 service promote", () => {
  it("promotes the requested deployment and reports it as the live one", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "promote",
        "dep_1",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
      ],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      projectId: "proj_1",
      service: { id: "svc_1", name: "hello-world" },
      deployment: { id: "dep_1", status: "running", live: true },
    });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "ok",
      text: "Promoted dep_1 to production.",
    });
  });

  it("brackets the SDK status transitions with the promote step", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "promote",
        "dep_1",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.events[0]).toEqual({ kind: "step-started", step: "promote" });
    expect(result.events.at(-1)).toEqual({
      kind: "step-finished",
      step: "promote",
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
    expect(result.events).toContainEqual({
      kind: "endpoint",
      name: "live",
      url: "https://hello.prisma.app",
    });
  });

  it("caches the selected service and the known live deployment", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    await harness.cli.run(
      [
        "service",
        "promote",
        "dep_1",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    const state = JSON.parse(
      await readFile(path.join(harness.stateDir, "state.json"), "utf8"),
    );
    expect(state.app.selectedByProject.proj_1).toEqual({
      id: "svc_1",
      name: "hello-world",
    });
    expect(state.app.knownLiveDeploymentByProject.proj_1.svc_1).toBe("dep_1");
  });

  it("warns instead of promoting when the target is already live", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "promote",
        "dep_2",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
      ],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.diagnostics).toEqual([
      {
        code: "SERVICE.DEPLOYMENT_ALREADY_LIVE",
        severity: "warn",
        summary: "The selected deployment is already live for this service.",
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

  it("emits the completed json envelope with commandId service.promote", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "promote",
        "dep_1",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.promote");
    expect(frame.envelope.result).toMatchObject({
      service: { id: "svc_1", name: "hello-world" },
      deployment: { id: "dep_1" },
    });
  });

  it("rejects a deployment that does not belong to the service", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "promote",
        "dep_missing",
        "--project",
        "acme-app",
        "--service",
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
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOYMENT_NOT_FOUND");
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
        "promote",
        "dep_1",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    expect(result.events.at(-1)).toEqual({
      kind: "step-finished",
      step: "promote",
      outcome: "failed",
    });
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOY_FAILED");
  });

  it("requires an existing service", async () => {
    const harness = await makeServiceCli({
      routes: releaseRoutes({ "GET /v1/apps": () => ({ data: page([]) }) }),
    });

    const result = await harness.cli.run(
      ["service", "promote", "dep_1", "--project", "acme-app", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.TARGET_REQUIRED");
    expect(frame.envelope.error.summary).toBe(
      "Service promote requires an existing service",
    );
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({
      authenticated: false,
      routes: releaseRoutes(),
    });

    const result = await harness.cli.run(
      ["service", "promote", "dep_1", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});
