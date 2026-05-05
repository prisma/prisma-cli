import path from "node:path";
import { describe, expect, it } from "vitest";

import { runBranchList, runBranchShow, runBranchUse } from "../src/controllers/branch";
import { createTempCwd, createTestCommandContext } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

describe("branch controller", () => {
  it("returns FEATURE_UNAVAILABLE for branch list in preview mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(runBranchList(context)).rejects.toMatchObject({
      code: "FEATURE_UNAVAILABLE",
      domain: "branch",
      summary: "Branch commands are not available in this preview",
    });
  });

  it("returns FEATURE_UNAVAILABLE for branch show in preview mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(runBranchShow(context)).rejects.toMatchObject({
      code: "FEATURE_UNAVAILABLE",
      domain: "branch",
      summary: "Branch commands are not available in this preview",
    });
  });

  it("returns FEATURE_UNAVAILABLE for branch use in preview mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      env: {
        ...process.env,
        PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
      },
    });

    await expect(runBranchUse(context, "preview")).rejects.toMatchObject({
      code: "FEATURE_UNAVAILABLE",
      domain: "branch",
      summary: "Branch commands are not available in this preview",
    });
  });

  it("returns a structured usage error when branch use cannot prompt and no target is provided", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    await expect(runBranchUse(context, undefined)).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "branch",
      summary: "Branch use requires a target in non-interactive mode",
    });
  });

  it("returns a structured usage error for an invalid branch name", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    await expect(runBranchUse(context, "Preview Space")).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "branch",
      summary: "Branch name must use the documented form",
    });
  });
});
