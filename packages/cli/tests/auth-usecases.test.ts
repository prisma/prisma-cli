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
      credential: null,
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
        email: "bob@example.com",
        name: "Bob Example",
      },
      workspace: {
        id: "ws_123",
        name: "Acme Inc",
      },
      credential: {
        type: "oauth",
        id: null,
        name: null,
      },
    });

    expect(readState().authSession).toEqual({
      provider: "github",
      userId: "usr_456",
      workspaceId: "ws_123",
    });
  });

  it("switches workspace by name case-insensitively", async () => {
    const { gateways, readState } = await createUseCaseGateways({
      authSession: {
        provider: "github",
        userId: "usr_123",
        workspaceId: "ws_123",
      },
    });
    const useCases = createAuthUseCases(gateways);

    await expect(useCases.useWorkspace("prisma labs")).resolves.toMatchObject({
      workspace: {
        id: "ws_456",
        name: "Prisma Labs",
      },
    });

    expect(readState().authSession?.workspaceId).toBe("ws_456");
  });

  it("clears the session on logout", async () => {
    const { gateways, readState } = await createUseCaseGateways({
      authSession: {
        provider: "github",
        userId: "usr_456",
        workspaceId: "ws_123",
      },
    });
    const useCases = createAuthUseCases(gateways);

    await expect(useCases.logout()).resolves.toEqual({
      authenticated: false,
      provider: null,
      user: null,
      workspace: null,
      credential: null,
    });

    expect(readState().authSession).toBeNull();
  });
});
