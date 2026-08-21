/**
 * SECURITY INVARIANT — read before changing this list.
 *
 * Skill content only ever comes from the packages named here. The sync
 * command never scans node_modules, or any other directory, looking for
 * skills to install, and no discovery mode may be added: a skill is
 * instructions an agent will follow, so installing one from an
 * arbitrary transitive dependency hands that dependency's author
 * influence over the user's agent. Resolving these names keeps the
 * trust boundary identical to the code's — if you run
 * `@prisma/orm-postgres`, you already trust its author.
 *
 * Adding a package here is a deliberate decision about a package Prisma
 * publishes. This is permanent.
 */
export const SKILL_SOURCE_PACKAGES: readonly string[] = [
  "@prisma/orm-postgres",
  "@prisma/orm-sqlite",
  "@prisma/orm-mongo",
  "@prisma/composer",
];

/** The directory inside a source package's tarball that holds its skill
 *  trees, one directory per skill. */
export const PACKAGE_SKILLS_DIR = "skills";

/** The project-root directories each agent harness reads its skills
 *  from. Sync writes all four whether or not the harness is in use, so
 *  a harness adopted later finds the skills already there. */
export const HARNESS_SKILL_DIRS: readonly string[] = [
  ".claude/skills",
  ".cursor/skills",
  ".agents/skills",
  ".windsurf/skills",
];

export function isSkillSourcePackage(name: string): boolean {
  return SKILL_SOURCE_PACKAGES.includes(name);
}
