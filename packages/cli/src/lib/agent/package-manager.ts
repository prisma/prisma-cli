import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export type AgentPackageManager = "bun" | "npm" | "pnpm" | "yarn";

const LOCKFILE_PACKAGE_MANAGERS: Array<{
  packageManager: AgentPackageManager;
  fileNames: string[];
}> = [
  { packageManager: "bun", fileNames: ["bun.lock", "bun.lockb"] },
  {
    packageManager: "pnpm",
    fileNames: ["pnpm-lock.yaml", "pnpm-workspace.yaml"],
  },
  { packageManager: "yarn", fileNames: ["yarn.lock"] },
  {
    packageManager: "npm",
    fileNames: ["package-lock.json", "npm-shrinkwrap.json"],
  },
];

export async function resolveSkillsPackageRunner(options: {
  cwd: string;
  signal: AbortSignal;
}): Promise<string[]> {
  return resolvePackageRunner(options);
}

export async function resolvePackageRunner(options: {
  cwd: string;
  signal: AbortSignal;
}): Promise<string[]> {
  options.signal.throwIfAborted();
  const packageManager =
    detectPackageManagerSync(options.cwd, options.signal) ?? "npm";
  options.signal.throwIfAborted();

  return packageRunnerForPackageManager(packageManager);
}

export function resolvePackageRunnerSync(cwd: string): string[] {
  const packageManager = detectPackageManagerSync(cwd) ?? "npm";
  return packageRunnerForPackageManager(packageManager);
}

export async function detectPackageManager(
  cwd: string,
  signal: AbortSignal,
): Promise<AgentPackageManager | null> {
  signal.throwIfAborted();
  const packageManager = detectPackageManagerSync(cwd, signal);
  signal.throwIfAborted();
  return packageManager;
}

export function detectPackageManagerSync(
  cwd: string,
  signal?: AbortSignal,
): AgentPackageManager | null {
  let directory = path.resolve(cwd);

  while (true) {
    signal?.throwIfAborted();

    const packageJsonManager = readPackageJsonPackageManager(directory);
    if (packageJsonManager) {
      return packageJsonManager;
    }

    const lockfileManager = readLockfilePackageManager(directory, signal);
    if (lockfileManager) {
      return lockfileManager;
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
}

function readPackageJsonPackageManager(
  directory: string,
): AgentPackageManager | null {
  const packageJsonPath = path.join(directory, "package.json");
  let content: string;

  try {
    content = readFileSync(packageJsonPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }

  try {
    const packageJson = JSON.parse(content) as { packageManager?: unknown };
    return parsePackageManager(packageJson.packageManager);
  } catch {
    return null;
  }
}

function readLockfilePackageManager(
  directory: string,
  signal?: AbortSignal,
): AgentPackageManager | null {
  for (const candidate of LOCKFILE_PACKAGE_MANAGERS) {
    for (const fileName of candidate.fileNames) {
      signal?.throwIfAborted();
      if (fileExists(path.join(directory, fileName))) {
        return candidate.packageManager;
      }
    }
  }

  return null;
}

function fileExists(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

function parsePackageManager(value: unknown): AgentPackageManager | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "bun" || normalized.startsWith("bun@")) return "bun";
  if (normalized === "pnpm" || normalized.startsWith("pnpm@")) return "pnpm";
  if (normalized === "yarn" || normalized.startsWith("yarn@")) return "yarn";
  if (normalized === "npm" || normalized.startsWith("npm@")) return "npm";

  return null;
}

function packageRunnerForPackageManager(
  packageManager: AgentPackageManager,
): string[] {
  switch (packageManager) {
    case "bun":
      return ["bunx"];
    case "pnpm":
      return ["pnpm", "dlx"];
    case "yarn":
      return ["yarn", "dlx"];
    case "npm":
      return ["npx", "-y"];
  }
}

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}
