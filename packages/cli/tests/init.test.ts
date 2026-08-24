// biome-ignore-all lint/performance/noAwaitInLoops: each assertion reads the filesystem state the command left behind.
/**
 * `prisma init` against real project fixtures: the postinstall hook it
 * writes into package.json, the in-process skills sync it runs, and the
 * diagnostics it answers with when either step has nothing safe to do.
 */
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, it } from "vitest";

import {
  type InitResult,
  initCommand,
  POSTINSTALL_SCRIPT,
} from "../src/commands/init";
import { agentSkillDirs, DEFAULT_AGENTS } from "../src/lib/skills/allowlist";
import {
  installPackage,
  isolateModuleResolution,
  makeProjectRoot,
} from "./helpers/skills-fixture";

isolateModuleResolution();

const HARNESS_SKILL_DIRS = agentSkillDirs(DEFAULT_AGENTS);

/** `config` is what evaluating prisma.config.ts yields, section by
 *  section — the test CLI never reads the fixture's file, so any test
 *  whose config file matters supplies its evaluated form here. */
function makeCli(config?: Record<string, unknown>) {
  return createTestCli({
    commands: { init: initCommand },
    config,
    now: () => new Date(0),
  });
}

async function runInit(
  cwd: string,
  argv: readonly string[] = [],
  config?: Record<string, unknown>,
): Promise<{
  exitCode: number;
  result: InitResult;
  diagnosticCodes: string[];
}> {
  const run = await makeCli(config).run(["init", ...argv], { cwd });
  return {
    exitCode: run.exitCode,
    result: run.presented?.data as InitResult,
    diagnosticCodes: (run.presented?.diagnostics ?? []).map(
      (diagnostic) => diagnostic.code,
    ),
  };
}

