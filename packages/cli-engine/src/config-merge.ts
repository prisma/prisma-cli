/**
 * Per-key resolution of one config section over the loaded chain, and
 * the provenance that survives it: which files contributed the resolved
 * value, and which file wrote each of its top-level keys, so
 * diagnostics name the file to fix and relative paths resolve against
 * the file that declared them.
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

export interface ResolvedSection {
  /** undefined when no file on the chain declares the section — the
   *  section validator owns absence, exactly as before. */
  readonly value: unknown;
  /** The files declaring the section, nearest first. */
  readonly contributors: readonly LoadedConfigFile[];
}

/** A file declares a section by writing the key with a value. A key
 *  written as `undefined` is absent: it neither contributes nor
 *  shadows an ancestor's real section. */
function declares(file: LoadedConfigFile, name: string): boolean {
  return (
    Object.hasOwn(file.sections, name) && file.sections[name] !== undefined
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * The engine's default merge: per key at the section's top level, the
 * child's key winning, replacement below — arrays and anything else
 * that is not a plain object replace atomically. A key written as
 * `undefined` on either side contributes nothing, so it cannot shadow
 * the other side's value. Built with fromEntries, never key-by-key
 * assignment, for the same `__proto__` hygiene the loader applies; the
 * result is always a fresh object, so frozen inputs are never touched.
 */
function mergePerKey(parent: unknown, child: unknown): unknown {
  if (!isPlainObject(parent) || !isPlainObject(child)) {
    return child;
  }
  return Object.fromEntries(
    [...Object.entries(parent), ...Object.entries(child)].filter(
      ([, value]) => value !== undefined,
    ),
  );
}

const PROVENANCE = new WeakMap<object, SectionProvenance>();

function canCarryProvenance(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

/** The nearest contributor whose raw section value wrote `key`. */
function fileDeclaringKey(
  name: string,
  key: string,
  contributors: readonly LoadedConfigFile[],
): string | undefined {
  return contributors.find((file) => {
    const raw = file.sections[name];
    return (
      isPlainObject(raw) && Object.hasOwn(raw, key) && raw[key] !== undefined
    );
  })?.path;
}

function provenanceOf(
  value: unknown,
  name: string,
  contributors: readonly LoadedConfigFile[],
): SectionProvenance {
  const files = contributors.map((file) => file.path);
  const keys = isPlainObject(value)
    ? Object.fromEntries(
        Object.keys(value).map((key) => [
          key,
          fileDeclaringKey(name, key, contributors) ?? files[0],
        ]),
      )
    : {};
  return { files, keys };
}

/**
 * Resolves `section` over the chain, nearest first: the farthest
 * declaring file's raw value, folded under each nearer one with the
 * section's own merge or the engine default. The resolved value is
 * annotated with provenance, readable via sectionProvenance and
 * resolveSectionPath.
 */
export function resolveSectionOverChain(
  section: ConfigSection<unknown>,
  files: readonly LoadedConfigFile[],
): ResolvedSection {
  const contributors = files.filter((file) => declares(file, section.name));
  if (contributors.length === 0) {
    return { value: undefined, contributors };
  }
  const merge = section.merge ?? mergePerKey;
  const value = contributors
    .map((file) => file.sections[section.name])
    .reduceRight((parent, child) => merge(parent, child));
  if (canCarryProvenance(value)) {
    PROVENANCE.set(value, provenanceOf(value, section.name, contributors));
  }
  return { value, contributors };
}

/** The provenance of a value resolveSectionOverChain produced, or
 *  undefined for any other value. */
export function sectionProvenance(
  value: unknown,
): SectionProvenance | undefined {
  return canCarryProvenance(value) ? PROVENANCE.get(value) : undefined;
}

/**
 * Resolves a path found under `key` of a resolved section value against
 * the file that declared that key — never against cwd or the nearest
 * config file. Sections opt in by resolving their path-valued settings
 * through this on the raw value their validator receives; an absolute
 * path comes back unchanged. Throws when the value carries no
 * provenance, which means it did not come from the engine's section
 * resolution — an engine-boundary misuse, not a user error.
 */
export function resolveSectionPath(
  sectionValue: unknown,
  key: string,
  path: string,
): string {
  if (isAbsolute(path)) {
    return path;
  }
  const provenance = sectionProvenance(sectionValue);
  if (provenance === undefined) {
    throw new Error(
      "@prisma/cli-engine: resolveSectionPath needs a value the engine resolved from the config chain, and this one carries no provenance",
    );
  }
  const declaring = Object.hasOwn(provenance.keys, key)
    ? provenance.keys[key]
    : provenance.files[0];
  return resolve(dirname(declaring), path);
}
