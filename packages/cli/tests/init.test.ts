// biome-ignore-all lint/performance/noAwaitInLoops: each assertion reads the filesystem state the command left behind.
/**
 * `prisma init` against real project fixtures: the postinstall hook it
 * writes into package.json, the in-process skills sync it runs, and the
 * diagnostics it answers with when either step has nothing safe to do.
 */
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, it } from "vitest";

import {
  type InitResult,
  initCommand,
  POSTINSTALL_SCRIPT,
} from "../src/commands/init";
import { HARNESS_SKILL_DIRS } from "../src/lib/skills/allowlist";
import {
  installPackage,
  isolateModuleResolution,
  makeProjectRoot,
} from "./helpers/skills-fixture";

isolateModuleResolution();

function makeCli() {
  return createTestCli({
    commands: { init: initCommand },
    now: () => new Date(0),
  });
}

async function runInit(
  cwd: string,
  argv: readonly string[] = [],
): Promise<{
  exitCode: number;
  result: InitResult;
  diagnosticCodes: string[];
}> {
  const run = await makeCli().run(["init", ...argv], { cwd });
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

    const { exitCode, result, diagnosticCodes } = await runInit(root);

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

  it("skips the sync on --no-skills and still adds the hook", async () => {
    const root = await makeProjectRoot("init-");
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });

    const { exitCode, result } = await runInit(root, ["--no-skills"]);

    expect(exitCode).toBe(0);
    expect(result.skills).toEqual({ outcome: "skipped", sync: null });
    expect(result.postinstall.outcome).toBe("added");
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

    const { exitCode, result } = await runInit(root);

    expect(exitCode).toBe(0);
    expect(result.postinstall.outcome).toBe("exists");
    expect(result.skills.outcome).toBe("up-to-date");
    expect(result.skills.sync?.synced).toEqual([]);
    expect(result.skills.sync?.pruned).toEqual([]);
  });

  it("turns a sync failure into a diagnostic on a successful init", async () => {
    const root = await makeProjectRoot("init-");
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });
    // A regular file where the sync must make a directory.
    await writeFile(path.join(root, ".claude"), "not a directory\n", "utf8");

    const { exitCode, result, diagnosticCodes } = await runInit(root);

    expect(exitCode).toBe(0);
    expect(result.skills).toEqual({ outcome: "failed", sync: null });
    expect(diagnosticCodes).toContain("INIT.SKILLS_SYNC_FAILED");
    expect(result.postinstall.outcome).toBe("added");
  });
});
