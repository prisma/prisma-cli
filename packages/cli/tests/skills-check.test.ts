// biome-ignore-all lint/performance/noAwaitInLoops: the fixture writes one harness directory after another.
/**
 * The staleness check as the bin runs it: one stderr line after the
 * command's own output, never touching the exit code, and silent
 * through every off switch.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PRISMA_CONFIG_VERSION } from "@prisma/cli-engine";
import { describe, expect, it } from "vitest";

import { main } from "../src/main";
import type { HostProcess } from "../src/runtime";
import {
  installPackage,
  isolateModuleResolution,
  makeProjectRoot,
  seedSyncedSkill,
} from "./helpers/skills-fixture";

isolateModuleResolution();

const NOTICE = "Prisma agent skills are out of date";

/** What definePrismaConfig produces, written out: a fixture project has
 *  no node_modules the config file could import the engine from. */
function configSource(skills: {
  check?: unknown;
  agents?: readonly string[];
}): string {
  return `export default ${JSON.stringify({
    $prismaConfig: PRISMA_CONFIG_VERSION,
    skills,
  })};\n`;
}

function makeProcess(overrides: {
  cwd: string;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  exitCode?: number;
}): HostProcess & { stdoutText: string; stderrText: string } {
  const proc = {
    argv: ["node", "bin.js", ...(overrides.argv ?? ["auth", "whoami"])],
    env: {
      PRISMA_DISABLE_TELEMETRY: "1",
      // The update check has its own suite; keep it out of this stderr.
      NO_UPDATE_NOTIFIER: "1",
      ...overrides.env,
    },
    cwd: () => overrides.cwd,
    version: "v22.12.0",
    versions: { node: "22.12.0" },
    platform: "linux",
    arch: "x64",
    stdoutText: "",
    stderrText: "",
    stdout: {
      isTTY: false,
      write(text: string) {
        proc.stdoutText += text;
      },
    },
    stderr: {
      isTTY: false,
      write(text: string) {
        proc.stderrText += text;
      },
    },
    stdin: {
      isTTY: false,
      async *[Symbol.asyncIterator]() {},
    } as unknown as HostProcess["stdin"],
    on: () => proc,
    off: () => proc,
    exit(code: number): never {
      throw new Error(`process.exit(${code})`);
    },
  };
  return proc;
}

function stubCli(exitCode = 0, marker?: string) {
  return () => ({
    run: async (
      _argv: readonly string[],
      runtime: { stderr: { write(text: string): void } },
    ) => {
      if (marker !== undefined) {
        runtime.stderr.write(`${marker}\n`);
      }
      return exitCode;
    },
  });
}

/** A project whose installed package is newer than the copies in its
 *  harness directories. */
async function makeStaleProject(): Promise<string> {
  const root = await makeProjectRoot("check-");
  await installPackage(root, {
    name: "@prisma/orm-postgres",
    version: "8.1.0",
    skills: ["prisma-8"],
  });
  await seedSyncedSkill(root, ".claude/skills", {
    skill: "prisma-8",
    library: "@prisma/orm-postgres",
    version: "8.0.0",
  });
  return root;
}

async function makeSyncedProject(): Promise<string> {
  const root = await makeProjectRoot("check-");
  await installPackage(root, {
    name: "@prisma/orm-postgres",
    version: "8.1.0",
    skills: ["prisma-8"],
  });
  for (const dir of [
    ".claude/skills",
    ".cursor/skills",
    ".agents/skills",
    ".devin/skills",
  ]) {
    await seedSyncedSkill(root, dir, {
      skill: "prisma-8",
      library: "@prisma/orm-postgres",
      version: "8.1.0",
    });
  }
  return root;
}

