#!/usr/bin/env node

// Runs prisma/cloud-deploy-action's own CLI test against one `prisma`
// executable. The test passes with zero cases when it gets no executable
// (for example after a rename of PRISMA_CLI_BINS in the action), so this
// also requires the deploy cases to have run and passed.
//
// Usage: node scripts/check-cloud-deploy-action.mjs <action-checkout> <prisma-executable>

import { accessSync, constants, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { run } from "node:test";
import { spec } from "node:test/reporters";
import { pathToFileURL } from "node:url";

const TEST_FILE = "tests/prisma-cli.test.mjs";
const DEPLOY_CASE = /accepts the deploy arguments for (.+)$/;

/**
 * Problems with a finished test run, or none when it counts as a pass.
 *
 * @param {readonly { name: string, outcome: "pass" | "fail" | "skip" }[]} results
 * @returns {string[]}
 */
export function findProblems(results) {
  const problems = results
    .filter((result) => result.outcome === "fail")
    .map((result) => `Failed: ${result.name}`);
  const passedDeployTargets = results
    .filter((result) => result.outcome === "pass")
    .map((result) => DEPLOY_CASE.exec(result.name)?.[1])
    .filter((target) => target !== undefined);
  if (!passedDeployTargets.includes("production")) {
    problems.push("The deploy case for production did not run and pass.");
  }
  if (!passedDeployTargets.some((target) => target !== "production")) {
    problems.push(
      "The deploy case for a named environment did not run and pass.",
    );
  }
  return problems;
}

function isExecutableFile(path) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

async function main() {
  const [actionDir, bin] = process.argv.slice(2);
  if (!(actionDir && bin)) {
    console.error(
      "Usage: node scripts/check-cloud-deploy-action.mjs <action-checkout> <prisma-executable>",
    );
    process.exit(1);
  }
  const testFile = resolve(actionDir, TEST_FILE);
  if (!existsSync(testFile)) {
    console.error(
      `::error::${join(actionDir, TEST_FILE)} does not exist. prisma/cloud-deploy-action must keep its CLI test at this path.`,
    );
    process.exit(1);
  }
  const executable = resolve(bin);
  if (!isExecutableFile(executable)) {
    console.error(
      `::error::The prisma executable ${executable} is missing or not executable.`,
    );
    process.exit(1);
  }

  process.env.PRISMA_CLI_BINS = executable;
  /** @type {{ name: string, outcome: "pass" | "fail" | "skip" }[]} */
  const results = [];
  const stream = run({ files: [testFile], cwd: resolve(actionDir) });
  stream.on("test:pass", ({ name, skip }) => {
    results.push({ name, outcome: skip ? "skip" : "pass" });
  });
  stream.on("test:fail", ({ name }) => {
    results.push({ name, outcome: "fail" });
  });
  for await (const chunk of stream.compose(spec)) {
    process.stdout.write(chunk);
  }

  const problems = findProblems(results);
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`::error::${problem}`);
    }
    console.error(
      `::error::prisma/cloud-deploy-action's test did not pass against ${executable}.`,
    );
    process.exit(1);
  }
  console.log(
    `prisma/cloud-deploy-action's test passes against ${executable}.`,
  );
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) await main();
