import { describe, expect, it } from "vitest";

import {
  makeServiceCli,
  presentedSummary,
  type Routes,
  releaseRoutes,
} from "./v8-service-testkit";

const INTERACTIVE = { stdin: true, stdout: true, stderr: true };
const TARGET = ["--project", "acme-app", "--service", "hello-world"];

function blocks(presented: unknown) {
  const value = presented as
    | { presentation: { human: Array<{ kind: string }> } }
    | undefined;
  return value?.presentation.human ?? [];
}

/** Records which deployments the run asked the API to delete, so a
 *  refused consent can be proven to have called nothing. */
function deleteRoutes(overrides: Routes = {}): {
  routes: Routes;
  deleted: string[];
} {
  const deleted: string[] = [];
  return {
    deleted,
    routes: releaseRoutes({
      "DELETE /v1/deployments/{deploymentId}": (init) => {
        deleted.push(init.params?.path?.deploymentId as string);
        return { data: { data: {} } };
      },
      ...overrides,
    }),
  };
}

describe("prisma-v8 service deployment delete", () => {
  it("deletes the deployment once consent is typed back", async () => {
    const removal = deleteRoutes();
    const harness = await makeServiceCli({ routes: removal.routes });

    const result = await harness.cli.run(
      ["service", "deployment", "delete", "dep_1", ...TARGET],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: INTERACTIVE,
        answers: ["dep_1"],
      },
    );

    expect(result.exitCode).toBe(0);
    expect(removal.deleted).toEqual(["dep_1"]);
    expect(result.events[0]).toEqual({ kind: "step-started", step: "delete" });
    expect(result.events.at(-1)).toEqual({
      kind: "step-finished",
      step: "delete",
      outcome: "ok",
    });
    expect(result.presented?.data).toEqual({
      projectId: "proj_1",
      service: { id: "svc_1", name: "hello-world" },
      deploymentId: "dep_1",
      deleted: true,
    });
    expect(presentedSummary(result.presented)).toEqual({
      kind: "summary",
      status: "ok",
      text: "Deleted dep_1 from hello-world.",
    });
    expect(
      blocks(result.presented).find((block) => block.kind === "fields"),
    ).toEqual({
      kind: "fields",
      rows: [
        { label: "project", value: "proj_1" },
        { label: "service", value: "hello-world" },
        { label: "deployment", value: "dep_1" },
        { label: "deleted", value: "yes" },
      ],
    });
  });

  it("grants non-interactively when --confirm carries the deployment id", async () => {
    const removal = deleteRoutes();
    const harness = await makeServiceCli({ routes: removal.routes });

    const result = await harness.cli.run(
      [
        "service",
        "deployment",
        "delete",
        "dep_1",
        ...TARGET,
        "--confirm",
        "dep_1",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(removal.deleted).toEqual(["dep_1"]);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || !frame.envelope.ok) {
      throw new Error("expected a completed envelope");
    }
    expect(frame.envelope.commandId).toBe("service.deployment.delete");
    expect(frame.envelope.result).toMatchObject({ deleted: true });
  });

  it("refuses a --confirm value that is not the deployment id", async () => {
    const removal = deleteRoutes();
    const harness = await makeServiceCli({ routes: removal.routes });

    const result = await harness.cli.run(
      [
        "service",
        "deployment",
        "delete",
        "dep_1",
        ...TARGET,
        "--confirm",
        "dep_2",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    expect(removal.deleted).toEqual([]);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("CLI.CONSENT_REQUIRED");
    expect(frame.envelope.error.meta).toMatchObject({
      consentToken: "dep_1",
    });
  });

  it("settles a mistyped consent token as the engine mismatch error", async () => {
    const removal = deleteRoutes();
    const harness = await makeServiceCli({ routes: removal.routes });

    const result = await harness.cli.run(
      ["service", "deployment", "delete", "dep_1", ...TARGET],
      {
        cwd: harness.cwd,
        env: harness.env,
        isTty: INTERACTIVE,
        answers: ["not-the-deployment"],
      },
    );

    expect(result.exitCode).toBe(2);
    expect(removal.deleted).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it("settles non-interactive runs with the engine consent error", async () => {
    const removal = deleteRoutes();
    const harness = await makeServiceCli({ routes: removal.routes });

    const result = await harness.cli.run(
      ["service", "deployment", "delete", "dep_1", ...TARGET, "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    expect(removal.deleted).toEqual([]);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("CLI.CONSENT_REQUIRED");
  });

  /**
   * The API permits this and clears the service's latest deployment
   * itself, so the CLI adds no guard of its own. Verified against the
   * management API's delete route and the interactor behind it: the
   * only documented 409 on this endpoint is the stop precondition, and
   * promotion is never consulted.
   */
  it("deletes the currently-live deployment without a CLI-side guard", async () => {
    const removal = deleteRoutes();
    const harness = await makeServiceCli({ routes: removal.routes });

    const result = await harness.cli.run(
      [
        "service",
        "deployment",
        "delete",
        "dep_2",
        ...TARGET,
        "--confirm",
        "dep_2",
      ],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(removal.deleted).toEqual(["dep_2"]);
    expect(result.presented?.data).toMatchObject({
      deploymentId: "dep_2",
      deleted: true,
    });
  });

  it("presents the API's own refusal when the deployment is still running", async () => {
    const removal = deleteRoutes({
      "DELETE /v1/deployments/{deploymentId}": () => ({
        error: {
          error: {
            message: "The deployment must be stopped before it can be deleted.",
          },
        },
        status: 409,
      }),
    });
    const harness = await makeServiceCli({ routes: removal.routes });

    const result = await harness.cli.run(
      [
        "service",
        "deployment",
        "delete",
        "dep_2",
        ...TARGET,
        "--confirm",
        "dep_2",
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
    expect(frame.envelope.error.summary).toBe("Failed to delete deployment");
    // The CLI does not stop the deployment first or invent the
    // precondition; the API states it and the user reads what it said.
    expect(frame.envelope.error.why).toContain(
      "The deployment must be stopped before it can be deleted.",
    );
  });

  it("settles an unknown deployment id as SERVICE.DEPLOYMENT_NOT_FOUND", async () => {
    const removal = deleteRoutes();
    const harness = await makeServiceCli({ routes: removal.routes });

    const result = await harness.cli.run(
      [
        "service",
        "deployment",
        "delete",
        "dep_missing",
        ...TARGET,
        "--confirm",
        "dep_missing",
        "--json",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    expect(removal.deleted).toEqual([]);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.DEPLOYMENT_NOT_FOUND");
  });

  it("fails early with the engine sign-in error when unauthenticated", async () => {
    const removal = deleteRoutes();
    const harness = await makeServiceCli({
      routes: removal.routes,
      authenticated: false,
    });

    const result = await harness.cli.run(
      ["service", "deployment", "delete", "dep_1", ...TARGET],
      { cwd: harness.cwd, env: harness.env, isTty: INTERACTIVE },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CLI.CREDENTIALS_REQUIRED");
  });
});
