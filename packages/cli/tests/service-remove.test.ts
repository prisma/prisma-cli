import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  makeServiceCli,
  page,
  presentedSummary,
  releaseRoutes,
} from "./service-testkit";

const INTERACTIVE = { stdin: true, stdout: true, stderr: true };

describe("prisma-cli service remove", () => {
  it("removes the selected service once consent is granted", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "remove",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
      ],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: INTERACTIVE,
        answers: ["hello-world"],
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toEqual({
      projectId: "proj_1",
      service: { id: "svc_1", name: "hello-world" },
      removed: true,
    });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "ok",
      text: "Removed hello-world and every deployment it owned.",
    });
    // A removal used to offer `service deploy`; the binary has no such
    // command, so listing deployments is all that is left to suggest.
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "List deployments",
        command: "prisma-cli service deployment list",
      },
    ]);
  });

  it("emits the remove step around the teardown progress and the deleted status", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "remove",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
      ],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: INTERACTIVE,
        answers: ["hello-world"],
      },
    );

    expect(result.events[0]).toEqual({ kind: "step-started", step: "remove" });
    expect(result.events[1]).toEqual({
      kind: "status",
      subject: "hello-world",
      status: "removing",
    });
    expect(result.events).toContainEqual({
      kind: "progress",
      step: "delete-deployments",
      completed: 2,
      total: 2,
    });
    expect(result.events).toContainEqual({
      kind: "status",
      subject: "hello-world",
      status: "deleted",
      from: "removing",
    });
    expect(result.events.at(-1)).toEqual({
      kind: "step-finished",
      step: "remove",
      outcome: "ok",
    });
  });

  it("clears the known live deployment from local state", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    // Nothing in the service family writes this key any more, but the
    // legacy `app` family still does for the same project, so clearing
    // it on removal has real effect until that family retires. Seeded
    // here so the assertion below observes a key that was present.
    const statePath = path.join(harness.stateDir, "state.json");
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(
      statePath,
      JSON.stringify({
        app: { knownLiveDeploymentByProject: { proj_1: { svc_1: "dep_2" } } },
      }),
    );

    await harness.cli.run(
      [
        "service",
        "remove",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
      ],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: INTERACTIVE,
        answers: ["hello-world"],
      },
    );

    const state = JSON.parse(
      await readFile(path.join(harness.stateDir, "state.json"), "utf8"),
    );
    expect(
      state.app?.knownLiveDeploymentByProject?.proj_1?.svc_1,
    ).toBeUndefined();
  });

  it("emits the completed json envelope with commandId service.remove", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "remove",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
        "--json",
      ],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: INTERACTIVE,
        answers: ["hello-world"],
      },
    );

    expect(result.exitCode).toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.remove");
    expect(frame.envelope.result).toMatchObject({ removed: true });
  });

  it("settles a mistyped consent token as the engine mismatch error", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "remove",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
      ],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: INTERACTIVE,
        answers: ["not-the-service"],
      },
    );

    expect(result.exitCode).toBe(2);
    expect(result.events).toEqual([]);
  });

  it("settles non-interactive runs with the engine consent error", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "remove",
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
    expect(frame.envelope.error.code).toBe("CLI.CONSENT_REQUIRED");
  });

  it("grants non-interactively when --confirm carries the service name", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "remove",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
        "--confirm",
        "hello-world",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ removed: true });
  });

  it("emits the completed json envelope for a --confirm removal", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "remove",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
        "--confirm",
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
    expect(frame.envelope.commandId).toBe("service.remove");
    expect(frame.envelope.result).toMatchObject({ removed: true });
  });

  it("refuses a --confirm value that is not the service name", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "remove",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
        "--confirm",
        "some-other-service",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("CLI.CONSENT_REQUIRED");
    expect(frame.envelope.error.meta).toMatchObject({
      consentToken: "hello-world",
    });
  });

  it("never lets --yes alone grant the removal", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "remove",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
        "--yes",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env, isTty: INTERACTIVE },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("CLI.CONSENT_REQUIRED");
  });

  it("rejects an empty --branch instead of falling back to the inferred branch", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "remove",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
        "--branch",
        "",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.BRANCH_INVALID");
  });

  it("settles a failing teardown as SERVICE.REMOVE_FAILED after a failed step", async () => {
    const harness = await makeServiceCli({
      routes: releaseRoutes({
        "DELETE /v1/apps/{appId}": () => ({
          error: { error: { message: "boom" } },
          status: 500,
        }),
      }),
    });

    const result = await harness.cli.run(
      [
        "service",
        "remove",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
        "--json",
      ],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: INTERACTIVE,
        answers: ["hello-world"],
      },
    );

    expect(result.exitCode).toBe(2);
    expect(result.events.at(-1)).toEqual({
      kind: "step-finished",
      step: "remove",
      outcome: "failed",
    });
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.REMOVE_FAILED");
  });

  it("requires --service or PRISMA_SERVICE_ID, interactive terminals included", async () => {
    const harness = await makeServiceCli({
      routes: releaseRoutes({ "GET /v1/apps": () => ({ data: page([]) }) }),
    });

    const result = await harness.cli.run(
      ["service", "remove", "--project", "acme-app", "--json"],
      { cwd: harness.cwd, env: harness.env, isTty: INTERACTIVE },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.TARGET_REQUIRED");
    expect(frame.envelope.error.summary).toBe(
      'Command "service remove" requires --service',
    );
    expect(frame.envelope.nextActions).toEqual([
      {
        kind: "user-choice",
        label: "Pass --service <name>.",
      },
      // Not `service deployment list`: that command resolves a service
      // before it lists anything, so it fails the same way this did.
      {
        kind: "run-command",
        label: "List services",
        command: "prisma-cli service list",
      },
    ]);
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const harness = await makeServiceCli({
      authenticated: false,
      routes: releaseRoutes(),
    });

    const result = await harness.cli.run(
      ["service", "remove", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: INTERACTIVE },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});
