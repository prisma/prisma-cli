import { describe, expect, it } from "vitest";

import { createBranchUseCases } from "../src/use-cases/branch";
import { createUseCaseGateways } from "./use-case-helpers";

describe("branch use cases", () => {
  it("lists all resolved-project branches with role and env map metadata", async () => {
    const { gateways } = await createUseCaseGateways({
      projectId: "proj_123",
    });
    const useCases = createBranchUseCases(gateways);

    await expect(useCases.list()).resolves.toEqual({
      projectId: "proj_123",
      projectName: "Acme Dashboard",
      branches: [
        {
          id: "br_456",
          name: "production",
          role: "production",
          envMap: "production",
        },
        {
          id: "br_234",
          name: "pr-123",
          role: "preview",
          envMap: "preview",
        },
        {
          id: "br_123",
          name: "preview",
          role: "preview",
          envMap: "preview",
        },
        {
          id: "br_345",
          name: "staging",
          role: "preview",
          envMap: "preview",
        },
      ],
    });
  });
});
