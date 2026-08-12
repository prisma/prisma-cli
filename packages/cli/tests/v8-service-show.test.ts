import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  makeServiceCli,
  page,
  readFlowRoutes,
  SERVICE,
} from "./v8-service-testkit";

describe("prisma-cli service show", () => {
  it("presents the selected service with live deployment, url, and recent deployments", async () => {
    const harness = await makeServiceCli();

    const result = await harness.cli.run(
      ["service", "show", "--project", "acme-app", "--service", "hello-world"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      projectId: "proj_1",
      service: { id: "svc_1", name: "hello-world" },
      liveDeployment: {
        id: "dep_2",
        status: "running",
        createdAt: "2026-08-02T00:00:00.000Z",
        url: "https://dep2.prisma.app",
        live: true,
      },
      liveUrl: "https://hello.prisma.app",
      recentDeployments: [
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

  it("presents no live url while the service has no live deployment", async () => {
    const neverPromoted = {
      id: "svc_1",
      name: "hello-world",
      projectId: "proj_1",
      region: { id: "eu-central-1" },
      latestDeploymentId: null,
      appEndpointDomain: "hello.prisma.app",
    };
    const harness = await makeServiceCli({
      routes: readFlowRoutes({
        "GET /v1/apps": () => ({
          data: page([{ ...SERVICE, latestDeploymentId: null }]),
        }),
        "GET /v1/apps/{appId}": () => ({ data: { data: neverPromoted } }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "show", "--project", "acme-app", "--service", "hello-world"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      liveDeployment: null,
      liveUrl: null,
    });
  });

  it("caches the selected service in the local state store", async () => {
    const harness = await makeServiceCli();

    await harness.cli.run(
      ["service", "show", "--project", "acme-app", "--service", "hello-world"],
      { cwd: harness.cwd, env: harness.env },
    );

    const state = JSON.parse(
      await readFile(path.join(harness.stateDir, "state.json"), "utf8"),
    );
    expect(state.app.selectedByProject.proj_1).toEqual({
      id: "svc_1",
      name: "hello-world",
    });
  });

  it("treats a project with no services as an undeployed success", async () => {
    const harness = await makeServiceCli({
      routes: readFlowRoutes({ "GET /v1/apps": () => ({ data: page([]) }) }),
    });

    const result = await harness.cli.run(
      ["service", "show", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      projectId: "proj_1",
      service: null,
      liveDeployment: null,
      liveUrl: null,
      recentDeployments: [],
    });
    // Nothing to inspect and no `service deploy` to offer, so no actions.
    expect(result.presented?.presentation.next).toEqual([]);
  });

  it("emits the completed json envelope with commandId service.show", async () => {
    const harness = await makeServiceCli();

    const result = await harness.cli.run(
      [
        "service",
        "show",
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
    if (frame?.kind !== "result") {
      throw new Error("expected a result frame");
    }
    expect(frame.envelope.ok).toBe(true);
    expect(frame.envelope.commandId).toBe("service.show");
    if (!frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
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
        "show",
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
    expect(frame.envelope.error.summary).toBe("Failed to inspect service");
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({ authenticated: false });

    const result = await harness.cli.run(
      ["service", "show", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });

  it("rejects an unknown --service name as SERVICE.SELECTION_INVALID", async () => {
    const harness = await makeServiceCli();

    const result = await harness.cli.run(
      [
        "service",
        "show",
        "--project",
        "acme-app",
        "--service",
        "nope",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.SELECTION_INVALID");
  });

  it("prompts to pick between several services and honors the answer", async () => {
    const second = {
      ...SERVICE,
      id: "svc_2",
      name: "api",
      latestDeploymentId: null,
      appEndpointDomain: null,
    };
    const harness = await makeServiceCli({
      routes: readFlowRoutes({
        "GET /v1/apps": () => ({ data: page([SERVICE, second]) }),
        "GET /v1/apps/{appId}": (init) => {
          expect(init.params?.path?.appId).toBe("svc_2");
          return {
            data: {
              data: {
                id: "svc_2",
                name: "api",
                projectId: "proj_1",
                region: { id: null },
                latestDeploymentId: null,
                appEndpointDomain: null,
              },
            },
          };
        },
        "GET /v1/apps/{appId}/deployments": () => ({ data: page([]) }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "show", "--project", "acme-app"],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: { stdin: true, stdout: true, stderr: true },
        answers: ["svc_2"],
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      service: { id: "svc_2", name: "api" },
    });
  });

  it("settles the picker as a structural prompt failure when non-interactive", async () => {
    const second = { ...SERVICE, id: "svc_2", name: "api" };
    const harness = await makeServiceCli({
      routes: readFlowRoutes({
        "GET /v1/apps": () => ({ data: page([SERVICE, second]) }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "show", "--project", "acme-app", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("CLI.PROMPT_REQUIRED");
  });
});
