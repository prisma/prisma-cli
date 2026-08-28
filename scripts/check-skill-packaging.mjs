#!/usr/bin/env node
// The `prisma-platform-core-concepts` skill must arrive in the `prisma`
// tarball, carrying the version of the tarball it arrived in.
//
// That claim is only worth as much as the artifact that proves it. The
// manifest can list `"skills"` in `files` while `prepack` failed to stage
// anything; the staged copy can be a leftover from an older version; the
// frontmatter stamp can be missing because someone hand-edited the skill.
// None of those show up in a unit test — they show up in what npm uploads.
// So this check packs the package the same way the publish workflow does and
// reads the skill back out of the tarball.
//
// It also compares the packed skill byte-for-byte against the repo-root
// `skills/` tree, which is the tracked source. If those two ever disagree,
// the tarball is serving different instructions than the repo records.
//
// Usage: node scripts/check-skill-packaging.mjs

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readSkillFrontmatter } from "./skill-frontmatter.ts";

const PACKAGE = "prisma";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = join(repoRoot, "packages/prisma");
const skillsRoot = join(repoRoot, "skills");

const failures = [];
function require_(condition, message) {
  if (!condition) failures.push(message);
}

/** Every file under `dir`, as paths relative to it, sorted. */
function filesUnder(dir) {
  return readdirSync(dir, { recursive: true, encoding: "utf-8" })
    .filter((entry) => statSync(join(dir, entry)).isFile())
    .sort();
}

/** The skills the repo-root tree says belong to this package. */
function ownedSkillNames() {
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(join(skillsRoot, entry.name, "SKILL.md")))
    .filter(
      (entry) =>
        readSkillFrontmatter(
          readFileSync(join(skillsRoot, entry.name, "SKILL.md"), "utf-8"),
        ).library === PACKAGE,
    )
    .map((entry) => entry.name);
}

const expected = ownedSkillNames();
require_(
  expected.length > 0,
  `no skill under skills/ declares \`metadata.library: "${PACKAGE}"\` — the frontmatter is what routes a skill into a tarball, so without it nothing ships.`,
);

// pnpm pack, not npm pack: it runs the same `prepack` and rewrites the same
// specifiers a real publish does.
const work = mkdtempSync(join(tmpdir(), "skill-packaging-"));
try {
  execFileSync("pnpm", ["pack", "--pack-destination", work], {
    cwd: packageDir,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const tarball = readdirSync(work).find((f) => f.endsWith(".tgz"));
  if (tarball === undefined)
    throw new Error(`pnpm pack produced no tarball for ${PACKAGE}`);
  execFileSync("tar", ["xzf", tarball], { cwd: work });
  const packedRoot = join(work, "package");

  const packedVersion = JSON.parse(
    readFileSync(join(packedRoot, "package.json"), "utf-8"),
  ).version;

  for (const name of expected) {
    const packedSkillDir = join(packedRoot, "skills", name);
    const packedSkill = join(packedSkillDir, "SKILL.md");
    if (!existsSync(packedSkill)) {
      require_(
        false,
        `the packed tarball has no skills/${name}/SKILL.md — check that "skills" is in the package's \`files\` and that the \`prepack\` script runs scripts/stage-skills.mjs.`,
      );
      continue;
    }

    const { library, libraryVersion } = readSkillFrontmatter(
      readFileSync(packedSkill, "utf-8"),
    );
    require_(
      library === PACKAGE,
      `the packed skills/${name}/SKILL.md declares metadata.library: "${library}", not "${PACKAGE}".`,
    );
    require_(
      libraryVersion === packedVersion,
      `the packed skills/${name}/SKILL.md is stamped metadata.library_version: "${libraryVersion}" but ships in ${PACKAGE}@${packedVersion} — the stamp is what tells a reader which CLI surface the skill describes. Run \`node scripts/set-version.ts ${packedVersion}\`.`,
    );

    // Byte equality with the tracked source: the tarball must serve exactly
    // the instructions the repo records.
    const sourceDir = join(skillsRoot, name);
    const sourceFiles = filesUnder(sourceDir);
    const packedFiles = filesUnder(packedSkillDir);
    require_(
      sourceFiles.join("\n") === packedFiles.join("\n"),
      `the packed skills/${name}/ does not have the same files as ${relative(repoRoot, sourceDir)}/ (packed: ${packedFiles.join(", ")}; source: ${sourceFiles.join(", ")}).`,
    );
    for (const file of sourceFiles.filter((f) => packedFiles.includes(f))) {
      require_(
        readFileSync(join(sourceDir, file), "utf-8") ===
          readFileSync(join(packedSkillDir, file), "utf-8"),
        `the packed skills/${name}/${file} differs from the tracked ${relative(repoRoot, join(sourceDir, file))}.`,
      );
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(
    `\nFAIL — skill packaging check:\n${failures.map((f) => `  - ${f}\n`).join("")}`,
  );
  process.exit(1);
}
process.stderr.write(
  `\nOK — the ${PACKAGE} tarball carries ${expected.join(", ")}, stamped with its version and identical to skills/.\n`,
);
