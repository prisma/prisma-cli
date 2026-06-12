import { access } from "node:fs/promises";
import path from "node:path";

import { sourceRootLineage } from "../fs/source-root";

export const COMPUTE_CONFIG_FILENAME = "prisma.compute.ts";

// Highest priority first. TypeScript is the canonical format; the rest exist
// so plain JavaScript projects are not forced into TypeScript.
export const COMPUTE_CONFIG_FILENAMES = [
  "prisma.compute.ts",
  "prisma.compute.mts",
  "prisma.compute.js",
  "prisma.compute.mjs",
  "prisma.compute.cjs",
] as const;

/**
 * Compute config files present in one directory, in filename priority order.
 */
export async function findComputeConfigCandidates(directory: string, signal?: AbortSignal): Promise<string[]> {
  const candidates: string[] = [];
  for (const filename of COMPUTE_CONFIG_FILENAMES) {
    const configPath = path.join(directory, filename);
    signal?.throwIfAborted();
    try {
      await access(configPath);
      candidates.push(configPath);
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  signal?.throwIfAborted();

  return candidates;
}

/**
 * Locates the nearest directory holding a compute config file, searching from
 * `cwd` up to the source root. This is location-only discovery — the config
 * is not loaded or validated — so it is safe to run during CLI bootstrap.
 * Returns null when no config exists inside the repository boundary.
 */
export async function findComputeConfigDir(cwd: string, signal?: AbortSignal): Promise<string | null> {
  for (const directory of await sourceRootLineage(cwd, signal)) {
    const candidates = await findComputeConfigCandidates(directory, signal);
    if (candidates.length > 0) {
      return directory;
    }
  }

  return null;
}
