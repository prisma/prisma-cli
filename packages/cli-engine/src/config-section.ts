import type { SectionProvenance } from "./config-merge";
import type { Diagnostic } from "./protocol";

/**
 * A command family's named slice of prisma.config.ts. The token couples
 * the section name, its validated type, and its total validator. The
 * validator owns absence: its input is the raw section value, or
 * undefined when the config file has no such section. It returns
 * findings; it never throws. Its second argument is the resolved
 * value's provenance: a validator with path-valued keys resolves each
 * through resolveSectionPath(provenance, key, path) and returns
 * absolute paths, so downstream code never resolves against cwd. A
 * one-argument validator stays valid for sections with no paths.
 */
export interface ConfigSection<T> {
  readonly name: string;
  readonly validate: (
    raw: unknown | undefined,
    provenance: SectionProvenance,
  ) => SectionValidation<T>;
  /**
   * How two files' raw values combine when more than one file on the
   * config chain declares the section. `child` is the nearer file's
   * value and wins conflicts. Both inputs may be frozen, so the result
   * must be a fresh value, never a mutation of either. Absent, the
   * engine merges per key at the section's top level and replaces
   * below.
   */
  readonly merge?: (parent: unknown, child: unknown) => unknown;
}

/**
 * Diagnostics on an OK validation are warnings: the engine writes them
 * to stderr as commentary (log-level filtered, human and json alike);
 * they never enter the stream or the envelope.
 */
export type SectionValidation<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly diagnostics: readonly Diagnostic[];
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export function defineConfigSection<T>(spec: {
  readonly name: string;
  readonly validate: (
    raw: unknown | undefined,
    provenance: SectionProvenance,
  ) => SectionValidation<T>;
  readonly merge?: (parent: unknown, child: unknown) => unknown;
}): ConfigSection<T> {
  return Object.freeze({
    name: spec.name,
    validate: spec.validate,
    merge: spec.merge,
  });
}
