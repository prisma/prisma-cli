import { CliStructuredError } from "@prisma/cli-engine/protocol";
import type { ManagementApiClient } from "@prisma/management-api-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createManagementDatabaseProvider,
  SUBSCRIPTION_LOOKUP_TIMEOUT_MS,
} from "../src/lib/database/provider";

const workspaceId = "ws_synthetic";
const upgradeUrl =
  "https://console.prisma.io/synthetic-workspace/settings/plans";

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function planLimitResponse(status = 400) {
  return {
    error: {
      error: {
        code: "planLimitReached",
        message: "Synthetic backend message that must not be rendered.",
      },
    },
    response: new Response(null, { status }),
  };
}

function subscriptionResponse() {
  return {
    data: {
      data: {
        planName: "Free",
        usageBlocked: true,
        upgradeUrl,
      },
    },
    response: new Response(null, { status: 200 }),
  };
}

describe("database plan-limit classification", () => {
  it("uses the discriminator rather than status-specific database translations", async () => {
    const client = {
      GET: vi
        .fn()
        .mockResolvedValueOnce(planLimitResponse(404))
        .mockResolvedValueOnce(subscriptionResponse()),
    };
    const provider = createManagementDatabaseProvider(
      client as unknown as ManagementApiClient,
      { workspaceId },
    );

    const error = await provider
      .showDatabase("db_synthetic")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CliStructuredError);
    expect((error as CliStructuredError).code).toBe(
      "POSTGRES.PLAN_LIMIT_REACHED",
    );
    expect(client.GET).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["backup 422", "backup", 422],
    ["restore 409", "restore", 409],
    ["restore 404", "restore", 404],
  ])("keeps the discriminator authoritative for %s", async (_name, operation, status) => {
    const client = {
      GET: vi
        .fn()
        .mockImplementation((path: string) =>
          Promise.resolve(
            path === "/v1/workspaces/{id}/subscription"
              ? subscriptionResponse()
              : planLimitResponse(status),
          ),
        ),
      POST: vi.fn().mockResolvedValue(planLimitResponse(status)),
    };
    const provider = createManagementDatabaseProvider(
      client as unknown as ManagementApiClient,
      { workspaceId },
    );

    const error = await (operation === "backup"
      ? provider.listBackups("db_synthetic")
      : provider.restoreDatabase({
          targetDatabaseId: "db_target",
          sourceDatabaseId: "db_source",
          backupId: "backup_synthetic",
          projectId: "project_synthetic",
        })
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CliStructuredError);
    expect((error as CliStructuredError).code).toBe(
      "POSTGRES.PLAN_LIMIT_REACHED",
    );
    expect(client.GET).toHaveBeenCalledWith(
      "/v1/workspaces/{id}/subscription",
      expect.anything(),
    );
  });

  // Every non-plan-limit API failure now carries the one registered code.
  // What stays specific to the response is `meta.apiCode`.
  it.each([
    ["503", undefined, 503],
    ["429", "rateLimitReached", 429],
    ["auth", "AUTH_REQUIRED", 401],
    ["spend limit", "spendLimitReached", 400],
    ["generic API error", "DATABASE_API_ERROR", 400],
  ])("does not classify a %s response as a plan limit", async (_name, code, status) => {
    const client = {
      GET: vi.fn().mockResolvedValue({
        error: {
          error: {
            ...(code ? { code } : {}),
            message: "Generic synthetic failure.",
          },
          usageBlocked: true,
        },
        response: new Response(null, { status }),
      }),
    };
    const provider = createManagementDatabaseProvider(
      client as unknown as ManagementApiClient,
      { workspaceId },
    );

    const error = await provider
      .showDatabase("db_synthetic")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CliStructuredError);
    expect(error).toMatchObject({
      code: "POSTGRES.API_ERROR",
      meta: { status, ...(code ? { apiCode: code } : {}) },
    });
    expect(client.GET).toHaveBeenCalledTimes(1);
  });

  it("offers a sign-in for a rejected request instead of minting an auth code", async () => {
    const client = {
      GET: vi.fn().mockResolvedValue({
        error: { error: { code: "AUTH_REQUIRED" } },
        response: new Response(null, { status: 403 }),
      }),
    };
    const provider = createManagementDatabaseProvider(
      client as unknown as ManagementApiClient,
      { workspaceId },
    );

    const error = await provider
      .showDatabase("db_synthetic")
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "POSTGRES.API_ERROR",
      why: "The Management API rejected the request as forbidden.",
      meta: { status: 403, apiCode: "AUTH_REQUIRED" },
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Sign in again with prisma auth login, then retry the command.",
        },
        {
          kind: "run-command",
          label: "prisma auth login",
          command: "prisma auth login",
        },
      ],
    });
  });

  it("leaves a network timeout outside plan-limit classification", async () => {
    const timeout = new Error("Synthetic timeout");
    const client = { GET: vi.fn().mockRejectedValue(timeout) };
    const provider = createManagementDatabaseProvider(
      client as unknown as ManagementApiClient,
      { workspaceId },
    );

    await expect(provider.showDatabase("db_synthetic")).rejects.toBe(timeout);
    expect(client.GET).toHaveBeenCalledTimes(1);
  });

  it("falls back when subscription enrichment stalls", async () => {
    vi.useFakeTimers();
    const client = {
      GET: vi
        .fn()
        .mockResolvedValueOnce(planLimitResponse())
        .mockImplementationOnce(
          (_path: string, options: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              options.signal.addEventListener(
                "abort",
                () => reject(options.signal.reason),
                { once: true },
              );
            }),
        ),
    };
    const provider = createManagementDatabaseProvider(
      client as unknown as ManagementApiClient,
      { workspaceId },
    );

    const errorPromise = provider
      .showDatabase("db_synthetic")
      .catch((caught: unknown) => caught);
    await vi.waitFor(() => expect(client.GET).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(SUBSCRIPTION_LOOKUP_TIMEOUT_MS);
    const error = await errorPromise;

    expect(error).toBeInstanceOf(CliStructuredError);
    expect(error).toMatchObject({
      code: "POSTGRES.PLAN_LIMIT_REACHED",
      meta: {
        workspaceId,
        planName: null,
        usageBlocked: null,
        upgradeUrl: null,
      },
    });
    expect(client.GET).toHaveBeenCalledTimes(2);
  });
});
