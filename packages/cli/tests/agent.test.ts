import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTempCwd, executeCli } from "./helpers";

function expectSkillsCommandPrefix(
  command: string[],
  binaryName: string,
  args: string[],
): void {
  expect(command[0]).toBe(binaryName);
  expect(command.slice(1, args.length + 1)).toEqual(args);
}

function mockSkillsExeca(
  stdout: unknown,
  options: { failed?: boolean; stderr?: string } = {},
) {
  const execa = vi.fn(async () => {
    if (options.failed) {
      throw new Error(options.stderr ?? "skills list failed");
    }

    return {
      stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout),
      stderr: options.stderr ?? "",
    };
  });

  vi.doMock("execa", () => ({ execa }));
  return execa;
}

afterEach(() => {
  vi.doUnmock("execa");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("agent commands", () => {
  it("shows help for agent commands", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const rootHelp = await executeCli({
      argv: ["--help"],
      cwd,
      stateDir,
    });
    const agentHelp = await executeCli({
      argv: ["agent", "--help"],
      cwd,
      stateDir,
    });
    const installHelp = await executeCli({
      argv: ["agent", "install", "--help"],
      cwd,
      stateDir,
    });
    const updateHelp = await executeCli({
      argv: ["agent", "update", "--help"],
      cwd,
      stateDir,
    });
    const statusHelp = await executeCli({
      argv: ["agent", "status", "--help"],
      cwd,
      stateDir,
    });

    expect(rootHelp.exitCode).toBe(0);
    expect(rootHelp.stderr).toContain("agent");

    expect(agentHelp.exitCode).toBe(0);
    expect(agentHelp.stderr).toContain(
      "Install Prisma context for AI coding agents",
    );
    expect(agentHelp.stderr).toContain(
      "$ npx -y @prisma/cli@latest agent install",
    );
    expect(agentHelp.stderr).toContain(
      "$ npx -y @prisma/cli@latest agent update",
    );
    expect(agentHelp.stderr).toContain(
      "$ npx -y @prisma/cli@latest agent status",
    );

    expect(installHelp.exitCode).toBe(0);
    expect(installHelp.stderr).toContain("--agent <agent>");
    expect(installHelp.stderr).toContain("--all-agents");
    expect(installHelp.stderr).toContain("--skill <skill>");
    expect(installHelp.stderr).not.toContain("--skip-skills");
    expect(installHelp.stderr).not.toContain("--skip-project-files");

    expect(updateHelp.exitCode).toBe(0);
    expect(updateHelp.stderr).toContain(
      "Refresh Prisma skills for AI coding agents",
    );
    expect(updateHelp.stderr).toContain("--all-agents");

    expect(statusHelp.exitCode).toBe(0);
    expect(statusHelp.stderr).toContain("--global");
  });

  it("uses the detected package manager in agent help examples", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({ packageManager: "pnpm@11.0.0" }, null, 2),
      "utf8",
    );

    const result = await executeCli({
      argv: ["agent", "--help"],
      cwd,
      stateDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(
      "$ pnpm dlx @prisma/cli@latest agent install",
    );
    expect(result.stderr).toContain(
      "$ pnpm dlx @prisma/cli@latest agent update",
    );
  });

  it("builds the skills CLI install command without writing files in dry-run mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: [
        "agent",
        "install",
        "--dry-run",
        "--agent",
        "codex",
        "--agent",
        "cursor",
        "--skill",
        "prisma-compute",
        "--global",
        "--copy",
        "--json",
      ],
      cwd,
      stateDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout);

    expect(payload).toMatchObject({
      ok: true,
      command: "agent.install",
      result: {
        operation: "install",
        skills: {
          status: "would-install",
        },
      },
      nextSteps: [],
    });
    expect(payload.result.skills.command).toEqual([
      "npx",
      "-y",
      "skills@latest",
      "add",
      "prisma/skills",
      "--skill",
      "prisma-compute",
      "--agent",
      "codex",
      "--agent",
      "cursor",
      "--global",
      "--copy",
      "--yes",
    ]);
  });

  it("renders agent install dry-run as a planned install", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["agent", "install", "--dry-run"],
      cwd,
      stateDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(
      "agent install → Would install Prisma skills.",
    );
    expect(result.stderr).toContain("skills:  would install");
    expect(result.stderr).toContain("--skill '*'");
  });

  it("uses the detected package manager for the skills installer", async () => {
    const cases = [
      {
        lockfile: "bun.lock",
        binary: "bunx",
        args: ["skills@latest", "add"],
      },
      {
        lockfile: "pnpm-lock.yaml",
        binary: "pnpm",
        args: ["dlx", "skills@latest", "add"],
      },
      {
        lockfile: "yarn.lock",
        binary: "yarn",
        args: ["dlx", "skills@latest", "add"],
      },
      {
        lockfile: "package-lock.json",
        binary: "npx",
        args: ["-y", "skills@latest", "add"],
      },
    ];

    await Promise.all(
      cases.map(async (testCase) => {
        const cwd = await createTempCwd();
        const stateDir = path.join(cwd, ".state");
        await writeFile(path.join(cwd, testCase.lockfile), "", "utf8");

        const result = await executeCli({
          argv: ["agent", "install", "--dry-run", "--json"],
          cwd,
          stateDir,
        });

        expect(result.exitCode).toBe(0);
        const payload = JSON.parse(result.stdout);
        expectSkillsCommandPrefix(
          payload.result.skills.command,
          testCase.binary,
          testCase.args,
        );
      }),
    );
  });

  it("runs the skills installer through Execa without streaming output", async () => {
    vi.resetModules();
    const execa = mockSkillsExeca("");
    const { createTestCommandContext } = await import("./helpers");
    const { runAgentInstall } = await import("../src/controllers/agent");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({ cwd, stateDir });

    const result = await runAgentInstall(context, {
      agent: ["codex"],
      skill: ["prisma-compute"],
    });

    const expectedCommand = [
      "npx",
      "-y",
      "skills@latest",
      "add",
      "prisma/skills",
      "--skill",
      "prisma-compute",
      "--agent",
      "codex",
      ...(process.platform === "win32" ? ["--copy"] : []),
      "--yes",
    ];
    expect(execa).toHaveBeenCalledWith(
      "npx",
      expectedCommand.slice(1),
      expect.objectContaining({
        cwd,
        env: context.runtime.env,
        cancelSignal: context.runtime.signal,
        stdin: "ignore",
      }),
    );
    const [, , execaOptions] = execa.mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(execaOptions).not.toHaveProperty("stdout");
    expect(execaOptions).not.toHaveProperty("stderr");
    expect(result.result.skills).toEqual({
      status: "installed",
      command: expectedCommand,
    });
  });

  it("prefers package.json packageManager for the skills installer", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writeFile(path.join(cwd, "package-lock.json"), "", "utf8");
    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({ packageManager: "pnpm@10.0.0" }, null, 2),
      "utf8",
    );

    const result = await executeCli({
      argv: ["agent", "install", "--dry-run", "--json"],
      cwd,
      stateDir,
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expectSkillsCommandPrefix(payload.result.skills.command, "pnpm", [
      "dlx",
      "skills@latest",
      "add",
    ]);
  });

  it("detects the package manager from a parent workspace", async () => {
    const cwd = await createTempCwd();
    const appPath = path.join(cwd, "apps", "web");
    const stateDir = path.join(cwd, ".state");
    await mkdir(appPath, { recursive: true });
    await writeFile(path.join(cwd, "pnpm-lock.yaml"), "", "utf8");

    const result = await executeCli({
      argv: ["agent", "install", "--dry-run", "--json"],
      cwd: appPath,
      stateDir,
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expectSkillsCommandPrefix(payload.result.skills.command, "pnpm", [
      "dlx",
      "skills@latest",
      "add",
    ]);
  });

  it("checks required Prisma skills from the skills lock", async () => {
    const cwd = await createTempCwd();
    await writeFile(
      path.join(cwd, "skills-lock.json"),
      JSON.stringify({
        version: 1,
        skills: {
          "prisma-client-api": {
            source: "prisma/skills",
            sourceType: "github",
            skillPath: "prisma-client-api/SKILL.md",
            computedHash: "test",
          },
        },
      }),
      "utf8",
    );

    const { readPrismaAgentSetupStatus } = await import(
      "../src/lib/agent/setup-status"
    );
    const signal = new AbortController().signal;

    await expect(
      readPrismaAgentSetupStatus({ cwd, signal }),
    ).resolves.toMatchObject({ skillsInstalled: true });
    await expect(
      readPrismaAgentSetupStatus({
        cwd,
        signal,
        requiredSkill: "prisma-compute",
      }),
    ).resolves.toMatchObject({ skillsInstalled: false });

    await writeFile(
      path.join(cwd, "skills-lock.json"),
      JSON.stringify({
        version: 1,
        skills: {
          "prisma-compute": {
            source: "prisma/skills",
            sourceType: "github",
            skillPath: "prisma-compute/SKILL.md",
            computedHash: "test",
          },
        },
      }),
      "utf8",
    );

    await expect(
      readPrismaAgentSetupStatus({
        cwd,
        signal,
        requiredSkill: "prisma-compute",
      }),
    ).resolves.toMatchObject({ skillsInstalled: true });
  });

  it("treats malformed skills lock files as not installed", async () => {
    const cwd = await createTempCwd();
    await writeFile(path.join(cwd, "skills-lock.json"), "{", "utf8");

    const { readPrismaAgentSetupStatus } = await import(
      "../src/lib/agent/setup-status"
    );

    await expect(
      readPrismaAgentSetupStatus({
        cwd,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ skillsInstalled: false });
  });

  it("keeps Windows command suffixes out of displayed agent commands", async () => {
    const platform = vi
      .spyOn(process, "platform", "get")
      .mockReturnValue("win32");
    try {
      const cwd = await createTempCwd();
      await writeFile(
        path.join(cwd, "package.json"),
        JSON.stringify({ packageManager: "pnpm@11.0.0" }, null, 2),
        "utf8",
      );

      const { resolvePrismaCliPackageCommandSync } = await import(
        "../src/lib/agent/cli-command"
      );
      const { resolveSkillsPackageRunner } = await import(
        "../src/lib/agent/package-manager"
      );

      expect(
        resolvePrismaCliPackageCommandSync(cwd, ["agent", "install"]),
      ).toBe("pnpm dlx @prisma/cli@latest agent install");
      const help = await executeCli({
        argv: ["agent", "--help"],
        cwd,
        stateDir: path.join(cwd, ".state"),
      });
      expect(help.exitCode).toBe(0);
      expect(help.stderr).toContain(
        "$ pnpm dlx @prisma/cli@latest agent install",
      );
      expect(help.stderr).not.toContain("pnpm.cmd");

      const install = await executeCli({
        argv: ["agent", "install", "--dry-run", "--json"],
        cwd,
        stateDir: path.join(cwd, ".state"),
      });
      expect(install.exitCode).toBe(0);
      await expect(access(path.join(cwd, "AGENTS.md"))).rejects.toThrow();
      await expect(access(path.join(cwd, "CLAUDE.md"))).rejects.toThrow();
      expect(JSON.parse(install.stdout).result.skills.command).toEqual([
        "pnpm",
        "dlx",
        "skills@latest",
        "add",
        "prisma/skills",
        "--skill",
        "*",
        "--agent",
        "codex",
        "--agent",
        "claude-code",
        "--copy",
        "--yes",
      ]);

      await expect(
        resolveSkillsPackageRunner({
          cwd,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual(["pnpm", "dlx"]);
    } finally {
      platform.mockRestore();
    }
  });

  it("leaves Windows command execution details to Execa", async () => {
    const platform = vi
      .spyOn(process, "platform", "get")
      .mockReturnValue("win32");
    try {
      const cwd = await createTempCwd();
      await writeFile(path.join(cwd, "bun.lock"), "", "utf8");

      const { resolvePrismaCliPackageCommandSync } = await import(
        "../src/lib/agent/cli-command"
      );
      const { resolveSkillsPackageRunner } = await import(
        "../src/lib/agent/package-manager"
      );

      expect(
        resolvePrismaCliPackageCommandSync(cwd, ["agent", "install"]),
      ).toBe("bunx @prisma/cli@latest agent install");
      await expect(
        resolveSkillsPackageRunner({
          cwd,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual(["bunx"]);
    } finally {
      platform.mockRestore();
    }
  });

  it("supports all agent targets in dry-run mode", async () => {
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");

    const result = await executeCli({
      argv: ["agent", "update", "--dry-run", "--all-agents", "--json"],
      cwd,
      stateDir,
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);

    expect(payload.command).toBe("agent.update");
    expect(payload.result.operation).toBe("update");
    expect(payload.result.skills.command).toContain("--agent");
    expect(payload.result.skills.command).toContain("*");
  });

  it("points global installs at the global status check", async () => {
    vi.resetModules();
    mockSkillsExeca("");
    const { createTestCommandContext } = await import("./helpers");
    const { runAgentInstall } = await import("../src/controllers/agent");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({ cwd, stateDir });

    const result = await runAgentInstall(context, { global: true });

    expect(result.nextSteps).toEqual([
      "Run npx -y @prisma/cli@latest agent status --global to verify the installed Prisma skills.",
    ]);
  });

  it("reports installed Prisma skills from the skills CLI", async () => {
    vi.resetModules();
    const execa = mockSkillsExeca([
      {
        name: "prisma-compute",
        path: "/repo/.agents/skills/prisma-compute",
        scope: "project",
        agents: ["Codex", "Cursor"],
      },
      {
        name: "unrelated",
        path: "/repo/.agents/skills/unrelated",
        scope: "project",
        agents: ["Codex"],
      },
    ]);
    const { createTestCommandContext } = await import("./helpers");
    const { runAgentStatus } = await import("../src/controllers/agent");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({ packageManager: "pnpm@11.0.0" }, null, 2),
      "utf8",
    );
    const { context } = await createTestCommandContext({ cwd, stateDir });

    const result = await runAgentStatus(context);

    expect(execa).toHaveBeenCalledWith(
      "pnpm",
      ["dlx", "skills@latest", "list", "--json"],
      expect.objectContaining({ cwd }),
    );
    expect(result.result).toMatchObject({
      skills: [
        {
          name: "prisma-compute",
          path: "/repo/.agents/skills/prisma-compute",
          scope: "project",
          agents: ["Codex", "Cursor"],
        },
      ],
      skillsListCommand: ["pnpm", "dlx", "skills@latest", "list", "--json"],
      statusScope: "project",
      skillsLockPath: "skills-lock.json",
      skillsLockInstalled: false,
      skillsInstalled: true,
      statusSource: "skills-cli",
      promptDismissedAt: null,
    });
    expect(result.warnings).toEqual([]);
    expect(result.nextSteps).toEqual([]);
  });

  it("reports globally installed Prisma skills from the skills CLI", async () => {
    vi.resetModules();
    const execa = mockSkillsExeca([
      {
        name: "prisma-compute",
        path: "/Users/aman/.agents/skills/prisma-compute",
        scope: "global",
        agents: ["Codex"],
      },
    ]);
    const { createTestCommandContext } = await import("./helpers");
    const { runAgentStatus } = await import("../src/controllers/agent");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    const { context } = await createTestCommandContext({ cwd, stateDir });

    const result = await runAgentStatus(context, { global: true });

    expect(execa).toHaveBeenCalledWith(
      "npx",
      ["-y", "skills@latest", "list", "-g", "--json"],
      expect.objectContaining({ cwd }),
    );
    expect(result.result).toMatchObject({
      skills: [
        {
          name: "prisma-compute",
          path: "/Users/aman/.agents/skills/prisma-compute",
          scope: "global",
          agents: ["Codex"],
        },
      ],
      skillsListCommand: ["npx", "-y", "skills@latest", "list", "-g", "--json"],
      statusScope: "global",
      skillsInstalled: true,
      statusSource: "skills-cli",
    });
    expect(result.nextSteps).toEqual([]);
  });

  it("checks Prisma skills from the compute config root when run in a subdirectory", async () => {
    vi.resetModules();
    const execa = mockSkillsExeca([
      {
        name: "prisma-compute",
        path: "/repo/.agents/skills/prisma-compute",
        scope: "project",
        agents: ["Codex"],
      },
    ]);
    const { createTestCommandContext } = await import("./helpers");
    const { runAgentStatus } = await import("../src/controllers/agent");
    const cwd = await createTempCwd();
    const appDir = path.join(cwd, "apps", "web");
    const stateDir = path.join(cwd, ".state");
    await mkdir(appDir, { recursive: true });
    await mkdir(path.join(cwd, ".git"), { recursive: true });
    await writeFile(
      path.join(cwd, "prisma.compute.ts"),
      'export default { apps: { web: { root: "apps/web" } } };\n',
      "utf8",
    );
    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({ packageManager: "pnpm@11.0.0" }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(cwd, "skills-lock.json"),
      JSON.stringify({ sources: ["prisma/skills"] }),
      "utf8",
    );
    const { context } = await createTestCommandContext({
      cwd: appDir,
      stateDir,
    });

    const result = await runAgentStatus(context);

    expect(execa).toHaveBeenCalledWith(
      "pnpm",
      ["dlx", "skills@latest", "list", "--json"],
      expect.objectContaining({ cwd }),
    );
    expect(result.result.skillsLockInstalled).toBe(true);
    expect(result.result.skillsInstalled).toBe(true);
    expect(result.result.statusScope).toBe("project");
    expect(result.result.skills).toEqual([
      {
        name: "prisma-compute",
        path: "/repo/.agents/skills/prisma-compute",
        scope: "project",
        agents: ["Codex"],
      },
    ]);
    expect(result.nextSteps).toEqual([]);
  });

  it("falls back to skills-lock status when skills CLI listing fails", async () => {
    vi.resetModules();
    mockSkillsExeca("", { failed: true, stderr: "skills exploded" });
    const { createTestCommandContext } = await import("./helpers");
    const { runAgentStatus } = await import("../src/controllers/agent");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writeFile(
      path.join(cwd, "skills-lock.json"),
      JSON.stringify({ sources: ["prisma/skills"] }),
      "utf8",
    );
    const { context } = await createTestCommandContext({ cwd, stateDir });

    const result = await runAgentStatus(context);

    expect(result.result).toEqual({
      skills: [],
      skillsListCommand: ["npx", "-y", "skills@latest", "list", "--json"],
      statusScope: "project",
      skillsLockPath: "skills-lock.json",
      skillsLockInstalled: true,
      skillsInstalled: true,
      statusSource: "skills-lock",
      promptDismissedAt: null,
    });
    expect(result.warnings[0]).toContain("skills exploded");
    expect(result.nextSteps).toEqual([]);
  });

  it("does not fall back to project skills-lock status for global status failures", async () => {
    vi.resetModules();
    mockSkillsExeca("", {
      failed: true,
      stderr: "global skills exploded",
    });
    const { createTestCommandContext } = await import("./helpers");
    const { runAgentStatus } = await import("../src/controllers/agent");
    const cwd = await createTempCwd();
    const stateDir = path.join(cwd, ".state");
    await writeFile(
      path.join(cwd, "skills-lock.json"),
      JSON.stringify({ sources: ["prisma/skills"] }),
      "utf8",
    );
    const { context } = await createTestCommandContext({ cwd, stateDir });

    const result = await runAgentStatus(context, { global: true });

    expect(result.result).toEqual({
      skills: [],
      skillsListCommand: ["npx", "-y", "skills@latest", "list", "-g", "--json"],
      statusScope: "global",
      skillsLockPath: "skills-lock.json",
      skillsLockInstalled: true,
      skillsInstalled: false,
      statusSource: "unavailable",
      promptDismissedAt: null,
    });
    expect(result.warnings[0]).toContain("global skills exploded");
    expect(result.nextSteps).toEqual([
      "Run npx -y @prisma/cli@latest agent install --global to install or refresh Prisma skills.",
    ]);
  });
});
