import type { ManagementApiClient } from "@prisma/management-api-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createManagementDatabaseProvider } from "../src/lib/database/provider";
import { runCommand } from "../src/shell/command-runner";
import { CliError } from "../src/shell/errors";
import { createTestCommandContext } from "./helpers";

const workspaceId = "ws_synthetic";
const upgradeUrl =
  "https://console.prisma.io/synthetic-workspace/settings/plans";

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
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

function partialSubscriptionResponse() {
  return {
    data: {
      data: {
        planName: "Free",
        usageBlocked: true,
      },
    },
    response: new Response(null, { status: 200 }),
  };
}

function createClient(options?: {
  subscriptionFails?: boolean;
  partialSubscription?: boolean;
}) {
  return {
    GET: vi.fn().mockImplementation((path: string) => {
      if (path === "/v1/workspaces/{id}/subscription") {
        return Promise.resolve(
          options?.subscriptionFails
            ? {
                error: {
                  error: {
                    code: "subscriptionUnavailable",
                    message: "Synthetic lookup failure.",
                  },
                },
                response: new Response(null, { status: 503 }),
              }
            : options?.partialSubscription
              ? partialSubscriptionResponse()
              : subscriptionResponse(),
        );
      }
      return Promise.resolve(planLimitResponse());
    }),
  };
}

async function runPlanLimitCommand(options?: {
  json?: boolean;
  subscriptionFails?: boolean;
  partialSubscription?: boolean;
  includeWorkspace?: boolean;
}) {
  const argv = [
    "database",
    "show",
    "db_synthetic",
    ...(options?.json ? ["--json"] : []),
  ];
  const { runtime, stdout, stderr } = await createTestCommandContext({ argv });
  const client = createClient({
    subscriptionFails: options?.subscriptionFails,
    partialSubscription: options?.partialSubscription,
  });
  const provider = createManagementDatabaseProvider(
    client as unknown as ManagementApiClient,
    {
      workspaceId:
        options?.includeWorkspace === false ? undefined : workspaceId,
    },
  );

  await runCommand(
    runtime,
    "database.show",
    { json: options?.json ?? false },
    async () => {
      await provider.showDatabase("db_synthetic", { signal: runtime.signal });
      throw new Error("Expected the synthetic operation to fail.");
    },
    { renderHuman: () => [] },
  );

  return { client, stdout: stdout.buffer, stderr: stderr.buffer };
}

