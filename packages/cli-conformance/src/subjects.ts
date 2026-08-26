/**
 * A config section, structurally. Deliberately not imported from
 * `@prisma/cli-engine`: this package checks the engine's consumers, so
 * depending on the engine would put it downstream of the things it
 * checks and make every dependency edge a potential cycle. The engine's
 * own `ConfigSection<T>` satisfies this shape.
 */
export interface CheckableSection {
  readonly name: string;
  readonly validate: (raw: unknown, provenance: CheckableProvenance) => unknown;
}

/** The engine's `SectionProvenance`, structurally, for the same reason. */
export interface CheckableProvenance {
  readonly files: readonly string[];
  readonly keys: Readonly<Record<string, string>>;
}

/**
 * The two places a section reaches the engine. Structural, so a caller
 * can pass toy values in a test without building a command.
 */
export interface SectionSources {
  readonly families: readonly {
    readonly configSection?: CheckableSection | undefined;
  }[];
  readonly commands: Readonly<
    Record<
      string,
      {
        readonly needs: {
          readonly config?: CheckableSection | undefined;
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
): readonly CheckableSection[] {
  const byName = new Map<string, CheckableSection>();
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
