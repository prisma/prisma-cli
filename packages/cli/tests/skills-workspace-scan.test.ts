// biome-ignore-all lint/performance/noAwaitInLoops: the fixture writes one directory after another.
/**
 * What the staleness check costs on a workspace whose glob is
 * `packages/**`. The check runs before every command, so the work must
 * be proportional to the number of declared members, not to the size of
 * the working tree. This counts the directory reads instead of timing
 * them, so it fails for the reason it says rather than because a
 * machine was busy.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ dirs: [] as string[] }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    readdir: (target: unknown, ...rest: unknown[]) => {
      if (typeof target === "string") {
        reads.dirs.push(target);
      }
      return (real.readdir as (...args: unknown[]) => unknown)(target, ...rest);
    },
  };
});

const { isolateModuleResolution, makeProjectRoot, writeMember } = await import(
  "./helpers/skills-fixture"
);
const { readSkillsStatus } = await import("../src/lib/skills/status");
const { workspaceMemberDirs } = await import("../src/lib/skills/project-root");

isolateModuleResolution();

/** A member with the kind of tree a built package really has. */
async function writeBuiltMember(root: string, member: string): Promise<void> {
  await writeMember(root, member);
  for (const inside of [
    "src/commands/nested",
    "dist/chunks/inner",
    "coverage/lcov-report",
    ".turbo/logs",
  ]) {
    await mkdir(path.join(root, member, inside), { recursive: true });
  }
}

async function makeWorkspace(): Promise<string> {
  const root = await makeProjectRoot("scan-");
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "root", workspaces: ["packages/**"] })}\n`,
    "utf8",
  );
  await writeBuiltMember(root, "packages/one");
  await writeBuiltMember(root, "packages/group/two");
  await mkdir(path.join(root, ".git", "objects", "pack"), { recursive: true });
  await mkdir(path.join(root, "docs", "guides", "deep"), { recursive: true });
  return root;
}

describe("expanding a ** workspace glob", () => {
  it("reads no directory inside a member and none outside the pattern", async () => {
    const root = await makeWorkspace();
    reads.dirs.length = 0;

    const members = await workspaceMemberDirs(root);

    expect(members).toEqual([
      path.join(root, "packages/group/two"),
      path.join(root, "packages/one"),
    ]);
    const walked = reads.dirs
      .map((dir) => path.relative(root, dir).split(path.sep).join("/"))
      .sort();
    expect(walked).toEqual(["packages", "packages/group"]);
  });

  it("keeps the whole status read proportional to the members", async () => {
    const root = await makeWorkspace();
    reads.dirs.length = 0;

    await readSkillsStatus(root);

    // Two members, four harness directories, and the packages
    // directories the glob crosses. A walk of the working tree would be
    // in the hundreds here and unbounded in a real checkout.
    expect(reads.dirs.length).toBeLessThan(12);
    expect(reads.dirs.filter((dir) => dir.includes(`${path.sep}dist`))).toEqual(
      [],
    );
  });
});
