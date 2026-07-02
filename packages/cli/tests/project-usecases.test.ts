import { describe, expect, it } from "vitest";

import { createProjectUseCases } from "../src/use-cases/project";
import { createUseCaseGateways } from "./use-case-helpers";

describe("project use cases", () => {
  it("lists sorted projects for the authenticated workspace", async () => {
    const { gateways } = await createUseCaseGateways();
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
        credential: null,
      }),
    ).resolves.toEqual({
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      projects: [
        {
          id: "proj_123",
          name: "Acme Dashboard",
          url: "https://prisma.build/acme/acme-dashboard",
        },
        {
          id: "proj_456",
          name: "Billing API",
          url: "https://prisma.build/acme/billing-api",
        },
        {
          id: "proj_999",
          name: "Sandbox",
          url: "https://prisma.build/acme/sandbox",
        },
      ],
    });
  });
});
