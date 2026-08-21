/**
 * Where sync decides the project is, and how it reads a skill's version
 * stamp. Both are the inputs every other behavior rests on.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseSkillStamp } from "../src/lib/skills/frontmatter";
import {
  findProjectRoot,
  workspaceMemberDirs,
} from "../src/lib/skills/project-root";
import { makeProjectRoot, writeMember } from "./helpers/skills-fixture";

async function nested(root: string, relative: string): Promise<string> {
  const dir = path.join(root, relative);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("finding the project root", () => {
  it("stops at a pnpm workspace above the working directory", async () => {
    const root = await makeProjectRoot();
    await writeFile(
      path.join(root, "pnpm-workspace.yaml"),
      'packages:\n  - "apps/*"\n',
      "utf8",
    );
    await writeMember(root, "apps/web");

    expect(await findProjectRoot(path.join(root, "apps/web"))).toBe(root);
  });

  it("stops at a package.json declaring workspaces", async () => {
    const root = await makeProjectRoot();
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({ name: "root", workspaces: ["packages/*"] })}\n`,
      "utf8",
    );
    const deep = await nested(root, "packages/api/src");

    expect(await findProjectRoot(deep)).toBe(root);
  });

  it("falls back to the repository root when nothing declares a workspace", async () => {
    const root = await makeProjectRoot();
    await mkdir(path.join(root, ".git"), { recursive: true });
    const deep = await nested(root, "services/api");
    await writeFile(
      path.join(deep, "package.json"),
      `${JSON.stringify({ name: "api" })}\n`,
      "utf8",
    );

    expect(await findProjectRoot(deep)).toBe(root);
  });

  it("falls back to the nearest package when there is no repository", async () => {
    const root = await makeProjectRoot();
    const deep = await nested(root, "src/lib");

    expect(await findProjectRoot(deep)).toBe(root);
  });
});

describe("enumerating workspace members", () => {
  it("expands the globs a pnpm workspace declares", async () => {
    const root = await makeProjectRoot();
    await writeFile(
      path.join(root, "pnpm-workspace.yaml"),
      ["packages:", '  - "apps/*"', '  - "tools/build"', ""].join("\n"),
      "utf8",
    );
    await writeMember(root, "apps/web");
    await writeMember(root, "apps/api");
    await writeMember(root, "tools/build");
    await writeMember(root, "elsewhere/ignored");

    expect(await workspaceMemberDirs(root)).toEqual([
      path.join(root, "apps/api"),
      path.join(root, "apps/web"),
      path.join(root, "tools/build"),
    ]);
  });

  it("expands the globs a package.json declares, including **", async () => {
    const root = await makeProjectRoot();
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({ name: "root", workspaces: ["packages/**"] })}\n`,
      "utf8",
    );
    await writeMember(root, "packages/one");
    await writeMember(root, "packages/one/nested");

    expect(await workspaceMemberDirs(root)).toEqual([
      path.join(root, "packages"),
      path.join(root, "packages/one"),
      path.join(root, "packages/one/nested"),
    ]);
  });

  it("finds no members in a project that declares no workspace", async () => {
    expect(await workspaceMemberDirs(await makeProjectRoot())).toEqual([]);
  });
});

describe("reading a skill's version stamp", () => {
  it("reads the library and library_version keys", () => {
    expect(
      parseSkillStamp(
        [
          "---",
          "name: prisma-8",
          "description: Use Prisma 8.",
          "library: @prisma/orm-postgres",
          'library_version: "8.1.0"',
          "---",
          "# Prisma 8",
        ].join("\n"),
      ),
    ).toEqual({ library: "@prisma/orm-postgres", libraryVersion: "8.1.0" });
  });

  it("reports nulls for a skill with no frontmatter", () => {
    expect(parseSkillStamp("# Just a heading\n")).toEqual({
      library: null,
      libraryVersion: null,
    });
  });

  it("reports nulls for an unstamped skill", () => {
    expect(parseSkillStamp("---\nname: team-skill\n---\n")).toEqual({
      library: null,
      libraryVersion: null,
    });
  });

  it("ignores keys nested under another key", () => {
    expect(
      parseSkillStamp(
        ["---", "metadata:", "  library: @acme/spoof", "---"].join("\n"),
      ).library,
    ).toBe(null);
  });
});
