import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  makeServiceCli,
  page,
  presentedSummary,
  releaseRoutes,
} from "./service-testkit";

describe("prisma-cli service version promote", () => {
  it("promotes the requested deployment and reports it as the live one", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      ["service", "version", "promote", "dep_1"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      service: { id: "svc_1", name: "hello-world" },
      version: { id: "dep_1", status: "running", live: true },
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
      ["service", "version", "promote", "dep_1"],
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

  it("writes no local selection or live-deployment state", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    await harness.cli.run(["service", "version", "promote", "dep_1"], {
      cwd: harness.cwd,
      env: harness.env,
    });

    await expect(
      readFile(path.join(harness.stateDir, "state.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("warns instead of promoting when the target is already live", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      ["service", "version", "promote", "dep_2"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.diagnostics).toEqual([
      {
        code: "SERVICE.VERSION_ALREADY_LIVE",
        severity: "warn",
        summary: "The selected version is already live for this service.",
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

  it("emits the completed json envelope with commandId service.version.promote", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "version",
        "promote",
        "dep_1",

        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.version.promote");
    expect(frame.envelope.result).toMatchObject({
      service: { id: "svc_1", name: "hello-world" },
      version: { id: "dep_1" },
    });
  });

  it("rejects a deployment that does not belong to the service", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "version",
        "promote",
        "dep_missing",

        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.VERSION_NOT_FOUND");
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
        "version",
        "promote",
        "dep_1",

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

  it("settles a deployment with no owning service as SERVICE.VERSION_DETACHED", async () => {
    const harness = await makeServiceCli({
      routes: releaseRoutes({ "GET /v1/apps": () => ({ data: page([]) }) }),
    });

    const result = await harness.cli.run(
      ["service", "version", "promote", "dep_1", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.VERSION_DETACHED");
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({
      authenticated: false,
      routes: releaseRoutes(),
    });

    const result = await harness.cli.run(
      ["service", "version", "promote", "dep_1"],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});
