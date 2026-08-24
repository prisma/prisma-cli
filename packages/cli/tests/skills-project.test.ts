/**
 * How sync enumerates a workspace's members, and how it reads a skill's
 * version stamp. Both are the inputs every other behavior rests on.
 * There is no project-root discovery to test: every skills surface
 * anchors at the directory the command runs in.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseSkillStamp } from "../src/lib/skills/frontmatter";
import { workspaceMemberDirs } from "../src/lib/skills/project-root";
import { makeProjectRoot, writeMember } from "./helpers/skills-fixture";

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

  it("expands the workspaces field of package.json (npm, Yarn, bun)", async () => {
    const root = await makeProjectRoot();
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({ name: "root", workspaces: ["packages/*"] })}\n`,
      "utf8",
    );
    await writeMember(root, "packages/one");
    await writeMember(root, "packages/two");

    expect(await workspaceMemberDirs(root)).toEqual([
      path.join(root, "packages/one"),
      path.join(root, "packages/two"),
    ]);
  });

  it("reads the Yarn object form of the workspaces field", async () => {
    const root = await makeProjectRoot();
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({
        name: "root",
        workspaces: { packages: ["packages/*"] },
      })}\n`,
      "utf8",
    );
    await writeMember(root, "packages/one");

    expect(await workspaceMemberDirs(root)).toEqual([
      path.join(root, "packages/one"),
    ]);
  });

  it("answers a ** glob with the packages, not with every directory", async () => {
    const root = await makeProjectRoot();
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({ name: "root", workspaces: ["packages/**"] })}\n`,
      "utf8",
    );
    await writeMember(root, "packages/one");
    await writeMember(root, "packages/group/two");
    await mkdir(path.join(root, "packages/one/dist/chunks/inner"), {
      recursive: true,
    });
    await mkdir(path.join(root, "packages/one/src"), { recursive: true });

    expect(await workspaceMemberDirs(root)).toEqual([
      path.join(root, "packages/group/two"),
      path.join(root, "packages/one"),
    ]);
  });

  it("never lists a directory inside node_modules as a member", async () => {
    const root = await makeProjectRoot();
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({ name: "root", workspaces: ["**"] })}\n`,
      "utf8",
    );
    await writeMember(root, "apps/web");
    // A dependency's own package.json must never make it a workspace
    // member: membership comes from the declared globs, and the glob
    // expansion refuses node_modules outright.
    await writeMember(root, "node_modules/@acme/toolkit");
    await writeMember(root, "apps/web/node_modules/@acme/other");

    expect(await workspaceMemberDirs(root)).toEqual([
      path.join(root, "apps/web"),
    ]);
  });

  it("finds no members in a project that declares no workspace", async () => {
    expect(await workspaceMemberDirs(await makeProjectRoot())).toEqual([]);
  });
});

describe("reading a skill's version stamp", () => {
  it("reads library and library_version from the metadata map", () => {
    expect(
      parseSkillStamp(
        [
          "---",
          "name: prisma-8",
          "description: Use Prisma 8.",
          "metadata:",
          "  library: @prisma/orm-postgres",
          '  library_version: "8.1.0"',
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

  it("ignores a library key written at the top level", () => {
    // The spec has no top-level extension keys, and nothing has shipped
    // one, so a file spelling the stamp there is unstamped.
    expect(
      parseSkillStamp(
        ["---", "name: prisma-8", "library: @prisma/orm-postgres", "---"].join(
          "\n",
        ),
      ),
    ).toEqual({ library: null, libraryVersion: null });
  });

  it("ignores library keys under some other map", () => {
    expect(
      parseSkillStamp(
        ["---", "allowed-tools:", "  library: @acme/spoof", "---"].join("\n"),
      ).library,
    ).toBe(null);
  });
});
