// biome-ignore-all lint/performance/noAwaitInLoops: the allowlist is walked in order — a package resolved from an earlier directory decides what a later one is compared against — and the reads are a handful of stats on small files.
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { compareVersionStrings } from "../semver-order";
import {
  type AgentName,
  agentSkillDirs,
  DEFAULT_AGENTS,
  isSkillSourcePackage,
  KNOWN_AGENTS,
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
 *  allowlist — or is a link into an installed package's files. Sync
 *  never touches it. A directory without a SKILL.md
 *  reads as "absent" so an interrupted copy is repaired by the next
 *  sync. */
export type SkillTargetState = "synced" | "stale" | "absent" | "unmanaged";

export interface SkillTarget {
  /** Harness directory, relative to the project root. */
  readonly dir: string;
  /** Where the copy is on disk, the directory sync writes. */
  readonly copyDir: string;
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

/** A copy this CLI installed that nothing wants any more: its source
 *  package is no longer installed, the package no longer ships it, or
 *  it sits in the directory of an agent the config no longer names. */
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

/** Reads every skill the installed source packages ship and the state
 *  of each copy in the configured agents' directories, plus the copies
 *  the next sync will remove. */
export async function readSkillsStatus(
  cwd: string,
  options?: SkillsStatusOptions,
): Promise<SkillsStatus> {
  const projectRoot = path.resolve(cwd);
  const agents = options?.agents ?? DEFAULT_AGENTS;
  const dirs = agentSkillDirs(agents);
  const unconfiguredDirs = agentSkillDirs(
    KNOWN_AGENTS.filter((agent) => !agents.includes(agent)),
  );
  const checkDisabled =
    options?.checkDisabled ?? (await readSkillsCheckDisabled(projectRoot));
  const packages = await findInstalledSourcePackages(projectRoot);
  const sources = await collectSkillSources(packages);
  const packageDirs: string[] = [];
  for (const installed of packages) {
    packageDirs.push(await resolveExisting(installed.dir));
  }
  const skills: SkillStatus[] = [];
  for (const source of sources.values()) {
    skills.push(await readSkillStatus(projectRoot, dirs, source, packageDirs));
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
        : await findOrphanedSkills(
            projectRoot,
            dirs,
            new Set(sources.keys()),
            unconfiguredDirs,
            new Set(
              skills.flatMap((skill) =>
                skill.targets.map((target) => target.copyDir),
              ),
            ),
          ),
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
  packageDirs: readonly string[],
): Promise<SkillStatus> {
  const targets: SkillTarget[] = [];
  for (const dir of dirs) {
    const copy = await locateCopy(path.join(projectRoot, dir, source.skill));
    const skillFile = path.join(copy.dir, "SKILL.md");
    const stamp = await readSkillStamp(skillFile);
    targets.push({
      dir,
      copyDir: copy.dir,
      syncedVersion: stamp?.libraryVersion ?? null,
      state:
        copy.followedLink && isPackageFile(copy.dir, packageDirs)
          ? "unmanaged"
          : await targetState(skillFile, stamp, source.version),
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
 * SKILL.md names an allowlisted package as its `library` — and that
 * nothing wants any more: in a configured directory, one no installed
 * package still provides; in the directory of an agent the config no
 * longer names, every one. A copy in one of `wantedCopies`, the disk
 * locations of the copies sync keeps, is wanted. A skill from anywhere
 * else is someone else's file and is never touched.
 */
export async function findOrphanedSkills(
  projectRoot: string,
  dirs: readonly string[],
  provided: ReadonlySet<string>,
  unconfiguredDirs: readonly string[] = [],
  wantedCopies: ReadonlySet<string> = new Set(),
): Promise<OrphanedSkill[]> {
  const orphans = new Map<string, { library: string | null; dirs: string[] }>();
  const scan = [
    ...dirs.map((dir) => ({ dir, wanted: provided })),
    ...unconfiguredDirs.map((dir) => ({ dir, wanted: new Set<string>() })),
  ];

  for (const { dir, wanted } of scan) {
    const harnessDir = path.join(projectRoot, dir);
    for (const skill of await skillDirectories(harnessDir)) {
      if (wanted.has(skill)) {
        continue;
      }
      const library = await managingLibrary(harnessDir, skill);
      if (library === null) {
        continue;
      }
      const copy = await locateCopy(path.join(harnessDir, skill));
      if (wantedCopies.has(copy.dir)) {
        continue;
      }
      const entry = orphans.get(skill) ?? { library, dirs: [] };
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

async function managingLibrary(
  harnessDir: string,
  skill: string,
): Promise<string | null> {
  const stamp = await readSkillStamp(path.join(harnessDir, skill, "SKILL.md"));
  if (
    stamp === null ||
    stamp.library === null ||
    !isSkillSourcePackage(stamp.library)
  ) {
    return null;
  }
  return stamp.library;
}

/**
 * Where the copy at `copyPath` is on disk. A link at `copyPath` is
 * followed only to a directory holding a SKILL.md; any other link is
 * itself the copy, so replacing it removes the link and never its
 * target.
 */
async function locateCopy(
  copyPath: string,
): Promise<{ dir: string; followedLink: boolean }> {
  if (await isSymbolicLink(copyPath)) {
    try {
      const target = await realpath(copyPath);
      if (await isFile(path.join(target, "SKILL.md"))) {
        return { dir: target, followedLink: true };
      }
    } catch {
      // A dangling link is replaced like a missing copy.
    }
    return {
      dir: path.join(
        await resolveExisting(path.dirname(copyPath)),
        path.basename(copyPath),
      ),
      followedLink: false,
    };
  }
  return { dir: await resolveExisting(copyPath), followedLink: false };
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

async function isSymbolicLink(target: string): Promise<boolean> {
  try {
    return (await lstat(target)).isSymbolicLink();
  } catch {
    return false;
  }
}

/** True for a directory a package manager owns: inside an installed
 *  source package, or anywhere under a node_modules directory. */
function isPackageFile(dir: string, packageDirs: readonly string[]): boolean {
  return (
    dir.split(path.sep).includes("node_modules") ||
    packageDirs.some((packageDir) => {
      const relative = path.relative(packageDir, dir);
      return (
        relative === "" ||
        (relative !== ".." &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative))
      );
    })
  );
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
