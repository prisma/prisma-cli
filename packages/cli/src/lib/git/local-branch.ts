import { access, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Resolves the checked-out branch the way git does: the nearest `.git`
 * (directory or worktree file) from `cwd` upward owns the answer, so
 * monorepo commands run from inside a package see the repository branch.
 * Returns null for detached HEAD or when no repository contains `cwd`.
 */
export async function readLocalGitBranch(
  cwd: string,
  signal: AbortSignal,
): Promise<string | null> {
  for (let directory = path.resolve(cwd); ; ) {
    // biome-ignore lint/performance/noAwaitInLoops: the walk stops at the first directory that holds a `.git`, and which directory that is decides whether the parent is looked at at all.
    const headPath = await resolveGitHeadPath(
      path.join(directory, ".git"),
      signal,
    );
    if (headPath) {
      // This repository owns cwd; never walk past it to an outer repository.
      return readBranchFromHead(headPath, signal);
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
}

async function readBranchFromHead(
  headPath: string,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const head = (
      await readFile(headPath, { encoding: "utf8", signal })
    ).trim();
    const refPrefix = "ref: refs/heads/";
    if (head.startsWith(refPrefix)) {
      return head.slice(refPrefix.length);
    }
  } catch (error) {
    if (signal.aborted) throw error;
  }

  return null;
}

async function resolveGitHeadPath(
  gitPath: string,
  signal: AbortSignal,
): Promise<string | null> {
  signal.throwIfAborted();
  try {
    const raw = await readFile(gitPath, { encoding: "utf8", signal });
    const prefix = "gitdir:";
    if (raw.startsWith(prefix)) {
      return path.join(
        path.resolve(path.dirname(gitPath), raw.slice(prefix.length).trim()),
        "HEAD",
      );
    }
  } catch (error) {
    if (signal.aborted) throw error;
    // Fall through to try the normal .git directory shape below.
    // Common cases: EISDIR (normal git repo), EACCES, ENOENT.
  }

  signal.throwIfAborted();
  try {
    // access does not accept AbortSignal; check before and after the filesystem boundary.
    await access(path.join(gitPath, "HEAD"));
    signal.throwIfAborted();
    return path.join(gitPath, "HEAD");
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}
