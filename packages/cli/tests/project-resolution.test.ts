import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";
import type { ProjectCandidate } from "../src/lib/project/resolution";
import {
  projectResolutionErrorToStructured,
  resolveProjectTarget,
} from "../src/lib/project/resolution";
import { createTempCwd, createTestCommandContext } from "./helpers";

async function writeLocalPin(cwd: string, pin: unknown) {
  await mkdir(path.join(cwd, ".prisma"), { recursive: true });
  await writeFile(
    path.join(cwd, ".prisma/local.json"),
    `${JSON.stringify(pin, null, 2)}\n`,
    "utf8",
  );
}

async function writeLocalPinContent(cwd: string, content: string) {
  await mkdir(path.join(cwd, ".prisma"), { recursive: true });
  await writeFile(path.join(cwd, ".prisma/local.json"), content, "utf8");
}

function expectOk<T, E>(result: Result<T, E>): T {
  expect(result.isOk()).toBe(true);
  if (result.isErr()) {
    throw new Error("Expected Result to be Ok");
  }
  return result.value;
}

function expectErr<T, E extends { _tag: string }>(
  result: Result<T, E>,
  expectedTag: E["_tag"],
): E {
  expect(result.isErr()).toBe(true);
  if (!result.isErr()) {
    throw new Error("Expected Result to be Err");
  }
  expect(result.error._tag).toBe(expectedTag);
  return result.error;
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

    const result = await resolveProjectTarget({
      context,
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      listProjects,
      commandName: "app deploy",
    });

    const error = expectErr(result, "LocalProjectWorkspaceMismatchError");
    expect(projectResolutionErrorToStructured(error)).toMatchObject({
      code: "PROJECT.LOCAL_WORKSPACE_MISMATCH",
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
    const listProjects = vi.fn(
      async (): Promise<ProjectCandidate[]> => [
        {
          id: "proj_active",
          name: "Active Project",
          workspace: {
            id: "ws_123",
            name: "Acme Inc",
          },
        },
      ],
    );

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

    const resolved = expectOk(result);
    expect(resolved.resolution.projectSource).toBe("explicit");
    expect(resolved.project.id).toBe("proj_active");
    expect(listProjects).toHaveBeenCalledTimes(1);
  });

  it("returns LOCAL_STATE_STALE for invalid local pin JSON before listing projects", async () => {
    const cwd = await createTempCwd();
    await writeLocalPinContent(cwd, "{ nope");
    const { context } = await createTestCommandContext({ cwd });
    const listProjects = vi.fn<() => Promise<ProjectCandidate[]>>();

    const result = await resolveProjectTarget({
      context,
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      listProjects,
      commandName: "app deploy",
    });

    const error = expectErr(result, "LocalStateStaleError");
    expect(projectResolutionErrorToStructured(error)).toMatchObject({
      code: "PROJECT.LOCAL_STATE_STALE",
      meta: {
        pinPath: ".prisma/local.json",
      },
    });
    expect(listProjects).not.toHaveBeenCalled();
  });
});
