import { execa } from "execa";
import { resolvePrismaCliPackageCommand } from "../lib/agent/cli-command";
import {
  DEFAULT_PRISMA_AGENT_SKILLS,
  DEFAULT_PRISMA_AGENT_TARGETS,
  PRISMA_AGENT_INSTALL_ARGS,
  PRISMA_AGENT_STATUS_ARGS,
  PRISMA_SKILLS_SOURCE,
  SKILLS_CLI_PACKAGE,
} from "../lib/agent/constants";
import { resolveSkillsPackageRunner } from "../lib/agent/package-manager";
import {
  readPrismaAgentSetupStatus,
  resolvePrismaAgentSetupCwd,
} from "../lib/agent/setup-status";
import { formatShellCommand } from "../shell/command-arguments";
import { CliError } from "../shell/errors";
import type { CommandContext } from "../shell/runtime";
import type {
  AgentInstalledSkill,
  AgentInstallResult,
  AgentSkillsResult,
  AgentStatusResult,
} from "../types/agent";

interface SkillsListSuccess {
  status: "ok";
  command: string[];
  skills: AgentInstalledSkill[];
}

interface SkillsListFailure {
  status: "failed";
  command: string[];
  message: string;
}

export interface AgentInstallOptions {
  agent?: string[];
  skill?: string[];
  allAgents?: boolean;
  copy?: boolean;
  global?: boolean;
  dryRun?: boolean;
}

export interface AgentStatusOptions {
  global?: boolean;
}

interface AgentInstallRunOptions {
  cwd?: string;
}

export async function runAgentInstall(
  context: CommandContext,
  options: AgentInstallOptions,
  operation: "install" | "update" = "install",
  runOptions: AgentInstallRunOptions = {},
) {
  const dryRun = options.dryRun === true;
  const cwd = await resolvePrismaAgentSetupCwd({
    cwd: runOptions.cwd ?? context.runtime.cwd,
    signal: context.runtime.signal,
  });
  const skillsCommand = await buildSkillsInstallCommand(context, options, cwd);
  const skills = await installSkills(context, {
    command: skillsCommand,
    cwd,
    dryRun,
  });
  const nextSteps = await resolveAgentInstallNextSteps(context, {
    cwd,
    dryRun,
    global: options.global === true,
  });

  return {
    command: `agent.${operation}`,
    result: {
      operation,
      skills,
    } satisfies AgentInstallResult,
    warnings: [],
    nextSteps,
  };
}

async function resolveAgentInstallNextSteps(
  context: CommandContext,
  options: { cwd: string; dryRun: boolean; global: boolean },
): Promise<string[]> {
  if (options.dryRun) {
    return [];
  }

  const statusCommand = await resolvePrismaCliPackageCommand({
    cwd: options.cwd,
    signal: context.runtime.signal,
    args: options.global
      ? [...PRISMA_AGENT_STATUS_ARGS, "--global"]
      : PRISMA_AGENT_STATUS_ARGS,
  });

  return [`Run ${statusCommand} to verify the installed Prisma skills.`];
}

export async function runAgentStatus(
  context: CommandContext,
  options: AgentStatusOptions = {},
) {
  const statusScope = options.global ? "global" : "project";
  const cwd = await resolvePrismaAgentSetupCwd({
    cwd: context.runtime.cwd,
    signal: context.runtime.signal,
  });
  const status = await readPrismaAgentSetupStatus({
    cwd,
    stateStore: context.stateStore,
    signal: context.runtime.signal,
  });
  const installCommand = await resolvePrismaCliPackageCommand({
    cwd,
    signal: context.runtime.signal,
    args: options.global
      ? [...PRISMA_AGENT_INSTALL_ARGS, "--global"]
      : PRISMA_AGENT_INSTALL_ARGS,
  });
  const skillsList = await listInstalledPrismaSkills(context, cwd, statusScope);
  const skillsInstalled =
    skillsList.status === "ok"
      ? skillsList.skills.length > 0
      : statusScope === "project" && status.skillsInstalled;
  const warnings =
    skillsList.status === "ok"
      ? []
      : [
          statusScope === "project"
            ? `Could not read installed skills with ${formatShellCommand(skillsList.command)}: ${skillsList.message}. Falling back to ${status.skillsLockPath}.`
            : `Could not read globally installed skills with ${formatShellCommand(skillsList.command)}: ${skillsList.message}.`,
        ];
  const statusSource = resolveStatusSource(skillsList, statusScope);

  return {
    command: "agent.status",
    result: {
      skills: skillsList.status === "ok" ? skillsList.skills : [],
      skillsListCommand: skillsList.command,
      statusScope,
      skillsLockPath: status.skillsLockPath,
      skillsLockInstalled: status.skillsInstalled,
      skillsInstalled,
      statusSource,
      promptDismissedAt: status.promptDismissedAt,
    } satisfies AgentStatusResult,
    warnings,
    nextSteps: skillsInstalled
      ? []
      : [`Run ${installCommand} to install or refresh Prisma skills.`],
  };
}

