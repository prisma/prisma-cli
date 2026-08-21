// biome-ignore-all lint/performance/noAwaitInLoops: the ancestor walk stops at the first directory that answers, and each glob segment is expanded from the directories the previous segment matched.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The directory the harness skill directories belong to: the workspace
 * root when there is one, otherwise the repository root, otherwise the
 * nearest package. Walking stops at the filesystem root.
 */
export async function findProjectRoot(cwd: string): Promise<string> {
  let gitRoot: string | null = null;
  let nearestPackage: string | null = null;

  for (const dir of ancestors(cwd)) {
    if (await exists(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    if (await hasWorkspacesField(path.join(dir, "package.json"))) {
      return dir;
    }
    if (gitRoot === null && (await exists(path.join(dir, ".git")))) {
      gitRoot = dir;
    }
    if (
      nearestPackage === null &&
      (await exists(path.join(dir, "package.json")))
    ) {
      nearestPackage = dir;
    }
  }

  return gitRoot ?? nearestPackage ?? path.resolve(cwd);
}

/**
 * The workspace member directories declared by the root's workspace
 * config, expanded from its globs. This reads the declared globs and
 * never walks node_modules: a package is resolvable from a member
 * directory only because the user declared that member.
 */
export async function workspaceMemberDirs(root: string): Promise<string[]> {
  const patterns = [
    ...(await pnpmWorkspacePatterns(path.join(root, "pnpm-workspace.yaml"))),
    ...(await packageJsonWorkspacePatterns(path.join(root, "package.json"))),
  ];

  const dirs = new Set<string>();
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      continue;
    }
    for (const dir of await expandPattern(root, pattern)) {
      dirs.add(dir);
    }
  }
  dirs.delete(path.resolve(root));
  return [...dirs].sort();
}

const LINE_BREAK = /\r?\n/;
const PACKAGES_KEY = /^packages\s*:/;
const SEQUENCE_ENTRY = /^\s+-\s+(.+?)\s*$/;
const QUOTED = /^(["'])(.*)\1$/;
const REGEX_METACHARACTER = /[.*+?^${}()|[\]\\]/g;

function* ancestors(from: string): Generator<string> {
  let dir = path.resolve(from);
  for (;;) {
    yield dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      return;
    }
    dir = parent;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function hasWorkspacesField(manifestPath: string): Promise<boolean> {
  const manifest = await readJson(manifestPath);
  return manifest?.workspaces !== undefined;
}

async function readJson(
  target: string,
): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(target, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

/**
 * The `packages:` list of a pnpm-workspace.yaml. Read line by line
 * rather than with a YAML parser: the CLI ships no YAML dependency, and
 * the only shape pnpm accepts here is a top-level sequence of strings.
 */
async function pnpmWorkspacePatterns(target: string): Promise<string[]> {
  let source: string;
  try {
    source = await readFile(target, "utf8");
  } catch {
    return [];
  }

  const patterns: string[] = [];
  let inPackages = false;
  for (const line of source.split(LINE_BREAK)) {
    if (PACKAGES_KEY.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) {
      continue;
    }
    const entry = SEQUENCE_ENTRY.exec(line);
    if (entry?.[1]) {
      patterns.push(stripQuotes(entry[1]));
      continue;
    }
    if (line.trim() !== "") {
      inPackages = false;
    }
  }
  return patterns;
}

async function packageJsonWorkspacePatterns(target: string): Promise<string[]> {
  const manifest = await readJson(target);
  const workspaces = manifest?.workspaces;
  const patterns = Array.isArray(workspaces)
    ? workspaces
    : (workspaces as { packages?: unknown })?.packages;
  return Array.isArray(patterns)
    ? patterns.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Expands one workspace glob into existing directories. `*` matches one
 * path segment and `**` any depth, which covers every pattern shape
 * workspace configs use.
 */
async function expandPattern(root: string, pattern: string): Promise<string[]> {
  const segments = pattern.split("/").filter((segment) => segment !== "");
  let current = [path.resolve(root)];

  for (const segment of segments) {
    const next: string[] = [];
    for (const dir of current) {
      next.push(...(await matchSegment(dir, segment)));
    }
    current = next;
  }
  return current;
}

async function matchSegment(dir: string, segment: string): Promise<string[]> {
  if (segment === "**") {
    return descendants(dir);
  }
  if (!segment.includes("*")) {
    const candidate = path.join(dir, segment);
    return (await isDirectory(candidate)) ? [candidate] : [];
  }
  const matcher = segmentMatcher(segment);
  return (await subdirectories(dir)).filter((child) =>
    matcher.test(path.basename(child)),
  );
}

async function descendants(dir: string): Promise<string[]> {
  const found: string[] = [dir];
  for (const child of await subdirectories(dir)) {
    found.push(...(await descendants(child)));
  }
  return found;
}

async function subdirectories(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

function segmentMatcher(segment: string): RegExp {
  const source = segment
    .split("*")
    .map((part) => part.replace(REGEX_METACHARACTER, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${source}$`);
}

function stripQuotes(value: string): string {
  const quoted = QUOTED.exec(value);
  return quoted?.[2] ?? value;
}
