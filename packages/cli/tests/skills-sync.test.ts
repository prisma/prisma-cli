// biome-ignore-all lint/performance/noAwaitInLoops: each fixture step and each assertion reads the filesystem the previous one wrote.
/**
 * `skills sync` and `skills list` against real project fixtures: the
 * layouts npm and pnpm produce, a workspace with two members, and every
 * state a copy can be in.
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, it } from "vitest";

import { skillsCommandFamily } from "../src/commands/skills/family";
import type {
  SkillsListResult,
  SkillsSyncResult,
} from "../src/commands/skills/results";
import { HARNESS_SKILL_DIRS } from "../src/lib/skills/allowlist";
import {
  installPackage,
  isolateModuleResolution,
  makeProjectRoot,
  seedSyncedSkill,
  writeMember,
  writeSkillTree,
  writeWorkspaceConfig,
} from "./helpers/skills-fixture";
import { mountsFor } from "./service-testkit";

const SKILLS_COMMANDS = mountsFor(["skills"]);

isolateModuleResolution();

function makeCli() {
  return createTestCli({
    commandFamilies: [skillsCommandFamily],
    commands: SKILLS_COMMANDS,
    groups: { skills: { brief: "Keep Prisma agent skills current" } },
    now: () => new Date(0),
  });
}

async function runSync(
  cwd: string,
  argv: readonly string[] = [],
): Promise<{ exitCode: number; result: SkillsSyncResult }> {
  const run = await makeCli().run(["skills", "sync", ...argv], { cwd });
  return {
    exitCode: run.exitCode,
    result: run.presented?.data as SkillsSyncResult,
  };
}

async function runList(
  cwd: string,
  argv: readonly string[] = [],
): Promise<{ exitCode: number; result: SkillsListResult }> {
  const run = await makeCli().run(["skills", "list", ...argv], { cwd });
  return {
    exitCode: run.exitCode,
    result: run.presented?.data as SkillsListResult,
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

const STAMP = /library_version:\s*(\S+)/;

async function stampOf(
  root: string,
  harnessDir: string,
  skill: string,
): Promise<string | null> {
  try {
    const source = await readFile(
      path.join(root, harnessDir, skill, "SKILL.md"),
      "utf8",
    );
    return STAMP.exec(source)?.[1] ?? null;
  } catch {
    return null;
  }
}

describe("skills sync", () => {
  it("installs a skill into every harness directory from an npm layout", async () => {
    const root = await makeProjectRoot();
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });

    const { exitCode, result } = await runSync(root);

    expect(exitCode).toBe(0);
    expect(result.synced).toEqual([
      {
        skill: "prisma-8",
        library: "@prisma/orm-postgres",
        version: "8.1.0",
        dirs: [...HARNESS_SKILL_DIRS],
      },
    ]);
    for (const dir of HARNESS_SKILL_DIRS) {
      expect(await stampOf(root, dir, "prisma-8")).toBe("8.1.0");
      // The whole tree travels, not just the SKILL.md the harness indexes.
      expect(
        await exists(
          path.join(root, dir, "prisma-8", "references", "usage.md"),
        ),
      ).toBe(true);
    }
  });

  it("writes a .gitignore into each managed copy, and the copy stays synced with it", async () => {
    const root = await makeProjectRoot();
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });

    await runSync(root);

    for (const dir of HARNESS_SKILL_DIRS) {
      expect(
        await readFile(path.join(root, dir, "prisma-8", ".gitignore"), "utf8"),
      ).toBe("*\n");
    }
    // The extra file changes neither the stamp nor the orphan scan: the
    // copies read as current and a second sync touches nothing.
    const list = await runList(root);
    expect(list.result.upToDate).toBe(true);
    expect(list.result.orphaned).toEqual([]);
    const again = await runSync(root);
    expect(again.result.synced).toEqual([]);
    expect(again.result.pruned).toEqual([]);
  });

  it("suggests the optional postinstall script without touching package.json", async () => {
    const root = await makeProjectRoot();
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });
    const manifestBefore = await readFile(
      path.join(root, "package.json"),
      "utf8",
    );

    const run = await makeCli().run(["skills", "sync"], { cwd: root });

    expect(run.presented?.presentation.next).toEqual([
      {
        kind: "user-choice",
        label:
          'Optional: add "postinstall": "prisma skills sync || exit 0" to your root package.json to resync on every install. Without it, the CLI prints a notice when the skills go out of date.',
      },
    ]);
    expect(await readFile(path.join(root, "package.json"), "utf8")).toBe(
      manifestBefore,
    );
  });

  it("resolves a package pnpm installed as a link into its store", async () => {
    const root = await makeProjectRoot();
    await installPackage(root, {
      name: "@prisma/composer",
      version: "0.12.0",
      skills: ["prisma-composer"],
      layout: "pnpm",
    });

    const { exitCode, result } = await runSync(root);

    expect(exitCode).toBe(0);
    expect(result.synced.map((skill) => skill.skill)).toEqual([
      "prisma-composer",
    ]);
    expect(await stampOf(root, ".claude/skills", "prisma-composer")).toBe(
      "0.12.0",
    );
  });

  it("replaces a stale copy and reports the directories it wrote", async () => {
    const root = await makeProjectRoot();
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.2.0",
      skills: ["prisma-8"],
    });
    for (const dir of HARNESS_SKILL_DIRS) {
      await seedSyncedSkill(root, dir, {
        skill: "prisma-8",
        library: "@prisma/orm-postgres",
        version: "8.0.0",
      });
    }
    // A file the old version shipped and the new one does not.
    const retired = path.join(
      root,
      ".claude/skills",
      "prisma-8",
      "references",
      "retired.md",
    );
    await writeFile(retired, "# gone in 8.2.0\n", "utf8");

    const { exitCode, result } = await runSync(root);

    expect(exitCode).toBe(0);
    expect(result.synced[0]?.dirs).toEqual([...HARNESS_SKILL_DIRS]);
    expect(await stampOf(root, ".claude/skills", "prisma-8")).toBe("8.2.0");
    expect(await exists(retired)).toBe(false);
  });

  it("does nothing and exits 0 when every copy is current", async () => {
    const root = await makeProjectRoot();
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });
    await runSync(root);

    const { exitCode, result } = await runSync(root);

    expect(exitCode).toBe(0);
    expect(result.synced).toEqual([]);
    expect(result.pruned).toEqual([]);
  });

  it("exits 0 when no allowlisted package is installed", async () => {
    const root = await makeProjectRoot();

    const { exitCode, result } = await runSync(root);

    expect(exitCode).toBe(0);
    expect(result.packages).toEqual([]);
    expect(result.synced).toEqual([]);
  });

  it("removes a copy whose source package is gone, and nothing else", async () => {
    const root = await makeProjectRoot();
    await seedSyncedSkill(root, ".claude/skills", {
      skill: "prisma-8",
      library: "@prisma/orm-postgres",
      version: "8.1.0",
    });
    await writeSkillTree(path.join(root, ".claude/skills", "someone-elses"), {
      skill: "someone-elses",
      library: "@acme/toolkit",
      version: "1.0.0",
    });

    const { exitCode, result } = await runSync(root);

    expect(exitCode).toBe(0);
    expect(result.pruned).toEqual([
      {
        skill: "prisma-8",
        library: "@prisma/orm-postgres",
        dirs: [".claude/skills"],
      },
    ]);
    expect(await exists(path.join(root, ".claude/skills", "prisma-8"))).toBe(
      false,
    );
    expect(
      await exists(path.join(root, ".claude/skills", "someone-elses")),
    ).toBe(true);
  });

  it("keeps a skill still shipped by another installed package", async () => {
    const root = await makeProjectRoot();
    await installPackage(root, {
      name: "@prisma/orm-sqlite",
      version: "8.1.0",
      skills: ["prisma-8"],
    });
    await seedSyncedSkill(root, ".claude/skills", {
      skill: "prisma-8",
      library: "@prisma/orm-postgres",
      version: "8.1.0",
    });

    const { result } = await runSync(root);

    expect(result.pruned).toEqual([]);
    expect(await exists(path.join(root, ".claude/skills", "prisma-8"))).toBe(
      true,
    );
  });

  it("installs the highest version two workspace members pin, and warns", async () => {
    const root = await makeProjectRoot();
    await writeWorkspaceConfig(root, ["apps/*"]);
    await writeMember(root, "apps/web");
    await writeMember(root, "apps/api");
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
      member: "apps/web",
    });
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.3.0",
      skills: ["prisma-8"],
      member: "apps/api",
    });

    const run = await makeCli().run(["skills", "sync"], {
      cwd: root,
      isTty: { stdout: true, stderr: true },
    });
    const result = run.presented?.data as SkillsSyncResult;

    expect(run.exitCode).toBe(0);
    expect(result.packages).toEqual([
      {
        package: "@prisma/orm-postgres",
        version: "8.3.0",
        conflictingVersions: ["8.1.0", "8.3.0"],
      },
    ]);
    expect(await stampOf(root, ".claude/skills", "prisma-8")).toBe("8.3.0");
    expect(run.stderr).toContain(
      "Workspace members install different versions of @prisma/orm-postgres (8.1.0, 8.3.0); the skills for 8.3.0 were installed.",
    );
  });

  it("syncs into the workspace root when run from inside a member", async () => {
    const root = await makeProjectRoot();
    await writeWorkspaceConfig(root, ["apps/*"]);
    await writeMember(root, "apps/web");
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
      member: "apps/web",
    });

    const { exitCode, result } = await runSync(path.join(root, "apps/web"));

    expect(exitCode).toBe(0);
    expect(result.projectRoot).toBe(root);
    expect(await stampOf(root, ".claude/skills", "prisma-8")).toBe("8.1.0");
    expect(await exists(path.join(root, "apps/web", ".claude", "skills"))).toBe(
      false,
    );
  });

  it("persists the opt-out with --disable and lifts it with --enable", async () => {
    const root = await makeProjectRoot();
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });

    const disabled = await runSync(root, ["--disable"]);
    expect(disabled.exitCode).toBe(0);
    expect(disabled.result.checkDisabled).toBe(true);
    expect(
      JSON.parse(
        await readFile(path.join(root, ".prisma", "skills.json"), "utf8"),
      ),
    ).toEqual({ check: false });

    const enabled = await runSync(root, ["--enable"]);
    expect(enabled.result.checkDisabled).toBe(false);
  });

  it("reports the check as disabled when prisma.config.ts turns it off", async () => {
    const root = await makeProjectRoot();
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });
    const cli = createTestCli({
      commandFamilies: [skillsCommandFamily],
      commands: SKILLS_COMMANDS,
      groups: { skills: { brief: "Keep Prisma agent skills current" } },
      config: { skills: { check: false } },
      now: () => new Date(0),
    });

    const run = await cli.run(["skills", "sync"], { cwd: root });

    // The same answer `skills list` gives, from the same setting.
    expect((run.presented?.data as SkillsSyncResult).checkDisabled).toBe(true);
  });

  it("refuses --disable and --enable together", async () => {
    const root = await makeProjectRoot();

    const run = await makeCli().run(
      ["skills", "sync", "--disable", "--enable"],
      {
        cwd: root,
      },
    );

    expect(run.exitCode).not.toBe(0);
    expect(await exists(path.join(root, ".prisma", "skills.json"))).toBe(false);
  });

  it("still syncs while disabling, so the opt-out never leaves stale copies", async () => {
    const root = await makeProjectRoot();
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });

    const { result } = await runSync(root, ["--disable"]);

    expect(result.synced.map((skill) => skill.skill)).toEqual(["prisma-8"]);
    expect(await stampOf(root, ".claude/skills", "prisma-8")).toBe("8.1.0");
  });

  it("never installs a skill from a package outside the allowlist", async () => {
    const root = await makeProjectRoot();
    await installPackage(root, {
      name: "@acme/toolkit",
      version: "1.0.0",
      skills: ["acme-helper"],
    });

    const { result } = await runSync(root);

    expect(result.packages).toEqual([]);
    expect(result.synced).toEqual([]);
    for (const dir of HARNESS_SKILL_DIRS) {
      expect(await exists(path.join(root, dir, "acme-helper"))).toBe(false);
    }
  });
});

describe("skills list", () => {
  it("reports each harness directory's synced version and state", async () => {
    const root = await makeProjectRoot();
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.2.0",
      skills: ["prisma-8"],
    });
    await seedSyncedSkill(root, ".claude/skills", {
      skill: "prisma-8",
      library: "@prisma/orm-postgres",
      version: "8.0.0",
    });
    await seedSyncedSkill(root, ".cursor/skills", {
      skill: "prisma-8",
      library: "@prisma/orm-postgres",
      version: "8.2.0",
    });

    const { exitCode, result } = await runList(root);

    expect(exitCode).toBe(0);
    expect(result.upToDate).toBe(false);
    expect(result.skills[0]?.targets).toEqual([
      { dir: ".claude/skills", syncedVersion: "8.0.0", state: "stale" },
      { dir: ".cursor/skills", syncedVersion: "8.2.0", state: "synced" },
      { dir: ".agents/skills", syncedVersion: null, state: "absent" },
      { dir: ".windsurf/skills", syncedVersion: null, state: "absent" },
    ]);
    expect(result.checkDisabled).toBe(false);
  });

  it("reports the project as up to date after a sync", async () => {
    const root = await makeProjectRoot();
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.2.0",
      skills: ["prisma-8"],
    });
    await runSync(root);

    const { result } = await runList(root);

    expect(result.upToDate).toBe(true);
    expect(result.orphaned).toEqual([]);
  });

  it("names copies waiting to be pruned", async () => {
    const root = await makeProjectRoot();
    await seedSyncedSkill(root, ".agents/skills", {
      skill: "prisma-composer",
      library: "@prisma/composer",
      version: "0.11.0",
    });

    const { result } = await runList(root);

    expect(result.orphaned).toEqual([
      {
        skill: "prisma-composer",
        library: "@prisma/composer",
        dirs: [".agents/skills"],
      },
    ]);
  });

  it("reports the check as disabled when prisma.config.ts turns it off", async () => {
    const root = await makeProjectRoot();
    const cli = createTestCli({
      commandFamilies: [skillsCommandFamily],
      commands: SKILLS_COMMANDS,
      groups: { skills: { brief: "Keep Prisma agent skills current" } },
      config: { skills: { check: false } },
      now: () => new Date(0),
    });

    const run = await cli.run(["skills", "list"], { cwd: root });

    expect((run.presented?.data as SkillsListResult).checkDisabled).toBe(true);
  });

  it("reads nothing and changes nothing", async () => {
    const root = await makeProjectRoot();
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.2.0",
      skills: ["prisma-8"],
    });

    await runList(root);

    for (const dir of HARNESS_SKILL_DIRS) {
      expect(await exists(path.join(root, dir))).toBe(false);
    }
  });
});

describe("harness directories that already exist", () => {
  it("writes into a directory the harness created, leaving its other skills alone", async () => {
    const root = await makeProjectRoot();
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });
    await mkdir(path.join(root, ".claude/skills", "team-skill"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, ".claude/skills", "team-skill", "SKILL.md"),
      "---\nname: team-skill\n---\n",
      "utf8",
    );

    await runSync(root);

    expect(
      await exists(path.join(root, ".claude/skills", "team-skill", "SKILL.md")),
    ).toBe(true);
    expect(await stampOf(root, ".claude/skills", "prisma-8")).toBe("8.1.0");
  });

  it("re-syncs after the copies are deleted by hand", async () => {
    const root = await makeProjectRoot();
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });
    await runSync(root);
    await rm(path.join(root, ".claude/skills"), {
      recursive: true,
      force: true,
    });

    const { result } = await runSync(root);

    expect(result.synced[0]?.dirs).toEqual([".claude/skills"]);
  });
});
