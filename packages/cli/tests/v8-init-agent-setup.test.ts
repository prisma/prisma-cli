/**
 * The agent-skill offer init makes once per project. The skills CLI runs
 * as a child process, so execa is faked and the argv is asserted instead.
 */
import path from "node:path";
import { createTestCli } from "@prisma/cli-engine/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalStateStore } from "../src/adapters/local-state";
import { DEFAULT_PRISMA_AGENT_TARGETS } from "../src/lib/agent/constants";
import { initCommand } from "../src/v8/init/init";
import { createTempCwd } from "./helpers";
import { writeSkillsLockWithSkill } from "./helpers/skills-lock";

const execa = vi.hoisted(() => vi.fn(async () => ({ exitCode: 0 })));
vi.mock("execa", () => ({ execa }));

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

let cwd: string;
let stateDir: string;

beforeEach(async () => {
  execa.mockClear();
  execa.mockImplementation(async () => ({ exitCode: 0 }));
  cwd = await createTempCwd();
  stateDir = path.join(cwd, ".state");
});

function run(
  argv: readonly string[],
  opts?: {
    readonly answers?: ReadonlyArray<string | boolean>;
    readonly isTty?: { stdin?: boolean };
    readonly env?: Readonly<Record<string, string | undefined>>;
  },
) {
  return createTestCli({
    commands: { init: initCommand },
    now: () => new Date(0),
  }).run(argv, {
    cwd,
    env: { PRISMA_CLI_STATE_DIR: stateDir, CI: undefined, ...opts?.env },
    ...(opts?.answers === undefined ? {} : { answers: opts.answers }),
    ...(opts?.isTty === undefined ? {} : { isTty: opts.isTty }),
  });
}

function dismissedAt(): Promise<string | null> {
  return new LocalStateStore(
    stateDir,
    new AbortController().signal,
  ).readAgentSetupPromptDismissedAt();
}

const BASE_ARGV = [
  "init",
  "--framework",
  "hono",
  "--name",
  "api",
  "--no-install",
  "--no-link",
];

describe("init agent-skill offer", () => {
  it("installs the skill when the offer is accepted", async () => {
    // adjust settings: no, then the skill offer: yes.
    const result = await run(BASE_ARGV, {
      isTty: { stdin: true },
      answers: [false, true],
    });

    expect(result.exitCode).toBe(0);
    expect(execa).toHaveBeenCalledTimes(1);
    const [executable, args] = execa.mock.calls[0] as unknown as [
      string,
      string[],
    ];
    expect([executable, ...args]).toEqual([
      "npx",
      "-y",
      "skills@latest",
      "add",
      "prisma/skills",
      "--skill",
      "prisma-compute",
      ...DEFAULT_PRISMA_AGENT_TARGETS.flatMap((agent) => ["--agent", agent]),
      "--yes",
    ]);
    expect(await dismissedAt()).toBeNull();
  });

  it("remembers a declined offer so nothing asks again", async () => {
    const result = await run(BASE_ARGV, {
      isTty: { stdin: true },
      answers: [false, false],
    });

    expect(result.exitCode).toBe(0);
    expect(execa).not.toHaveBeenCalled();
    expect(await dismissedAt()).toMatch(ISO_TIMESTAMP);
  });

  it("does not offer when the skill is already installed", async () => {
    await writeSkillsLockWithSkill(cwd);

    const result = await run(BASE_ARGV, {
      isTty: { stdin: true },
      answers: [false],
    });

    expect(result.exitCode).toBe(0);
    expect(execa).not.toHaveBeenCalled();
    expect(await dismissedAt()).toBeNull();
  });

  it("downgrades a failed skill install to a warn diagnostic", async () => {
    execa.mockImplementation(async () => {
      throw new Error("Command failed with exit code 1");
    });

    const result = await run([...BASE_ARGV, "--json"], {
      isTty: { stdin: true },
      answers: [false, true],
    });

    expect(result.exitCode).toBe(0);
    const frame = result.json.at(-1) as unknown as {
      envelope: { diagnostics: ReadonlyArray<Record<string, unknown>> };
    };
    expect(frame.envelope.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "INIT.AGENT_SETUP_FAILED",
        severity: "warn",
      }),
    );
  });

  it("takes the offer's default of no under --yes, and remembers it", async () => {
    const result = await run([...BASE_ARGV, "--yes"]);

    expect(result.exitCode).toBe(0);
    expect(execa).not.toHaveBeenCalled();
    expect(await dismissedAt()).toMatch(ISO_TIMESTAMP);
  });

  it("never offers or records anything in CI", async () => {
    const result = await run(BASE_ARGV, { env: { CI: "true" } });

    expect(result.exitCode).toBe(0);
    expect(execa).not.toHaveBeenCalled();
    expect(await dismissedAt()).toBeNull();
  });

  it("asks nothing once a previous run recorded a dismissal", async () => {
    await new LocalStateStore(
      stateDir,
      new AbortController().signal,
    ).setAgentSetupPromptDismissedAt("2026-01-01T00:00:00.000Z");

    const result = await run(BASE_ARGV, {
      isTty: { stdin: true },
      answers: [false],
    });

    expect(result.exitCode).toBe(0);
    expect(execa).not.toHaveBeenCalled();
    expect(await dismissedAt()).toBe("2026-01-01T00:00:00.000Z");
  });
});
