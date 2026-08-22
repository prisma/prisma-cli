import { describe, expect, it } from "vitest";

import {
  makeServiceCli,
  page,
  presentedSummary,
  releaseRoutes,
} from "./service-testkit";

const INTERACTIVE = { stdin: true, stdout: true, stderr: true };

describe("prisma-cli service delete", () => {
  it("deletes the service once consent is granted", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      ["service", "delete", "--project", "acme-app", "hello-world"],
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
      deleted: true,
    });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "ok",
      text: "Deleted hello-world and every version it owned.",
    });
    // The service is gone, so nothing service-scoped can run next;
    // listing what remains is all that is left to suggest.
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "List remaining services",
        command: "prisma-cli service list",
      },
    ]);
  });

  it("emits the delete step around the teardown progress and the deleted status", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      ["service", "delete", "--project", "acme-app", "hello-world"],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: INTERACTIVE,
        answers: ["hello-world"],
      },
    );

    expect(result.events[0]).toEqual({ kind: "step-started", step: "delete" });
    expect(result.events[1]).toEqual({
      kind: "status",
      subject: "hello-world",
      status: "deleting",
    });
    expect(result.events).toContainEqual({
      kind: "progress",
      step: "delete-versions",
      completed: 2,
      total: 2,
    });
    expect(result.events).toContainEqual({
      kind: "status",
      subject: "hello-world",
      status: "deleted",
      from: "deleting",
    });
    expect(result.events.at(-1)).toEqual({
      kind: "step-finished",
      step: "delete",
      outcome: "ok",
    });
  });

  it("emits the completed json envelope with commandId service.delete", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      ["service", "delete", "--project", "acme-app", "hello-world", "--json"],
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
    expect(frame.envelope.commandId).toBe("service.delete");
    expect(frame.envelope.result).toMatchObject({ deleted: true });
  });

  it("settles a mistyped consent token as the engine mismatch error", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      ["service", "delete", "--project", "acme-app", "hello-world"],
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
      ["service", "delete", "--project", "acme-app", "hello-world", "--json"],
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
        "delete",
        "--project",
        "acme-app",
        "hello-world",
        "--confirm",
        "hello-world",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ deleted: true });
  });

  it("emits the completed json envelope for a --confirm deletion", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "delete",
        "--project",
        "acme-app",
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
    expect(frame.envelope.commandId).toBe("service.delete");
    expect(frame.envelope.result).toMatchObject({ deleted: true });
  });

  it("refuses a --confirm value that is not the service name", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "delete",
        "--project",
        "acme-app",
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

  it("never lets --yes alone grant the deletion", async () => {
    const harness = await makeServiceCli({ routes: releaseRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "delete",
        "--project",
        "acme-app",
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
        "delete",
        "--project",
        "acme-app",
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

  it("settles a failing teardown as SERVICE.DELETE_FAILED after a failed step", async () => {
    const harness = await makeServiceCli({
      routes: releaseRoutes({
        "DELETE /v1/apps/{appId}": () => ({
          error: { error: { message: "boom" } },
          status: 500,
        }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "delete", "--project", "acme-app", "hello-world", "--json"],
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
      step: "delete",
      outcome: "failed",
    });
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DELETE_FAILED");
  });

  it("requires a service argument, interactive terminals included", async () => {
    const harness = await makeServiceCli({
      routes: releaseRoutes({ "GET /v1/apps": () => ({ data: page([]) }) }),
    });

    const result = await harness.cli.run(
      ["service", "delete", "--project", "acme-app", "--json"],
      { cwd: harness.cwd, env: harness.env, isTty: INTERACTIVE },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.TARGET_REQUIRED");
    expect(frame.envelope.error.summary).toBe(
      'Command "service delete" requires a service',
    );
    expect(frame.envelope.nextActions).toEqual([
      {
        kind: "user-choice",
        label: "Pass the service id or name as the first argument.",
      },
      // Not `service version list`: that command resolves a service
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
      ["service", "delete", "--project", "acme-app"],
      { cwd: harness.cwd, env: harness.env, isTty: INTERACTIVE },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});
