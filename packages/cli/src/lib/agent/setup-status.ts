import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { LocalStateStore } from "../../adapters/local-state";
import { PRISMA_SKILLS_LOCK_FILENAME, PRISMA_SKILLS_SOURCE } from "./constants";

export interface PrismaAgentSetupStatus {
  skillsLockPath: string;
  skillsInstalled: boolean;
  promptDismissedAt: string | null;
}

export async function readPrismaAgentSetupStatus(options: {
  cwd: string;
  stateStore?: LocalStateStore;
  signal: AbortSignal;
  requiredSkill?: string;
}): Promise<PrismaAgentSetupStatus> {
  const skillsLockPath = path.join(options.cwd, PRISMA_SKILLS_LOCK_FILENAME);
  const [skillsInstalled, promptDismissedAt] = await Promise.all([
    hasPrismaSkillsLock(skillsLockPath, options.signal, options.requiredSkill),
    options.stateStore?.readAgentSetupPromptDismissedAt() ?? null,
  ]);

  return {
    skillsLockPath: path.basename(skillsLockPath),
    skillsInstalled,
    promptDismissedAt,
  };
}

export function isPrismaAgentSetupComplete(
  status: PrismaAgentSetupStatus,
): boolean {
  return status.skillsInstalled;
}

export function shouldOfferPrismaAgentSetup(
  status: PrismaAgentSetupStatus,
): boolean {
  return !isPrismaAgentSetupComplete(status) && !status.promptDismissedAt;
}

export async function isLikelyProjectDirectory(options: {
  cwd: string;
  signal: AbortSignal;
}): Promise<boolean> {
  const signals = ["package.json", "prisma.config.ts", ".git"];

  return (
    await Promise.all(
      signals.map((fileName) =>
        pathExists(path.join(options.cwd, fileName), options.signal),
      ),
    )
  ).some(Boolean);
}

async function hasPrismaSkillsLock(
  filePath: string,
  signal: AbortSignal,
  requiredSkill?: string,
): Promise<boolean> {
  try {
    const raw = await readFile(filePath, { encoding: "utf8", signal });
    return hasPrismaSkillsLockEntry(JSON.parse(raw), requiredSkill);
  } catch (error) {
    if (isNotFoundError(error) || error instanceof SyntaxError) {
      return false;
    }
    throw error;
  }
}

function hasPrismaSkillsLockEntry(
  value: unknown,
  requiredSkill: string | undefined,
): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (requiredSkill) {
    return skillLockEntryUsesPrismaSource(
      readSkillLockEntries(value)[requiredSkill],
    );
  }

  if (readLegacySources(value).includes(PRISMA_SKILLS_SOURCE)) {
    return true;
  }

  return Object.values(readSkillLockEntries(value)).some(
    skillLockEntryUsesPrismaSource,
  );
}

function readLegacySources(value: Record<string, unknown>): string[] {
  return Array.isArray(value.sources)
    ? value.sources.filter((source) => typeof source === "string")
    : [];
}

function readSkillLockEntries(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return isRecord(value.skills) ? value.skills : {};
}

function skillLockEntryUsesPrismaSource(value: unknown): boolean {
  return isRecord(value) && value.source === PRISMA_SKILLS_SOURCE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function pathExists(
  filePath: string,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  try {
    await stat(filePath);
    signal.throwIfAborted();
    return true;
  } catch (error) {
    if (signal.aborted) throw error;
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}
