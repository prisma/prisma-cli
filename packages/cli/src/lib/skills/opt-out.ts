import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The project's persisted answer to the staleness check, written by
 * `skills sync --disable` and read by the check on every command. It
 * sits at the project root beside the CLI's other local state, so the
 * opt-out follows the project rather than one machine's environment.
 */
export const SKILLS_STATE_FILE = path.join(".prisma", "skills.json");

interface SkillsStateFile {
  check?: boolean;
}

export function skillsStatePath(projectRoot: string): string {
  return path.join(projectRoot, SKILLS_STATE_FILE);
}

export async function readSkillsCheckDisabled(
  projectRoot: string,
): Promise<boolean> {
  try {
    const state = JSON.parse(
      await readFile(skillsStatePath(projectRoot), "utf8"),
    ) as SkillsStateFile;
    return state.check === false;
  } catch {
    return false;
  }
}

export async function writeSkillsCheckDisabled(
  projectRoot: string,
  disabled: boolean,
): Promise<void> {
  const target = skillsStatePath(projectRoot);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    `${JSON.stringify({ check: !disabled }, null, 2)}\n`,
    "utf8",
  );
}
