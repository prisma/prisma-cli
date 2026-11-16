#!/usr/bin/env node

// Runs prisma/cloud-deploy-action's own CLI test against one `prisma`
// executable. The test passes with zero cases when it gets no executable
// (for example after a rename of PRISMA_CLI_BINS in the action), so this
// also requires the deploy cases to have run.
//
// Exit codes: 0 the action can drive the executable, 1 it cannot,
// 2 the check could not run.
//
// Usage: node scripts/check-cloud-deploy-action.mjs <action-checkout> <prisma-executable>

import { accessSync, constants, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { run } from "node:test";
import { spec } from "node:test/reporters";
import {
  EXIT_INCOMPATIBLE,
  EXIT_NOT_RUN,
  judgeRun,
} from "./check-cloud-deploy-action-utils.mjs";

const TEST_FILE = "tests/prisma-cli.test.mjs";

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
    process.exit(EXIT_NOT_RUN);
  }
  const testFile = resolve(actionDir, TEST_FILE);
  if (!existsSync(testFile)) {
    console.error(
      `::error::${join(actionDir, TEST_FILE)} does not exist. prisma/cloud-deploy-action must keep its CLI test at this path. The check could not run.`,
    );
    process.exit(EXIT_NOT_RUN);
  }
  const executable = resolve(bin);
  if (!isExecutableFile(executable)) {
    console.error(
      `::error::The prisma executable ${executable} is missing or not executable. The check could not run.`,
    );
    process.exit(EXIT_NOT_RUN);
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

  const { verdict, problems } = judgeRun(results);
  for (const problem of problems) {
    console.error(`::error::${problem}`);
  }
  if (verdict === "not-run") {
    console.error(
      `::error::The check could not run: prisma/cloud-deploy-action's deploy cases did not run against ${executable}.`,
    );
    process.exit(EXIT_NOT_RUN);
  }
  if (verdict === "incompatible") {
    console.error(
      `::error::prisma/cloud-deploy-action cannot drive ${executable}: its test failed.`,
    );
    process.exit(EXIT_INCOMPATIBLE);
  }
  console.log(
    `prisma/cloud-deploy-action's test passes against ${executable}.`,
  );
}

await main();
