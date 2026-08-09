import type { AnyCommand } from "./commands";
import type { ConfigSection } from "./config-section";

/**
 * The unit of contribution and ownership a package exports for CLI
 * purposes: its config section (declared once — a family-level fact)
 * and its commands by NAME. A command whose needs.config token is not
 * its command family's section is a construction error. The shell owns
 * the tree; a command family owns its section.
 */
export interface CommandFamily {
  readonly configSection: ConfigSection<unknown> | undefined;
  readonly commands: Readonly<Record<string, AnyCommand>>;
  /**
   * The family's documentation base URL. The engine derives each
   * diagnostic's docs link from base + code.
   */
  readonly docsBaseUrl: string | undefined;
}

export function defineCommandFamily(spec: {
  readonly configSection?: ConfigSection<unknown>;
  readonly commands: Readonly<Record<string, AnyCommand>>;
  readonly docsBaseUrl?: string;
}): CommandFamily {
  return Object.freeze({
    configSection: spec.configSection,
    commands: spec.commands,
    docsBaseUrl: spec.docsBaseUrl,
  });
}

/** What the shell builds: commands by PATH (space-separated, 'db migrate'). */
export type MountedTree = Readonly<Record<string, AnyCommand>>;
