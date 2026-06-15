import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PreviewAppProvider,
  PreviewAppRecord,
  PreviewDeploymentRecord,
} from "../src/lib/app/preview-provider";
import { confirmPrompt } from "../src/shell/prompt";
import { createTempCwd, createTestCommandContext } from "./helpers";

vi.mock("../src/shell/prompt", async () => {
  const actual = await vi.importActual<typeof import("../src/shell/prompt")>(
    "../src/shell/prompt",
  );
  return {
    ...actual,
    confirmPrompt: vi.fn(),
  };
});

const mockedConfirmPrompt = vi.mocked(confirmPrompt);

describe("production deploy gate", () => {
  afterEach(() => {
    mockedConfirmPrompt.mockReset();
  });

  it("does not gate preview branch deploys", async () => {
    const { context, stderr } = await createGateContext();
    const provider = createGateProvider();

    const { enforceProductionDeployGate } = await import(
      "../src/lib/app/production-deploy-gate"
    );
    await enforceProductionDeployGate(context, provider, {
      appId: "app_1",
      appName: "hello-world",
      branchKind: "preview",
      prod: false,
    });

    expect(provider.listDeployments).not.toHaveBeenCalled();
    expect(stderr.buffer).toBe("");
  });

  it("auto-promotes the first production deploy without --prod", async () => {
    const { context, stderr } = await createGateContext();
    const app = createApp({ liveDeploymentId: null });
    const provider = createGateProvider(app, []);

    const { enforceProductionDeployGate } = await import(
      "../src/lib/app/production-deploy-gate"
    );
    await enforceProductionDeployGate(context, provider, {
      appId: app.id,
      appName: app.name,
      branchKind: "production",
      prod: false,
    });

    expect(provider.listDeployments).toHaveBeenCalledWith("app_1");
    expect(stderr.buffer).toContain(
      'First deploy of "hello-world" -- promoting to production.',
    );
  });

  it("blocks a subsequent production deploy without --prod", async () => {
    const { context } = await createGateContext();
    const provider = createGateProvider(createApp(), [createDeployment()]);

    const { enforceProductionDeployGate } = await import(
      "../src/lib/app/production-deploy-gate"
    );
    await expect(
      enforceProductionDeployGate(context, provider, {
        appId: "app_1",
        appName: "hello-world",
        branchKind: "production",
        prod: false,
      }),
    ).rejects.toMatchObject({
      code: "PROD_DEPLOY_REQUIRES_FLAG",
      exitCode: 2,
      humanLines: [
        "This would deploy to production.",
        "",
        "Production deploys require explicit intent. Re-run with:",
        "",
        "  prisma-cli app deploy --prod",
        "",
        "Or deploy a preview from a feature branch:",
        "",
        "  git checkout -b <branch-name>",
        "  prisma-cli app deploy",
      ],
    });
  });

  it("asks for confirmation on a subsequent production deploy with --prod", async () => {
    mockedConfirmPrompt.mockResolvedValueOnce(true);
    const { context, stderr } = await createGateContext({ isTTY: true });
    const provider = createGateProvider(createApp(), [createDeployment()]);

    const { enforceProductionDeployGate } = await import(
      "../src/lib/app/production-deploy-gate"
    );
    await enforceProductionDeployGate(context, provider, {
      appId: "app_1",
      appName: "hello-world",
      branchKind: "production",
      prod: true,
    });

    expect(stderr.buffer).toContain(
      "This will deploy to production and replace the live deployment.",
    );
    expect(stderr.buffer).toContain("Current live:  dep_live deployed");
    expect(mockedConfirmPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Deploy to production?",
        initialValue: false,
      }),
    );
  });

  it("allows --prod --yes without prompting", async () => {
    const { context, stderr } = await createGateContext({
      flags: { yes: true },
    });
    const provider = createGateProvider(createApp(), [createDeployment()]);

    const { enforceProductionDeployGate } = await import(
      "../src/lib/app/production-deploy-gate"
    );
    await enforceProductionDeployGate(context, provider, {
      appId: "app_1",
      appName: "hello-world",
      branchKind: "production",
      prod: true,
    });

    expect(mockedConfirmPrompt).not.toHaveBeenCalled();
    expect(stderr.buffer).toContain("Deploying to production (--prod --yes).");
  });

  it("does not let --yes grant production authority without --prod", async () => {
    const { context } = await createGateContext({ flags: { yes: true } });
    const provider = createGateProvider(createApp(), [createDeployment()]);

    const { enforceProductionDeployGate } = await import(
      "../src/lib/app/production-deploy-gate"
    );
    await expect(
      enforceProductionDeployGate(context, provider, {
        appId: "app_1",
        appName: "hello-world",
        branchKind: "production",
        prod: false,
      }),
    ).rejects.toMatchObject({
      code: "PROD_DEPLOY_REQUIRES_FLAG",
      exitCode: 2,
    });
    expect(mockedConfirmPrompt).not.toHaveBeenCalled();
  });
});

async function createGateContext(
  options: Parameters<typeof createTestCommandContext>[0] = {},
) {
  const cwd = options.cwd ?? (await createTempCwd());
  return createTestCommandContext({
    ...options,
    cwd,
    stateDir: options.stateDir ?? path.join(cwd, ".state"),
  });
}

function createGateProvider(
  app = createApp(),
  deployments: PreviewDeploymentRecord[] = [createDeployment()],
): Pick<PreviewAppProvider, "listDeployments"> {
  return {
    listDeployments: vi.fn().mockResolvedValue({
      app,
      deployments,
    }),
  };
}

function createApp(
  overrides: Partial<PreviewAppRecord> = {},
): PreviewAppRecord {
  return {
    id: "app_1",
    name: "hello-world",
    region: "eu-west-3",
    branchId: "branch_main",
    liveDeploymentId: "dep_live",
    liveUrl: "https://hello-world.prisma.app",
    ...overrides,
  };
}

function createDeployment(
  overrides: Partial<PreviewDeploymentRecord> = {},
): PreviewDeploymentRecord {
  return {
    id: "dep_live",
    status: "running",
    createdAt: "2026-05-29T05:00:00.000Z",
    url: "https://hello-world.prisma.app",
    live: true,
    ...overrides,
  };
}
