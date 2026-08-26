// biome-ignore-all lint/performance/noAwaitInLoops: the allowlist is walked in order — a package resolved from an earlier directory decides what a later one is compared against — and the reads are a handful of stats on small files.
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { compareVersionStrings } from "../semver-order";
import {
  type AgentName,
  agentSkillDirs,
  DEFAULT_AGENTS,
  isSkillSourcePackage,
  PACKAGE_SKILLS_DIR,
  SKILL_SOURCE_PACKAGES,
} from "./allowlist";
import { readSkillStamp, type SkillStamp } from "./frontmatter";
import { readSkillsCheckDisabled } from "./opt-out";
import { type ResolvedPackage, resolvePackage } from "./resolve";
import { workspaceMemberDirs } from "./workspace-members";

export interface InstalledSourcePackage {
  readonly name: string;
  readonly version: string;
  readonly dir: string;
  /** Every version this package resolves to across the root and the
   *  workspace members, when the members disagree. */
  readonly conflictingVersions: readonly string[];
}

/** "unmanaged": the directory holds a SKILL.md this CLI did not write —
 *  unstamped, unreadable, or stamped by a package outside the
 *  allowlist. Sync never touches it. A directory without a SKILL.md
 *  reads as "absent" so an interrupted copy is repaired by the next
 *  sync. */
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

export interface SkillsStatusOptions {
  /** Set false to skip the orphan scan; the staleness notice never
   *  reads it. */
  readonly orphans?: boolean;
  /** The agents whose skill directories the status covers; every known
   *  agent when absent. */
  readonly agents?: readonly AgentName[];
  /** An opt-out flag the caller already read from that root. */
  readonly checkDisabled?: boolean;
}

export async function readSkillsStatus(
  cwd: string,
  options?: SkillsStatusOptions,
): Promise<SkillsStatus> {
  const projectRoot = path.resolve(cwd);
  const dirs = agentSkillDirs(options?.agents ?? DEFAULT_AGENTS);
  const checkDisabled =
    options?.checkDisabled ?? (await readSkillsCheckDisabled(projectRoot));
  const packages = await findInstalledSourcePackages(projectRoot);
  const sources = await collectSkillSources(packages);
  const skills: SkillStatus[] = [];
  for (const source of sources.values()) {
    skills.push(await readSkillStatus(projectRoot, dirs, source));
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
        : await findOrphanedSkills(projectRoot, dirs, new Set(sources.keys())),
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
  dirs: readonly string[],
  source: SkillSource,
): Promise<SkillStatus> {
  const targets: SkillTarget[] = [];
  for (const dir of dirs) {
    const skillFile = path.join(projectRoot, dir, source.skill, "SKILL.md");
    const stamp = await readSkillStamp(skillFile);
    targets.push({
      dir,
      syncedVersion: stamp?.libraryVersion ?? null,
      state: await targetState(skillFile, stamp, source.version),
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

async function targetState(
  skillFile: string,
  stamp: SkillStamp | null,
  sourceVersion: string,
): Promise<SkillTargetState> {
  if (stamp === null) {
    // Only a SKILL.md that is genuinely missing is nobody's skill, so
    // sync may (re)write it — this is how an interrupted copy
    // self-heals. One that exists but cannot be read — or sits in a
    // directory that cannot be inspected — may be the user's; sync
    // must refuse it rather than destroy it.
    return (await missingFromDisk(skillFile)) ? "absent" : "unmanaged";
  }
  if (stamp.library === null || !isSkillSourcePackage(stamp.library)) {
    return "unmanaged";
  }
  return stamp.libraryVersion === sourceVersion ? "synced" : "stale";
}

async function missingFromDisk(target: string): Promise<boolean> {
  try {
    await stat(target);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/**
 * Copies in the harness directories that this CLI installed — their
 * SKILL.md names an allowlisted package as its `library` — and that no
 * installed package still provides. A skill from anywhere else is
 * someone else's file and is never touched.
 */
export async function findOrphanedSkills(
  projectRoot: string,
  dirs: readonly string[],
  provided: ReadonlySet<string>,
): Promise<OrphanedSkill[]> {
  const orphans = new Map<string, { library: string | null; dirs: string[] }>();

  for (const dir of dirs) {
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
