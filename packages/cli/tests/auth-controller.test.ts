import path from "node:path";
import { describe, expect, it } from "vitest";

import { runAuthLogin } from "../src/controllers/auth";
import { createTempCwd, createTestCommandContext } from "./helpers";

const fixturePath = path.resolve("fixtures/mock-api.json");

describe("auth controller", () => {
  it("returns a structured usage error when login cannot prompt and selectors are missing", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({
      cwd,
      stateDir,
      fixturePath,
      isTTY: false,
    });

    await expect(runAuthLogin(context, {})).rejects.toMatchObject({
      code: "USAGE_ERROR",
      domain: "auth",
      summary: "Login requires explicit selectors in non-interactive mode",
    });
  });
});
