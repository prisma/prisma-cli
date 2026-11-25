// biome-ignore-all lint/performance/noAwaitInLoops: one skill tree is written at a time; an interrupted copy can leave one partial tree, which reads as absent (no SKILL.md yet) and is repaired by the next sync.
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { AGENT_SKILL_DIRS } from "./allowlist";
import type { InstalledSourcePackage, SkillsStatus } from "./status";

export interface SyncedSkill {
  readonly skill: string;
  readonly library: string;
  readonly version: string;
  /** Harness directories written, relative to the project root. */
  readonly dirs: readonly string[];
}

export interface PrunedSkill {
  readonly skill: string;
  readonly library: string | null;
  readonly dirs: readonly string[];
}

/** A target directory sync would have written, except it holds a
 *  SKILL.md this CLI does not manage — unstamped, unreadable, or
 *  stamped by a package outside the allowlist. */
export interface RefusedSkill {
  readonly skill: string;
  readonly dirs: readonly string[];
}

export interface SyncOutcome {
  readonly projectRoot: string;
  readonly packages: readonly InstalledSourcePackage[];
  /** Every skill name the installed packages ship, whether or not this
   *  run wrote it. Empty while packages are installed means those
   *  versions ship no skills. */
  readonly skills: readonly string[];
  readonly synced: readonly SyncedSkill[];
  readonly pruned: readonly PrunedSkill[];
  readonly refused: readonly RefusedSkill[];
  readonly checkDisabled: boolean;
}

/**
 * Brings the harness skill directories in line with the installed
 * source packages and the configured agents: copies each skill tree
 * whose stamp does not match the package it came from, and removes
 * copies whose source package is gone or whose agent the config no
 * longer names. A target directory that exists but is not this CLI's
 * copy is refused, never replaced. Doing nothing is the normal outcome
 * and is not an error.
 */
export async function syncSkills(status: SkillsStatus): Promise<SyncOutcome> {
  const synced: SyncedSkill[] = [];
  const refused: RefusedSkill[] = [];
  for (const skill of status.skills) {
    const dirs = skill.targets
      .filter((target) => target.state === "stale" || target.state === "absent")
      .map((target) => target.dir);
    const refusedDirs = skill.targets
      .filter((target) => target.state === "unmanaged")
      .map((target) => target.dir);
    if (refusedDirs.length > 0) {
      refused.push({ skill: skill.skill, dirs: refusedDirs });
    }
    // Older CLI versions wrote a `*` .gitignore into their copies; a
    // copy that is already current never gets rewritten, so the stray
    // file is removed here. Only the exact file the old CLI wrote is
    // removed — one the user authored stays.
    for (const target of skill.targets) {
      if (target.state === "synced") {
        await removeOldCliGitignore(
          path.join(status.projectRoot, target.dir, skill.skill, ".gitignore"),
        );
      }
    }
    const written = await writeCopies(
      status.projectRoot,
      skill.sourceDir,
      skill.skill,
      dirs,
    );
    if (written.length === 0) {
      continue;
    }
    synced.push({
      skill: skill.skill,
      library: skill.library,
      version: skill.version,
      dirs: written,
    });
  }

  const pruned = await pruneOrphans(status);

  return {
    projectRoot: status.projectRoot,
    packages: status.packages,
    skills: status.skills.map((skill) => skill.skill),
    synced,
    pruned,
    refused,
    checkDisabled: status.checkDisabled,
  };
}

async function pruneOrphans(status: SkillsStatus): Promise<PrunedSkill[]> {
  if (status.orphans.length === 0) {
    return [];
  }
  const linkTargets = await harnessLinkTargets(status.projectRoot);
  const pruned: PrunedSkill[] = [];
  for (const orphan of status.orphans) {
    for (const dir of orphan.dirs) {
      await rm(path.join(status.projectRoot, dir, orphan.skill), {
        recursive: true,
        force: true,
      });
      await removeEmptyHarnessDirs(status.projectRoot, dir, linkTargets);
    }
    pruned.push({
      skill: orphan.skill,
      library: orphan.library,
      dirs: orphan.dirs,
    });
  }
  return pruned;
}

