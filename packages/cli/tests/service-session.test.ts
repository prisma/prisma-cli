/**
 * Where a service command's identity comes from. Every service command
 * resolves its workspace through `requireWorkspace`, and the only
 * sanctioned source for it is the engine's `ctx.activeCredential()`.
 * These tests fail if that identity starts coming from anywhere else:
 * the seeded session names a workspace the Management API fake never
 * reports, so a run that reads its workspace from any other source
 * prints a different name.
 *
 * That identity decides what a run is ACTING AS. It does not decide
 * which projects it can see — the API answers within the credential's
 * scope, and the CLI reports what it returned. Comparing the two ids is
 * what broke every service command against the real API; the prefixed
 * fixture below is the regression for it.
 */
import { credentialWorkspaceId } from "@prisma/cli-engine";
import { mintTestJwt } from "@prisma/cli-engine/testing";
import { describe, expect, it } from "vitest";

import {
  domainRecord,
  makeServiceCli,
  PROJECT,
  page,
  type Routes,
  readFlowRoutes,
  WORKSPACE,
} from "./service-testkit";

const OTHER_WORKSPACE = { id: "ws_2", name: "Other Inc" };

/**
 * What `/v1/projects` returns for a credential: the projects of the one
 * workspace that credential names. It does not return other workspaces'
 * projects, and a fixture that pretends otherwise invites client-side
 * filtering to handle a case the API never produces — the filter #144
 * removed from the legacy listing, and that the service tree's own copy
 * of it carried until the first real e2e run found it.
 */
function workspaceRoutes(overrides: Routes = {}): Routes {
  return readFlowRoutes({
    "GET /v1/projects": () => ({ data: page([PROJECT]) }),
    ...overrides,
  });
}

/**
 * The same one project, reported the way the management API actually
 * reports it: a `wksp_`-prefixed workspace id, where the credential's
 * `workspace_id` claim carries the bare form. Two systems that disagree
 * about the format — which is exactly the pairing a fixture writing
 * both sides by hand cannot produce, and why every service command
 * resolved nothing against the real API while this suite stayed green.
 */
function prefixedWorkspaceRoutes(): Routes {
  return readFlowRoutes({
    "GET /v1/projects": () => ({
      data: page([
        {
          ...PROJECT,
          workspace: { id: `wksp_${WORKSPACE.id}`, name: WORKSPACE.name },
        },
      ]),
    }),
  });
}

/**
 * A token the one workspace derivation cannot place: no `workspace_id`
 * claim, and a `sub` that is not `workspace:<id>`. The platform mints
 * no such credential — an OAuth token carries `workspace_id`, and a
 * service token's subject is always `workspace:<id>` — so this pins the
 * refusal for a shape only a malformed credential could have. It calls
 * the product's own derivation, so the day that changes this fails
 * rather than quietly pinning a refusal the product never makes.
 */
const UNSCOPED_SERVICE_TOKEN = mintTestJwt({ sub: "usr_1" });

function domainRoutes(): Routes {
  return readFlowRoutes({
    "GET /v1/apps/{appId}/domains": () => ({
      data: { data: [domainRecord()] },
    }),
    "GET /v1/domains/{domainId}": () => ({ data: { data: domainRecord() } }),
  });
}

