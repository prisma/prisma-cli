#!/usr/bin/env node

/**
 * Maintainer-facing release bump.
 *
 * Reads the root `package.json` version *as committed at HEAD*, computes
 * the next release version (`8.0.0-rc.1` → `8.0.0-rc.2`; a pre-8 stable
 * base transitions onto the RC line as `8.0.0-rc.1` — see
 * docs/oss/versioning.md), and writes that value to every lockstep
 * workspace `package.json` via `set-version.ts`.
 *
 * Reading from HEAD (rather than disk) is what makes the script
 * idempotent: re-running it without committing the previous bump
 * would otherwise read the *bumped* root version and double-advance.
 *
 * The lockfile records `workspace:` specifiers, so rewriting them
 * without regenerating it leaves the two disagreeing and any later
 * `pnpm install --frozen-lockfile` fails. This script therefore
 * refreshes the lockfile itself: the version bump is one commit that is
 * internally consistent, which is the whole reason nothing rewrites a
 * manifest outside a commit.
 *
 * The caller (a maintainer, or tooling driving a release PR) is
 * responsible for branch creation, commit, and PR opening — see
 * docs/oss/versioning.md for the procedure.
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCanonicalBase,
  computeNextReleaseVersion,
} from "./determine-version-utils.ts";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function readRootVersionAtHead(): string {
  const json = execFileSync("git", ["show", "HEAD:package.json"], {
    cwd: rootDir,
    encoding: "utf-8",
  });

  const parsed = JSON.parse(json) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(
      "Root package.json at HEAD is missing a `version` field. " +
        "The bump-version script requires a canonical base to start from.",
    );
  }
  return parsed.version;
}

const currentVersion = readRootVersionAtHead();
assertCanonicalBase(currentVersion);

const nextVersion = computeNextReleaseVersion(currentVersion);

console.log(`Current root version (HEAD): ${currentVersion}`);
console.log(`Next release version:        ${nextVersion}`);
console.log("");

const setVersionScript = join(rootDir, "scripts", "set-version.ts");
execFileSync("node", [setVersionScript, nextVersion], {
  cwd: rootDir,
  stdio: "inherit",
});

console.log("");
console.log("Refreshing pnpm-lock.yaml to match the rewritten specifiers...");
execFileSync("pnpm", ["install", "--lockfile-only"], {
  cwd: rootDir,
  stdio: "inherit",
});
