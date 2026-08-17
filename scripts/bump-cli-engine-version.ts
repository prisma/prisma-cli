#!/usr/bin/env node

/**
 * Maintainer-facing engine version bump — the one command an
 * engine-changing PR runs so its version claim ships with it.
 *
 * The engine versions independently of the workspace lockstep (ADR 0004,
 * docs/oss/versioning.md): its version means "the engine changed", and
 * deciding patch-vs-minor is the author's compatibility claim, which is
 * why this is a command and not automation. Everything downstream IS
 * automatic — the next publish run ships the new version, and the dev
 * CLI build in the same run pins it.
 *
 * What one invocation edits, so the bump lands as one consistent commit:
 *   - `packages/cli-engine/package.json` `version`
 *   - `packages/cli/package.json`'s `workspace:<version>` pin on the engine
 *   - `pnpm-lock.yaml`, refreshed to match
 *
 * Reads the current version from HEAD (not disk) so re-running before
 * committing cannot double-advance, mirroring `bump-version.ts`.
 *
 * Usage: pnpm bump-cli-engine-version <patch|minor|X.Y.Z>
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeNextEngineVersion } from "./bump-cli-engine-version-utils.ts";

const ENGINE_PACKAGE = "@prisma/cli-engine";
const ENGINE_MANIFEST = "packages/cli-engine/package.json";
const SHELL_MANIFEST = "packages/cli/package.json";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const request = process.argv[2];
if (!request) {
  const script = process.argv[1];
  console.error(`Usage: node ${script} <patch|minor|X.Y.Z>`);
  console.error("  minor — the pre-1.0 breaking bump (0.1.0 -> 0.2.0)");
  console.error("  patch — the compatible bump       (0.1.0 -> 0.1.1)");
  process.exit(1);
}

function readEngineVersionAtHead(): string {
  const json = execFileSync("git", ["show", `HEAD:${ENGINE_MANIFEST}`], {
    cwd: rootDir,
    encoding: "utf-8",
  });
  const parsed = JSON.parse(json) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(`${ENGINE_MANIFEST} at HEAD has no \`version\` field.`);
  }
  return parsed.version;
}

const currentVersion = readEngineVersionAtHead();
const nextVersion = computeNextEngineVersion(currentVersion, request);

console.log(`Current engine version (HEAD): ${currentVersion}`);
console.log(`Next engine version:           ${nextVersion}`);
console.log("");

const enginePath = join(rootDir, ENGINE_MANIFEST);
const engine = JSON.parse(readFileSync(enginePath, "utf-8")) as {
  version: string;
};
engine.version = nextVersion;
writeFileSync(enginePath, `${JSON.stringify(engine, null, 2)}\n`);
console.log(`Updated ${ENGINE_MANIFEST}`);

const shellPath = join(rootDir, SHELL_MANIFEST);
const shell = JSON.parse(readFileSync(shellPath, "utf-8")) as {
  dependencies?: Record<string, string>;
};
if (shell.dependencies?.[ENGINE_PACKAGE] === undefined) {
  throw new Error(
    `${SHELL_MANIFEST} no longer depends on ${ENGINE_PACKAGE}; this script needs updating.`,
  );
}
shell.dependencies[ENGINE_PACKAGE] = `workspace:${nextVersion}`;
writeFileSync(shellPath, `${JSON.stringify(shell, null, 2)}\n`);
console.log(`Updated ${SHELL_MANIFEST} pin to workspace:${nextVersion}`);

console.log("");
console.log("Refreshing pnpm-lock.yaml to match the rewritten specifiers...");
execFileSync("pnpm", ["install", "--lockfile-only"], {
  cwd: rootDir,
  stdio: "inherit",
});
