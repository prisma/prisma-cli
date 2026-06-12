import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Resolves the directories from `appPath` up to its source root, nearest
 * first. The source root is the closest ancestor that looks like a repository
 * or workspace root; a standalone app is its own source root.
 *
 * This module stays dependency-light: it is imported during CLI bootstrap.
 */
export async function resolveSourceRoot(appRoot: string, signal?: AbortSignal): Promise<string> {
  let current = path.resolve(appRoot);

  while (true) {
    if (
      await pathExists(path.join(current, ".git"), signal) ||
      await pathExists(path.join(current, "pnpm-workspace.yaml"), signal) ||
      await pathExists(path.join(current, "bun.lock"), signal) ||
      await pathExists(path.join(current, "bun.lockb"), signal) ||
      await packageJsonDeclaresWorkspaces(current, signal)
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(appRoot);
    }

    current = parent;
  }
}

/** Directories from `appPath` up to its source root, nearest first. */
export async function sourceRootLineage(appPath: string, signal?: AbortSignal): Promise<string[]> {
  const sourceRoot = await resolveSourceRoot(appPath, signal);
  const lineage: string[] = [];
  let current = path.resolve(appPath);

  while (true) {
    lineage.push(current);
    if (current === sourceRoot) {
      return lineage;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return lineage;
    }

    current = parent;
  }
}

async function packageJsonDeclaresWorkspaces(directory: string, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  try {
    const content = await readFile(path.join(directory, "package.json"), { encoding: "utf8", signal });
    const parsed = JSON.parse(content) as { workspaces?: unknown };
    return Boolean(parsed.workspaces);
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
}

async function pathExists(targetPath: string, signal?: AbortSignal): Promise<boolean> {
  try {
    signal?.throwIfAborted();
    await stat(targetPath);
    signal?.throwIfAborted();
    return true;
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
}
