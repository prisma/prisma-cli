// biome-ignore-all lint/performance/noAwaitInLoops: The upward walk stops at the first hit, so checks must run sequentially.
import { stat } from "node:fs/promises";
import path from "node:path";

/**
 * Walks up from cwd to the nearest directory containing a `.prisma/`
 * directory and returns that directory, or null when no ancestor has
 * one. Pure filesystem check — no config file is read or evaluated.
 * Nearest wins by design: a nested directory deliberately linked to a
 * different project beats the repo root.
 */
export async function findNearestPrismaDir(
  cwd: string,
): Promise<string | null> {
  let dir = path.resolve(cwd);
  for (;;) {
    if (await isDirectory(path.join(dir, ".prisma"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}
