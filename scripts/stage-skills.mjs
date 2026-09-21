#!/usr/bin/env node
// Stage the agent skills that belong to a package into that package's
// `skills/` directory, so they travel inside its tarball.
//
// Why in the tarball: an agent skill is only useful if it describes the
// version of the package the reader actually installed. Shipping it beside
// the code makes that true by construction — the skill and the CLI surface it
// documents are the same artifact, updated by the same `pnpm add`. This is
// also what lets a consumer's `prisma skills sync` resolve the skill by
// package name instead of scanning node_modules.
//
// Which skills belong to which package is not configured here: each
// `SKILL.md` already declares its package in `metadata.library` frontmatter
// (the same key `set-version.ts` stamps the version onto), so this script
// reads that and copies the matching trees. One source of truth, no table to
// keep in sync.
//
// Run from the package directory, which is where npm/pnpm run `prepack`:
//
//   node ../../scripts/stage-skills.mjs
//
// `prepack` rather than the build: `pnpm pack` and `pnpm publish` both run
// it, so the staged copy is produced by the very act of making a tarball and
// can never be a stale build artifact restored from a turbo cache.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readSkillFrontmatter } from "./skill-frontmatter.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = process.cwd();

const packageName = JSON.parse(
  readFileSync(join(packageDir, "package.json"), "utf-8"),
).name;
if (typeof packageName !== "string") {
  throw new Error(`No package name in ${join(packageDir, "package.json")}.`);
}

const skillsRoot = join(repoRoot, "skills");
const owned = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => existsSync(join(skillsRoot, entry.name, "SKILL.md")))
  .filter((entry) => {
    const source = readFileSync(
      join(skillsRoot, entry.name, "SKILL.md"),
      "utf-8",
    );
    return readSkillFrontmatter(source).library === packageName;
  })
  .map((entry) => entry.name);

const destinationRoot = join(packageDir, "skills");

// Rebuilt from scratch every run: a skill that stops belonging to this
// package, or is renamed, must not linger in the next tarball.
rmSync(destinationRoot, { recursive: true, force: true });

if (owned.length === 0) {
  process.stderr.write(
    `No skills declare metadata.library: "${packageName}" — nothing staged.\n`,
  );
  process.exit(0);
}

mkdirSync(destinationRoot, { recursive: true });
for (const name of owned) {
  cpSync(join(skillsRoot, name), join(destinationRoot, name), {
    recursive: true,
  });
}

process.stderr.write(
  `Staged ${owned.join(", ")} into ${packageName}'s tarball.\n`,
);
