#!/usr/bin/env node

// Points this repo's dependencies on the product CLI packages at what
// their repos last published on a given channel (operator ruling
// 2026-08-17): a non-dev CLI depends on the latest non-dev composer and
// ORM; a dev CLI depends on their latest dev builds.
//
// Two callers, one mechanism:
//   - `--channel release` (the default) runs from
//     `.github/workflows/update-product-versions.yml`, on a
//     repository_dispatch from a product repo's publish workflow, on a
//     daily schedule as the backstop for a missed dispatch, and by hand.
//     Its edits become a pull request, so CI tests the new versions
//     before they ship.
//   - `--channel dev` runs inside `publish.yml`'s dev stamp, alongside
//     the version stamp. Nothing is committed; the build and the
//     conformance checks that follow it in the same run are what stand
//     between a product's dev build and a dev CLI.
//
// Which dist-tag "last published" means is per package and per channel:
// composer releases under `latest`, prisma/prisma's RC line releases go
// to `next`, and both publish dev builds under `dev`. A package absent
// from a manifest is skipped — the table names candidates, not
// requirements.
//
// Exit codes: 0 whether or not anything changed (callers read the
// summary), 1 on any error.

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WATCHED = /** @type {const} */ ([
  { name: "@prisma/composer-cli", release: "latest" },
  // The library, a devDependency here: the startup probe imports it to
  // prove the eager-loading detector works. It must move with the CLI
  // package it ships beside, or the fixture resolves a second copy.
  { name: "@prisma/composer", release: "latest" },
  { name: "@prisma/orm-toolchain", release: "next" },
]);

const MANIFEST_PATHS = [
  "packages/cli/package.json",
  "packages/prisma/package.json",
];

/** Every field whose specifier names an exact published version. */
const FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The dist-tag a package publishes this channel under.
 *
 * @param {{ release: string }} entry
 * @param {"release" | "dev"} channel
 */
export function tagFor(entry, channel) {
  return channel === "dev" ? "dev" : entry.release;
}

/**
 * @param {string} path
 * @param {string} field
 * @param {Record<string, string>} deps
 * @param {ReadonlyMap<string, string | undefined>} published
 */
function updatesForField(path, field, deps, published) {
  const updates = [];
  for (const { name } of WATCHED) {
    const from = deps[name];
    if (from === undefined) continue;
    const to = published.get(name);
    if (to === undefined || to === from) continue;
    updates.push({ path, field, name, from, to });
  }
  return updates;
}

/**
 * The edits that bring every manifest to the registry's versions. Pure;
 * exported for tests.
 *
 * @param {ReadonlyArray<{ path: string; manifest: Record<string, unknown> }>} manifests
 * @param {ReadonlyMap<string, string | undefined>} published name → version at its tag
 * @returns {Array<{ path: string; field: string; name: string; from: string; to: string }>}
 */
export function computeUpdates(manifests, published) {
  const updates = [];
  for (const { path, manifest } of manifests) {
    for (const field of FIELDS) {
      const deps = /** @type {Record<string, string> | undefined} */ (
        manifest[field]
      );
      if (deps === undefined) continue;
      updates.push(...updatesForField(path, field, deps, published));
    }
  }
  return updates;
}

/**
 * @param {ReadonlyArray<{ path: string; manifest: Record<string, unknown> }>} manifests
 * @param {ReadonlyArray<{ path: string; field: string; name: string; to: string }>} updates
 */
export function applyUpdates(manifests, updates) {
  for (const update of updates) {
    const target = manifests.find((entry) => entry.path === update.path);
    if (target === undefined) continue;
    const deps = /** @type {Record<string, string>} */ (
      target.manifest[update.field]
    );
    deps[update.name] = update.to;
  }
}

function publishedVersion(name, tag) {
  try {
    const out = execFileSync("npm", ["view", `${name}@${tag}`, "version"], {
      encoding: "utf-8",
    }).trim();
    return out.length > 0 ? out : undefined;
  } catch {
    // Not published yet (or the tag does not exist) — nothing to move to.
    return undefined;
  }
}

function main() {
  const flag = process.argv.indexOf("--channel");
  const channel = flag === -1 ? "release" : process.argv[flag + 1];
  if (channel !== "release" && channel !== "dev") {
    console.error(`Usage: node ${process.argv[1]} [--channel release|dev]`);
    process.exit(1);
  }

  const manifests = MANIFEST_PATHS.map((path) => ({
    path,
    manifest: JSON.parse(readFileSync(join(rootDir, path), "utf-8")),
  }));
  const published = new Map(
    WATCHED.map((entry) => [
      entry.name,
      publishedVersion(entry.name, tagFor(entry, channel)),
    ]),
  );
  const updates = computeUpdates(manifests, published);
  applyUpdates(manifests, updates);

  for (const { path, name, from, to } of updates) {
    console.log(`${path}: ${name} ${from} -> ${to}`);
  }
  if (updates.length === 0) {
    console.log(`All watched versions already match the ${channel} channel.`);
  }
  for (const path of new Set(updates.map((update) => update.path))) {
    const target = manifests.find((entry) => entry.path === path);
    writeFileSync(
      join(rootDir, path),
      `${JSON.stringify(target.manifest, null, 2)}\n`,
    );
  }

  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    // One line per package, not per manifest: both manifests carry the
    // same pins, so naming each twice makes an unreadable PR title.
    const summary = [
      ...new Set(
        updates.map(({ name, from, to }) => `${name} ${from} -> ${to}`),
      ),
    ].join("; ");
    appendFileSync(
      outputFile,
      `changed<<EOF\n${String(updates.length > 0)}\nEOF\n`,
    );
    appendFileSync(outputFile, `summary<<EOF\n${summary}\nEOF\n`);
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) main();
