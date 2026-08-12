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

/** Records which deployments the run asked the API to stop, so a test
 *  can prove the call was made — or skipped. */
function stopRoutes(overrides: Routes = {}): {
  routes: Routes;
  stopped: string[];
} {
  const stopped: string[] = [];
  return {
    stopped,
    routes: releaseRoutes({
      "POST /v1/deployments/{deploymentId}/stop": (init) => {
        stopped.push(init.params?.path?.deploymentId as string);
        return { data: { data: {} } };
      },
      ...overrides,
    }),
  };
}

const TARGET = ["--project", "acme-app", "--service", "hello-world"];

describe("prisma-v8 service deployment stop", () => {
  it("stops a running deployment and reports it stopped", async () => {
    const stop = stopRoutes();
    const harness = await makeServiceCli({ routes: stop.routes });

    const result = await harness.cli.run(
      ["service", "deployment", "stop", "dep_2", ...TARGET],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(stop.stopped).toEqual(["dep_2"]);
    expect(result.presented?.data).toMatchObject({
      projectId: "proj_1",
      service: { id: "svc_1", name: "hello-world" },
      deployment: { id: "dep_2", status: "stopped" },
      alreadyInState: false,
    });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "ok",
      text: "Stopped dep_2.",
    });
    // The stopped deployment reports no url: it serves nothing.
    expect(
      blocks(result.presented).find((block) => block.kind === "fields"),
    ).toEqual({
      kind: "fields",
      rows: [
        { label: "project", value: "proj_1" },
        { label: "service", value: "hello-world" },
        { label: "deployment", value: "dep_2" },
        { label: "status", value: "stopped" },
      ],
    });
  });

  it("warns instead of calling the API when the deployment is already stopped", async () => {
    const stop = stopRoutes();
    const harness = await makeServiceCli({ routes: stop.routes });

    const result = await harness.cli.run(
      ["service", "deployment", "stop", "dep_1", ...TARGET],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(stop.stopped).toEqual([]);
    expect(result.presented?.diagnostics).toEqual([
      {
        code: "SERVICE.DEPLOYMENT_ALREADY_STOPPED",
        severity: "warn",
        summary: "The selected deployment is already stopped.",
        nextActions: [],
      },
    ]);
    expect(result.events).toEqual([]);
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "ok",
      text: "dep_1 was already stopped.",
    });
  });

  it("settles a provider failure as SERVICE.DEPLOY_FAILED with exit 2", async () => {
    const stop = stopRoutes({
      "POST /v1/deployments/{deploymentId}/stop": () => ({
        error: { error: { message: "backend down" } },
        status: 500,
      }),
    });
    const harness = await makeServiceCli({ routes: stop.routes });

    const result = await harness.cli.run(
      ["service", "deployment", "stop", "dep_2", ...TARGET, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOY_FAILED");
    expect(frame.envelope.error.summary).toBe("Failed to stop deployment");
  });

  it("settles an unknown deployment id as SERVICE.DEPLOYMENT_NOT_FOUND", async () => {
    const stop = stopRoutes();
    const harness = await makeServiceCli({ routes: stop.routes });

    const result = await harness.cli.run(
      ["service", "deployment", "stop", "dep_missing", ...TARGET, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOYMENT_NOT_FOUND");
    expect(stop.stopped).toEqual([]);
  });

  it("emits the completed json envelope with commandId service.deployment.stop", async () => {
    const stop = stopRoutes();
    const harness = await makeServiceCli({ routes: stop.routes });

    const result = await harness.cli.run(
      ["service", "deployment", "stop", "dep_2", ...TARGET, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.deployment.stop");
    expect(frame.envelope.result).toMatchObject({
      deployment: { id: "dep_2", status: "stopped" },
    });
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const stop = stopRoutes();
    const harness = await makeServiceCli({
      routes: stop.routes,
      authenticated: false,
    });

    const result = await harness.cli.run(
      ["service", "deployment", "stop", "dep_2", ...TARGET],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});
