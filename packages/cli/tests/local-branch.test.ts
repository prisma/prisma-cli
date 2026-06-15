import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readLocalGitBranch } from "../src/lib/git/local-branch";
import { createTempCwd } from "./helpers";

const signal = new AbortController().signal;

async function writeGitHead(repoDir: string, head: string): Promise<void> {
  await mkdir(path.join(repoDir, ".git"), { recursive: true });
  await writeFile(path.join(repoDir, ".git", "HEAD"), `${head}\n`, "utf8");
}

describe("readLocalGitBranch", () => {
  it("reads the branch from the repository at cwd", async () => {
    const repo = await createTempCwd();
    await writeGitHead(repo, "ref: refs/heads/feat/api");

    expect(await readLocalGitBranch(repo, signal)).toBe("feat/api");
  });

  it("walks up to the repository root from inside a monorepo package", async () => {
    const repo = await createTempCwd();
    await writeGitHead(repo, "ref: refs/heads/feat/compute");
    const packageDir = path.join(repo, "apps", "api", "src");
    await mkdir(packageDir, { recursive: true });

    expect(await readLocalGitBranch(packageDir, signal)).toBe("feat/compute");
  });

  it("treats the nearest repository as the boundary even when its HEAD is detached", async () => {
    const outer = await createTempCwd();
    await writeGitHead(outer, "ref: refs/heads/outer-branch");
    const inner = path.join(outer, "vendored");
    await writeGitHead(inner, "0123456789abcdef0123456789abcdef01234567");

    expect(await readLocalGitBranch(inner, signal)).toBeNull();
  });

  it("supports worktree-style .git files pointing at the real git directory", async () => {
    const base = await createTempCwd();
    const gitDir = path.join(base, "real-git");
    await mkdir(gitDir, { recursive: true });
    await writeFile(
      path.join(gitDir, "HEAD"),
      "ref: refs/heads/worktree-branch\n",
      "utf8",
    );
    const worktree = path.join(base, "tree");
    await mkdir(worktree, { recursive: true });
    await writeFile(
      path.join(worktree, ".git"),
      `gitdir: ${path.join("..", "real-git")}\n`,
      "utf8",
    );

    const nested = path.join(worktree, "apps", "web");
    await mkdir(nested, { recursive: true });
    expect(await readLocalGitBranch(nested, signal)).toBe("worktree-branch");
  });

  it("returns null when no repository contains cwd", async () => {
    const dir = await createTempCwd();
    expect(await readLocalGitBranch(dir, signal)).toBeNull();
  });
});
