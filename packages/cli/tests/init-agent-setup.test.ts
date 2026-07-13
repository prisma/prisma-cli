import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { writeSkillsLockWithSkill } from "./helpers/skills-lock";

afterEach(() => {
  vi.resetModules();
});

const SKILL_PROMPT_MESSAGE =
  "Install the Prisma Compute skill for this project?";

async function setupInitAgentPromptTest(options: {
  skillAnswer?: boolean;
  runAgentInstall?: ReturnType<typeof vi.fn>;
  skillsInstalled?: boolean;
  isTTY?: boolean;
  quiet?: boolean;
}) {
  const runAgentInstall =
    options.runAgentInstall ??
    vi.fn().mockResolvedValue({
      command: "agent.install",
      result: {
        operation: "install",
        skills: { status: "installed", command: [] },
      },
      warnings: [],
      nextSteps: [],
    });
  // Interactive init asks to adjust settings and to link before the skill
  // prompt; both are declined so only the skill answer varies per test.
  const confirmPrompt = vi.fn(async ({ message }: { message: string }) => {
    if (message === SKILL_PROMPT_MESSAGE) {
      return options.skillAnswer ?? true;
    }
    return false;
  });

  vi.doMock("../src/controllers/agent", () => ({
    runAgentInstall,
  }));
  vi.doMock("../src/shell/prompt", async () => {
    const actual = await vi.importActual<typeof import("../src/shell/prompt")>(
      "../src/shell/prompt",
    );
    return {
      ...actual,
      confirmPrompt,
    };
  });

  const { createTempCwd, createTestCommandContext } = await import("./helpers");
  const { runInit } = await import("../src/controllers/init");
  const cwd = await createTempCwd();
  if (options.skillsInstalled) {
    await writeSkillsLockWithSkill(cwd);
  }
  const { context } = await createTestCommandContext({
    cwd,
    stateDir: path.join(cwd, ".state"),
    isTTY: options.isTTY ?? true,
    flags: options.quiet ? { quiet: true } : undefined,
    env: {
      ...process.env,
      PRISMA_CLI_MOCK_FIXTURE_PATH: undefined,
    },
  });

  return { context, cwd, confirmPrompt, runAgentInstall, runInit };
}

function skillPromptCalls(confirmPrompt: ReturnType<typeof vi.fn>) {
  return confirmPrompt.mock.calls.filter(
    ([options]) => options.message === SKILL_PROMPT_MESSAGE,
  );
}

describe("init agent setup prompt", () => {
  it("interactive init offers the Prisma Compute skill install and installs on accept", async () => {
    const { context, cwd, confirmPrompt, runAgentInstall, runInit } =
      await setupInitAgentPromptTest({ skillAnswer: true });

    const result = await runInit(context, { framework: "hono" });

    expect(result.command).toBe("init");
    expect(skillPromptCalls(confirmPrompt)).toHaveLength(1);
    expect(runAgentInstall).toHaveBeenCalledTimes(1);
    expect(runAgentInstall.mock.calls[0][0]).toBe(context);
    expect(runAgentInstall.mock.calls[0][1]).toEqual({
      skill: ["prisma-compute"],
    });
    expect(runAgentInstall.mock.calls[0][2]).toBe("install");
    expect(runAgentInstall.mock.calls[0][3]).toEqual({ cwd });
    expect(result.warnings).toEqual([]);
  });

  it("declining the skill prompt records dismissal and init still succeeds", async () => {
    const { context, confirmPrompt, runAgentInstall, runInit } =
      await setupInitAgentPromptTest({ skillAnswer: false });

    const result = await runInit(context, { framework: "hono" });

    expect(result.command).toBe("init");
    expect(skillPromptCalls(confirmPrompt)).toHaveLength(1);
    expect(runAgentInstall).not.toHaveBeenCalled();
    await expect(
      context.stateStore.readAgentSetupPromptDismissedAt(),
    ).resolves.toEqual(expect.any(String));
  });

  it("does not offer the skill install when prisma-compute is already installed", async () => {
    const { context, confirmPrompt, runAgentInstall, runInit } =
      await setupInitAgentPromptTest({ skillsInstalled: true });

    const result = await runInit(context, { framework: "hono" });

    expect(result.command).toBe("init");
    expect(skillPromptCalls(confirmPrompt)).toHaveLength(0);
    expect(runAgentInstall).not.toHaveBeenCalled();
  });

  it("downgrades a failed skill install to a warning with the retry command", async () => {
    const { context, runAgentInstall, runInit } =
      await setupInitAgentPromptTest({
        skillAnswer: true,
        runAgentInstall: vi
          .fn()
          .mockRejectedValue(new Error("skills installer exploded")),
      });

    const result = await runInit(context, { framework: "hono" });

    expect(result.command).toBe("init");
    expect(runAgentInstall).toHaveBeenCalledTimes(1);
    expect(result.warnings).toEqual([
      expect.stringContaining("The Prisma Compute skill was not installed."),
    ]);
  });

  it("does not offer the skill install in quiet runs", async () => {
    const { context, confirmPrompt, runAgentInstall, runInit } =
      await setupInitAgentPromptTest({ quiet: true });

    const result = await runInit(context, { framework: "hono" });

    expect(result.command).toBe("init");
    expect(skillPromptCalls(confirmPrompt)).toHaveLength(0);
    expect(runAgentInstall).not.toHaveBeenCalled();
  });

  it("does not offer the skill install in non-interactive runs", async () => {
    const { context, confirmPrompt, runAgentInstall, runInit } =
      await setupInitAgentPromptTest({ isTTY: false });

    const result = await runInit(context, { framework: "hono" });

    expect(result.command).toBe("init");
    expect(confirmPrompt).not.toHaveBeenCalled();
    expect(runAgentInstall).not.toHaveBeenCalled();
  });
});
