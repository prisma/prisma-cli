import { describe, expect, it } from "vitest";

import { createAuthUseCases } from "../src/use-cases/auth";
import { createUseCaseGateways } from "./use-case-helpers";

describe("auth use cases", () => {
  it("returns the signed-out empty state", async () => {
    const { gateways } = await createUseCaseGateways();
    const useCases = createAuthUseCases(gateways);

    await expect(useCases.whoami()).resolves.toEqual({
      authenticated: false,
      provider: null,
      user: null,
      workspace: null,
      linkedProjectId: null,
    });
  });

  it("persists login selection and returns the signed-in auth state", async () => {
    const { gateways, readState } = await createUseCaseGateways();
    const useCases = createAuthUseCases(gateways);

    await expect(
      useCases.login({
        provider: "github",
        userId: "usr_456",
        workspaceId: "ws_123",
      }),
    ).resolves.toEqual({
      authenticated: true,
      provider: "github",
      user: {
        id: "usr_456",
        name: "Bob Example",
        email: "bob@example.com",
      },
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      linkedProjectId: null,
    });

    expect(readState().authSession).toEqual({
      provider: "github",
      userId: "usr_456",
      workspaceId: "ws_123",
    });
  });

  it("clears the session on logout and preserves linked project context", async () => {
    const { gateways, readState } = await createUseCaseGateways({
      authSession: {
        provider: "github",
        userId: "usr_456",
        workspaceId: "ws_123",
      },
      linkedProjectId: "proj_123",
    });
    const useCases = createAuthUseCases(gateways);

    await expect(useCases.logout()).resolves.toEqual({
      authenticated: false,
      provider: null,
      user: null,
      workspace: null,
      linkedProjectId: "proj_123",
    });

    expect(readState().authSession).toBeNull();
  });
});
