import type { ManagementApiClient } from "@prisma/management-api-sdk";
import { describe, expect, it, vi } from "vitest";

import { resolveDefaultBranch } from "../src/lib/app/read-branch";

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

describe("resolveDefaultBranch", () => {
  it("returns the default branch even when another branch is named main", async () => {
    const client = clientReturning([
      { id: "b_main", gitName: "main", isDefault: false, role: "preview" },
      { id: "b_trunk", gitName: "trunk", isDefault: true, role: "production" },
    ]);

    const result = await resolveDefaultBranch(client, { projectId: "proj_1" });

    expect(result).toEqual({
      id: "b_trunk",
      name: "trunk",
      kind: "production",
    });
  });

  it("returns null when the project has no branches", async () => {
    const client = clientReturning([]);

    const result = await resolveDefaultBranch(client, { projectId: "proj_1" });

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
      resolveDefaultBranch(client, { projectId: "proj_1" }),
    ).rejects.toThrow();
  });

  it("follows pagination to a default branch on a later page", async () => {
    const GET = vi
      .fn()
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
          "cursor_1",
        ),
      )
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
          null,
        ),
      );
    const client = { GET } as unknown as ManagementApiClient;

    const result = await resolveDefaultBranch(client, { projectId: "proj_1" });

    expect(result).toEqual({ id: "b_main", name: "main", kind: "production" });
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
