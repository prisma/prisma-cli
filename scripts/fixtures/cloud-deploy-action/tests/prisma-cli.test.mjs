// A small stand-in for prisma/cloud-deploy-action's tests/prisma-cli.test.mjs
// with the same contract: PRISMA_CLI_BINS and the deploy case titles.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const REJECTED_ARGUMENTS = /CLI\.INVALID_ARGUMENTS/;
const bins = (process.env.PRISMA_CLI_BINS ?? "").split(",").filter(Boolean);

for (const bin of bins) {
  const version = spawnSync(bin, ["--version"], {
    encoding: "utf8",
  }).stdout.trim();
  for (const environment of ["", "pr-7"]) {
    test(`prisma ${version} accepts the deploy arguments for ${environment || "production"}`, () => {
      const args = [
        "deploy",
        "module.ts",
        ...(environment ? ["--environment", environment] : []),
      ];
      const { stdout } = spawnSync(bin, args, { encoding: "utf8" });
      assert.doesNotMatch(stdout, REJECTED_ARGUMENTS);
    });
  }
}
