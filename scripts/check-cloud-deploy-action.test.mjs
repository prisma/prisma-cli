import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findProblems } from "./check-cloud-deploy-action.mjs";

const production = "prisma 8.0.0 accepts the deploy arguments for production";
const named = "prisma 8.0.0 accepts the deploy arguments for pr-7";
const destroy = "prisma 8.0.0 accepts the destroy arguments";

describe("findProblems", () => {
  it("passes when both deploy cases pass and the destroy case is skipped", () => {
    assert.deepEqual(
      findProblems([
        { name: production, outcome: "pass" },
        { name: named, outcome: "pass" },
        { name: destroy, outcome: "skip" },
      ]),
      [],
    );
  });

  it("fails a run with no cases, as when the action renames PRISMA_CLI_BINS", () => {
    assert.equal(
      findProblems([{ name: "tests/prisma-cli.test.mjs", outcome: "pass" }])
        .length,
      2,
    );
  });

  it("fails when a deploy case is skipped instead of passing", () => {
    assert.deepEqual(
      findProblems([
        { name: production, outcome: "pass" },
        { name: named, outcome: "skip" },
      ]),
      ["The deploy case for a named environment did not run and pass."],
    );
  });

  it("fails on any failed case", () => {
    assert.deepEqual(
      findProblems([
        { name: production, outcome: "pass" },
        { name: named, outcome: "pass" },
        { name: destroy, outcome: "fail" },
      ]),
      [`Failed: ${destroy}`],
    );
  });
});
