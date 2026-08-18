#!/usr/bin/env node

// Fails a pull request that changes `packages/cli-engine` while leaving
// its version at one the registry already has. That is how
// `prisma@8.0.0-rc.4` shipped: the CLI was built against engine exports
// that the published `@prisma/cli-engine@0.1.1` does not contain, and
// `npx prisma@next` crashed on import. The registry is immutable, so a
// changed engine must claim a new version (`pnpm bump-cli-engine-version`).
//
// Usage: node scripts/check-engine-version.mjs <base-ref>

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const NPM_NOT_FOUND_PATTERN = /\bE404\b/;

/** Whether a failed `npm view` means the version is absent, as opposed
 * to npm itself failing — no binary, no network, no auth. */
function isNotFoundError(error) {
  if (typeof error !== "object" || error === null) return false;
  const { stderr, stdout } = error;
  return NPM_NOT_FOUND_PATTERN.test(`${stderr ?? ""}\n${stdout ?? ""}`);
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const ENGINE_MANIFEST = "packages/cli-engine/package.json";

/**
 * Whether a manifest change alters what npm publishes. devDependencies
 * never ship in the tarball — the release version sweep rewrites the
 * engine's `@repo/*` devDependencies on every bump, and that must not
 * read as "the engine changed".
 *
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} head
 * @returns {boolean}
 */
export function manifestChangeShips(base, head) {
  const shipped = ({ devDependencies: _dev, ...rest }) => rest;
  return JSON.stringify(shipped(base)) !== JSON.stringify(shipped(head));
}

/**
 * @param {{ changedFiles: readonly string[], engineVersion: string, versionOnRegistry: boolean }} input
 * @returns {string | null} the failure message, or null when the change is fine
 */
export function engineBumpVerdict({
  changedFiles,
  engineVersion,
  versionOnRegistry,
}) {
  const engineChanged = changedFiles.some((file) =>
    file.startsWith("packages/cli-engine/"),
  );
  if (!engineChanged || !versionOnRegistry) return null;
  return (
    `packages/cli-engine changed, but its version (${engineVersion}) is already on the registry, ` +
    "and published versions are immutable. Run `pnpm bump-cli-engine-version <patch|minor>` " +
    "so the changed engine ships under a new version."
  );
}

async function main() {
  const baseSha = process.argv[2];
  if (!baseSha) {
    console.error("Usage: node scripts/check-engine-version.mjs <base-ref>");
    process.exit(1);
  }

  const { stdout: mergeBase } = await execFileAsync(
    "git",
    ["merge-base", baseSha, "HEAD"],
    { cwd: rootDir },
  );
  const { stdout: diff } = await execFileAsync(
    "git",
    ["diff", "--name-only", mergeBase.trim(), "HEAD"],
    { cwd: rootDir },
  );
  let changedFiles = diff.split("\n").filter(Boolean);

  if (changedFiles.includes(ENGINE_MANIFEST)) {
    const { stdout: baseManifest } = await execFileAsync(
      "git",
      ["show", `${mergeBase.trim()}:${ENGINE_MANIFEST}`],
      { cwd: rootDir },
    );
    const headManifest = readFileSync(join(rootDir, ENGINE_MANIFEST), "utf-8");
    if (
      !manifestChangeShips(JSON.parse(baseManifest), JSON.parse(headManifest))
    ) {
      changedFiles = changedFiles.filter((file) => file !== ENGINE_MANIFEST);
    }
  }

  const manifest = JSON.parse(
    readFileSync(join(rootDir, "packages/cli-engine/package.json"), "utf-8"),
  );
  const engineVersion = manifest.version;

  let versionOnRegistry = true;
  try {
    await execFileAsync("npm", [
      "view",
      `@prisma/cli-engine@${engineVersion}`,
      "version",
      "--prefer-online",
    ]);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    versionOnRegistry = false;
  }

  const verdict = engineBumpVerdict({
    changedFiles,
    engineVersion,
    versionOnRegistry,
  });
  if (verdict !== null) {
    console.error(`::error::${verdict}`);
    process.exit(1);
  }
  console.log(
    `Engine version ${engineVersion} is consistent with this change set.`,
  );
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) await main();