describe("database plan-limit recovery", () => {
  it("renders an explicit human diagnosis and canonical upgrade URL on stderr", async () => {
    const { client, stdout, stderr } = await runPlanLimitCommand();

    expect(process.exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain(
      "Workspace plan limit reached [PLAN_LIMIT_REACHED]",
    );
    expect(stderr).toContain(
      "This is a workspace plan limit, not a Prisma outage.",
    );
    expect(stderr).toContain(`Workspace: ${workspaceId}`);
    expect(stderr).toContain("Current plan: Free");
    expect(stderr).toContain(`Upgrade: ${upgradeUrl}`);
    expect(stderr).not.toContain("Synthetic backend message");
    expect(client.GET).toHaveBeenCalledTimes(2);
    expect(client.GET).toHaveBeenLastCalledWith(
      "/v1/workspaces/{id}/subscription",
      expect.objectContaining({
        params: { path: { id: workspaceId } },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("emits one standard JSON failure envelope with recovery metadata", async () => {
    const { stdout, stderr } = await runPlanLimitCommand({ json: true });
    const payload = JSON.parse(stdout);

    expect(process.exitCode).toBe(1);
    expect(stderr).toBe("");
    expect(payload).toMatchObject({
      ok: false,
      command: "database.show",
      error: {
        code: "PLAN_LIMIT_REACHED",
        domain: "database",
        meta: {
          workspaceId,
          blockedFeature: null,
          planName: "Free",
          usageBlocked: true,
          upgradeUrl,
        },
      },
      warnings: [],
      nextSteps: [],
      nextActions: [],
    });
    expect(stdout).not.toContain("Workspace plan limit reached [");
  });

  it("keeps the plan-limit code and null recovery fields when lookup fails", async () => {
    const { stdout, stderr } = await runPlanLimitCommand({
      json: true,
      subscriptionFails: true,
    });
    const payload = JSON.parse(stdout);

    expect(process.exitCode).toBe(1);
    expect(stderr).toBe("");
    expect(payload.error).toMatchObject({
      code: "PLAN_LIMIT_REACHED",
      meta: {
        workspaceId,
        blockedFeature: null,
        planName: null,
        usageBlocked: null,
        upgradeUrl: null,
      },
    });
    expect(payload.error.fix).toBe(
      "Open Prisma Console and upgrade the affected workspace plan.",
    );
    expect(stdout).not.toContain("https://console.prisma.io");
    expect(payload.error.why).toContain("not a Prisma outage");
  });

  it("keeps the human diagnosis and gives safe Console guidance when lookup fails", async () => {
    const { stdout, stderr } = await runPlanLimitCommand({
      subscriptionFails: true,
    });

    expect(process.exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain(
      "Workspace plan limit reached [PLAN_LIMIT_REACHED]",
    );
    expect(stderr).toContain("not a Prisma outage");
    expect(stderr).toContain(
      "Upgrade: Open Prisma Console and upgrade the affected workspace plan.",
    );
    expect(stderr).not.toContain("https://console.prisma.io");
  });

  it("falls back safely when successful subscription metadata is partial", async () => {
    const human = await runPlanLimitCommand({ partialSubscription: true });

    expect(human.stderr).toContain("Current plan: Free");
    expect(human.stderr).toContain(
      "Upgrade: Open Prisma Console and upgrade the affected workspace plan.",
    );
    expect(human.stderr).not.toContain("undefined");

    const json = await runPlanLimitCommand({
      json: true,
      partialSubscription: true,
    });
    const payload = JSON.parse(json.stdout);

    expect(payload.error.fix).toBe(
      "Open Prisma Console and upgrade the affected workspace plan.",
    );
    expect(payload.error.meta).toMatchObject({
      planName: "Free",
      usageBlocked: true,
      upgradeUrl: null,
    });
  });

  it("uses null metadata and skips lookup when workspace context is unavailable", async () => {
    const { client, stdout } = await runPlanLimitCommand({
      json: true,
      includeWorkspace: false,
    });
    const payload = JSON.parse(stdout);

    expect(payload.error.meta).toEqual({
      workspaceId: null,
      blockedFeature: null,
      planName: null,
      usageBlocked: null,
      upgradeUrl: null,
    });
    expect(client.GET).toHaveBeenCalledTimes(1);
  });

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

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe("PLAN_LIMIT_REACHED");
    expect(client.GET).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["503", undefined, 503, "DATABASE_API_ERROR"],
    ["429", "rateLimitReached", 429, undefined],
    ["auth", "AUTH_REQUIRED", 401, "AUTH_REQUIRED"],
    ["spend limit", "spendLimitReached", 400, undefined],
    ["generic API error", "DATABASE_API_ERROR", 400, "DATABASE_API_ERROR"],
  ])("does not classify a %s response as a plan limit", async (_name, code, status, expectedStableCode) => {
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

    expect(error).toBeInstanceOf(CliError);
    if (expectedStableCode) {
      expect((error as CliError).code).toBe(expectedStableCode);
    }
    expect((error as CliError).code).not.toBe("PLAN_LIMIT_REACHED");
    expect(client.GET).toHaveBeenCalledTimes(1);
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

  it("preserves cancellation during subscription enrichment", async () => {
    const controller = new AbortController();
    const client = {
      GET: vi
        .fn()
        .mockResolvedValueOnce(planLimitResponse())
        .mockImplementationOnce(async () => {
          controller.abort();
          return subscriptionResponse();
        }),
    };
    const provider = createManagementDatabaseProvider(
      client as unknown as ManagementApiClient,
      { workspaceId },
    );

    await expect(
      provider.showDatabase("db_synthetic", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(client.GET).toHaveBeenCalledTimes(2);
  });
});
