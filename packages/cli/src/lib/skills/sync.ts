// biome-ignore-all lint/performance/noAwaitInLoops: one skill tree is written at a time, so an interrupted sync leaves whole trees rather than an interleaving of half-copied ones.
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

export interface SyncOutcome {
  readonly projectRoot: string;
  readonly packages: readonly InstalledSourcePackage[];
  readonly synced: readonly SyncedSkill[];
  readonly pruned: readonly PrunedSkill[];
  readonly checkDisabled: boolean;
}

/**
 * Brings the harness skill directories in line with the installed
 * source packages: copies each skill tree whose stamp does not match
 * the package it came from, and removes copies whose source package is
 * gone. Doing nothing is the normal outcome and is not an error.
 */
export async function syncSkills(status: SkillsStatus): Promise<SyncOutcome> {
  const synced: SyncedSkill[] = [];
  for (const skill of status.skills) {
    const dirs = skill.targets
      .filter((target) => target.state !== "synced")
      .map((target) => target.dir);
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
    synced,
    pruned,
    checkDisabled: status.checkDisabled,
  };
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
