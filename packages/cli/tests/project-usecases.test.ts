import { describe, expect, it } from "vitest";

import { createProjectUseCases } from "../src/use-cases/project";
import { createUseCaseGateways } from "./use-case-helpers";

describe("project use cases", () => {
  it("lists sorted projects for the authenticated workspace", async () => {
    const { gateways } = await createUseCaseGateways({
      linkedProjectId: "proj_123",
    });
    const useCases = createProjectUseCases(gateways);

    await expect(
      useCases.list({
        authenticated: true,
        provider: "github",
        user: {
          email: "bob@example.com",
        },
        workspace: {
          id: "ws_123",
          name: "Acme Inc",
        },
        linkedProjectId: "proj_123",
      }),
    ).resolves.toEqual({
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      linkedProjectId: "proj_123",
      projects: [
        {
          id: "proj_123",
          name: "Acme Dashboard",
        },
        {
          id: "proj_456",
          name: "Billing API",
        },
      ],
    });
  });

  it("shows local-only linked state when auth is missing", async () => {
    const { gateways } = await createUseCaseGateways({
      linkedProjectId: "proj_123",
    });
    const useCases = createProjectUseCases(gateways);

    await expect(
      useCases.show({
        authenticated: false,
        provider: null,
        user: null,
        workspace: null,
        linkedProjectId: "proj_123",
      }),
    ).resolves.toEqual({
      linkedProjectId: "proj_123",
      workspace: null,
      project: null,
    });
  });

  it("links a project and returns the enriched linked result", async () => {
    const { gateways, readState } = await createUseCaseGateways();
    const useCases = createProjectUseCases(gateways);

    await expect(
      useCases.link(
        {
          authenticated: true,
          provider: "github",
          user: {
            email: "bob@example.com",
          },
          workspace: {
            id: "ws_123",
            name: "Acme Inc",
          },
          linkedProjectId: null,
        },
        "proj_456",
      ),
    ).resolves.toEqual({
      linkedProjectId: "proj_456",
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      project: {
        id: "proj_456",
        name: "Billing API",
      },
    });

    expect(readState().linkedProjectId).toBe("proj_456");
  });
});
