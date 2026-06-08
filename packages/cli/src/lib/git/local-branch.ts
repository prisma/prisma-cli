import { access, readFile } from "node:fs/promises";
import path from "node:path";

export async function readLocalGitBranch(cwd: string, signal: AbortSignal): Promise<string | null> {
  const gitPath = path.join(cwd, ".git");
  const headPath = await resolveGitHeadPath(gitPath, signal);
  if (!headPath) {
    return null;
  }

  try {
    const head = (await readFile(headPath, { encoding: "utf8", signal })).trim();
    const refPrefix = "ref: refs/heads/";
    if (head.startsWith(refPrefix)) {
      return head.slice(refPrefix.length);
    }
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }

  return null;
}

async function resolveGitHeadPath(gitPath: string, signal: AbortSignal): Promise<string | null> {
  signal.throwIfAborted();
  try {
    const raw = await readFile(gitPath, { encoding: "utf8", signal });
    const prefix = "gitdir:";
    if (raw.startsWith(prefix)) {
      return path.join(path.resolve(path.dirname(gitPath), raw.slice(prefix.length).trim()), "HEAD");
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
