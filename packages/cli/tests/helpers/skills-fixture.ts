// biome-ignore-all lint/performance/noAwaitInLoops: fixture files are written in order so a directory exists before the files inside it.
/**
 * Project fixtures for the skills commands: a temporary project root
 * with real packages under node_modules, in the layouts npm and pnpm
 * produce, plus the harness skill directories the sync writes into.
 *
 * The fixture packages mimic the packaging contract rather than
 * depending on the published ones: a `skills/<name>/SKILL.md` whose
 * frontmatter carries `library` and `library_version`, and a reference
 * file beside it.
 */
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import Module from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, onTestFinished } from "vitest";

/**
 * Vitest runs its workers with NODE_PATH pointing into the repository's
 * pnpm store, and Node adds NODE_PATH to every resolution wherever it
 * starts from — so without this a fixture project appears to have every
 * package in this repository installed, including two on the allowlist.
 * Clearing it and recomputing Node's global paths makes the fixtures
 * hermetic; the shipped CLI never runs under such a NODE_PATH.
 */
export function isolateModuleResolution(): void {
  const original = process.env.NODE_PATH;
  process.env.NODE_PATH = "";
  (Module as unknown as { _initPaths(): void })._initPaths();
  afterAll(() => {
    if (original === undefined) {
      delete process.env.NODE_PATH;
    } else {
      process.env.NODE_PATH = original;
    }
    (Module as unknown as { _initPaths(): void })._initPaths();
  });
}

export interface FixturePackage {
  readonly name: string;
  readonly version: string;
  /** Skill directory names the package ships. */
  readonly skills?: readonly string[];
  /** Where the package's files live: directly under node_modules (npm)
   *  or in a store directory that node_modules links to (pnpm). */
  readonly layout?: "npm" | "pnpm";
  /** The workspace member that installs it, relative to the root.
   *  Absent means the root itself. */
  readonly member?: string;
}

export async function makeProjectRoot(prefix = "skills-"): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `prisma-cli-${prefix}`));
  // Fixtures made inside a hook clean themselves up with the suite.
  const cleanup = async (): Promise<void> => {
    await rm(dir, { recursive: true, force: true });
  };
  try {
    onTestFinished(cleanup);
  } catch {
    afterAll(cleanup);
  }
  await writeFile(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name: "fixture-project", version: "0.0.0" }, null, 2)}\n`,
    "utf8",
  );
  return dir;
}

export async function writeWorkspaceConfig(
  root: string,
  patterns: readonly string[],
): Promise<void> {
  await writeFile(
    path.join(root, "pnpm-workspace.yaml"),
    `packages:\n${patterns.map((pattern) => `  - "${pattern}"`).join("\n")}\n`,
    "utf8",
  );
}

export async function writeMember(root: string, member: string): Promise<void> {
  const dir = path.join(root, member);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name: path.basename(member), version: "0.0.0" }, null, 2)}\n`,
    "utf8",
  );
}

/** Installs a fixture package so that standard resolution from its
 *  owner's directory finds it. */
export async function installPackage(
  root: string,
  pkg: FixturePackage,
): Promise<string> {
  const owner = pkg.member === undefined ? root : path.join(root, pkg.member);
  const linkPath = path.join(owner, "node_modules", pkg.name);
  const contentDir =
    pkg.layout === "pnpm"
      ? path.join(
          root,
          "node_modules",
          ".pnpm",
          `${pkg.name.replace("/", "+")}@${pkg.version}`,
          "node_modules",
          pkg.name,
        )
      : linkPath;

  await mkdir(contentDir, { recursive: true });
  await writeFile(
    path.join(contentDir, "package.json"),
    `${JSON.stringify({ name: pkg.name, version: pkg.version, main: "index.js" }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(contentDir, "index.js"), "module.exports = {};\n");

  for (const skill of pkg.skills ?? []) {
    await writeSkillTree(path.join(contentDir, "skills", skill), {
      skill,
      library: pkg.name,
      version: pkg.version,
    });
  }

  if (contentDir !== linkPath) {
    await mkdir(path.dirname(linkPath), { recursive: true });
    await symlink(contentDir, linkPath, "dir");
  }
  return contentDir;
}

export async function writeSkillTree(
  dir: string,
  skill: { skill: string; library: string; version: string },
): Promise<void> {
  await mkdir(path.join(dir, "references"), { recursive: true });
  await writeFile(
    path.join(dir, "SKILL.md"),
    [
      "---",
      `name: ${skill.skill}`,
      `description: Use ${skill.library}.`,
      `library: ${skill.library}`,
      `library_version: ${skill.version}`,
      "---",
      "",
      `# ${skill.skill}`,
      "",
      "See references/usage.md.",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(dir, "references", "usage.md"),
    `# Usage for ${skill.version}\n`,
    "utf8",
  );
}

/** Writes a copy into one harness directory, as a previous sync would
 *  have. */
export async function seedSyncedSkill(
  root: string,
  harnessDir: string,
  skill: { skill: string; library: string; version: string },
): Promise<void> {
  await writeSkillTree(path.join(root, harnessDir, skill.skill), skill);
}

export async function readSyncedStamp(
  root: string,
  harnessDir: string,
  skill: string,
): Promise<string> {
  return readFile(path.join(root, harnessDir, skill, "SKILL.md"), "utf8");
}
