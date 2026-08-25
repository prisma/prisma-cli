/**
 * Per-key resolution of one config section over the loaded chain, and
 * the provenance that survives it: which files contributed the resolved
 * value, and which file wrote each of its top-level keys, so
 * diagnostics name the file to fix and relative paths resolve against
 * the file that declared them.
 *
 * A section's value is user code — a property getter can throw or side
 * effect — so each contributor's value is read exactly once, inside a
 * guard that turns a throw into a config error naming that file.
 */
import { dirname, isAbsolute, resolve } from "node:path";
import type { ConfigSection } from "./config-section";
import type { LoadedConfigFile } from "./runtime";

/** Which files a resolved section value came from. */
export interface SectionProvenance {
  /** Paths of the files declaring the section, nearest first. */
  readonly files: readonly string[];
  /**
   * The declaring file per top-level key of the resolved value: the
   * nearest file whose raw section wrote that key. A key no file wrote
   * (a custom merge produced it) is attributed to the nearest file.
   */
  readonly keys: Readonly<Record<string, string>>;
}

export type ResolvedSection =
  | {
      readonly ok: true;
      /** undefined when no file on the chain declares the section — the
       *  section validator owns absence, exactly as before. */
      readonly value: unknown;
      /** The files declaring the section, nearest first. */
      readonly contributors: readonly LoadedConfigFile[];
      /** Where the value came from, for resolveSectionPath. */
      readonly provenance: SectionProvenance;
    }
  | {
      /** Reading or merging the section's value threw: the value and a
       *  custom merge are user code alike, so this is a config error
       *  naming the file, never an engine bug. */
      readonly ok: false;
      readonly file: string;
      readonly cause: unknown;
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * One file's declared value, read exactly once. A plain object is
 * snapshotted into a fresh object of its defined entries — a key
 * written `undefined` is absent, on a single-file chain and a merged
 * one alike, so it neither appears nor shadows an ancestor's key.
 * Anything else is carried atomically. A section written `undefined`
 * does not contribute at all.
 */
interface Contribution {
  readonly file: LoadedConfigFile;
  readonly value: unknown;
  /** The snapshot's top-level keys; null when the value is not a
   *  plain object. */
  readonly keys: ReadonlySet<string> | null;
}

function snapshotContribution(
  file: LoadedConfigFile,
  name: string,
): Contribution | null {
  if (!Object.hasOwn(file.sections, name)) {
    return null;
  }
  const raw = file.sections[name];
  if (raw === undefined) {
    return null;
  }
  if (!isPlainObject(raw)) {
    return { file, value: raw, keys: null };
  }
  const entries = Object.entries(raw).filter(
    ([, value]) => value !== undefined,
  );
  return {
    file,
    value: Object.fromEntries(entries),
    keys: new Set(entries.map(([key]) => key)),
  };
}

/** The engine's default merge: per key at the section's top level, the
 *  child's key winning, replacement below. fromEntries rather than
 *  key-by-key assignment: assigning a key named `__proto__` would run
 *  the prototype setter instead of creating an own property. */
function mergePerKey(parent: unknown, child: unknown): unknown {
  if (!isPlainObject(parent) || !isPlainObject(child)) {
    return child;
  }
  return Object.fromEntries([
    ...Object.entries(parent),
    ...Object.entries(child),
  ]);
}

function provenanceOf(
  value: unknown,
  contributions: readonly Contribution[],
): SectionProvenance {
  const files = contributions.map((contribution) => contribution.file.path);
  const keys = isPlainObject(value)
    ? Object.fromEntries(
        Object.keys(value).map((key) => [
          key,
          contributions.find((contribution) => contribution.keys?.has(key))
            ?.file.path ?? files[0],
        ]),
      )
    : {};
  return { files, keys };
}

/**
 * Resolves `section` over the chain, nearest first: the farthest
 * declaring file's value, folded under each nearer one with the
 * section's own merge or the engine default. A plain-object result is
 * always a fresh, frozen object — the files' exports are never
 * mutated — and the result carries the provenance resolveSectionPath
 * consumes.
 */
export function resolveSectionOverChain(
  section: ConfigSection<unknown>,
  files: readonly LoadedConfigFile[],
): ResolvedSection {
  const contributions: Contribution[] = [];
  for (const file of files) {
    let contribution: Contribution | null;
    try {
      contribution = snapshotContribution(file, section.name);
    } catch (cause) {
      return { ok: false, file: file.path, cause };
    }
    if (contribution !== null) {
      contributions.push(contribution);
    }
  }
  const contributors = contributions.map((contribution) => contribution.file);
  if (contributions.length === 0) {
    return {
      ok: true,
      value: undefined,
      contributors,
      provenance: { files: [], keys: {} },
    };
  }
  const merge = section.merge ?? mergePerKey;
  let merged: unknown;
  try {
    merged = contributions
      .map((contribution) => contribution.value)
      .reduceRight((parent, child) => merge(parent, child));
  } catch (cause) {
    // A custom merge is section-author code operating on config-file
    // values; a throw names the nearest contributing file, like a
    // throwing getter does.
    return { ok: false, file: contributions[0].file.path, cause };
  }
  // Freezing is safe here: every plain object in the fold is a fresh
  // snapshot or built from one, never a file's own export.
  const value = isPlainObject(merged) ? Object.freeze(merged) : merged;
  return {
    ok: true,
    value,
    contributors,
    provenance: provenanceOf(value, contributions),
  };
}

/**
 * Resolves a path found under a TOP-LEVEL `key` of a resolved section
 * value against the file that declared that key — never against cwd or
 * the nearest config file. Sections opt in by resolving their
 * path-valued settings through this with the provenance
 * resolveSectionOverChain returned; an absolute path comes back
 * unchanged. Throws on a key the resolved value does not carry at its
 * top level — a silent fallback could resolve against the wrong file,
 * which is the mistake this helper exists to prevent.
 */
export function resolveSectionPath(
  provenance: SectionProvenance,
  key: string,
  path: string,
): string {
  if (isAbsolute(path)) {
    return path;
  }
  if (!Object.hasOwn(provenance.keys, key)) {
    throw new Error(
      `@prisma/cli-engine: resolveSectionPath resolves only top-level section keys, and '${key}' is not a top-level key of the resolved section`,
    );
  }
  return resolve(dirname(provenance.keys[key]), path);
}
