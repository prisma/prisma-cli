import type { Diagnostic } from "./protocol";

/**
 * A command family's named slice of prisma.config.ts. The token couples
 * the section name, its validated type, and its total validator. The
 * validator owns absence: its input is the raw section value, or
 * undefined when the config file has no such section. It returns
 * findings; it never throws (R10).
 */
export interface ConfigSection<T> {
  readonly name: string;
  readonly validate: (raw: unknown | undefined) => SectionValidation<T>;
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
  readonly validate: (raw: unknown | undefined) => SectionValidation<T>;
}): ConfigSection<T> {
  return Object.freeze({ name: spec.name, validate: spec.validate });
}
