import { describe, expect, it } from "vitest";

import { createBranchUseCases } from "../src/use-cases/branch";
import { createUseCaseGateways } from "./use-case-helpers";

describe("branch use cases", () => {
  it("lists all linked-project branches and keeps an active preview without remote state visible", async () => {
    const { gateways } = await createUseCaseGateways({
      linkedProjectId: "proj_123",
      activeBranch: "feat-auth",
    });
    const useCases = createBranchUseCases(gateways);

    await expect(useCases.list()).resolves.toEqual({
      linkedProjectId: "proj_123",
      projectName: "Acme Dashboard",
      activeBranch: "feat-auth",
      branches: [
        {
          id: "br_456",
          name: "production",
          kind: "production",
          active: false,
          remoteState: true,
        },
        {
          id: "feat-auth",
          name: "feat-auth",
          kind: "preview",
          active: true,
          remoteState: false,
        },
        {
          id: "br_234",
          name: "pr-123",
          kind: "preview",
          active: false,
          remoteState: true,
        },
        {
          id: "br_123",
          name: "preview",
          kind: "preview",
          active: false,
          remoteState: true,
        },
        {
          id: "br_345",
          name: "staging",
          kind: "preview",
          active: false,
          remoteState: true,
        },
      ],
    });
  });

  it("shows live deployment details when remote state exists", async () => {
    const { gateways } = await createUseCaseGateways({
      linkedProjectId: "proj_123",
      activeBranch: "preview",
    });
    const useCases = createBranchUseCases(gateways);

    await expect(useCases.show()).resolves.toEqual({
      linkedProjectId: "proj_123",
      projectName: "Acme Dashboard",
      branch: {
        name: "preview",
        kind: "preview",
        active: true,
        remoteState: true,
        liveDeployment: {
          id: "dep_123",
          status: "ready",
          url: "https://preview.acme-dashboard.prisma.app",
        },
      },
    });
  });

  it("updates the active branch without mutating linked project state", async () => {
    const { gateways, readState } = await createUseCaseGateways({
      linkedProjectId: "proj_123",
    });
    const useCases = createBranchUseCases(gateways);

    await expect(useCases.use("production")).resolves.toEqual({
      linkedProjectId: "proj_123",
      projectName: "Acme Dashboard",
      branch: {
        name: "production",
        kind: "production",
        active: true,
        remoteState: true,
        liveDeployment: {
          id: "dep_456",
          status: "ready",
          url: "https://acme-dashboard.prisma.app",
        },
      },
    });

    expect(readState().linkedProjectId).toBe("proj_123");
    expect(readState().activeBranch).toBe("production");
  });
});
