import type { ConfigSection } from "@prisma/cli-engine";

/**
 * The two places a section reaches the engine. Structural rather than
 * the engine's own types so a caller can pass toy values in a test
 * without building a command.
 */
export interface SectionSources {
  readonly families: readonly {
    readonly configSection?: ConfigSection<unknown> | undefined;
  }[];
  readonly commands: Readonly<
    Record<
      string,
      {
        readonly needs: {
          readonly config?: ConfigSection<unknown> | undefined;
        };
      }
    >
  >;
}

/**
 * Every config section the engine would recognise, derived the way the
 * engine derives it: from command families AND from standalone mounted
 * commands' `needs.config`, because the shell mounts its own commands
 * with no family (see declaredConfigSections in the engine's
 * execution/engine.ts). A check over families alone would state a
 * narrower rule than the engine enforces.
 */
export function sectionsFrom(
  sources: SectionSources,
): readonly ConfigSection<unknown>[] {
  const byName = new Map<string, ConfigSection<unknown>>();
  for (const family of sources.families) {
    const section = family.configSection;
    if (section !== undefined && !byName.has(section.name)) {
      byName.set(section.name, section);
    }
  }
  for (const command of Object.values(sources.commands)) {
    const section = command.needs.config;
    if (section !== undefined && !byName.has(section.name)) {
      byName.set(section.name, section);
    }
  }
  return [...byName.values()];
}
