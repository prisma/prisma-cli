import type { ManagementApiClient } from "@prisma/management-api-sdk";
import { describe, expect, it, vi } from "vitest";

import { resolveReadBranch } from "../src/lib/app/read-branch";

type RawBranch = {
  id: string;
  gitName: string;
  isDefault: boolean;
  role: "production" | "preview";
};

function clientReturning(branches: RawBranch[]): ManagementApiClient {
  return {
    GET: vi.fn().mockResolvedValue({
      data: {
        data: branches,
        pagination: { hasMore: false, nextCursor: null },
      },
    }),
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
});