async function readManifest(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

describe("init", () => {
  it("adds the postinstall hook and syncs the skills on a fresh project", async () => {
    const root = await makeProjectRoot("init-");
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });

    const { exitCode, result } = await runInit(root);

    expect(exitCode).toBe(0);
    expect(result.postinstall).toEqual({
      outcome: "added",
      script: POSTINSTALL_SCRIPT,
    });
    expect(result.config).toEqual({
      outcome: "created",
      agents: [...DEFAULT_AGENTS],
    });
    const scaffold = await readFile(
      path.join(root, "prisma.config.ts"),
      "utf8",
    );
    expect(scaffold).toContain(
      'import { definePrismaConfig } from "prisma/config";',
    );
    expect(scaffold).toContain(
      'agents: ["claude", "cursor", "agents", "devin"]',
    );
    expect(result.skills.outcome).toBe("synced");
    expect(result.skills.sync?.synced.map((skill) => skill.skill)).toEqual([
      "prisma-8",
    ]);
    const manifest = await readManifest(root);
    expect((manifest.scripts as Record<string, unknown>).postinstall).toBe(
      POSTINSTALL_SCRIPT,
    );
    expect(
      await exists(path.join(root, ".claude/skills", "prisma-8", "SKILL.md")),
    ).toBe(true);
  });

  it("keeps the file's indentation and its other fields", async () => {
    const root = await makeProjectRoot("init-");
    await writeFile(
      path.join(root, "package.json"),
      `{\n    "name": "four-spaces",\n    "version": "1.2.3",\n    "scripts": {\n        "build": "tsc"\n    }\n}\n`,
      "utf8",
    );

    await runInit(root);

    const source = await readFile(path.join(root, "package.json"), "utf8");
    expect(source).toContain('    "name": "four-spaces"');
    expect(source).toContain('        "build": "tsc"');
    expect(source).toContain(`        "postinstall": "${POSTINSTALL_SCRIPT}"`);
    expect(source.endsWith("\n")).toBe(true);
    expect((await readManifest(root)).version).toBe("1.2.3");
  });

  it("reports a hook that is already ours without rewriting the file", async () => {
    const root = await makeProjectRoot("init-");
    await runInit(root);
    const before = await readFile(path.join(root, "package.json"), "utf8");

    const { exitCode, result, diagnosticCodes } = await runInit(root, [], {
      skills: { agents: [...DEFAULT_AGENTS] },
    });

    expect(exitCode).toBe(0);
    expect(result.postinstall.outcome).toBe("exists");
    expect(diagnosticCodes).toEqual([]);
    expect(await readFile(path.join(root, "package.json"), "utf8")).toBe(
      before,
    );
  });

  it("never touches a postinstall script the user wrote", async () => {
    const root = await makeProjectRoot("init-");
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify(
        {
          name: "fixture-project",
          scripts: { postinstall: "husky install" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const before = await readFile(path.join(root, "package.json"), "utf8");

    const { exitCode, result, diagnosticCodes } = await runInit(root);

    expect(exitCode).toBe(0);
    expect(result.postinstall).toEqual({
      outcome: "kept",
      script: "husky install",
    });
    expect(diagnosticCodes).toContain("INIT.POSTINSTALL_KEPT");
    expect(await readFile(path.join(root, "package.json"), "utf8")).toBe(
      before,
    );
  });

  // chmod bits do not deny writes on Windows the way they do on POSIX.
  it.skipIf(process.platform === "win32")(
    "reports an unwritable package.json without failing",
    async () => {
      const root = await makeProjectRoot("init-");
      const manifestPath = path.join(root, "package.json");
      const before = await readFile(manifestPath, "utf8");
      await chmod(manifestPath, 0o444);

      const { exitCode, result, diagnosticCodes } = await runInit(root);
      await chmod(manifestPath, 0o644);

      expect(exitCode).toBe(0);
      expect(result.postinstall).toEqual({ outcome: "skipped", script: null });
      expect(diagnosticCodes).toContain("INIT.PACKAGE_JSON_UNWRITABLE");
      expect(await readFile(manifestPath, "utf8")).toBe(before);
    },
  );

  it("leaves a non-object scripts value untouched", async () => {
    const root = await makeProjectRoot("init-");
    await writeFile(
      path.join(root, "package.json"),
      `{\n  "name": "fixture-project",\n  "scripts": "oops"\n}\n`,
      "utf8",
    );
    const before = await readFile(path.join(root, "package.json"), "utf8");

    const { exitCode, result, diagnosticCodes } = await runInit(root);

    expect(exitCode).toBe(0);
    expect(result.postinstall).toEqual({ outcome: "kept", script: null });
    expect(diagnosticCodes).toContain("INIT.SCRIPTS_NOT_AN_OBJECT");
    expect(await readFile(path.join(root, "package.json"), "utf8")).toBe(
      before,
    );
  });

  it("keeps a UTF-8 BOM and still adds the hook", async () => {
    const root = await makeProjectRoot("init-");
    await writeFile(
      path.join(root, "package.json"),
      `\uFEFF{\n  "name": "bom-project"\n}\n`,
      "utf8",
    );

    const { exitCode, result } = await runInit(root);

    expect(exitCode).toBe(0);
    expect(result.postinstall.outcome).toBe("added");
    const source = await readFile(path.join(root, "package.json"), "utf8");
    expect(source.startsWith("\uFEFF")).toBe(true);
    expect(source).toContain(`"postinstall": "${POSTINSTALL_SCRIPT}"`);
  });

  it("preserves CRLF line endings", async () => {
    const root = await makeProjectRoot("init-");
    await writeFile(
      path.join(root, "package.json"),
      `{\r\n  "name": "crlf-project"\r\n}\r\n`,
      "utf8",
    );

    const { exitCode, result } = await runInit(root);

    expect(exitCode).toBe(0);
    expect(result.postinstall.outcome).toBe("added");
    const source = await readFile(path.join(root, "package.json"), "utf8");
    expect(source.endsWith("\r\n")).toBe(true);
    expect(source.split("\r\n").length).toBe(source.split("\n").length);
  });

  it("skips the hook with a diagnostic when there is no package.json", async () => {
    const root = await makeProjectRoot("init-");
    await rm(path.join(root, "package.json"));

    const { exitCode, result, diagnosticCodes } = await runInit(root);

    expect(exitCode).toBe(0);
    expect(result.postinstall).toEqual({ outcome: "skipped", script: null });
    expect(diagnosticCodes).toContain("INIT.NO_PACKAGE_JSON");
    expect(await exists(path.join(root, "package.json"))).toBe(false);
  });

  it("skips the hook on --no-postinstall and still syncs", async () => {
    const root = await makeProjectRoot("init-");
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });

    const { exitCode, result } = await runInit(root, ["--no-postinstall"]);

    expect(exitCode).toBe(0);
    expect(result.postinstall).toEqual({ outcome: "skipped", script: null });
    expect((await readManifest(root)).scripts).toBeUndefined();
    expect(result.skills.outcome).toBe("synced");
  });

  it("skips the sync and the config scaffold on --skills=none, and still adds the hook", async () => {
    const root = await makeProjectRoot("init-");
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });

    const { exitCode, result } = await runInit(root, ["--skills=none"]);

    expect(exitCode).toBe(0);
    expect(result.skills).toEqual({ outcome: "skipped", sync: null });
    expect(result.config).toEqual({ outcome: "skipped", agents: null });
    expect(result.postinstall.outcome).toBe("added");
    expect(await exists(path.join(root, "prisma.config.ts"))).toBe(false);
    for (const dir of HARNESS_SKILL_DIRS) {
      expect(await exists(path.join(root, dir))).toBe(false);
    }
  });

  it("reruns idempotently: both steps report already done", async () => {
    const root = await makeProjectRoot("init-");
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });
    await runInit(root);

    // The rerun evaluates the scaffold the first run wrote; the test
    // CLI stubs config loading, so its evaluated form is passed in.
    const { exitCode, result, diagnosticCodes } = await runInit(root, [], {
      skills: { agents: [...DEFAULT_AGENTS] },
    });

    expect(exitCode).toBe(0);
    expect(result.postinstall.outcome).toBe("exists");
    // The scaffold init itself wrote already carries skills.agents, so
    // the rerun neither edits it nor warns about it.
    expect(result.config).toEqual({ outcome: "exists", agents: null });
    expect(diagnosticCodes).toEqual([]);
    expect(result.skills.outcome).toBe("up-to-date");
    expect(result.skills.sync?.synced).toEqual([]);
    expect(result.skills.sync?.pruned).toEqual([]);
  });

  it("surfaces a refused directory instead of claiming the skills are current", async () => {
    const root = await makeProjectRoot("init-");
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });
    const userSkill = path.join(root, ".claude/skills", "prisma-8");
    await mkdir(userSkill, { recursive: true });
    await writeFile(
      path.join(userSkill, "SKILL.md"),
      "---\nname: prisma-8\n---\n\nMy own notes.\n",
      "utf8",
    );

    const run = await makeCli().run(["init"], {
      cwd: root,
      isTty: { stdout: true, stderr: true },
    });
    const result = run.presented?.data as InitResult;

    expect(run.exitCode).toBe(0);
    expect(result.skills.sync?.refused).toEqual([
      { skill: "prisma-8", dirs: [".claude/skills"] },
    ]);
    expect(
      (run.presented?.diagnostics ?? []).map((diagnostic) => diagnostic.code),
    ).toContain("SKILLS.UNMANAGED_DIRECTORY");
    expect(run.stderr).toContain(
      ".claude/skills/prisma-8 is not managed by this CLI, so it was left untouched.",
    );
    expect(run.stderr).not.toContain("Agent skills are up to date.");
  });

  it("writes the --skills list into the scaffold and syncs only those agents", async () => {
    const root = await makeProjectRoot("init-");
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });

    const { exitCode, result } = await runInit(root, [
      "--skills=claude,cursor",
    ]);

    expect(exitCode).toBe(0);
    expect(result.config).toEqual({
      outcome: "created",
      agents: ["claude", "cursor"],
    });
    expect(
      await readFile(path.join(root, "prisma.config.ts"), "utf8"),
    ).toContain('agents: ["claude", "cursor"]');
    expect(result.skills.sync?.synced[0]?.dirs).toEqual([
      ".claude/skills",
      ".cursor/skills",
    ]);
    expect(await exists(path.join(root, ".devin"))).toBe(false);
  });

  it("rejects --skills naming an unknown agent", async () => {
    const root = await makeProjectRoot("init-");

    const run = await makeCli().run(["init", "--skills=claude,zed"], {
      cwd: root,
      isTty: { stdout: true, stderr: true },
    });

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("'zed'");
    expect(await exists(path.join(root, "prisma.config.ts"))).toBe(false);
  });

  it("rejects none mixed with agent names", async () => {
    const root = await makeProjectRoot("init-");

    const run = await makeCli().run(["init", "--skills=none,claude"], {
      cwd: root,
      isTty: { stdout: true, stderr: true },
    });

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("cannot be combined");
  });

  it("never edits an existing prisma.config.ts, and says what to add", async () => {
    const root = await makeProjectRoot("init-");
    const configPath = path.join(root, "prisma.config.ts");
    const before = "export default { $prismaConfig: 1 };\n";
    await writeFile(configPath, before, "utf8");

    const { exitCode, result, diagnosticCodes } = await runInit(root, [
      "--skills=claude",
    ]);

    expect(exitCode).toBe(0);
    expect(result.config).toEqual({ outcome: "exists", agents: null });
    expect(diagnosticCodes).toContain("INIT.CONFIG_KEPT");
    expect(await readFile(configPath, "utf8")).toBe(before);
  });

  it("still advises when the file's text merely mentions skills and agents", async () => {
    // `skills:` and `agents:` both appear, but skills.agents is not
    // set: a text match would go quiet, the evaluated config does not.
    const root = await makeProjectRoot("init-");
    const configPath = path.join(root, "prisma.config.ts");
    await writeFile(
      configPath,
      'export default definePrismaConfig({\n  skills: { check: false },\n  // agents: ["claude"]\n});\n',
      "utf8",
    );

    const { exitCode, result, diagnosticCodes } = await runInit(root, [], {
      skills: { check: false },
    });

    expect(exitCode).toBe(0);
    expect(result.config).toEqual({ outcome: "exists", agents: null });
    expect(diagnosticCodes).toContain("INIT.CONFIG_KEPT");
  });

  it("stays quiet for a config that sets skills.agents in a spelling no text match sees", async () => {
    // Shorthand properties: the file never spells `agents:`, yet the
    // evaluated config carries skills.agents.
    const root = await makeProjectRoot("init-");
    await writeFile(
      path.join(root, "prisma.config.ts"),
      'const agents = ["claude"];\nconst skills = { agents };\nexport default definePrismaConfig({ skills });\n',
      "utf8",
    );

    const { exitCode, result, diagnosticCodes } = await runInit(root, [], {
      skills: { agents: ["claude"] },
    });

    expect(exitCode).toBe(0);
    expect(result.config).toEqual({ outcome: "exists", agents: null });
    expect(diagnosticCodes).toEqual([]);
  });

  it("shows the exact snippet for the agents the user asked for", async () => {
    const root = await makeProjectRoot("init-");
    await writeFile(
      path.join(root, "prisma.config.ts"),
      "export default { $prismaConfig: 1 };\n",
      "utf8",
    );

    const run = await makeCli().run(["init", "--skills=claude,cursor"], {
      cwd: root,
      isTty: { stdout: true, stderr: true },
    });

    expect(run.stderr).toContain('skills: { agents: ["claude", "cursor"] }');
  });

  it.skipIf(process.platform === "win32")(
    "turns a sync failure into a diagnostic on a successful init",
    async () => {
      const root = await makeProjectRoot("init-");
      await installPackage(root, {
        name: "@prisma/orm-postgres",
        version: "8.1.0",
        skills: ["prisma-8"],
      });
      // A parent the sync cannot create the skill directory in.
      const skillsDir = path.join(root, ".claude", "skills");
      await mkdir(skillsDir, { recursive: true });
      await chmod(skillsDir, 0o555);

      try {
        const { exitCode, result, diagnosticCodes } = await runInit(root);

        expect(exitCode).toBe(0);
        expect(result.skills).toEqual({ outcome: "failed", sync: null });
        expect(diagnosticCodes).toContain("INIT.SKILLS_SYNC_FAILED");
        expect(result.postinstall.outcome).toBe("added");
      } finally {
        await chmod(skillsDir, 0o755);
      }
    },
  );
});
