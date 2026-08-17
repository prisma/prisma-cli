#!/usr/bin/env node

// Updates the shell's exact dependencies on the product CLI packages to
// what their repos last published (operator ruling 2026-08-13: family
// publishes flow into this repo automatically and deploy as dev
// versions; only a real CLI release needs a human). Run by
// `.github/workflows/update-product-versions.yml` on a repository_dispatch from a
// product repo's publish workflow, on a daily schedule as the backstop
// for missed dispatches, and by hand via workflow_dispatch.
//
// The script edits `packages/cli/package.json` in place and prints one
// line per changed pin; the workflow turns a non-empty change set into
// an auto-merge pull request. Exit codes: 0 with changes or without
// (the workflow reads the summary file), 1 on any error.
//
// Which dist-tag "last published" means is per package: composer
// releases under `latest`; prisma/prisma's RC-line releases go to
// `next`. A package absent from the shell's dependencies is skipped —
// the list below names candidates, not requirements — so the
// composer → composer-cli hand-over needs no edit here.

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WATCHED = /** @type {const} */ ([
  { name: "@prisma/composer", tag: "latest" },
  { name: "@prisma/composer-cli", tag: "latest" },
  { name: "@prisma/orm-toolchain", tag: "next" },
]);

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(rootDir, "packages", "cli", "package.json");

/**
 * Computes the version-update edits for a manifest given the registry's current
 * versions. Pure; exported for tests.
 *
 * @param {{ dependencies?: Record<string, string> }} manifest
 * @param {ReadonlyMap<string, string | undefined>} published name → version at its watched tag
 * @returns {Array<{ name: string; from: string; to: string }>}
 */
export function computeVersionUpdates(manifest, published) {
  const changes = [];
  const deps = manifest.dependencies ?? {};
  for (const { name } of WATCHED) {
    const current = deps[name];
    if (current === undefined) continue;
    const latest = published.get(name);
    if (latest === undefined || latest === current) continue;
    changes.push({ name, from: current, to: latest });
  }
  return changes;
}

function publishedVersion(name, tag) {
  try {
    const out = execFileSync("npm", ["view", `${name}@${tag}`, "version"], {
      encoding: "utf-8",
    }).trim();
    return out.length > 0 ? out : undefined;
  } catch {
    // Not published yet (or the tag does not exist) — nothing to update to.
    return undefined;
  }
}

function main() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const published = new Map(
    WATCHED.map(({ name, tag }) => [name, publishedVersion(name, tag)]),
  );
  const changes = computeVersionUpdates(manifest, published);

  for (const { name, from, to } of changes) {
    manifest.dependencies[name] = to;
    console.log(`${name}: ${from} -> ${to}`);
  }
  if (changes.length > 0) {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    console.log("All watched pins already match the registry.");
  }

  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const summary = changes
      .map(({ name, from, to }) => `${name} ${from} -> ${to}`)
      .join("; ");
    appendFileSync(
      outputFile,
      `changed<<EOF\n${String(changes.length > 0)}\nEOF\n`,
    );
    appendFileSync(outputFile, `summary<<EOF\n${summary}\nEOF\n`);
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) main();
