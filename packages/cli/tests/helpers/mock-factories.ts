import { vi } from "vitest";

export function createProjectClient(
  projectId = "proj_123",
  options: {
    branchExists?: boolean;
    isDefault?: boolean;
    defaultBranchName?: string;
    extraBranches?: Array<{
      name: string;
      role?: "preview" | "production";
      isDefault?: boolean;
    }>;
  } = {},
) {
  const defaultBranchName = options.defaultBranchName ?? "main";
  const branchRecord = (branchName: string) => {
    const isDefault = options.isDefault ?? branchName === defaultBranchName;
    return {
      id: `branch_${branchName.replace(/[^a-z0-9]+/gi, "_")}`,
      gitName: branchName,
      isDefault,
      // The default (durable) branch is the production branch.
      role: isDefault ? "production" : "preview",
    };
  };
  const extraBranchRecords = (options.extraBranches ?? []).map((branch) => ({
    id: `branch_${branch.name.replace(/[^a-z0-9]+/gi, "_")}`,
    gitName: branch.name,
    isDefault: branch.isDefault ?? false,
    role: branch.role ?? "preview",
  }));

  return {
    token: "token",
    GET: vi
      .fn()
      .mockImplementation(
        (
          pathName: string,
          request?: { params?: { query?: { gitName?: string } } },
        ) => {
          if (pathName === "/v1/projects") {
            return {
              data: {
                data: [
                  {
                    id: projectId,
                    name:
                      projectId === "proj_456"
                        ? "Billing API"
                        : "Acme Dashboard",
                    slug:
                      projectId === "proj_456"
                        ? "billing-api"
                        : "acme-dashboard",
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
            const branchName =
              request?.params?.query?.gitName ?? defaultBranchName;
            return {
              data: {
                data:
                  options.branchExists === false
                    ? []
                    : [branchRecord(branchName), ...extraBranchRecords],
                pagination: { hasMore: false, nextCursor: null },
              },
            };
          }

          throw new Error(`Unexpected path ${pathName}`);
        },
      ),
    POST: vi
      .fn()
      .mockImplementation(
        (pathName: string, request?: { body?: { gitName?: string } }) => {
          if (pathName === "/v1/projects/{projectId}/branches") {
            const branchName = request?.body?.gitName ?? "main";
            return {
              data: {
                data: branchRecord(branchName),
              },
            };
          }

          throw new Error(`Unexpected path ${pathName}`);
        },
      ),
  };
}

export function createResolveBranch(
  role: "preview" | "production" = "preview",
) {
  return vi
    .fn()
    .mockImplementation((_projectId: string, options: { branchName: string }) =>
      Promise.resolve({
        id: `branch_${options.branchName.replace(/[^a-z0-9]+/gi, "_")}`,
        name: options.branchName,
        role,
      }),
    );
}
