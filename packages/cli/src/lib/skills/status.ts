// biome-ignore-all lint/performance/noAwaitInLoops: the allowlist is walked in order — a package resolved from an earlier directory decides what a later one is compared against — and the reads are a handful of stats on small files.
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { compareVersionStrings } from "../semver-order";
import {
  HARNESS_SKILL_DIRS,
  isSkillSourcePackage,
  PACKAGE_SKILLS_DIR,
  SKILL_SOURCE_PACKAGES,
} from "./allowlist";
import { readSkillStamp, type SkillStamp } from "./frontmatter";
import { readSkillsCheckDisabled } from "./opt-out";
import { findProjectRoot, workspaceMemberDirs } from "./project-root";
import { type ResolvedPackage, resolvePackage } from "./resolve";

export interface InstalledSourcePackage {
  readonly name: string;
  readonly version: string;
  readonly dir: string;
  /** Every version this package resolves to across the root and the
   *  workspace members, when the members disagree. */
  readonly conflictingVersions: readonly string[];
}

/** "unmanaged": the directory holds a SKILL.md this CLI did not write —
 *  unstamped, or stamped by a package outside the allowlist. Sync never
 *  touches it. A directory without a SKILL.md reads as "absent" so an
 *  interrupted copy is repaired by the next sync. */
export type SkillTargetState = "synced" | "stale" | "absent" | "unmanaged";

export interface SkillTarget {
  /** Harness directory, relative to the project root. */
  readonly dir: string;
  readonly syncedVersion: string | null;
  readonly state: SkillTargetState;
}

export interface SkillStatus {
  readonly skill: string;
  readonly library: string;
  readonly version: string;
  readonly sourceDir: string;
  readonly targets: readonly SkillTarget[];
  readonly upToDate: boolean;
}

/** A copy this CLI installed whose source package is no longer
 *  installed, or which the source package no longer ships. */
export interface OrphanedSkill {
  readonly skill: string;
  readonly library: string | null;
  readonly dirs: readonly string[];
}

export interface SkillsStatus {
  readonly projectRoot: string;
  readonly checkDisabled: boolean;
  readonly packages: readonly InstalledSourcePackage[];
  readonly skills: readonly SkillStatus[];
  readonly orphans: readonly OrphanedSkill[];
  readonly upToDate: boolean;
}

/** The first skill that is stale or was never synced — what the check
 *  names in its one line. */
export function firstOutdatedSkill(status: SkillsStatus): SkillStatus | null {
  return status.skills.find((skill) => !skill.upToDate) ?? null;
}

export interface SkillsStatusOptions {
  /** Set false to skip the orphan scan; the staleness notice never
   *  reads it. */
  readonly orphans?: boolean;
  /** A root the caller already resolved, so the ancestor walk is not
   *  repeated. */
  readonly projectRoot?: string;
  /** An opt-out flag the caller already read from that root. */
  readonly checkDisabled?: boolean;
}

export async function readSkillsStatus(
  cwd: string,
  options?: SkillsStatusOptions,
): Promise<SkillsStatus> {
  const projectRoot = options?.projectRoot ?? (await findProjectRoot(cwd));
  const checkDisabled =
    options?.checkDisabled ?? (await readSkillsCheckDisabled(projectRoot));
  const packages = await findInstalledSourcePackages(projectRoot);
  const sources = await collectSkillSources(packages);
  const skills: SkillStatus[] = [];
  for (const source of sources.values()) {
    skills.push(await readSkillStatus(projectRoot, source));
  }
  skills.sort((left, right) => left.skill.localeCompare(right.skill));

  return {
    projectRoot,
    checkDisabled,
    packages,
    skills,
    orphans:
      options?.orphans === false
        ? []
        : await findOrphanedSkills(projectRoot, new Set(sources.keys())),
    upToDate: skills.every((skill) => skill.upToDate),
  };
}

export interface SkillSource {
  readonly skill: string;
  readonly library: string;
  readonly version: string;
  readonly dir: string;
}

/**
 * The allowlisted packages installed in this project, resolved by name
 * from the project root and from each declared workspace member. Never
 * a directory scan.
 */
