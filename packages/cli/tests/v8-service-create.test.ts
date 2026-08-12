import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  makeServiceCli,
  page,
  presentedSummary,
  type RawService,
  type Routes,
  readFlowRoutes,
  SERVICE,
} from "./v8-service-testkit";

function blocks(presented: unknown) {
  const value = presented as
    | { presentation: { human: Array<{ kind: string }> } }
    | undefined;
  return value?.presentation.human ?? [];
}

/** What POST /v1/apps answers with: a service that exists but has never
 *  been deployed, so it names no live deployment and its endpoint domain
 *  does not resolve yet. */
const CREATED: RawService = {
  id: "svc_new",
  name: "worker",
  region: { id: "eu-central-1" },
  branchId: "br_1",
  latestDeploymentId: null,
  appEndpointDomain: "worker.prisma.app",
};

interface CreateHarness {
  routes: Routes;
  bodies: unknown[];
}

function createRoutes(overrides: Routes = {}): CreateHarness {
  const bodies: unknown[] = [];
  return {
    bodies,
    routes: readFlowRoutes({
      "GET /v1/apps": () => ({ data: page([]) }),
      "POST /v1/apps": (init) => {
        bodies.push(init.body);
        return { data: { data: CREATED } };
      },
      ...overrides,
    }),
  };
}

describe("prisma-v8 service create", () => {
  it("creates the service and presents it with no live url", async () => {
    const created = createRoutes();
    const harness = await makeServiceCli({ routes: created.routes });

    const result = await harness.cli.run(
      ["service", "create", "worker", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      projectId: "proj_1",
      branch: "main",
      service: {
        id: "svc_new",
        name: "worker",
        region: "eu-central-1",
        liveDeploymentId: null,
        liveUrl: null,
      },
      existing: false,
    });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "ok",
      text: "Created worker on main.",
    });
    // The created service carries "worker.prisma.app" already, and that
    // address serves nothing until the first deployment is promoted.
    expect(
      blocks(result.presented).find((block) => block.kind === "fields"),
    ).toEqual({
      kind: "fields",
      rows: [
        { label: "project", value: "proj_1" },
        { label: "branch", value: "main" },
        { label: "service", value: "worker" },
        { label: "id", value: "svc_new" },
        { label: "region", value: "eu-central-1" },
        { label: "live url", value: "not deployed" },
      ],
    });
  });

  it("sends exactly the four create-body fields the API takes", async () => {
    const created = createRoutes();
    const harness = await makeServiceCli({ routes: created.routes });

    await harness.cli.run(
      [
        "service",
        "create",
        "worker",
        "--project",
        "acme-app",
        "--region",
        "us-east-1",
        "--branch",
        "main",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(created.bodies).toEqual([
      {
        projectId: "proj_1",
        branchId: "br_1",
        displayName: "worker",
        regionId: "us-east-1",
      },
    ]);
  });

  it("omits regionId when no region is given, letting the API default", async () => {
    const created = createRoutes();
    const harness = await makeServiceCli({ routes: created.routes });

    await harness.cli.run(
      ["service", "create", "worker", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(created.bodies).toEqual([
      { projectId: "proj_1", branchId: "br_1", displayName: "worker" },
    ]);
  });

  it("defaults to the main branch when none is given", async () => {
    const created = createRoutes();
    const harness = await makeServiceCli({ routes: created.routes });

    const result = await harness.cli.run(
      ["service", "create", "worker", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ branch: "main" });
  });

  it("remembers the created service as the selection for later commands", async () => {
    const created = createRoutes();
    const harness = await makeServiceCli({ routes: created.routes });

    await harness.cli.run(
      ["service", "create", "worker", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env },
    );

    const state = JSON.parse(
      await readFile(path.join(harness.stateDir, "state.json"), "utf8"),
    );
    expect(state.app.selectedByProject.proj_1).toEqual({
      id: "svc_new",
      name: "worker",
    });
  });

  it("reports the existing service when the name is already taken", async () => {
    const taken: RawService = { ...SERVICE, name: "worker", id: "svc_taken" };
    const created = createRoutes({
      "GET /v1/apps": () => ({ data: page([taken]) }),
      "POST /v1/apps": () => ({
        error: { error: { message: "already exists" } },
        status: 409,
      }),
    });
    const harness = await makeServiceCli({ routes: created.routes });

    const result = await harness.cli.run(
      ["service", "create", "worker", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      service: { id: "svc_taken", name: "worker" },
      existing: true,
    });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "info",
      text: "worker already exists on main; showing it.",
    });
  });

  it("settles an empty name as SERVICE.NAME_REQUIRED with exit 2", async () => {
    const created = createRoutes();
    const harness = await makeServiceCli({ routes: created.routes });

    const result = await harness.cli.run(
      ["service", "create", "   ", "--project", "acme-app", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.NAME_REQUIRED");
    expect(created.bodies).toEqual([]);
  });

  it("settles an API refusal as SERVICE.DEPLOY_FAILED with exit 2", async () => {
    const created = createRoutes({
      "POST /v1/apps": () => ({
        error: { error: { message: "quota exceeded" } },
        status: 400,
      }),
    });
    const harness = await makeServiceCli({ routes: created.routes });

    const result = await harness.cli.run(
      ["service", "create", "worker", "--project", "acme-app", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOY_FAILED");
    expect(frame.envelope.error.summary).toBe("Failed to create service");
  });

  it("emits the completed json envelope with commandId service.create", async () => {
    const created = createRoutes();
    const harness = await makeServiceCli({ routes: created.routes });

    const result = await harness.cli.run(
      ["service", "create", "worker", "--project", "acme-app", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.create");
    expect(frame.envelope.result).toMatchObject({
      service: { id: "svc_new", liveUrl: null },
      existing: false,
    });
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const created = createRoutes();
    const harness = await makeServiceCli({
      routes: created.routes,
      authenticated: false,
    });

    const result = await harness.cli.run(
      ["service", "create", "worker", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});
