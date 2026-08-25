// biome-ignore-all lint/performance/noAwaitInLoops: one skill tree is written at a time; an interrupted copy can leave one partial tree, which reads as absent (no SKILL.md yet) and is repaired by the next sync.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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
 * source packages: copies each skill tree whose stamp does not match
 * the package it came from, and removes copies whose source package is
 * gone. A target directory that exists but is not this CLI's copy is
 * refused, never replaced. Doing nothing is the normal outcome and is
 * not an error.
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
    if (dirs.length === 0) {
      continue;
    }
    for (const dir of dirs) {
      await replaceTree(
        skill.sourceDir,
        path.join(status.projectRoot, dir, skill.skill),
      );
    }
    synced.push({
      skill: skill.skill,
      library: skill.library,
      version: skill.version,
      dirs,
    });
  }

  const pruned: PrunedSkill[] = [];
  for (const orphan of status.orphans) {
    for (const dir of orphan.dirs) {
      await rm(path.join(status.projectRoot, dir, orphan.skill), {
        recursive: true,
        force: true,
      });
    }
    pruned.push({
      skill: orphan.skill,
      library: orphan.library,
      dirs: orphan.dirs,
    });
  }

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
