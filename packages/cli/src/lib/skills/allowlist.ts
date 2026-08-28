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
  // The CLI's own package: ships prisma-platform-core-concepts, staged
  // into the tarball by scripts/stage-skills.mjs at prepack.
  "prisma",
];

/** The directory inside a source package's tarball that holds its skill
 *  trees, one directory per skill. */
export const PACKAGE_SKILLS_DIR = "skills";

/**
 * The agent harnesses this CLI can install skills for, each mapped to
 * the project-relative directory that harness reads its skills from.
 * There is no harness detection anywhere: which of these a project uses
 * comes from `skills: { agents: [...] }` in prisma.config.ts, and every
 * one of them when the config says nothing.
 */
export const AGENT_SKILL_DIRS = {
  claude: ".claude/skills",
  cursor: ".cursor/skills",
  agents: ".agents/skills",
  // docs.devin.ai product-guides/skills: Devin reads
  // .devin/skills/<skill-name>/SKILL.md, and .agents/skills too, so this
  // entry matters only when a config names devin alone. The same page
  // documents .windsurf/skills, which was deliberately not added.
  devin: ".devin/skills",
} as const;

export type AgentName = keyof typeof AGENT_SKILL_DIRS;

export const KNOWN_AGENTS = Object.keys(AGENT_SKILL_DIRS) as AgentName[];

/** Without a config, sync writes every known agent's directory, so a
 *  harness adopted later finds the skills already there. */
export const DEFAULT_AGENTS: readonly AgentName[] = KNOWN_AGENTS;

export function isKnownAgent(name: string): name is AgentName {
  return name in AGENT_SKILL_DIRS;
}

export function agentSkillDirs(
  agents: readonly AgentName[],
): readonly string[] {
  return agents.map((agent) => AGENT_SKILL_DIRS[agent]);
}

export function isSkillSourcePackage(name: string): boolean {
  return SKILL_SOURCE_PACKAGES.includes(name);
}