describe("prisma service — the workspace comes from the engine session", () => {
  it("resolves the project the API returns", async () => {
    const harness = await makeServiceCli({ routes: workspaceRoutes() });

    const result = await harness.cli.run(
      ["service", "show", "--project", "acme-app", "hello-world"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ projectId: "proj_1" });
  });

  /**
   * The regression for the defect the first real e2e run surfaced: the
   * service tree filtered the project listing by comparing the API's
   * workspace id against the credential's, which are the same workspace
   * in two formats. Every project was discarded, so the pinned project
   * looked gone and every service command settled
   * SERVICE.LOCAL_STATE_STALE.
   */
  it("resolves a project the API reports under a prefixed workspace id", async () => {
    const harness = await makeServiceCli({ routes: prefixedWorkspaceRoutes() });

    const result = await harness.cli.run(
      ["service", "show", "--project", "acme-app", "hello-world"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ projectId: "proj_1" });
  });

  /**
   * A refused listing is not an empty workspace. Reading one as the
   * other told the user their local binding was stale and sent them to
   * re-link a project that was never the problem.
   */
  it("raises a refused project listing instead of reporting no projects", async () => {
    const harness = await makeServiceCli({
      routes: readFlowRoutes({
        "GET /v1/projects": () => ({
          error: { error: { message: "Access denied for this token." } },
          status: 403,
        }),
      }),
    });

    const result = await harness.cli.run(
      ["service", "show", "--project", "acme-app", "hello-world", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).not.toBe(0);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).not.toBe("SERVICE.LOCAL_STATE_STALE");
    expect(frame.envelope.error.summary).toBe("Failed to list projects");
    expect(frame.envelope.error.why).toContain("Access denied for this token.");
  });

  it("refuses a project the API did not return", async () => {
    const harness = await makeServiceCli({ routes: workspaceRoutes() });

    const result = await harness.cli.run(
      ["service", "show", "--project", "no-such-app", "hello-world", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.PROJECT_NOT_FOUND");
    // The workspace the refusal names still comes from the session.
    expect(frame.envelope.error.why).toContain('workspace "Acme Inc"');
  });

  it("presents the session's workspace name, not the one the API reports for the project", async () => {
    const harness = await makeServiceCli({
      sessionWorkspace: { id: "ws_1", name: "Signed-in Workspace" },
      routes: domainRoutes(),
    });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "show",
        "shop.acme.com",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    // The fake API reports this project's workspace as "Acme Inc".
    expect(PROJECT.workspace.name).toBe("Acme Inc");
    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      workspace: { id: "ws_1", name: "Signed-in Workspace" },
    });
  });

  it("shows the workspace id when the session's workspace has no name", async () => {
    const harness = await makeServiceCli({
      sessionWorkspace: { id: "ws_1" },
      routes: domainRoutes(),
    });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "show",
        "shop.acme.com",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
      ],
      { cwd: harness.cwd, env: harness.env, isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      workspace: { id: "ws_1", name: "ws_1" },
    });
    expect(result.stderr).toContain("workspace:     ws_1");
  });

  it("fails with the engine sign-in error when there is no session", async () => {
    const harness = await makeServiceCli({
      authenticated: false,
      routes: workspaceRoutes(),
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
    expect(frame.envelope.error.code).toBe("CLI.CREDENTIALS_REQUIRED");
  });

  /** The API fake reports this project in "Acme Inc" (ws_1) throughout,
   *  so a run that presents ws_2 can only have taken it from the token's
   *  claims. */
  it("acts as the workspace a service token's claims name", async () => {
    const harness = await makeServiceCli({
      authenticated: false,
      environmentToken: mintTestJwt({
        sub: "usr_1",
        workspace_id: OTHER_WORKSPACE.id,
      }),
      routes: domainRoutes(),
    });

    const result = await harness.cli.run(
      [
        "service",
        "domain",
        "show",
        "shop.acme.com",
        "--project",
        "acme-app",
        "--service",
        "hello-world",
      ],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(PROJECT.workspace.id).toBe("ws_1");
    expect(result.presented?.data).toMatchObject({
      workspace: { id: "ws_2" },
    });
  });

  it("refuses a service token whose claims name no workspace", async () => {
    expect(credentialWorkspaceId(UNSCOPED_SERVICE_TOKEN)).toBeUndefined();

    const harness = await makeServiceCli({
      authenticated: false,
      environmentToken: UNSCOPED_SERVICE_TOKEN,
      routes: workspaceRoutes(),
    });

    const result = await harness.cli.run(
      ["service", "show", "--project", "acme-app", "hello-world", "--json"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(2);
    const frame = result.json[result.json.length - 1];
    if (frame?.kind !== "result" || frame.envelope.ok) {
      throw new Error("expected an errored envelope");
    }
    expect(frame.envelope.error.code).toBe("SERVICE.WORKSPACE_REQUIRED");
  });
});
