import open from "open";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readAuthState } from "../src/auth";
import {
  makeServiceCli,
  page,
  readFlowRoutes,
  SERVICE_DETAIL,
  SIGNED_IN,
} from "./v8-service-testkit";

vi.mock("../src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth")>()),
  readAuthState: vi.fn(),
}));

vi.mock("open", () => ({ default: vi.fn() }));

beforeEach(() => {
  vi.mocked(readAuthState).mockReset();
  vi.mocked(readAuthState).mockResolvedValue(SIGNED_IN);
  vi.mocked(open).mockReset();
});

describe("prisma-v8 service open", () => {
  it("reports the live URL as an endpoint event without launching a browser", async () => {
    const harness = await makeServiceCli();

    const result = await harness.cli.run(
      ["service", "open", "--project", "acme-app", "--service", "hello-world"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      projectId: "proj_1",
      service: { id: "svc_1", name: "hello-world" },
      url: "https://hello.prisma.app",
      opened: false,
    });
    expect(result.events).toContainEqual({
      kind: "endpoint",
      name: "live-url",
      url: "https://hello.prisma.app",
    });
    expect(open).not.toHaveBeenCalled();
    expect(result.stdout).toBe("https://hello.prisma.app\n");
  });

  it("settles a project with no services as SERVICE.NO_DEPLOYMENTS", async () => {
    const harness = await makeServiceCli({
      routes: readFlowRoutes({ "GET /v1/apps": () => ({ data: page([]) }) }),
    });

    const result = await harness.cli.run(
      ["service", "open", "--project", "acme-app", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.NO_DEPLOYMENTS");
  });

  it("settles a service without a live URL as SERVICE.FEATURE_UNAVAILABLE", async () => {
    const harness = await makeServiceCli({
      routes: readFlowRoutes({
        "GET /v1/apps/{appId}": () => ({
          data: { data: { ...SERVICE_DETAIL, appEndpointDomain: null } },
        }),
      }),
    });

    const result = await harness.cli.run(
      [
        "service",
        "open",
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
    expect(frame.envelope.error.code).toBe("SERVICE.FEATURE_UNAVAILABLE");
  });

  it("frames the endpoint event and completed envelope on the json stream", async () => {
    const harness = await makeServiceCli();

    const result = await harness.cli.run(
      [
        "service",
        "open",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    const endpointFrame = result.json.find(
      (frame) => frame.kind === "endpoint",
    );
    expect(endpointFrame).toMatchObject({
      name: "live-url",
      url: "https://hello.prisma.app",
    });
    const last = result.json[result.json.length - 1];
    if (last?.kind !== "result" || !last.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(last.envelope.commandId).toBe("service.open");
    expect(last.envelope.result).toMatchObject({ opened: false });
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({ authenticated: false });

    const result = await harness.cli.run(
      ["service", "open", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
    expect(open).not.toHaveBeenCalled();
  });
});
