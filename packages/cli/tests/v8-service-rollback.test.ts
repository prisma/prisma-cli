import { beforeEach, describe, expect, it, vi } from "vitest";

import { readAuthState } from "../src/auth";
import {
  DEPLOYMENTS,
  makeServiceCli,
  page,
  releaseRoutes,
  SIGNED_IN,
} from "./v8-service-testkit";

vi.mock("../src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth")>()),
  readAuthState: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(readAuthState).mockReset();
  vi.mocked(readAuthState).mockResolvedValue(SIGNED_IN);
});

describe("prisma-v8 service rollback", () => {
  it("rolls back to the deployment before the live one by default", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "rollback",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      service: { id: "svc_1", name: "hello-world" },
      deployment: { id: "dep_1", status: "running", live: true },
      previousLiveDeploymentId: "dep_2",
    });
  });

  it("honors an explicit --to deployment", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "rollback",
        "--to",
        "dep_1",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      deployment: { id: "dep_1" },
    });
  });

  it("brackets the SDK status transitions with the rollback step", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "rollback",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
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

  it("emits the completed json envelope with commandId service.rollback", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "rollback",
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
    expect(frame.envelope.commandId).toBe("service.rollback");
    expect(frame.envelope.result).toMatchObject({
      deployment: { id: "dep_1" },
      previousLiveDeploymentId: "dep_2",
    });
  });

  it("reports SERVICE.NO_PREVIOUS_DEPLOYMENT when only the live deployment exists", async () => {
    const [, live] = DEPLOYMENTS;
    const harness = await makeServiceCli({
      routes: releaseRoutes({
        "GET /v1/apps/{appId}/deployments": () => ({ data: page([live]) }),
      }),
    });

    const result = await harness.cli.run(
      [
        "service",
        "rollback",
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
    expect(frame.envelope.error.code).toBe("SERVICE.NO_PREVIOUS_DEPLOYMENT");
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
        "rollback",
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
      step: "rollback",
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
      ["service", "rollback", "--project", "acme-app", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.TARGET_REQUIRED");
  });

  it("runs without any confirmation prompt (legacy parity, recorded as a divergence follow-up)", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "rollback",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
      ],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: { stdin: true, stdout: true, stderr: true },
        // An unexpected prompt fails the run: this proves rollback asks nothing.
        answers: [],
      },
    );

    expect(result.exitCode).toBe(0);
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({
      authenticated: false,
      routes: releaseRoutes(),
    });

    const result = await harness.cli.run(
      ["service", "rollback", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});
