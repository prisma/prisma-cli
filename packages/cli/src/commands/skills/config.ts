import {
  defineConfigSection,
  type LoadedConfig,
  loadConfig,
  resolveSectionOverChain,
} from "@prisma/cli-engine";
import type { Diagnostic } from "@prisma/cli-engine/protocol";
import {
  type AgentName,
  DEFAULT_AGENTS,
  isKnownAgent,
  KNOWN_AGENTS,
} from "../../lib/skills/allowlist";
import { getCliVersion } from "../../lib/version";

export interface SkillsConfig {
  /** Whether other commands may report out-of-date agent skills.
   *  `skills: { check: false }` in prisma.config.ts silences it for
   *  everyone working in the project. */
  readonly check: boolean;
  /** The agent harnesses whose skill directories sync writes and list
   *  reports. Absent means every known agent. */
  readonly agents: readonly AgentName[];
  /** Whether the config spells out `skills.agents` itself, as opposed
   *  to `agents` holding the default set. Init uses this to tell "the
   *  scaffold is already in place" from "the file exists but says
   *  nothing about agents". */
  readonly agentsConfigured: boolean;
}

const DEFAULT: SkillsConfig = {
  check: true,
  agents: DEFAULT_AGENTS,
  agentsConfigured: false,
};

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

function invalidAgents(value: unknown): Diagnostic {
  return {
    code: "SKILLS.CONFIG_INVALID",
    severity: "error",
    summary: `skills.agents must be an array of agent names, and is ${describe(value)}.`,
    nextActions: [
      {
        kind: "user-choice",
        label: `List the agents to install skills for (${KNOWN_AGENTS.join(", ")}), or remove skills.agents to install for all of them.`,
      },
    ],
  };
}

function unknownAgent(name: string): Diagnostic {
  return {
    code: "SKILLS.CONFIG_INVALID",
    severity: "error",
    summary: `skills.agents names '${name}', which this CLI does not know. The known agents are ${KNOWN_AGENTS.join(", ")}.`,
    nextActions: [
      {
        kind: "user-choice",
        label: `Remove '${name}' from skills.agents, or update the CLI if a newer version knows it.`,
      },
    ],
  };
}

function describe(value: unknown): string {
  return value === null ? "null" : typeof value;
}

function validateAgents(
  raw: unknown,
):
  | { ok: true; agents: readonly AgentName[] }
  | { ok: false; diagnostic: Diagnostic } {
  if (raw === undefined) {
    return { ok: true, agents: DEFAULT_AGENTS };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, diagnostic: invalidAgents(raw) };
  }
  const agents: AgentName[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !isKnownAgent(entry)) {
      return {
        ok: false,
        diagnostic:
          typeof entry === "string"
            ? unknownAgent(entry)
            : invalidAgents(entry),
      };
    }
    if (!agents.includes(entry)) {
      agents.push(entry);
    }
  }
  return { ok: true, agents };
}

/** Runtime.loadConfig's shape: cwd and CLI version already bound. */
export type ProjectConfigLoader = (
  configPath?: string,
) => Promise<LoadedConfig>;

/** The disk loader bound the way the bin's Runtime binds it, for
 *  callers with no Runtime in scope (the post-login tip). */
export function projectConfigLoader(cwd: string): ProjectConfigLoader {
  return (configPath) => loadConfig(cwd, configPath, getCliVersion());
}

/**
 * The project's skills settings, resolved per key over the discovered
 * config chain exactly as the skills commands resolve them, so callers
 * that run outside a command handler (the staleness check, the
 * post-login tip) agree with the commands on the governing config from
 * any directory. `load` is Runtime.loadConfig wherever a Runtime is in
 * scope, so a host-supplied loader governs these reads too. Chain
 * discovery is stat-only until a file exists, so a project without a
 * config never pays a TypeScript transpile.
 *
 * Null deliberately collapses "no config" and "config broken or
 * invalid": both callers fall back to the default agent set, so a
 * broken config never silences the check. The commands that consume
 * the config surface the error themselves.
 */
export async function readProjectSkillsConfig(
  load: ProjectConfigLoader,
  configPath?: string,
): Promise<SkillsConfig | null> {
  const loaded = await load(configPath);
  const broken = loaded.diagnostics.some(
    (entry) => entry.diagnostic.severity === "error",
  );
  if (broken || loaded.files.length === 0) {
    return null;
  }
  const resolved = resolveSectionOverChain(skillsConfigSection, loaded.files);
  if (!resolved.ok) {
    return null;
  }
  const section = skillsConfigSection.validate(
    resolved.value,
    resolved.provenance,
  );
  return section.ok ? section.value : null;
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
    // The engine's chain resolver snapshots plain objects, but carries
    // any other object (a class instance) atomically, so its getters —
    // user code that can throw — first run here.
    let check: unknown;
    let rawAgents: unknown;
    try {
      check = (raw as { check?: unknown }).check;
      rawAgents = (raw as { agents?: unknown }).agents;
    } catch {
      return { ok: false, diagnostics: [invalidSection(raw)] };
    }
    if (check !== undefined && typeof check !== "boolean") {
      return { ok: false, diagnostics: [invalidCheck(check)] };
    }
    const agents = validateAgents(rawAgents);
    if (!agents.ok) {
      return { ok: false, diagnostics: [agents.diagnostic] };
    }
    return {
      ok: true,
      value: {
        check: check ?? true,
        agents: agents.agents,
        agentsConfigured: rawAgents !== undefined,
      },
      diagnostics: [],
    };
  },
});
