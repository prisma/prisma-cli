import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeServiceCli,
  page,
  presentedSummary,
  readFlowRoutes,
  SERVICE_DETAIL,
} from "./v8-service-testkit";

describe("prisma-v8 service open", () => {
  it("reports the live URL as an endpoint event and opens nothing when the session is not interactive", async () => {
    const opener = vi.fn();
    const harness = await makeServiceCli({ openUrl: opener });

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
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      tone: "info",
      text: "Resolved the live URL for the selected service.",
    });
    expect(result.events).toContainEqual({
      kind: "endpoint",
      name: "Live URL",
      url: "https://hello.prisma.app",
    });
    expect(opener).not.toHaveBeenCalled();
    expect(result.stdout).toBe("https://hello.prisma.app\n");
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "Inspect the service",
        command: "prisma-cli service show",
      },
      {
        kind: "run-command",
        label: "Show the live deployment",
        command: "prisma-cli service show-deploy dep_2",
      },
    ]);
  });

  it("opens the live URL through the engine opener in an interactive session", async () => {
    const opener = vi.fn();
    const harness = await makeServiceCli({ openUrl: opener });

    const result = await harness.cli.run(
      ["service", "open", "--project", "acme-app", "--service", "hello-world"],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: { stdin: true, stdout: true, stderr: true },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(opener).toHaveBeenCalledWith("https://hello.prisma.app");
    expect(result.presented?.data).toMatchObject({ opened: true });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      tone: "ok",
      text: "Opened the live URL for the selected service.",
    });
    expect(result.events).toContainEqual({
      kind: "endpoint",
      name: "Live URL",
      url: "https://hello.prisma.app",
    });
  });

  it("reports opened: false when the opener fails, never an error", async () => {
    const harness = await makeServiceCli({
      openUrl: () => {
        throw new Error("no browser here");
      },
    });

    const result = await harness.cli.run(
      ["service", "open", "--project", "acme-app", "--service", "hello-world"],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: { stdin: true, stdout: true, stderr: true },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ opened: false });
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
    // No action suggests `service deploy`: the binary does not answer to it.
    expect(frame.envelope.nextActions).toEqual([
      {
        kind: "run-command",
        label: "Inspect the service",
        command: "prisma-cli service show",
      },
    ]);
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
      name: "Live URL",
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
    const opener = vi.fn();
    const harness = await makeServiceCli({
      authenticated: false,
      openUrl: opener,
    });

    const result = await harness.cli.run(
      ["service", "open", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
    expect(opener).not.toHaveBeenCalled();
  });
});