describe("the skills check", () => {
  it("names the installed and synced versions on stderr", async () => {
    const proc = makeProcess({ cwd: await makeStaleProject() });

    const exitCode = await main(proc, stubCli());

    expect(exitCode).toBe(0);
    expect(proc.stderrText).toBe(
      "Prisma agent skills are out of date (installed @prisma/orm-postgres 8.1.0, synced 8.0.0). Run: prisma skills sync\n",
    );
    expect(proc.stdoutText).toBe("");
  });

  it("reports a project that was never synced the same way", async () => {
    const root = await makeProjectRoot("check-");
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
    });
    const proc = makeProcess({ cwd: root });

    await main(proc, stubCli());

    expect(proc.stderrText).toContain(
      "(installed @prisma/orm-postgres 8.1.0, synced none)",
    );
  });

  it("writes after the command's own output", async () => {
    const proc = makeProcess({ cwd: await makeStaleProject() });

    await main(proc, stubCli(0, "COMMAND-OUTPUT-MARKER"));

    expect(proc.stderrText.indexOf("COMMAND-OUTPUT-MARKER")).toBeLessThan(
      proc.stderrText.indexOf(NOTICE),
    );
  });

  it("leaves a failing command's exit code alone", async () => {
    const proc = makeProcess({ cwd: await makeStaleProject() });

    const exitCode = await main(proc, stubCli(2));

    expect(exitCode).toBe(2);
    expect(proc.stderrText).toContain(NOTICE);
  });

  it("says nothing when every copy is current", async () => {
    const proc = makeProcess({ cwd: await makeSyncedProject() });

    await main(proc, stubCli());

    expect(proc.stderrText).toBe("");
  });

  it("never evaluates the config when every copy is current", async () => {
    // The check swallows errors, so a throwing config alone could not
    // tell "never evaluated" from "evaluated and caught": evaluation
    // must leave a visible trace.
    const root = await makeSyncedProject();
    const marker = path.join(root, "config-evaluated.txt");
    await writeFile(
      path.join(root, "prisma.config.ts"),
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "");\n` +
        'throw new Error("the check evaluated the config");\n',
      "utf8",
    );
    const proc = makeProcess({ cwd: root });

    const exitCode = await main(proc, stubCli());

    expect(exitCode).toBe(0);
    expect(proc.stderrText).toBe("");
    expect(existsSync(marker)).toBe(false);
  });

  it("says nothing when no allowlisted package is installed", async () => {
    const proc = makeProcess({ cwd: await makeProjectRoot("check-") });

    await main(proc, stubCli());

    expect(proc.stderrText).toBe("");
  });

  it("says nothing when the project directory cannot be read", async () => {
    const proc = makeProcess({ cwd: "/nonexistent-project-directory" });

    const exitCode = await main(proc, stubCli());

    expect(exitCode).toBe(0);
    expect(proc.stderrText).toBe("");
  });
});

describe("the skills check off switches", () => {
  it.each([
    ["--quiet", { argv: ["auth", "whoami", "--quiet"] }],
    ["-q", { argv: ["auth", "whoami", "-q"] }],
    ["--json", { argv: ["auth", "whoami", "--json"] }],
    ["--format json", { argv: ["auth", "whoami", "--format", "json"] }],
    ["--format=json", { argv: ["auth", "whoami", "--format=json"] }],
    ["--version", { argv: ["--version"] }],
    ["PRISMA_SKILLS_CHECK=0", { env: { PRISMA_SKILLS_CHECK: "0" } }],
    ["CI", { env: { CI: "1" } }],
    ["GITHUB_ACTIONS", { env: { GITHUB_ACTIONS: "true" } }],
    [
      "TEAMCITY_VERSION (no CI variable)",
      { env: { TEAMCITY_VERSION: "2025.1" } },
    ],
  ])("stays silent under %s", async (_name, overrides) => {
    const proc = makeProcess({ cwd: await makeStaleProject(), ...overrides });

    await main(proc, stubCli());

    expect(proc.stderrText).toBe("");
  });

  it.each([
    ["skills list", ["skills", "list"]],
    [
      "a global flag before the group",
      ["--config", "prisma.config.ts", "skills", "list"],
    ],
    ["init, which syncs or was told not to", ["init"]],
  ])("stays silent for the commands that fix it (%s)", async (_name, argv) => {
    const proc = makeProcess({ cwd: await makeStaleProject(), argv });

    await main(proc, stubCli());

    expect(proc.stderrText).toBe("");
  });

  it("ignores suppressing tokens after a bare --", async () => {
    const proc = makeProcess({
      cwd: await makeStaleProject(),
      argv: ["auth", "whoami", "--", "--json"],
    });

    await main(proc, stubCli());

    expect(proc.stderrText).toContain(NOTICE);
  });

  it("stays silent after skills sync --disable persisted the opt-out", async () => {
    const root = await makeStaleProject();
    await mkdir(path.join(root, ".prisma"), { recursive: true });
    await writeFile(
      path.join(root, ".prisma", "skills.json"),
      '{ "check": false }\n',
      "utf8",
    );
    const proc = makeProcess({ cwd: root });

    await main(proc, stubCli());

    expect(proc.stderrText).toBe("");
  });

  it("stays silent when prisma.config.ts sets skills.check to false", async () => {
    const root = await makeStaleProject();
    await writeFile(
      path.join(root, "prisma.config.ts"),
      configSource({ check: false }),
      "utf8",
    );
    const proc = makeProcess({ cwd: root });

    await main(proc, stubCli());

    expect(proc.stderrText).toBe("");
  });

  it.each([
    ["--config <path>", ["--config", "elsewhere.config.ts"]],
    ["--config=<path>", ["--config=elsewhere.config.ts"]],
  ])("reads the config file an explicit %s names", async (_name, configArgv) => {
    const root = await makeStaleProject();
    await writeFile(
      path.join(root, "elsewhere.config.ts"),
      configSource({ check: false }),
      "utf8",
    );
    const proc = makeProcess({
      cwd: root,
      argv: ["auth", "whoami", ...configArgv],
    });

    await main(proc, stubCli());

    expect(proc.stderrText).toBe("");
  });

  it("still reports when prisma.config.ts leaves the check on", async () => {
    const root = await makeStaleProject();
    await writeFile(
      path.join(root, "prisma.config.ts"),
      configSource({ check: true }),
      "utf8",
    );
    const proc = makeProcess({ cwd: root });

    await main(proc, stubCli());

    expect(proc.stderrText).toContain(NOTICE);
  });

  it("still reports when the config's skills section fails validation", async () => {
    // A broken config must not silence the check: the invalid section
    // reads as null and the check falls back to the defaults.
    const root = await makeStaleProject();
    await writeFile(
      path.join(root, "prisma.config.ts"),
      configSource({ check: "yes" }),
      "utf8",
    );
    const proc = makeProcess({ cwd: root });

    await main(proc, stubCli());

    expect(proc.stderrText).toContain(NOTICE);
  });

  it("stays silent when only a directory outside the configured agents is stale", async () => {
    // .claude holds the stale copy; the config narrows the project to
    // cursor, whose directory sync would create, so nothing the config
    // cares about is out of date.
    const root = await makeProjectRoot("check-");
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
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
      version: "8.1.0",
    });
    await writeFile(
      path.join(root, "prisma.config.ts"),
      configSource({ agents: ["cursor"] }),
      "utf8",
    );
    const proc = makeProcess({ cwd: root });

    await main(proc, stubCli());

    expect(proc.stderrText).toBe("");
  });

  it("stays silent when the config records agents: [], even with stale copies on disk", async () => {
    const root = await makeStaleProject();
    await writeFile(
      path.join(root, "prisma.config.ts"),
      configSource({ agents: [] }),
      "utf8",
    );
    const proc = makeProcess({ cwd: root });

    await main(proc, stubCli());

    expect(proc.stderrText).toBe("");
  });

  it("honors a repository root's skills.check from a nested directory", async () => {
    // The stale install lives in packages/app; the config that turns
    // the check off lives at the repository root. The first run, before
    // the root config exists, proves the fixture is genuinely stale
    // from the nested directory.
    const root = await makeProjectRoot("check-");
    await mkdir(path.join(root, ".git"), { recursive: true });
    const member = path.join(root, "packages", "app");
    await installPackage(root, {
      name: "@prisma/orm-postgres",
      version: "8.1.0",
      skills: ["prisma-8"],
      member: "packages/app",
    });
    await seedSyncedSkill(member, ".claude/skills", {
      skill: "prisma-8",
      library: "@prisma/orm-postgres",
      version: "8.0.0",
    });
    const before = makeProcess({ cwd: member });
    await main(before, stubCli());
    expect(before.stderrText).toContain(NOTICE);

    await writeFile(
      path.join(root, "prisma.config.ts"),
      configSource({ check: false }),
      "utf8",
    );
    const after = makeProcess({ cwd: member });
    await main(after, stubCli());
    expect(after.stderrText).toBe("");
  });

  it("still reports a stale copy inside the configured agents", async () => {
    const root = await makeStaleProject();
    await writeFile(
      path.join(root, "prisma.config.ts"),
      configSource({ agents: ["claude"] }),
      "utf8",
    );
    const proc = makeProcess({ cwd: root });

    await main(proc, stubCli());

    expect(proc.stderrText).toContain(NOTICE);
  });
});
