/**
 * Where a service command's identity comes from. Every service command
 * resolves its workspace through `requireWorkspace`, and the only
 * sanctioned source for it is the engine's `ctx.activeCredential()`.
 * These tests fail if that identity starts coming from anywhere else:
 * the seeded session names a workspace the Management API fake never
 * reports, so a run that reads its workspace from any other source
 * resolves a different project or prints a different name.
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
} from "./v8-service-testkit";

const OTHER_WORKSPACE = { id: "ws_2", name: "Other Inc" };

const OTHER_PROJECT = {
  id: "proj_2",
  name: "other-app",
  workspace: OTHER_WORKSPACE,
};

/** One project per workspace, so which one resolves is decided purely
 *  by the workspace the run is acting as. */
function twoWorkspaceRoutes(overrides: Routes = {}): Routes {
  return readFlowRoutes({
    "GET /v1/projects": () => ({ data: page([PROJECT, OTHER_PROJECT]) }),
    ...overrides,
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

describe("prisma-v8 service — the workspace comes from the engine session", () => {
  it("resolves a project in the workspace the session names", async () => {
    const harness = await makeServiceCli({
      sessionWorkspace: OTHER_WORKSPACE,
      routes: twoWorkspaceRoutes(),
    });

    const result = await harness.cli.run(
      ["service", "show", "--project", "other-app", "--service", "hello-world"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ projectId: "proj_2" });
  });

  it("refuses a project outside the workspace the session names", async () => {
    const harness = await makeServiceCli({ routes: twoWorkspaceRoutes() });

    const result = await harness.cli.run(
      [
        "service",
        "show",
        "--project",
        "other-app",
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
    expect(frame.envelope.error.code).toBe("SERVICE.PROJECT_NOT_FOUND");
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
      routes: twoWorkspaceRoutes(),
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

  it("acts as the workspace a service token's claims name", async () => {
    const harness = await makeServiceCli({
      authenticated: false,
      environmentToken: mintTestJwt({
        sub: "usr_1",
        workspace_id: OTHER_WORKSPACE.id,
      }),
      routes: twoWorkspaceRoutes(),
    });

    const result = await harness.cli.run(
      ["service", "show", "--project", "other-app", "--service", "hello-world"],
      { cwd: harness.cwd, env: harness.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({ projectId: "proj_2" });
  });

  it("refuses a service token whose claims name no workspace", async () => {
    expect(credentialWorkspaceId(UNSCOPED_SERVICE_TOKEN)).toBeUndefined();

    const harness = await makeServiceCli({
      authenticated: false,
      environmentToken: UNSCOPED_SERVICE_TOKEN,
      routes: twoWorkspaceRoutes(),
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
    expect(frame.envelope.error.code).toBe("SERVICE.WORKSPACE_REQUIRED");
  });
});
