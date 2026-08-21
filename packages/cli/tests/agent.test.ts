import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createTestCli } from "@prisma/cli-engine/testing";
import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeTempCwd, mountsFor } from "./service-testkit";

vi.mock("execa", () => ({ execa: vi.fn() }));

const AGENT_COMMANDS = mountsFor(["agent"]);

/** The whole group is local: no session is ever seeded, so every run
 *  here also proves the unauthenticated axis of R-S2b-9. */
function makeCli(platform?: string) {
  return createTestCli({
    commands: AGENT_COMMANDS,
    groups: { agent: { brief: "Install Prisma context for AI coding agents" } },
    now: () => new Date(0),
    ...(platform === undefined
      ? {}
      : {
          host: {
            runtime: { name: "node", version: "v22.12.0" },
            platform,
            arch: "x64",
          },
        }),
  });
}

async function makeCwd(): Promise<{
  cwd: string;
  env: Record<string, string>;
}> {
  const cwd = await makeTempCwd("agent-");
  return { cwd, env: { PRISMA_CLI_STATE_DIR: path.join(cwd, ".state") } };
}

function skillsListStdout(skills: unknown): { stdout: string; stderr: string } {
  return { stdout: JSON.stringify(skills), stderr: "" };
}

function errorFrame(json: readonly unknown[]) {
  const frame = json[json.length - 1] as
    | { kind: string; envelope: { ok: boolean } }
    | undefined;
  if (frame?.kind !== "result" || frame.envelope.ok) {
    throw new Error("expected an errored envelope");
  }
  return frame.envelope as unknown as {
    ok: false;
    commandId: string;
    error: {
      code: string;
      summary: string;
      why?: string;
      nextActions: Array<{ kind: string; label: string; command?: string }>;
    };
  };
}

function completedFrame(json: readonly unknown[]) {
  const frame = json[json.length - 1] as
    | { kind: string; envelope: { ok: boolean } }
    | undefined;
  if (frame?.kind !== "result" || !frame.envelope.ok) {
    throw new Error("expected a completed envelope");
  }
  return frame.envelope as unknown as {
    ok: true;
    commandId: string;
    result: unknown;
    diagnostics: Array<{ code: string; severity: string; summary: string }>;
    nextActions: Array<{ kind: string; label: string; command?: string }>;
  };
}

beforeEach(() => {
  vi.mocked(execa).mockReset();
});