export async function findInstalledSourcePackages(
  projectRoot: string,
): Promise<InstalledSourcePackage[]> {
  const searchDirs = [projectRoot, ...(await workspaceMemberDirs(projectRoot))];
  const found: InstalledSourcePackage[] = [];

  for (const name of SKILL_SOURCE_PACKAGES) {
    const resolutions: ResolvedPackage[] = [];
    for (const dir of searchDirs) {
      const resolved = await resolvePackage(dir, name);
      if (resolved !== null) {
        resolutions.push(resolved);
      }
    }
    if (resolutions.length === 0) {
      continue;
    }

    const highest = resolutions.reduce((best, candidate) =>
      (compareVersionStrings(candidate.version, best.version) ?? 0) > 0
        ? candidate
        : best,
    );
    const versions = [...new Set(resolutions.map((one) => one.version))].sort();
    found.push({
      name,
      version: highest.version,
      dir: highest.dir,
      conflictingVersions: versions.length > 1 ? versions : [],
    });
  }

  return found;
}

/** Every skill tree the installed source packages ship, keyed by skill
 *  name. When two packages ship the same skill, the higher version
 *  wins — the public packages version in lockstep, so this only
 *  arbitrates a half-finished upgrade. */
export async function collectSkillSources(
  packages: readonly InstalledSourcePackage[],
): Promise<Map<string, SkillSource>> {
  const sources = new Map<string, SkillSource>();

  for (const installed of packages) {
    const skillsDir = path.join(installed.dir, PACKAGE_SKILLS_DIR);
    for (const skill of await skillDirectories(skillsDir)) {
      const existing = sources.get(skill);
      if (
        existing !== undefined &&
        (compareVersionStrings(installed.version, existing.version) ?? 0) <= 0
      ) {
        continue;
      }
      sources.set(skill, {
        skill,
        library: installed.name,
        version: installed.version,
        dir: path.join(skillsDir, skill),
      });
    }
  }

  return sources;
}

async function readSkillStatus(
  projectRoot: string,
  source: SkillSource,
): Promise<SkillStatus> {
  const targets: SkillTarget[] = [];
  for (const dir of HARNESS_SKILL_DIRS) {
    const skillDir = path.join(projectRoot, dir, source.skill);
    const stamp = await readSkillStamp(path.join(skillDir, "SKILL.md"));
    targets.push({
      dir,
      syncedVersion: stamp?.libraryVersion ?? null,
      state: stampState(stamp, source.version),
    });
  }

  return {
    skill: source.skill,
    library: source.library,
    version: source.version,
    sourceDir: source.dir,
    targets,
    upToDate: targets.every(
      (target) => target.state === "synced" || target.state === "unmanaged",
    ),
  };
}

function stampState(
  stamp: SkillStamp | null,
  sourceVersion: string,
): SkillTargetState {
  // A null stamp means no readable SKILL.md: nobody's skill, so sync
  // may (re)write it — this is how an interrupted copy self-heals.
  if (stamp === null) {
    return "absent";
  }
  if (stamp.library === null || !isSkillSourcePackage(stamp.library)) {
    return "unmanaged";
  }
  return stamp.libraryVersion === sourceVersion ? "synced" : "stale";
}

/**
 * Copies in the harness directories that this CLI installed — their
 * SKILL.md names an allowlisted package as its `library` — and that no
 * installed package still provides. A skill from anywhere else is
 * someone else's file and is never touched.
 */
export async function findOrphanedSkills(
  projectRoot: string,
  provided: ReadonlySet<string>,
): Promise<OrphanedSkill[]> {
  const orphans = new Map<string, { library: string | null; dirs: string[] }>();

  for (const dir of HARNESS_SKILL_DIRS) {
    const harnessDir = path.join(projectRoot, dir);
    for (const skill of await skillDirectories(harnessDir)) {
      if (provided.has(skill)) {
        continue;
      }
      const stamp = await readSkillStamp(
        path.join(harnessDir, skill, "SKILL.md"),
      );
      if (stamp?.library === null || stamp === null) {
        continue;
      }
      if (!isSkillSourcePackage(stamp.library)) {
        continue;
      }
      const entry = orphans.get(skill) ?? { library: stamp.library, dirs: [] };
      entry.dirs.push(dir);
      orphans.set(skill, entry);
    }
  }

  return [...orphans.entries()].map(([skill, entry]) => ({
    skill,
    library: entry.library,
    dirs: entry.dirs,
  }));
}

/** The subdirectories of `dir` that hold a SKILL.md. */
async function skillDirectories(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const skills: string[] = [];
  for (const name of entries.sort()) {
    if (await isFile(path.join(dir, name, "SKILL.md"))) {
      skills.push(name);
    }
  }
  return skills;
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}
