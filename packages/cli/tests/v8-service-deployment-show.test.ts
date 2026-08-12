import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { makeServiceCli, readFlowRoutes } from "./v8-service-testkit";

/** deployment show scans projects to find the owning service. */
function showDeployRoutes(overrides = {}) {
  return readFlowRoutes(overrides);
}

describe("prisma-v8 service deployment show", () => {
  it("presents the promoted service url and takes the live flag from the service's latest deployment", async () => {
    const harness = await makeServiceCli({ routes: showDeployRoutes() });

    const result = await harness.cli.run(
      ["service", "deployment", "show", "dep_2"],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: { stdout: true },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      service: { id: "svc_1", name: "hello-world" },
      deployment: {
        id: "dep_2",
        status: "running",
        createdAt: "2026-08-02T00:00:00.000Z",
        url: "https://hello.prisma.app",
        live: true,
      },
    });
  });

  it("ignores a live deployment named only by local CLI state", async () => {
    const harness = await makeServiceCli({ routes: showDeployRoutes() });
    await mkdir(harness.stateDir, { recursive: true });
    await writeFile(
      path.join(harness.stateDir, "state.json"),
      JSON.stringify({
        app: { knownLiveDeploymentByProject: { proj_1: { svc_1: "dep_1" } } },
      }),
    );

    const result = await harness.cli.run(
      ["service", "deployment", "show", "dep_1"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      deployment: { id: "dep_1", live: false },
    });
  });

  it("settles an unknown deployment id as SERVICE.DEPLOYMENT_NOT_FOUND with exit 2", async () => {
    const harness = await makeServiceCli({ routes: showDeployRoutes() });

    const result = await harness.cli.run(
      ["service", "deployment", "show", "dep_missing", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOYMENT_NOT_FOUND");
    expect(frame.envelope.error.summary).toBe(
      'Deployment "dep_missing" not found',
    );
  });

  it("surfaces provider failures as SERVICE.DEPLOY_FAILED instead of not-found", async () => {
    const harness = await makeServiceCli({
      routes: showDeployRoutes({
        "GET /v1/deployments/{deploymentId}": () => ({
          error: { error: { message: "backend down" } },
          status: 500,
        }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "deployment", "show", "dep_2", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOY_FAILED");
  });

  it("emits the completed json envelope with commandId service.deployment.show", async () => {
    const harness = await makeServiceCli({ routes: showDeployRoutes() });

    const result = await harness.cli.run(
      ["service", "deployment", "show", "dep_1", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.deployment.show");
    expect(frame.envelope.result).toMatchObject({
      deployment: { id: "dep_1", live: false },
    });
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({
      routes: showDeployRoutes(),
      authenticated: false,
    });

    const result = await harness.cli.run(
      ["service", "deployment", "show", "dep_1"],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: { stdout: true },
      },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});
