import type { AnyCommand } from "./commands";
import type { ConfigSection } from "./config-section";

/**
 * A retired invocation. Redirects are metadata, never commands: they
 * stay out of help and out of the command tree, and are consulted only
 * when an invocation fails to resolve.
 */
export interface RedirectSpec {
  /**
   * The retired invocation as the user types it: a space-separated
   * absolute path in the mounted tree, the same convention as
   * MountedTree keys. Whitespace only separates segments, so it is
   * normalized away — `'  migration \t apply '` is `'migration apply'`.
   */
  readonly from: string;
  /**
   * When present, a retired FLAG on a live command: `from` names the
   * live command's path and this the retired flag's camelCase name
   * (rendered --kebab-case, as flag declarations are).
   */
  readonly flag?: string;
  readonly replacement?: string | readonly string[];
  /** One sentence of context, surfaced as the error's `why`. */
  readonly reason?: string;
  readonly code?: `${string}.${string}`;
  readonly summary?: string;
  readonly help?: string;
  readonly docsUrl?: string;
}

/** The normalized redirect a command family carries. */
export interface CommandRedirect {
  readonly from: string;
  readonly flag: string | undefined;
  readonly replacement: readonly string[];
  readonly reason: string | undefined;
  readonly code: `${string}.${string}` | undefined;
  readonly summary: string | undefined;
  readonly help: string | undefined;
  readonly docsUrl: string | undefined;
}

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
  /** The invocations this family retired. */
  readonly redirects: readonly CommandRedirect[];
}

/** A path is segments separated by whitespace, so the separator's shape
 *  carries no meaning and one form reaches the table and every lookup. */
function normalizePath(from: string): string {
  return from.trim().replace(/\s+/g, " ");
}

function replacementSteps(replacement: RedirectSpec["replacement"]): string[] {
  if (replacement === undefined) {
    return [];
  }
  if (typeof replacement === "string") {
    return [replacement];
  }
  return [...replacement];
}

function normalizeRedirect(spec: RedirectSpec): CommandRedirect {
  return Object.freeze({
    from: normalizePath(spec.from),
    flag: spec.flag,
    replacement: Object.freeze(replacementSteps(spec.replacement)),
    reason: spec.reason,
    code: spec.code,
    summary: spec.summary,
    help: spec.help,
    docsUrl: spec.docsUrl,
  });
}

export function defineCommandFamily(spec: {
  readonly configSection?: ConfigSection<unknown>;
  readonly commands: Readonly<Record<string, AnyCommand>>;
  readonly docsBaseUrl?: string;
  readonly redirects?: readonly RedirectSpec[];
}): CommandFamily {
  return Object.freeze({
    configSection: spec.configSection,
    commands: spec.commands,
    docsBaseUrl: spec.docsBaseUrl,
    redirects: (spec.redirects ?? []).map(normalizeRedirect),
  });
}

/** What the shell builds: commands by PATH (space-separated, 'db migrate'). */
export type MountedTree = Readonly<Record<string, AnyCommand>>;
