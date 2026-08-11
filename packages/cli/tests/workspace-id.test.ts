import { describe, expect, it, vi } from "vitest";

import {
  listRealWorkspaceProjects,
  readProjectListLocalBinding,
} from "../src/controllers/project";
import { writeLocalResolutionPin } from "../src/lib/project/local-pin";
import { sameWorkspaceId, stripWorkspacePrefix } from "../src/lib/workspace-id";
import { createTempCwd } from "./helpers";

/** The bare id a credential's `workspace_id` claim carries, and the
 *  `wksp_`-prefixed id the management API returns for that same
 *  workspace. */
const CREDENTIAL_WORKSPACE_ID = "cmjs0z06102rz2mgzk5zqj495";
const API_WORKSPACE_ID = `wksp_${CREDENTIAL_WORKSPACE_ID}`;

const WORKSPACE = { id: CREDENTIAL_WORKSPACE_ID, name: "Acme Inc" };

function clientReturning(projects: unknown[]) {
  return {
    GET: vi.fn().mockResolvedValue({ data: { data: projects } }),
  } as never;
}

function apiProject(id: string, name: string, workspaceId: string) {
  return {
    id,
    name,
    slug: name,
    workspace: { id: workspaceId, name: "Acme Inc" },
  };
}

describe("workspace id matching", () => {
  it("treats the prefixed and bare forms of one id as the same workspace", () => {
    expect(sameWorkspaceId(API_WORKSPACE_ID, CREDENTIAL_WORKSPACE_ID)).toBe(
      true,
    );
    expect(sameWorkspaceId(CREDENTIAL_WORKSPACE_ID, API_WORKSPACE_ID)).toBe(
      true,
    );
    expect(sameWorkspaceId(API_WORKSPACE_ID, API_WORKSPACE_ID)).toBe(true);
    expect(stripWorkspacePrefix(API_WORKSPACE_ID)).toBe(
      CREDENTIAL_WORKSPACE_ID,
    );
    expect(stripWorkspacePrefix(CREDENTIAL_WORKSPACE_ID)).toBe(
      CREDENTIAL_WORKSPACE_ID,
    );
  });

  it("keeps two genuinely different workspaces apart", () => {
    expect(sameWorkspaceId(API_WORKSPACE_ID, "wksp_other")).toBe(false);
    expect(sameWorkspaceId(CREDENTIAL_WORKSPACE_ID, "other")).toBe(false);
  });
});

describe("listRealWorkspaceProjects", () => {
  it("lists the workspace's projects when the API returns prefixed workspace ids", async () => {
    const client = clientReturning([
      apiProject("proj_456", "Billing API", API_WORKSPACE_ID),
      apiProject("proj_123", "Acme Dashboard", API_WORKSPACE_ID),
    ]);

    const projects = await listRealWorkspaceProjects(client, WORKSPACE);

    expect(projects.map((project) => project.id)).toEqual([
      "proj_123",
      "proj_456",
    ]);
  });

  it("still excludes projects belonging to another workspace", async () => {
    const client = clientReturning([
      apiProject("proj_456", "Billing API", API_WORKSPACE_ID),
      apiProject("proj_999", "Alpha", "wksp_other"),
    ]);

    const projects = await listRealWorkspaceProjects(client, WORKSPACE);

    expect(projects.map((project) => project.id)).toEqual(["proj_456"]);
  });
});

describe("readProjectListLocalBinding", () => {
  it("reports a directory as linked when the pin holds the other id form", async () => {
    const cwd = await createTempCwd();
    const written = await writeLocalResolutionPin(
      cwd,
      { workspaceId: API_WORKSPACE_ID, projectId: "proj_123" },
      AbortSignal.timeout(5_000),
    );
    expect(written.isOk()).toBe(true);

    const binding = await readProjectListLocalBinding(
      cwd,
      WORKSPACE,
      [{ id: "proj_123" }],
      AbortSignal.timeout(5_000),
    );

    expect(binding).toEqual({ status: "linked" });
  });
});