describe("prisma-cli agent install", () => {
  it("declares no credential needs and runs without a session", async () => {
    for (const command of Object.values(AGENT_COMMANDS)) {
      expect(command.needs.credentials).toBe(false);
    }
  });

  it("builds the installer command without spawning it in dry-run mode", async () => {
    const { cwd, env } = await makeCwd();

    const result = await makeCli().run(
      [
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
      ],
      { cwd, env },
    );

    expect(result.exitCode).toBe(0);
    expect(execa).not.toHaveBeenCalled();
    expect(result.presented?.data).toEqual({
      operation: "install",
      skills: {
        status: "would-install",
        command: [
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
        ],
      },
    });
    expect(result.presented?.presentation.next).toEqual([]);
  });

  it("spawns the installer with the run's cwd, env and signal, and reports it installed", async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: "",
      stderr: "",
    } as never);
    const { cwd, env } = await makeCwd();

    const result = await makeCli().run(["agent", "install"], { cwd, env });

    expect(result.exitCode).toBe(0);
    const expectedCommand = [
      "npx",
      "-y",
      "skills@latest",
      "add",
      "prisma/skills",
      "--skill",
      "*",
      "--agent",
      "codex",
      "--agent",
      "claude-code",
      // The harness host is fixed to linux, so --copy never joins here;
      // the Windows rule has its own test below.
      "--yes",
    ];
    expect(execa).toHaveBeenCalledWith(
      "npx",
      expectedCommand.slice(1),
      expect.objectContaining({ cwd, env, stdin: "ignore" }),
    );
    const [, , options] = vi.mocked(execa).mock.calls[0] as unknown as [
      string,
      string[],
      { cancelSignal: AbortSignal },
    ];
    expect(options.cancelSignal).toBeInstanceOf(AbortSignal);
    // The installer's own output must not reach the CLI's streams: every
    // byte a command writes goes through the engine's event protocol.
    expect(options).not.toHaveProperty("stdout");
    expect(options).not.toHaveProperty("stderr");
    expect(result.presented?.data).toEqual({
      operation: "install",
      skills: { status: "installed", command: expectedCommand },
    });
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "Verify the installed Prisma skills",
        command: "npx -y @prisma/cli@next agent status",
      },
    ]);
  });

  it("points a global install at the global status check", async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: "", stderr: "" } as never);
    const { cwd, env } = await makeCwd();

    const result = await makeCli().run(["agent", "install", "--global"], {
      cwd,
      env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "Verify the installed Prisma skills",
        command: "npx -y @prisma/cli@next agent status --global",
      },
    ]);
  });

  it("asks the skills CLI for every agent with --all-agents", async () => {
    const { cwd, env } = await makeCwd();

    const result = await makeCli().run(
      ["agent", "install", "--dry-run", "--all-agents"],
      { cwd, env },
    );

    expect(result.exitCode).toBe(0);
    const command = (
      result.presented?.data as { skills: { command: string[] } }
    ).skills.command;
    expect(command).toContain("--agent");
    expect(command).toContain("*");
    expect(command).not.toContain("codex");
  });

  it("forces --copy on Windows and leaves it off on other platforms", async () => {
    const { cwd, env } = await makeCwd();
    const installerCommandOn = async (platform: string) => {
      const result = await makeCli(platform).run(
        ["agent", "install", "--dry-run"],
        { cwd, env },
      );
      return (result.presented?.data as { skills: { command: string[] } })
        .skills.command;
    };

    // Each platform's expectation is written out rather than rebuilt from
    // the host's platform, so inverting the rule fails this test instead of
    // being mirrored by it.
    expect(await installerCommandOn("win32")).toContain("--copy");
    expect(await installerCommandOn("linux")).not.toContain("--copy");
  });

  it("uses the detected package manager for the installer", async () => {
    const { cwd, env } = await makeCwd();
    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({ packageManager: "pnpm@11.0.0" }),
      "utf8",
    );

    const result = await makeCli().run(["agent", "install", "--dry-run"], {
      cwd,
      env,
    });

    expect(result.exitCode).toBe(0);
    const command = (
      result.presented?.data as { skills: { command: string[] } }
    ).skills.command;
    expect(command.slice(0, 4)).toEqual([
      "pnpm",
      "dlx",
      "skills@latest",
      "add",
    ]);
  });

  it("settles a failed installer as AGENT.SKILLS_INSTALL_FAILED with the installer command as a next action", async () => {
    vi.mocked(execa).mockRejectedValue(
      Object.assign(new Error("skills exploded"), { exitCode: 7 }),
    );
    const { cwd, env } = await makeCwd();

    const result = await makeCli().run(["agent", "install", "--json"], {
      cwd,
      env,
    });

    expect(result.exitCode).toBe(2);
    const envelope = errorFrame(result.json);
    expect(envelope.commandId).toBe("agent.install");
    expect(envelope.error.code).toBe("AGENT.SKILLS_INSTALL_FAILED");
    expect(envelope.error.summary).toBe("Prisma skills install failed");
    expect(envelope.error.why).toBe("The skills installer exited with code 7.");
    expect(envelope.error.nextActions).toEqual([
      {
        kind: "run-command",
        label: "Retry the installer directly",
        // The harness host is fixed to linux, whatever machine runs this.
        command:
          "npx -y skills@latest add prisma/skills --skill '*' --agent codex --agent claude-code --yes",
      },
    ]);
  });

  it("emits the completed json envelope with commandId agent.install", async () => {
    const { cwd, env } = await makeCwd();

    const result = await makeCli().run(
      ["agent", "install", "--dry-run", "--json"],
      { cwd, env },
    );

    expect(result.exitCode).toBe(0);
    const envelope = completedFrame(result.json);
    expect(envelope.commandId).toBe("agent.install");
    expect(envelope.result).toMatchObject({
      operation: "install",
      skills: { status: "would-install" },
    });
  });
});

describe("prisma-cli agent update", () => {
  it("runs the same operation under the update name", async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: "", stderr: "" } as never);
    const { cwd, env } = await makeCwd();

    const result = await makeCli().run(["agent", "update", "--json"], {
      cwd,
      env,
    });

    expect(result.exitCode).toBe(0);
    const envelope = completedFrame(result.json);
    expect(envelope.commandId).toBe("agent.update");
    expect(envelope.result).toMatchObject({
      operation: "update",
      skills: { status: "installed" },
    });
    expect(execa).toHaveBeenCalledTimes(1);
  });

  it("settles a failed installer as AGENT.SKILLS_INSTALL_FAILED", async () => {
    vi.mocked(execa).mockRejectedValue(new Error("skills exploded"));
    const { cwd, env } = await makeCwd();

    const result = await makeCli().run(["agent", "update", "--json"], {
      cwd,
      env,
    });

    expect(result.exitCode).toBe(2);
    const envelope = errorFrame(result.json);
    expect(envelope.commandId).toBe("agent.update");
    expect(envelope.error.code).toBe("AGENT.SKILLS_INSTALL_FAILED");
    expect(envelope.error.why).toBe(
      "The skills installer exited with code unknown.",
    );
  });
});

