import { execFile } from "node:child_process";

import type { LocalGitState } from "../../types/diagnostics";

export async function readLocalGitState(cwd: string, signal: AbortSignal): Promise<LocalGitState | null> {
  signal.throwIfAborted();

  const insideWorkTree = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"], signal);
  if (insideWorkTree?.trim() !== "true") {
    return null;
  }

  const [ref, sha, status] = await Promise.all([
    runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], signal),
    runGit(cwd, ["rev-parse", "--short", "HEAD"], signal),
    runGit(cwd, ["status", "--porcelain"], signal),
  ]);

  return {
    ref: cleanGitValue(ref),
    sha: cleanGitValue(sha),
    dirty: status === null ? null : status.trim().length > 0,
  };
}

function runGit(cwd: string, args: string[], signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();

    const child = execFile(
      "git",
      args,
      {
        cwd,
        signal,
        timeout: 2_000,
      },
      (error, stdout) => {
        if (signal.aborted) {
          reject(error);
          return;
        }

        if (error) {
          resolve(null);
          return;
        }

        resolve(stdout);
      },
    );

    child.on("error", (error) => {
      if (signal.aborted) {
        reject(error);
        return;
      }

      resolve(null);
    });
  });
}

function cleanGitValue(value: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}
