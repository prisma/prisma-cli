import { defineConfigSection } from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";

export interface SkillsConfig {
  /** Whether other commands may report out-of-date agent skills.
   *  `skills: { check: false }` in prisma.config.ts silences it for
   *  everyone working in the project. */
  readonly check: boolean;
}

const DEFAULT: SkillsConfig = { check: true };

export const SKILLS_CONFIG_SECTION_NAME = "skills";

function invalidSection(value: unknown): Diagnostic {
  return {
    code: "SKILLS.CONFIG_INVALID",
    severity: "error",
    summary: `The 'skills' config section must be an object, and is ${describe(value)}.`,
    nextActions: [
      {
        kind: "user-choice",
        label: "Write skills: { check: false } to silence the skills check.",
      },
    ],
  };
}

function invalidCheck(value: unknown): Diagnostic {
  return {
    code: "SKILLS.CONFIG_INVALID",
    severity: "error",
    summary: `skills.check must be true or false, and is ${describe(value)}.`,
    nextActions: [
      {
        kind: "user-choice",
        label: "Set skills.check to true or false, or remove it.",
      },
    ],
  };
}

function describe(value: unknown): string {
  return value === null ? "null" : typeof value;
}

export const skillsConfigSection = defineConfigSection<SkillsConfig>({
  name: SKILLS_CONFIG_SECTION_NAME,
  validate: (raw) => {
    if (raw === undefined) {
      return { ok: true, value: DEFAULT, diagnostics: [] };
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, diagnostics: [invalidSection(raw)] };
    }
    const check = (raw as { check?: unknown }).check;
    if (check !== undefined && typeof check !== "boolean") {
      return { ok: false, diagnostics: [invalidCheck(check)] };
    }
    return { ok: true, value: { check: check ?? true }, diagnostics: [] };
  },
});
