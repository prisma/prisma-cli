import type { CommandContext } from "@prisma/cli-engine";
import { execa } from "execa";
import {
  DEFAULT_PRISMA_AGENT_SKILLS,
  DEFAULT_PRISMA_AGENT_TARGETS,
  PRISMA_SKILLS_SOURCE,
  SKILLS_CLI_PACKAGE,
} from "../../lib/agent/constants";
import { resolveSkillsPackageRunner } from "../../lib/agent/package-manager";
import { skillsInstallFailedError } from "./errors";
import type { AgentInstalledSkill } from "./results";

/** What the skills CLI calls need from the handler context. */
export type AgentContext = Pick<
  CommandContext,
  "cwd" | "env" | "signal" | "host"
>;

export interface AgentInstallInputs {
  readonly agent?: readonly string[];
  readonly skill?: readonly string[];
  readonly allAgents?: boolean;
  readonly copy?: boolean;
  readonly global?: boolean;
}

export interface SkillsListSuccess {
  status: "ok";
  command: string[];
  skills: AgentInstalledSkill[];
}

export interface SkillsListFailure {
  status: "failed";
  command: string[];
  message: string;
}

export async function buildSkillsInstallCommand(
  ctx: AgentContext,
  inputs: AgentInstallInputs,
  cwd: string,
): Promise<string[]> {
  const command = [
    ...(await resolveSkillsPackageRunner({ cwd, signal: ctx.signal })),
    SKILLS_CLI_PACKAGE,
    "add",
    PRISMA_SKILLS_SOURCE,
  ];
  const skills =
    inputs.skill && inputs.skill.length > 0
      ? inputs.skill
      : DEFAULT_PRISMA_AGENT_SKILLS;

  for (const skill of skills) {
    command.push("--skill", skill);
  }

  for (const agent of resolveTargetAgents(inputs)) {
    command.push("--agent", agent);
  }

  if (inputs.global) {
    command.push("--global");
  }

  if (inputs.copy || ctx.host.platform === "win32") {
    command.push("--copy");
  }

  command.push("--yes");
  return command;
}

function resolveTargetAgents(inputs: AgentInstallInputs): readonly string[] {
  if (inputs.allAgents) {
    return ["*"];
  }

  if (inputs.agent && inputs.agent.length > 0) {
    return inputs.agent;
  }

  return DEFAULT_PRISMA_AGENT_TARGETS;
}

export async function runSkillsInstall(
  ctx: AgentContext,
  command: readonly string[],
  cwd: string,
): Promise<void> {
  const [executable, args] = splitCommand(command);

  try {
    await execa(executable, args, {
      cwd,
      env: ctx.env,
      cancelSignal: ctx.signal,
      stdin: "ignore",
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw skillsInstallFailedError({
      command,
      exitCode: exitCodeFromError(error),
      cause: error,
    });
  }
}

export async function listInstalledPrismaSkills(
  ctx: AgentContext,
  cwd: string,
  scope: "project" | "global",
): Promise<SkillsListSuccess | SkillsListFailure> {
  const command = [
    ...(await resolveSkillsPackageRunner({ cwd, signal: ctx.signal })),
    SKILLS_CLI_PACKAGE,
    "list",
    ...(scope === "global" ? ["-g"] : []),
    "--json",
  ];
  const [executable, args] = splitCommand(command);

  try {
    const { stdout } = await execa(executable, args, {
      cwd,
      env: ctx.env,
      cancelSignal: ctx.signal,
      stdin: "ignore",
    });
    return {
      status: "ok",
      command,
      skills: parseSkillsListOutput(stdout ?? "").filter((skill) =>
        isPrismaSkillName(skill.name),
      ),
    };
  } catch (error) {
    if (isAbortError(error) || ctx.signal.aborted) {
      throw error;
    }

    return {
      status: "failed",
      command,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function splitCommand(
  command: readonly string[],
): [executable: string, args: string[]] {
  const [executable, ...args] = command;
  if (!executable) {
    throw new Error("Cannot run an empty command.");
  }

  return [executable, args];
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (isObject(error) && error.isCanceled === true)
  );
}

function exitCodeFromError(error: unknown): number | null {
  if (!isObject(error) || typeof error.exitCode !== "number") {
    return null;
  }

  return error.exitCode;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSkillsListOutput(output: string): AgentInstalledSkill[] {
  const parsed = JSON.parse(output) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("skills list did not return a JSON array");
  }

  return parsed.flatMap((item) => {
    const skill = parseInstalledSkill(item);
    return skill ? [skill] : [];
  });
}

function parseInstalledSkill(value: unknown): AgentInstalledSkill | null {
  if (!isObject(value)) {
    return null;
  }

  if (
    typeof value.name !== "string" ||
    typeof value.path !== "string" ||
    typeof value.scope !== "string" ||
    !Array.isArray(value.agents)
  ) {
    return null;
  }

  return {
    name: value.name,
    path: value.path,
    scope: value.scope,
    agents: value.agents.filter((agent) => typeof agent === "string"),
  };
}

function isPrismaSkillName(name: string): boolean {
  return name === "prisma" || name.startsWith("prisma-");
}
