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
import { getCliVersion } from "../src/lib/version";
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
  adviceFor: (code: string) => string[];
}> {
  const run = await makeCli(config).run(["init", ...argv], { cwd });
  const diagnostics = run.presented?.diagnostics ?? [];
  return {
    exitCode: run.exitCode,
    result: run.presented?.data as InitResult,
    diagnosticCodes: diagnostics.map((diagnostic) => diagnostic.code),
    adviceFor: (code) =>
      diagnostics
        .filter((diagnostic) => diagnostic.code === code)
        .flatMap((diagnostic) => diagnostic.nextActions ?? [])
        .map((action) => action.label),
  };
}

const ADD_DEPENDENCY_ADVICE = `Add "prisma": "${getCliVersion()}" to devDependencies yourself, then run your package manager's install.`;

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
      dependency: "added",
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
    expect(manifest.devDependencies).toEqual({ prisma: getCliVersion() });
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

    const { exitCode, result, diagnosticCodes, adviceFor } =
      await runInit(root);

    expect(exitCode).toBe(0);
    expect(result.postinstall).toEqual({
      outcome: "kept",
      script: "husky install",
      dependency: "skipped",
    });
    expect(diagnosticCodes).toContain("INIT.POSTINSTALL_KEPT");
    expect(adviceFor("INIT.POSTINSTALL_KEPT")).toContain(ADD_DEPENDENCY_ADVICE);
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
      expect(result.postinstall).toEqual({
        outcome: "skipped",
        script: null,
        dependency: "skipped",
      });
      expect(diagnosticCodes).toContain("INIT.PACKAGE_JSON_UNWRITABLE");
      expect(await readFile(manifestPath, "utf8")).toBe(before);
    },
  );

  it.skipIf(process.platform === "win32")(
    "an unwritable package.json that already declares prisma reports the dependency declared",
    async () => {
      const root = await makeProjectRoot("init-");
      const manifestPath = path.join(root, "package.json");
      await writeFile(
        manifestPath,
        `${JSON.stringify(
          { name: "fixture-project", devDependencies: { prisma: "^7.0.0" } },
          null,
          2,
        )}\n`,
        "utf8",
      );
      await chmod(manifestPath, 0o444);

      const { exitCode, result, diagnosticCodes } = await runInit(root, [
        "--skills=none",
      ]);
      await chmod(manifestPath, 0o644);

      expect(exitCode).toBe(0);
      expect(result.postinstall).toEqual({
        outcome: "skipped",
        script: null,
        dependency: "declared",
      });
      expect(diagnosticCodes).toContain("INIT.PACKAGE_JSON_UNWRITABLE");
    },
  );

  it.skipIf(process.platform === "win32")(
    "an unreadable ancestor package.json does not fail init after the edit landed",
    async () => {
      const root = await makeProjectRoot("init-");
      const ancestorManifest = path.join(root, "package.json");
      const app = path.join(root, "app");
      await mkdir(app);
      await writeFile(
        path.join(app, "package.json"),
        `${JSON.stringify({ name: "nested-app" }, null, 2)}\n`,
        "utf8",
      );
      // The install-command detection walks ancestors; this one throws
      // EACCES instead of ENOENT.
      await chmod(ancestorManifest, 0o000);

      const run = await makeCli().run(["init", "--skills=none"], { cwd: app });
      await chmod(ancestorManifest, 0o644);
      const result = run.presented?.data as InitResult;

      expect(run.exitCode).toBe(0);
      expect(result.postinstall.dependency).toBe("added");
      expect((await readManifest(app)).devDependencies).toEqual({
        prisma: getCliVersion(),
      });
      expect(run.presented?.presentation.next).toEqual([
        {
          kind: "user-choice",
          label:
            "Run your package manager's install to fetch the added prisma dev dependency.",
        },
      ]);
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

    const { exitCode, result, diagnosticCodes, adviceFor } =
      await runInit(root);

    expect(exitCode).toBe(0);
    expect(result.postinstall).toEqual({
      outcome: "kept",
      script: null,
      dependency: "skipped",
    });
    expect(diagnosticCodes).toContain("INIT.SCRIPTS_NOT_AN_OBJECT");
    expect(adviceFor("INIT.SCRIPTS_NOT_AN_OBJECT")).toContain(
      ADD_DEPENDENCY_ADVICE,
    );
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

    const { exitCode, result, diagnosticCodes, adviceFor } =
      await runInit(root);

    expect(exitCode).toBe(0);
    expect(result.postinstall).toEqual({
      outcome: "skipped",
      script: null,
      dependency: "skipped",
    });
    expect(diagnosticCodes).toContain("INIT.NO_PACKAGE_JSON");
    expect(adviceFor("INIT.NO_PACKAGE_JSON")).toContain(ADD_DEPENDENCY_ADVICE);
    expect(await exists(path.join(root, "package.json"))).toBe(false);
  });

  it("reports an unparseable package.json with hook and dependency advice", async () => {
    const root = await makeProjectRoot("init-");
    await writeFile(path.join(root, "package.json"), "{ not json", "utf8");
    const before = await readFile(path.join(root, "package.json"), "utf8");

    const { exitCode, result, diagnosticCodes, adviceFor } =
      await runInit(root);

    expect(exitCode).toBe(0);
    expect(result.postinstall).toEqual({
      outcome: "skipped",
      script: null,
      dependency: "skipped",
    });
    expect(diagnosticCodes).toContain("INIT.PACKAGE_JSON_UNREADABLE");
    expect(adviceFor("INIT.PACKAGE_JSON_UNREADABLE")).toContain(
      ADD_DEPENDENCY_ADVICE,
    );
    expect(await readFile(path.join(root, "package.json"), "utf8")).toBe(
      before,
    );
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
    expect(result.postinstall).toEqual({
      outcome: "skipped",
      script: null,
      dependency: "skipped",
    });
    const manifest = await readManifest(root);
    expect(manifest.scripts).toBeUndefined();
    // The dependency add rides the manifest edit, so the opt-out skips
    // both; the config loader's guidance covers the missing package.
    expect(manifest.devDependencies).toBeUndefined();
    expect(result.skills.outcome).toBe("synced");
  });

  it("records --skills=none as an empty agents scaffold, skips the sync, and still adds the hook", async () => {
    const root = await makeProjectRoot("init-");
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });

    const { exitCode, result, diagnosticCodes } = await runInit(root, [
      "--skills=none",
    ]);

    expect(exitCode).toBe(0);
    expect(result.skills).toEqual({ outcome: "skipped", sync: null });
    expect(result.config).toEqual({ outcome: "created", agents: [] });
    expect(result.postinstall.outcome).toBe("added");
    expect(diagnosticCodes).toEqual([]);
    const scaffold = await readFile(
      path.join(root, "prisma.config.ts"),
      "utf8",
    );
    expect(scaffold).toContain("agents: [],");
    for (const dir of HARNESS_SKILL_DIRS) {
      expect(await exists(path.join(root, dir))).toBe(false);
    }
  });

  it("reruns --skills=none idempotently over its own scaffold", async () => {
    const root = await makeProjectRoot("init-");
    await runInit(root, ["--skills=none"]);
    const before = await readFile(path.join(root, "prisma.config.ts"), "utf8");

    const { exitCode, result, diagnosticCodes } = await runInit(
      root,
      ["--skills=none"],
      { skills: { agents: [] } },
    );

    expect(exitCode).toBe(0);
    expect(result.config).toEqual({ outcome: "exists", agents: null });
    expect(result.skills).toEqual({ outcome: "skipped", sync: null });
    expect(diagnosticCodes).toEqual([]);
    expect(await readFile(path.join(root, "prisma.config.ts"), "utf8")).toBe(
      before,
    );
  });

  it("advises the empty snippet when --skills=none meets a config init cannot edit", async () => {
    const root = await makeProjectRoot("init-");
    const configPath = path.join(root, "prisma.config.ts");
    const before = "export default { $prismaConfig: 1 };\n";
    await writeFile(configPath, before, "utf8");

    const run = await makeCli().run(["init", "--skills=none"], {
      cwd: root,
      isTty: { stdout: true, stderr: true },
    });
    const result = run.presented?.data as InitResult;

    expect(run.exitCode).toBe(0);
    expect(result.config).toEqual({ outcome: "exists", agents: null });
    expect(
      (run.presented?.diagnostics ?? []).map((diagnostic) => diagnostic.code),
    ).toContain("INIT.CONFIG_KEPT");
    expect(run.stderr).toContain("skills: { agents: [] }");
    expect(await readFile(configPath, "utf8")).toBe(before);
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

  it("reports no-skills when the installed packages ship none", async () => {
    const root = await makeProjectRoot("init-");
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "6.9.0",
    });

    const run = await makeCli().run(["init"], {
      cwd: root,
      isTty: { stdout: true, stderr: true },
    });
    const result = run.presented?.data as InitResult;

    expect(run.exitCode).toBe(0);
    expect(result.skills.outcome).toBe("no-skills");
    expect(run.stderr).toContain(
      "No Prisma dependencies in your project ship agent skills to sync.",
    );
    expect(run.stderr).not.toContain("up to date");
  });

  it("reports no-packages when no allowlisted package is installed", async () => {
    const root = await makeProjectRoot("init-");

    const { exitCode, result } = await runInit(root);

    expect(exitCode).toBe(0);
    expect(result.skills.outcome).toBe("no-packages");
    expect(result.skills.sync?.packages).toEqual([]);
  });

  it("reports no-agents when the config records agents: []", async () => {
    const root = await makeProjectRoot("init-");
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });

    const { exitCode, result } = await runInit(root, [], {
      skills: { agents: [] },
    });

    expect(exitCode).toBe(0);
    expect(result.skills.outcome).toBe("no-agents");
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

  it("adds the prisma dev dependency at the CLI's exact version, with install advice", async () => {
    const root = await makeProjectRoot("init-");

    const run = await makeCli().run(["init", "--skills=none"], { cwd: root });
    const result = run.presented?.data as InitResult;

    expect(run.exitCode).toBe(0);
    expect(result.postinstall.dependency).toBe("added");
    expect((await readManifest(root)).devDependencies).toEqual({
      prisma: getCliVersion(),
    });
    expect(run.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "Install the added prisma dev dependency",
        command: "npm install",
      },
    ]);
  });

  const DECLARING_FIELDS = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ] as const;

  for (const field of DECLARING_FIELDS) {
    it(`leaves every dependency field alone when prisma is in ${field}`, async () => {
      const root = await makeProjectRoot("init-");
      await writeFile(
        path.join(root, "package.json"),
        `${JSON.stringify(
          { name: "fixture-project", [field]: { prisma: "^7.0.0" } },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const { exitCode, result } = await runInit(root, ["--skills=none"]);

      expect(exitCode).toBe(0);
      expect(result.postinstall.outcome).toBe("added");
      expect(result.postinstall.dependency).toBe("declared");
      const manifest = await readManifest(root);
      expect(manifest[field]).toEqual({ prisma: "^7.0.0" });
      const others = DECLARING_FIELDS.filter((name) => name !== field);
      expect(others.map((name) => manifest[name])).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
    });
  }

  const MALFORMED_DEV_DEPENDENCIES = [
    ["a string", "oops"],
    ["an array", ["prisma"]],
  ] as const;

  for (const [shape, value] of MALFORMED_DEV_DEPENDENCIES) {
    it(`leaves a devDependencies field that is ${shape} untouched and reports the dependency skipped`, async () => {
      const root = await makeProjectRoot("init-");
      await writeFile(
        path.join(root, "package.json"),
        `${JSON.stringify(
          {
            name: "fixture-project",
            scripts: { postinstall: POSTINSTALL_SCRIPT },
            devDependencies: value,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      const before = await readFile(path.join(root, "package.json"), "utf8");

      const { exitCode, result, diagnosticCodes, adviceFor } = await runInit(
        root,
        ["--skills=none"],
      );

      expect(exitCode).toBe(0);
      expect(result.postinstall).toEqual({
        outcome: "exists",
        script: POSTINSTALL_SCRIPT,
        dependency: "skipped",
      });
      expect(diagnosticCodes).toContain("INIT.DEV_DEPENDENCIES_NOT_AN_OBJECT");
      expect(adviceFor("INIT.DEV_DEPENDENCIES_NOT_AN_OBJECT")).toEqual([
        `Fix the devDependencies field so it is an object, then add "prisma": "${getCliVersion()}" yourself and run your package manager's install.`,
      ]);
      expect(await readFile(path.join(root, "package.json"), "utf8")).toBe(
        before,
      );
    });
  }

  it("still adds the hook when devDependencies is malformed, preserving the field", async () => {
    const root = await makeProjectRoot("init-");
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify(
        { name: "fixture-project", devDependencies: "oops" },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const { exitCode, result, diagnosticCodes } = await runInit(root, [
      "--skills=none",
    ]);

    expect(exitCode).toBe(0);
    expect(result.postinstall).toEqual({
      outcome: "added",
      script: POSTINSTALL_SCRIPT,
      dependency: "skipped",
    });
    expect(diagnosticCodes).toContain("INIT.DEV_DEPENDENCIES_NOT_AN_OBJECT");
    const manifest = await readManifest(root);
    expect((manifest.scripts as Record<string, unknown>).postinstall).toBe(
      POSTINSTALL_SCRIPT,
    );
    expect(manifest.devDependencies).toBe("oops");
  });

  it("a kept foreign postinstall carries no dependency advice when prisma is declared", async () => {
    const root = await makeProjectRoot("init-");
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify(
        {
          name: "fixture-project",
          scripts: { postinstall: "husky install" },
          dependencies: { prisma: "8.0.0" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const { result, adviceFor } = await runInit(root, ["--skills=none"]);

    expect(result.postinstall.dependency).toBe("declared");
    expect(adviceFor("INIT.POSTINSTALL_KEPT")).not.toContain(
      ADD_DEPENDENCY_ADVICE,
    );
  });

  it("reports no install advice when prisma is already declared", async () => {
    const root = await makeProjectRoot("init-");
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify(
        { name: "fixture-project", dependencies: { prisma: "8.0.0" } },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const run = await makeCli().run(["init", "--skills=none"], { cwd: root });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.presentation.next).toEqual([]);
  });

  it("keeps indentation, BOM and CRLF around the added dependency", async () => {
    const root = await makeProjectRoot("init-");
    await writeFile(
      path.join(root, "package.json"),
      `\uFEFF{\r\n    "name": "windows-project"\r\n}\r\n`,
      "utf8",
    );

    const { result } = await runInit(root, ["--skills=none"]);

    expect(result.postinstall.dependency).toBe("added");
    const source = await readFile(path.join(root, "package.json"), "utf8");
    expect(source.startsWith("\uFEFF")).toBe(true);
    expect(source.endsWith("\r\n")).toBe(true);
    expect(source.split("\r\n").length).toBe(source.split("\n").length);
    expect(source).toContain(`    "prisma": "${getCliVersion()}"`);
  });

  it("a rerun whose hook exists still adds a dependency the user removed", async () => {
    const root = await makeProjectRoot("init-");
    await runInit(root, ["--skills=none"]);
    const manifest = await readManifest(root);
    delete (manifest as { devDependencies?: unknown }).devDependencies;
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    const { result } = await runInit(root, ["--skills=none"], {
      skills: { agents: [] },
    });

    expect(result.postinstall).toEqual({
      outcome: "exists",
      script: POSTINSTALL_SCRIPT,
      dependency: "added",
    });
    expect((await readManifest(root)).devDependencies).toEqual({
      prisma: getCliVersion(),
    });
  });

  it("runs every step when discovery finds no config file", async () => {
    const root = await makeProjectRoot("init-");
    const cli = createTestCli({
      commands: { init: initCommand },
      loadConfig: async () => ({ files: [], diagnostics: [] }),
      now: () => new Date(0),
    });

    const run = await cli.run(["init"], { cwd: root });
    const result = run.presented?.data as InitResult;

    expect(run.exitCode).toBe(0);
    expect(result.postinstall.outcome).toBe("added");
    expect(result.config.outcome).toBe("created");
    expect(result.skills.outcome).toBe("no-packages");
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

/**
 * Init below an ancestor config. The handler reads the chain from
 * ctx.configFiles — the load the engine's needs check already did —
 * so these tests seed the chain through the test CLI's loadConfig,
 * exactly as a real run's resolver would hand it over. The real-disk
 * discovery path is the init e2e's.
 */
describe("init below an ancestor config", () => {
  async function makeRepoWithAncestorConfig(): Promise<{
    root: string;
    nested: string;
  }> {
    const root = await makeProjectRoot("init-repo-");
    const nested = path.join(root, "packages", "db");
    await mkdir(nested, { recursive: true });
    await writeFile(
      path.join(nested, "package.json"),
      `${JSON.stringify({ name: "db-package", version: "0.0.0" }, null, 2)}\n`,
      "utf8",
    );
    return { root, nested };
  }

  /** The chain a subdirectory run resolves: one file, at the fixture
   *  root, above the run's cwd. */
  function ancestorChainCli(root: string) {
    return createTestCli({
      commands: { init: initCommand },
      loadConfig: async () => ({
        files: [{ path: path.join(root, "prisma.config.ts"), sections: {} }],
        diagnostics: [],
      }),
      now: () => new Date(0),
    });
  }

  it("skips the postinstall hook, the dependency, and the skills sync, and says why", async () => {
    const { root, nested } = await makeRepoWithAncestorConfig();

    const run = await ancestorChainCli(root).run(["init"], {
      cwd: nested,
      isTty: { stdout: true, stderr: true },
    });
    const result = run.presented?.data as InitResult;

    expect(run.exitCode).toBe(0);
    expect(result.postinstall).toEqual({
      outcome: "skipped",
      reason: "governing-config",
      script: null,
      dependency: "skipped",
    });
    expect(result.skills).toEqual({
      outcome: "skipped",
      reason: "governing-config",
      sync: null,
    });
    expect(result.config).toEqual({
      outcome: "created",
      agents: [...DEFAULT_AGENTS],
    });
    expect(run.stderr).toContain(
      "Skipped the postinstall hook and the prisma dev dependency",
    );
    expect(run.stderr).toContain("Skipped the skills sync");
    expect(run.stderr).toContain(
      "another prisma.config.ts already governs this directory",
    );
    expect(run.stderr).toContain("belong at the repository root");
    expect(await exists(path.join(nested, "prisma.config.ts"))).toBe(true);
    const manifest = await readManifest(nested);
    expect(manifest.scripts).toBeUndefined();
    expect(manifest.devDependencies).toBeUndefined();
  });

  it("--postinstall opts the manifest edit back in, the sync stays skipped", async () => {
    const { root, nested } = await makeRepoWithAncestorConfig();

    const run = await ancestorChainCli(root).run(["init", "--postinstall"], {
      cwd: nested,
    });
    const result = run.presented?.data as InitResult;

    expect(run.exitCode).toBe(0);
    expect(result.postinstall).toEqual({
      outcome: "added",
      script: POSTINSTALL_SCRIPT,
      dependency: "added",
    });
    expect(result.skills).toEqual({
      outcome: "skipped",
      reason: "governing-config",
      sync: null,
    });
    const manifest = await readManifest(nested);
    expect((manifest.scripts as Record<string, unknown>).postinstall).toBe(
      POSTINSTALL_SCRIPT,
    );
    expect(manifest.devDependencies).toEqual({ prisma: getCliVersion() });
  });

  it("--skills opts the sync back in, the manifest edit stays skipped", async () => {
    const { root, nested } = await makeRepoWithAncestorConfig();
    await installPackage(nested, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });

    const run = await ancestorChainCli(root).run(["init", "--skills=claude"], {
      cwd: nested,
    });
    const result = run.presented?.data as InitResult;

    expect(run.exitCode).toBe(0);
    expect(result.skills.outcome).toBe("synced");
    expect(
      await exists(path.join(nested, ".claude/skills", "prisma-8", "SKILL.md")),
    ).toBe(true);
    expect(result.postinstall).toEqual({
      outcome: "skipped",
      reason: "governing-config",
      script: null,
      dependency: "skipped",
    });
    expect(result.config).toEqual({ outcome: "created", agents: ["claude"] });
  });

  it("a config in cwd itself is not an ancestor and defers nothing", async () => {
    const root = await makeProjectRoot("init-repo-");
    await writeFile(
      path.join(root, "prisma.config.ts"),
      "export default { $prismaConfig: 1 };\n",
      "utf8",
    );

    // The default test-CLI loader places the seeded config in the
    // run's cwd, the non-ancestor shape.
    const { exitCode, result } = await runInit(root, [], {
      skills: { agents: [...DEFAULT_AGENTS] },
    });

    expect(exitCode).toBe(0);
    expect(result.postinstall.outcome).toBe("added");
    expect(result.postinstall.reason).toBeUndefined();
    expect(result.config.outcome).toBe("exists");
    expect(result.skills.outcome).toBe("no-packages");
  });
});
