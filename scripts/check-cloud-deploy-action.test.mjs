import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { judgeRun } from "./check-cloud-deploy-action-utils.mjs";

const production = "prisma 8.0.0 accepts the deploy arguments for production";
const named = "prisma 8.0.0 accepts the deploy arguments for pr-7";
const destroy = "prisma 8.0.0 accepts the destroy arguments";

describe("judgeRun", () => {
  it("passes when both deploy cases pass and the destroy case is skipped", () => {
    assert.deepEqual(
      judgeRun([
        { name: production, outcome: "pass" },
        { name: named, outcome: "pass" },
        { name: destroy, outcome: "skip" },
      ]),
      { verdict: "pass", problems: [] },
    );
  });

  it("reports a run with no cases as not run, as when the action renames PRISMA_CLI_BINS", () => {
    const { verdict, problems } = judgeRun([
      { name: "tests/prisma-cli.test.mjs", outcome: "pass" },
    ]);
    assert.equal(verdict, "not-run");
    assert.equal(problems.length, 2);
    assert.ok(
      problems[0].includes("accepts the deploy arguments for production"),
    );
    assert.ok(problems[0].includes("test titles may have changed"));
  });

  it("reports a skipped deploy case as not run", () => {
    const { verdict, problems } = judgeRun([
      { name: production, outcome: "pass" },
      { name: named, outcome: "skip" },
    ]);
    assert.equal(verdict, "not-run");
    assert.ok(problems[0].includes("<environment>"));
  });

  it("reports a failed deploy case as incompatible", () => {
    assert.deepEqual(
      judgeRun([
        { name: production, outcome: "fail" },
        { name: named, outcome: "pass" },
      ]),
      { verdict: "incompatible", problems: [`Failed: ${production}`] },
    );
  });

  it("reports any other failed case as incompatible", () => {
    assert.deepEqual(
      judgeRun([
        { name: production, outcome: "pass" },
        { name: named, outcome: "pass" },
        { name: destroy, outcome: "fail" },
      ]),
      { verdict: "incompatible", problems: [`Failed: ${destroy}`] },
    );
  });
});

describe("check-cloud-deploy-action.mjs", () => {
  const scripts = dirname(fileURLToPath(import.meta.url));
  const actionDir = join(scripts, "fixtures/cloud-deploy-action");
  const rejecting = join(scripts, "fixtures/rejecting-prisma");
  const accepting = join(scripts, "fixtures/accepting-prisma");
  const linkRoot = mkdtempSync(join(tmpdir(), "check-cloud-deploy-action-"));
  after(() => rmSync(linkRoot, { recursive: true, force: true }));

  // Inside `node --test`, run() in the child would otherwise skip its files.
  const { NODE_TEST_CONTEXT: _, ...env } = process.env;

  function check(script, bin) {
    return spawnSync(process.execPath, [script, actionDir, bin], {
      encoding: "utf8",
      env,
    });
  }

  const script = join(scripts, "check-cloud-deploy-action.mjs");

  it("exits 0 for a CLI that accepts the arguments", () => {
    const result = check(script, accepting);
    assert.equal(result.status, 0, result.stderr);
  });

  it("exits 1 for a CLI that rejects the arguments", () => {
    const result = check(script, rejecting);
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stderr.includes("cannot drive"));
  });

  it("exits 2 when the executable is missing", () => {
    const result = check(script, join(scripts, "fixtures/no-such-prisma"));
    assert.equal(result.status, 2, result.stderr);
  });

  it("runs when started through a symbolic link", () => {
    const linked = join(linkRoot, "scripts");
    symlinkSync(scripts, linked);
    const result = check(
      join(linked, "check-cloud-deploy-action.mjs"),
      rejecting,
    );
    assert.equal(result.status, 1, result.stderr);
  });
});