async function buildSkillsInstallCommand(
  context: CommandContext,
  options: AgentInstallOptions,
  cwd: string,
): Promise<string[]> {
  const command = [
    ...(await resolveSkillsPackageRunner({
      cwd,
      signal: context.runtime.signal,
    })),
    SKILLS_CLI_PACKAGE,
    "add",
    PRISMA_SKILLS_SOURCE,
  ];
  const skills =
    options.skill && options.skill.length > 0
      ? options.skill
      : DEFAULT_PRISMA_AGENT_SKILLS;
  const agents = resolveTargetAgents(options);

  for (const skill of skills) {
    command.push("--skill", skill);
  }

  for (const agent of agents) {
    command.push("--agent", agent);
  }

  if (options.global) {
    command.push("--global");
  }

  if (options.copy || process.platform === "win32") {
    command.push("--copy");
  }

  command.push("--yes");
  return command;
}

function resolveTargetAgents(options: AgentInstallOptions): string[] {
  if (options.allAgents) {
    return ["*"];
  }

  if (options.agent && options.agent.length > 0) {
    return options.agent;
  }

  return DEFAULT_PRISMA_AGENT_TARGETS;
}

async function installSkills(
  context: CommandContext,
  options: {
    command: string[];
    cwd: string;
    dryRun: boolean;
  },
): Promise<AgentSkillsResult> {
  if (options.dryRun) {
    return { status: "would-install", command: options.command };
  }

  await runChildProcess(context, options.command, options.cwd);
  return { status: "installed", command: options.command };
}

async function listInstalledPrismaSkills(
  context: CommandContext,
  cwd: string,
  scope: "project" | "global",
): Promise<SkillsListSuccess | SkillsListFailure> {
  const command = [
    ...(await resolveSkillsPackageRunner({
      cwd,
      signal: context.runtime.signal,
    })),
    SKILLS_CLI_PACKAGE,
    "list",
    ...(scope === "global" ? ["-g"] : []),
    "--json",
  ];

  try {
    const { stdout } = await runChildProcessCapture(context, command, cwd);
    return {
      status: "ok",
      command,
      skills: parseSkillsListOutput(stdout).filter((skill) =>
        isPrismaSkillName(skill.name),
      ),
    };
  } catch (error) {
    if (isAbortError(error) || context.runtime.signal.aborted) {
      throw error;
    }

    return {
      status: "failed",
      command,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runChildProcess(
  context: CommandContext,
  command: string[],
  cwd: string,
): Promise<void> {
  const [executable, args] = splitCommand(command);

  try {
    await execa(executable, args, {
      cwd,
      env: context.runtime.env,
      cancelSignal: context.runtime.signal,
      stdin: "ignore",
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw skillsInstallFailed(command, exitCodeFromError(error), error);
  }
}

async function runChildProcessCapture(
  context: CommandContext,
  command: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  const [executable, args] = splitCommand(command);

  const result = await execa(executable, args, {
    cwd,
    env: context.runtime.env,
    cancelSignal: context.runtime.signal,
    stdin: "ignore",
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function splitCommand(command: string[]): [executable: string, args: string[]] {
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

function resolveStatusSource(
  skillsList: SkillsListSuccess | SkillsListFailure,
  statusScope: "project" | "global",
): AgentStatusResult["statusSource"] {
  if (skillsList.status === "ok") {
    return "skills-cli";
  }

  return statusScope === "project" ? "skills-lock" : "unavailable";
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
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.name !== "string" ||
    typeof candidate.path !== "string" ||
    typeof candidate.scope !== "string" ||
    !Array.isArray(candidate.agents)
  ) {
    return null;
  }

  return {
    name: candidate.name,
    path: candidate.path,
    scope: candidate.scope,
    agents: candidate.agents.filter((agent) => typeof agent === "string"),
  };
}

function isPrismaSkillName(name: string): boolean {
  return name === "prisma" || name.startsWith("prisma-");
}

function skillsInstallFailed(
  command: string[],
  code: number | null,
  error?: unknown,
): CliError {
  const commandText = formatShellCommand(command);

  return new CliError({
    code: "AGENT_SKILLS_INSTALL_FAILED",
    domain: "cli",
    summary: "Prisma skills install failed",
    why: `The skills installer exited with code ${code ?? "unknown"}.`,
    fix: "Run the command below to retry the installer directly.",
    debug: formatErrorDebug(error),
    exitCode: 1,
    nextSteps: [commandText],
  });
}

function formatErrorDebug(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (error === undefined) {
    return undefined;
  }

  return String(error);
}
