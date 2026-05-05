import path from "node:path";
import { describe, expect, it } from "vitest";

import { runProjectLink } from "../src/controllers/project";
import { createTempCwd, createTestCommandContext } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

describe("project controller", () => {
  it("returns a structured usage error when project link cannot prompt and no target is provided", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    await expect(runProjectLink(context, undefined)).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "project",
      summary: "Project link requires a project target in non-interactive mode",
    });
  });
});
