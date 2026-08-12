import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  makeServiceCli,
  page,
  readFlowRoutes,
  SERVICE,
  SERVICE_DETAIL,
} from "./service-testkit";

describe("prisma-cli service deployment list", () => {
  it("lists deployments newest first with the live hint applied", async () => {
    const harness = await makeServiceCli();

    const result = await harness.cli.run(
      [
        "service",
        "deployment",
        "list",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
      ],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      projectId: "proj_1",
      service: { id: "svc_1", name: "hello-world" },
      deployments: [
        {
          id: "dep_2",
          status: "running",
          createdAt: "2026-08-02T00:00:00.000Z",
          url: "https://dep2.prisma.app",
          live: true,
        },
        {
          id: "dep_1",
          status: "stopped",
          createdAt: "2026-08-01T00:00:00.000Z",
          url: "https://dep1.prisma.app",
          live: false,
        },
      ],
    });
  });

  it("marks no deployment live when the service names none, whatever local state remembers", async () => {
    const harness = await makeServiceCli({
      routes: readFlowRoutes({
        "GET /v1/apps": () => ({
          data: page([{ ...SERVICE, latestDeploymentId: null }]),
        }),
        "GET /v1/apps/{appId}": () => ({
          data: { data: { ...SERVICE_DETAIL, latestDeploymentId: null } },
        }),
      }),
    });
    await mkdir(harness.stateDir, { recursive: true });
    await writeFile(
      path.join(harness.stateDir, "state.json"),
      JSON.stringify({
        app: { knownLiveDeploymentByProject: { proj_1: { svc_1: "dep_1" } } },
      }),
    );

    const result = await harness.cli.run(
      [
        "service",
        "deployment",
        "list",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
      ],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      deployments: [
        { id: "dep_2", live: null },
        { id: "dep_1", live: null },
      ],
    });
  });

  it("treats a project with no services as a success with an empty listing", async () => {
    const harness = await makeServiceCli({
      routes: readFlowRoutes({ "GET /v1/apps": () => ({ data: page([]) }) }),
    });

    const result = await harness.cli.run(
      ["service", "deployment", "list", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      projectId: "proj_1",
      service: null,
      deployments: [],
    });
    // An empty listing offers no action: `service deploy` is not a command
    // this binary answers to.
    expect(result.presented?.presentation.next).toEqual([]);
  });

  it("emits the completed json envelope with commandId service.deployment.list", async () => {
    const harness = await makeServiceCli();

    const result = await harness.cli.run(
      [
        "service",
        "deployment",
        "list",
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
    expect(frame.envelope.commandId).toBe("service.deployment.list");
    expect(frame.envelope.result).toMatchObject({
      projectId: "proj_1",
      service: { id: "svc_1", name: "hello-world" },
    });
  });

  it("settles a deployments failure as SERVICE.DEPLOY_FAILED with exit 2", async () => {
    const harness = await makeServiceCli({
      routes: readFlowRoutes({
        "GET /v1/apps/{appId}": () => ({
          error: { error: { message: "boom" } },
          status: 500,
        }),
      }),
    });

    const result = await harness.cli.run(
      [
        "service",
        "deployment",
        "list",
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
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOY_FAILED");
    expect(frame.envelope.error.summary).toBe(
      "Failed to list service deployments",
    );
    expect(frame.envelope.nextActions).toEqual([]);
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({ authenticated: false });

    const result = await harness.cli.run(
      ["service", "deployment", "list", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});
