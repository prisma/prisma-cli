import { beforeEach, describe, expect, it, vi } from "vitest";

import { readAuthState } from "../src/auth";
import {
  makeServiceCli,
  readFlowRoutes,
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

/** show-deploy scans projects to find the owning service. */
function showDeployRoutes(overrides = {}) {
  return readFlowRoutes(overrides);
}

describe("prisma-v8 service show-deploy", () => {
  it("presents the deployment with the live flag from the provider live pointer", async () => {
    const harness = await makeServiceCli({ routes: showDeployRoutes() });

    const result = await harness.cli.run(["service", "show-deploy", "dep_2"], {
      cwd: harness.cwd,
      env: harness.env,
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      service: { id: "svc_1", name: "hello-world" },
      deployment: {
        id: "dep_2",
        status: "running",
        createdAt: "2026-08-02T00:00:00.000Z",
        url: "https://dep2.prisma.app",
        live: true,
      },
    });
  });

  it("settles an unknown deployment id as SERVICE.DEPLOYMENT_NOT_FOUND with exit 2", async () => {
    const harness = await makeServiceCli({ routes: showDeployRoutes() });

    const result = await harness.cli.run(
      ["service", "show-deploy", "dep_missing", "--json"],
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
      ["service", "show-deploy", "dep_2", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOY_FAILED");
  });

  it("emits the completed json envelope with commandId service.show-deploy", async () => {
    const harness = await makeServiceCli({ routes: showDeployRoutes() });

    const result = await harness.cli.run(
      ["service", "show-deploy", "dep_1", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.show-deploy");
    expect(frame.envelope.result).toMatchObject({
      deployment: { id: "dep_1", live: false },
    });
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({
      routes: showDeployRoutes(),
      authenticated: false,
    });

    const result = await harness.cli.run(["service", "show-deploy", "dep_1"], {
      cwd: harness.cwd,
      env: harness.env,
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});