/**
 * A harness directory this CLI emptied by removing its last copy is
 * removed too, and so is its parent (`.claude/skills`, then `.claude`),
 * so opting an agent out leaves nothing behind. `rmdir` refuses a
 * directory holding anything else, which is exactly the user's file
 * that must stay. A directory a harness path links to stays too, so
 * the link is not left dangling.
 */
async function removeEmptyHarnessDirs(
  projectRoot: string,
  dir: string,
  linkTargets: ReadonlySet<string>,
): Promise<void> {
  for (
    let current = dir;
    current !== "." && current !== "";
    current = path.dirname(current)
  ) {
    const target = path.join(projectRoot, current);
    try {
      if (linkTargets.has(await realpath(target))) {
        return;
      }
      await rmdir(target);
    } catch {
      return;
    }
  }
}

/** The real directories that a symbolic link at any agent's harness
 *  directory, or at one of its parents, points to. */
async function harnessLinkTargets(projectRoot: string): Promise<Set<string>> {
  const targets = new Set<string>();
  for (const dir of Object.values(AGENT_SKILL_DIRS)) {
    for (
      let current: string = dir;
      current !== "." && current !== "";
      current = path.dirname(current)
    ) {
      const candidate = path.join(projectRoot, current);
      try {
        if ((await lstat(candidate)).isSymbolicLink()) {
          targets.add(await realpath(candidate));
        }
      } catch {
        // A missing or dangling path protects nothing.
      }
    }
  }
  return targets;
}

const OLD_CLI_GITIGNORE = /^\*\r?\n?$/;

async function removeOldCliGitignore(file: string): Promise<void> {
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch {
    return;
  }
  if (OLD_CLI_GITIGNORE.test(content)) {
    await rm(file, { force: true });
  }
}

/**
 * Writes the skill into each harness directory at the real path its
 * copy resolves to, so a symbolic link to a copy stays a link and two
 * paths to one directory are written once. A destination that is,
 * holds, or lies inside the source tree is left alone, because
 * replacing it would delete the source before it is read. Returns the
 * harness directories whose copy is now current.
 */
async function writeCopies(
  projectRoot: string,
  sourceDir: string,
  skill: string,
  dirs: readonly string[],
): Promise<string[]> {
  const source = await resolveExisting(sourceDir);
  const writtenTargets = new Set<string>();
  const written: string[] = [];
  for (const dir of dirs) {
    const target = await resolveExisting(path.join(projectRoot, dir, skill));
    if (isSameOrInside(target, source) || isSameOrInside(source, target)) {
      continue;
    }
    if (!writtenTargets.has(target)) {
      await replaceTree(sourceDir, target);
      writtenTargets.add(target);
    }
    written.push(dir);
  }
  return written;
}

/** `target` with every symbolic link followed, as far as the path
 *  exists on disk. */
async function resolveExisting(target: string): Promise<string> {
  const absolute = path.resolve(target);
  try {
    return await realpath(absolute);
  } catch {
    const parent = path.dirname(absolute);
    if (parent === absolute) {
      return absolute;
    }
    return path.join(await resolveExisting(parent), path.basename(absolute));
  }
}

function isSameOrInside(target: string, dir: string): boolean {
  const relative = path.relative(dir, target);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

/**
 * Copies a skill tree over whatever is at the destination, so a skill
 * that lost a reference file between versions does not keep the stale
 * one. Files are read and written rather than handed to `fs.cp`,
 * because under Yarn PnP the source lives inside a zip and only the
 * patched read path can see it.
 */
async function replaceTree(source: string, destination: string): Promise<void> {
  await rm(destination, { recursive: true, force: true });
  await copyTree(source, destination);
}

async function copyTree(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to);
      continue;
    }
    if (entry.isFile() || entry.isSymbolicLink()) {
      await writeFile(to, await readFile(from));
    }
  }
}
