import path from "node:path";
import { describe, expect, it } from "vitest";

import { runProjectShow } from "../src/controllers/project";
import { createTempCwd, createTestCommandContext } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

describe("project controller", () => {
  it("returns PROJECT_UNRESOLVED when automatic resolution cannot choose a project", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    await context.stateStore.setAuthSession({
      provider: "github",
      userId: "usr_456",
      workspaceId: "ws_123",
    });

    await expect(runProjectShow(context, undefined)).rejects.toMatchObject({
      code: "PROJECT_UNRESOLVED",
      domain: "project",
    });
  });
});
