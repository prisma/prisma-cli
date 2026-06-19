import type { ManagementApiClient } from "@prisma/management-api-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  resolveProductionBranch,
  resolveReadBranch,
} from "../src/lib/app/read-branch";

type RawBranch = {
  id: string;
  gitName: string;
  isDefault: boolean;
  role: "production" | "preview";
};

function pageResponse(branches: RawBranch[], nextCursor: string | null) {
  return {
    data: {
      data: branches,
      pagination: { hasMore: nextCursor !== null, nextCursor },
    },
  };
}

function clientReturning(branches: RawBranch[]): ManagementApiClient {
  return {
    GET: vi.fn().mockResolvedValue(pageResponse(branches, null)),
  } as unknown as ManagementApiClient;
}

describe("resolveReadBranch", () => {
  it("returns the branch whose gitName matches the request", async () => {
    const client = clientReturning([
      {
        id: "b_master",
        gitName: "master",
        isDefault: true,
        role: "production",
      },
      { id: "b_feat", gitName: "feat/x", isDefault: false, role: "preview" },
    ]);

    const result = await resolveReadBranch(client, {
      projectId: "proj_1",
      branchName: "feat/x",
    });

    expect(result).toEqual({ id: "b_feat", name: "feat/x", kind: "preview" });
  });

  it("falls back to the default branch when the requested branch does not exist", async () => {
    const client = clientReturning([
      {
        id: "b_master",
        gitName: "master",
        isDefault: true,
        role: "production",
      },
    ]);

    const result = await resolveReadBranch(client, {
      projectId: "proj_1",
      branchName: "main",
    });

    expect(result).toEqual({
      id: "b_master",
      name: "master",
      kind: "production",
    });
  });

  it("returns null when the project has no branches", async () => {
    const client = clientReturning([]);

    const result = await resolveReadBranch(client, {
      projectId: "proj_1",
      branchName: "main",
    });

    expect(result).toBeNull();
  });

  it("throws when the branches request fails", async () => {
    const client = {
      GET: vi.fn().mockResolvedValue({
        error: { message: "Unauthorized" },
        response: { status: 401 },
      }),
    } as unknown as ManagementApiClient;

    await expect(
      resolveReadBranch(client, { projectId: "proj_1", branchName: "main" }),
    ).rejects.toThrow();
  });

  it("follows pagination to a branch on a later page", async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce(
        pageResponse(
          [
            {
              id: "b_main",
              gitName: "main",
              isDefault: true,
              role: "production",
            },
          ],
          "cursor_1",
        ),
      )
      .mockResolvedValueOnce(
        pageResponse(
          [
            {
              id: "b_feat",
              gitName: "feat/x",
              isDefault: false,
              role: "preview",
            },
          ],
          null,
        ),
      );
    const client = { GET } as unknown as ManagementApiClient;

    const result = await resolveReadBranch(client, {
      projectId: "proj_1",
      branchName: "feat/x",
    });

    expect(result).toEqual({ id: "b_feat", name: "feat/x", kind: "preview" });
    expect(GET).toHaveBeenCalledTimes(2);
    expect(GET).toHaveBeenNthCalledWith(
      1,
      "/v1/projects/{projectId}/branches",
      expect.objectContaining({
        params: { path: { projectId: "proj_1" }, query: { cursor: undefined } },
      }),
    );
    expect(GET).toHaveBeenNthCalledWith(
      2,
      "/v1/projects/{projectId}/branches",
      expect.objectContaining({
        params: {
          path: { projectId: "proj_1" },
          query: { cursor: "cursor_1" },
        },
      }),
    );
  });
});

describe("resolveProductionBranch", () => {
  it("returns the production-role branch even when it is not named production", async () => {
    const client = clientReturning([
      {
        id: "b_master",
        gitName: "master",
        isDefault: true,
        role: "production",
      },
      { id: "b_feat", gitName: "feat/x", isDefault: false, role: "preview" },
    ]);

    const result = await resolveProductionBranch(client, {
      projectId: "proj_1",
    });

    expect(result).toEqual({
      id: "b_master",
      name: "master",
      kind: "production",
    });
  });

  it("returns an explicit branch by name so callers can validate its role", async () => {
    const client = clientReturning([
      {
        id: "b_main",
        gitName: "main",
        isDefault: true,
        role: "production",
      },
      { id: "b_feat", gitName: "feat/x", isDefault: false, role: "preview" },
    ]);

    const result = await resolveProductionBranch(client, {
      projectId: "proj_1",
      branchName: "feat/x",
    });

    expect(result).toEqual({ id: "b_feat", name: "feat/x", kind: "preview" });
  });

  it("returns null when an explicit branch does not exist", async () => {
    const client = clientReturning([
      {
        id: "b_master",
        gitName: "master",
        isDefault: true,
        role: "production",
      },
    ]);

    const result = await resolveProductionBranch(client, {
      projectId: "proj_1",
      branchName: "feat/missing",
    });

    expect(result).toBeNull();
  });

  it("falls back to the default branch when no production-role branch exists", async () => {
    const client = clientReturning([
      {
        id: "b_master",
        gitName: "master",
        isDefault: true,
        role: "preview",
      },
    ]);

    const result = await resolveProductionBranch(client, {
      projectId: "proj_1",
    });

    expect(result).toEqual({
      id: "b_master",
      name: "master",
      kind: "preview",
    });
  });
});
