#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  participatesInLockstep,
  rewriteWorkspaceDeps,
} from "./set-version-utils.ts";

// Operator ruling 2026-08-10: `@prisma/compute` versions independently
// pending extraction to another repo; the lockstep set is the root plus
// the CLI packages. Its manifest and publish workflow stay untouched.
const LOCKSTEP_EXCLUDED = new Set(["@prisma/compute"]);

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const version = process.argv[2];

if (!version) {
  const script = path.relative(process.cwd(), process.argv[1]);
  console.error(`Usage: node ${script} <version>`);
  console.error(`Example: node ${script} 8.0.0-rc.2`);
  process.exit(1);
}

interface PnpmPackage {
  name: string;
  version: string;
  path: string;
  private: boolean;
}

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  [key: string]: unknown;
}

const output = execSync("pnpm list -r --json", {
  cwd: rootDir,
  encoding: "utf-8",
});

const workspacePackages: PnpmPackage[] = JSON.parse(output);

let updatedCount = 0;

// Every workspace package — publishable, private, and the workspace
// root — gets the same version (excluding LOCKSTEP_EXCLUDED, above).
// Lockstep is the invariant that lets a single read of the root
// `package.json` answer "what version are we shipping right now?"; if
// private packages drifted, that invariant would be silently violated
// by direct invocations of this script.
for (const pkg of workspacePackages) {
  if (LOCKSTEP_EXCLUDED.has(pkg.name)) {
    console.log(`Skipped ${pkg.name} (excluded from lockstep)`);
    continue;
  }
  const packageJsonPath = path.join(pkg.path, "package.json");
  const content = await fs.readFile(packageJsonPath, "utf-8");
  const packageJson: PackageJson = JSON.parse(content);

  packageJson.version = version;
  rewriteWorkspaceDeps(packageJson, version);
  await fs.writeFile(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );

  console.log(`Updated ${pkg.name} to ${version}`);
  updatedCount++;
}

// Project-boundary manifests (tracked package.json files that are not
// workspace members but carry `workspace:` pins) version in lockstep
// too. Without this sweep they go stale on every bump and fail at
// install once the old version leaves the registry.
const memberPaths = new Set(
  workspacePackages.map((pkg) => path.join(pkg.path, "package.json")),
);
const trackedManifests = execSync("git ls-files -- '*package.json'", {
  cwd: rootDir,
  encoding: "utf-8",
})
  .split("\n")
  .filter(Boolean)
  .map((rel) => path.join(rootDir, rel))
  .filter((abs) => !memberPaths.has(abs));

for (const manifestPath of trackedManifests) {
  const packageJson: PackageJson = JSON.parse(
    await fs.readFile(manifestPath, "utf-8"),
  );
  if (!participatesInLockstep(packageJson)) continue;
  packageJson.version = version;
  rewriteWorkspaceDeps(packageJson, version);
  await fs.writeFile(manifestPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  console.log(
    `Updated ${path.relative(rootDir, manifestPath)} (project-boundary manifest) to ${version}`,
  );
  updatedCount++;
}

console.log(`\nDone! Updated ${updatedCount} packages.`);