describe("prisma-cli agent status", () => {
  it("reports the Prisma skills the skills CLI lists and drops the rest", async () => {
    vi.mocked(execa).mockResolvedValue(
      skillsListStdout([
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
      ]) as never,
    );
    const { cwd, env } = await makeCwd();

    const result = await makeCli().run(["agent", "status"], { cwd, env });

    expect(result.exitCode).toBe(0);
    expect(execa).toHaveBeenCalledWith(
      "npx",
      ["-y", "skills@latest", "list", "--json"],
      expect.objectContaining({ cwd }),
    );
    expect(result.presented?.data).toEqual({
      skills: [
        {
          name: "prisma-compute",
          path: "/repo/.agents/skills/prisma-compute",
          scope: "project",
          agents: ["Codex", "Cursor"],
        },
      ],
      skillsListCommand: ["npx", "-y", "skills@latest", "list", "--json"],
      statusScope: "project",
      skillsLockPath: "skills-lock.json",
      skillsLockInstalled: false,
      skillsInstalled: true,
      statusSource: "skills-cli",
      promptDismissedAt: null,
    });
    expect(result.presented?.diagnostics).toEqual([]);
    expect(result.presented?.presentation.next).toEqual([]);
  });

  it("checks globally installed skills with --global", async () => {
    vi.mocked(execa).mockResolvedValue(
      skillsListStdout([
        {
          name: "prisma",
          path: "/home/dev/.agents/skills/prisma",
          scope: "global",
          agents: ["Codex"],
        },
      ]) as never,
    );
    const { cwd, env } = await makeCwd();

    const result = await makeCli().run(["agent", "status", "--global"], {
      cwd,
      env,
    });

    expect(result.exitCode).toBe(0);
    expect(execa).toHaveBeenCalledWith(
      "npx",
      ["-y", "skills@latest", "list", "-g", "--json"],
      expect.objectContaining({ cwd }),
    );
    expect(result.presented?.data).toMatchObject({
      statusScope: "global",
      statusSource: "skills-cli",
      skillsInstalled: true,
    });
  });

  it("falls back to the skills lock with a warn diagnostic when the skills CLI fails", async () => {
    vi.mocked(execa).mockRejectedValue(new Error("skills exploded"));
    const { cwd, env } = await makeCwd();
    await writeFile(
      path.join(cwd, "skills-lock.json"),
      JSON.stringify({ sources: ["prisma/skills"] }),
      "utf8",
    );

    const result = await makeCli().run(["agent", "status", "--json"], {
      cwd,
      env,
    });

    expect(result.exitCode).toBe(0);
    const envelope = completedFrame(result.json);
    expect(envelope.commandId).toBe("agent.status");
    expect(envelope.result).toEqual({
      skills: [],
      skillsListCommand: ["npx", "-y", "skills@latest", "list", "--json"],
      statusScope: "project",
      skillsLockPath: "skills-lock.json",
      skillsLockInstalled: true,
      skillsInstalled: true,
      statusSource: "skills-lock",
      promptDismissedAt: null,
    });
    expect(envelope.diagnostics).toHaveLength(1);
    expect(envelope.diagnostics[0]).toMatchObject({
      code: "AGENT.SKILLS_LIST_UNAVAILABLE",
      severity: "warn",
    });
    expect(envelope.diagnostics[0]?.summary).toContain("skills exploded");
    expect(envelope.diagnostics[0]?.summary).toContain(
      "Falling back to skills-lock.json",
    );
  });

  it("does not fall back to the project lock for a failed global listing", async () => {
    vi.mocked(execa).mockRejectedValue(new Error("global skills exploded"));
    const { cwd, env } = await makeCwd();
    await writeFile(
      path.join(cwd, "skills-lock.json"),
      JSON.stringify({ sources: ["prisma/skills"] }),
      "utf8",
    );

    const result = await makeCli().run(["agent", "status", "--global"], {
      cwd,
      env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      statusScope: "global",
      statusSource: "unavailable",
      skillsInstalled: false,
    });
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "Install or refresh Prisma skills",
        command: "npx -y @prisma/cli@next agent install --global",
      },
    ]);
  });

  it("offers the install command when no skills are installed", async () => {
    vi.mocked(execa).mockResolvedValue(skillsListStdout([]) as never);
    const { cwd, env } = await makeCwd();

    const result = await makeCli().run(["agent", "status"], { cwd, env });

    expect(result.exitCode).toBe(0);
    expect(result.presented?.data).toMatchObject({
      skillsInstalled: false,
      statusSource: "skills-cli",
    });
    expect(result.presented?.presentation.next).toEqual([
      {
        kind: "run-command",
        label: "Install or refresh Prisma skills",
        command: "npx -y @prisma/cli@next agent install",
      },
    ]);
  });
});
