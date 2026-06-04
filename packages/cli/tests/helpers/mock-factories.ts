import { vi } from "vitest";

export function createProjectClient(
  projectId = "proj_123",
  options: {
    branchExists?: boolean;
    isDefault?: boolean;
  } = {},
) {
  const branchRecord = (branchName: string) => ({
    id: `branch_${branchName.replace(/[^a-z0-9]+/gi, "_")}`,
    gitName: branchName,
    isDefault: options.isDefault ?? branchName === "main",
    role: "preview",
  });

  return {
    token: "token",
    GET: vi.fn().mockImplementation((pathName: string, request?: { params?: { query?: { gitName?: string } } }) => {
      if (pathName === "/v1/projects") {
        return {
          data: {
            data: [
              {
                id: projectId,
                name: projectId === "proj_456" ? "Billing API" : "Acme Dashboard",
                slug: projectId === "proj_456" ? "billing-api" : "acme-dashboard",
                workspace: {
                  id: "ws_123",
                  name: "Acme Inc",
                },
              },
            ],
          },
        };
      }

      if (pathName === "/v1/projects/{projectId}/branches") {
        const branchName = request?.params?.query?.gitName ?? "main";
        return {
          data: {
            data: options.branchExists === false ? [] : [branchRecord(branchName)],
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    }),
    POST: vi.fn().mockImplementation((pathName: string, request?: { body?: { gitName?: string } }) => {
      if (pathName === "/v1/projects/{projectId}/branches") {
        const branchName = request?.body?.gitName ?? "main";
        return {
          data: {
            data: branchRecord(branchName),
          },
        };
      }

      throw new Error(`Unexpected path ${pathName}`);
    }),
  };
}

export function createResolveBranch(role: "preview" | "production" = "preview") {
  return vi.fn().mockImplementation((_projectId: string, options: { branchName: string }) => Promise.resolve({
    id: `branch_${options.branchName.replace(/[^a-z0-9]+/gi, "_")}`,
    name: options.branchName,
    role,
  }));
}
