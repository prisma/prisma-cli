import { writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Writes a skills-lock.json recording the given skill as installed from
 * prisma/skills, the shape the agent setup status check reads.
 */
export async function writeSkillsLockWithSkill(
  cwd: string,
  skillName = "prisma-compute",
): Promise<void> {
  await writeFile(
    path.join(cwd, "skills-lock.json"),
    JSON.stringify({
      version: 1,
      skills: {
        [skillName]: {
          source: "prisma/skills",
          sourceType: "github",
          skillPath: `${skillName}/SKILL.md`,
          computedHash: "test",
        },
      },
    }),
    "utf8",
  );
}
