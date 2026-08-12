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
  it("returns what the API returned, sorted, without filtering", async () => {
    const client = clientReturning([
      apiProject("proj_456", "Billing API", API_WORKSPACE_ID),
      apiProject("proj_123", "Acme Dashboard", API_WORKSPACE_ID),
    ]);

    const projects = await listRealWorkspaceProjects(client);

    expect(projects.map((project) => project.id)).toEqual([
      "proj_123",
      "proj_456",
    ]);
  });

  /** The credential names one workspace and the API answers within it,
   *  so this case does not arise in production. It is pinned because
   *  the filter that used to drop such a row dropped every row instead
   *  whenever the two id forms met, reporting "No projects found." for
   *  a workspace full of projects. Surfacing a stray row is a far
   *  cheaper failure than hiding every row. */
  it("does not hide a project the API attributes to another workspace", async () => {
    const client = clientReturning([
      apiProject("proj_456", "Billing API", API_WORKSPACE_ID),
      apiProject("proj_999", "Alpha", "wksp_other"),
    ]);

    const projects = await listRealWorkspaceProjects(client);

    expect(projects.map((project) => project.id)).toEqual([
      "proj_999",
      "proj_456",
    ]);
  });
});

describe("readProjectListLocalBinding", () => {
  /** The pin records the workspace id the CLI held when it was written,
   *  which is the bare form under Prisma 8 and the prefixed form under
   *  Prisma 7.
   *  The binding is judged by whether the pinned project is one the API
   *  returned, so neither form can make a linked directory read as
   *  invalid. */
  it("reports a directory as linked whichever id form the pin holds", async () => {
    const bindings = await Promise.all(
      [API_WORKSPACE_ID, CREDENTIAL_WORKSPACE_ID].map(async (workspaceId) => {
        const cwd = await createTempCwd();
        const written = await writeLocalResolutionPin(
          cwd,
          { workspaceId, projectId: "proj_123" },
          AbortSignal.timeout(5_000),
        );
        expect(written.isOk(), workspaceId).toBe(true);

        return readProjectListLocalBinding(
          cwd,
          [{ id: "proj_123" }],
          AbortSignal.timeout(5_000),
        );
      }),
    );

    expect(bindings).toEqual([{ status: "linked" }, { status: "linked" }]);
  });

  it("reports invalid when the pinned project is not one the API returned", async () => {
    const cwd = await createTempCwd();
    await writeLocalResolutionPin(
      cwd,
      { workspaceId: CREDENTIAL_WORKSPACE_ID, projectId: "proj_gone" },
      AbortSignal.timeout(5_000),
    );

    const binding = await readProjectListLocalBinding(
      cwd,
      [{ id: "proj_123" }],
      AbortSignal.timeout(5_000),
    );

    expect(binding).toEqual({ status: "invalid" });
  });
});
