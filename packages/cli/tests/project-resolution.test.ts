import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createTempCwd, createTestCommandContext } from "./helpers";
import { resolveProjectTarget } from "../src/lib/project/resolution";
import type { ProjectCandidate } from "../src/lib/project/resolution";

async function writeLocalPin(cwd: string, pin: unknown) {
  await mkdir(path.join(cwd, ".prisma"), { recursive: true });
  await writeFile(path.join(cwd, ".prisma/local.json"), `${JSON.stringify(pin, null, 2)}\n`, "utf8");
}

describe("project resolution", () => {
  it("returns LOCAL_PROJECT_WORKSPACE_MISMATCH before listing projects", async () => {
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, {
      workspaceId: "ws_other",
      projectId: "proj_123",
    });
    const { context } = await createTestCommandContext({ cwd });
    const listProjects = vi.fn<() => Promise<ProjectCandidate[]>>();

    await expect(resolveProjectTarget({
      context,
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      listProjects,
      commandName: "app deploy",
    })).rejects.toMatchObject({
      code: "LOCAL_PROJECT_WORKSPACE_MISMATCH",
      domain: "project",
      meta: {
        pinPath: ".prisma/local.json",
        pinnedWorkspaceId: "ws_other",
        pinnedProjectId: "proj_123",
        activeWorkspaceId: "ws_123",
        activeWorkspaceName: "Acme Inc",
      },
    });
    expect(listProjects).not.toHaveBeenCalled();
  });

  it("lets explicit project targeting bypass a mismatched local pin", async () => {
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, {
      workspaceId: "ws_other",
      projectId: "proj_123",
    });
    const { context } = await createTestCommandContext({ cwd });
    const listProjects = vi.fn(async (): Promise<ProjectCandidate[]> => [{
      id: "proj_active",
      name: "Active Project",
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
    }]);

    const result = await resolveProjectTarget({
      context,
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      explicitProject: "proj_active",
      listProjects,
      commandName: "app deploy",
    });

    expect(result.resolution.projectSource).toBe("explicit");
    expect(result.project.id).toBe("proj_active");
    expect(listProjects).toHaveBeenCalledTimes(1);
  });

  it("lets PRISMA_PROJECT_ID bypass a mismatched local pin", async () => {
    const cwd = await createTempCwd();
    await writeLocalPin(cwd, {
      workspaceId: "ws_other",
      projectId: "proj_123",
    });
    const { context } = await createTestCommandContext({ cwd });
    const listProjects = vi.fn(async (): Promise<ProjectCandidate[]> => [{
      id: "proj_env",
      name: "Env Project",
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
    }]);

    const result = await resolveProjectTarget({
      context,
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      envProjectId: "proj_env",
      listProjects,
      commandName: "app deploy",
    });

    expect(result.resolution.projectSource).toBe("env");
    expect(result.project.id).toBe("proj_env");
    expect(listProjects).toHaveBeenCalledTimes(1);
  });
});
