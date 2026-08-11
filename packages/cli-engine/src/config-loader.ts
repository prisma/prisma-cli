/**
 * The prisma.config.ts loader behind Runtime.loadConfig: resolve the
 * file (the one `--config` named, otherwise prisma.config.ts in cwd —
 * cwd only, no walking up), evaluate it, check the defineConfig version
 * marker, and produce LoadedConfig.
 *
 * Absence of an undiscovered file is not an error: section validators
 * own absence, so no prisma.config.ts in cwd is an empty LoadedConfig.
 * Absence of a file the user NAMED with --config is an error — they
 * said which file to read and it was not there. An evaluated file
 * WITHOUT the marker (a classic Prisma 7 config, which uses the same
 * filename) fails early with one typed diagnostic — the loader never
 * partially interprets an unmarked file, and never guesses.
 *
 * Evaluation goes through c12, the same loader prisma/prisma and
 * prisma/composer use, because the shipped CLI runs on ordinary Node,
 * which cannot import a .ts file. c12 transpiles it with jiti first.
 * Every c12 feature beyond "evaluate this one file" is switched off
 * below so discovery and merging stay exactly as they were.
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Diagnostic } from "./protocol";
import type { ConfigRequest, LoadedConfig } from "./runtime";
import { PRISMA_CONFIG_VERSION } from "./runtime";

export const CONFIG_FILE_NAME = "prisma.config.ts";

const MARKER_KEY = "$prismaConfig";

/**
 * Top-level keys the config file format keeps for itself, so no
 * section may be named one of them; buildCommandTree rejects the
 * declaration at construction.
 *
 * `$`-prefixed keys are metadata: `$prismaConfig` is the version
 * marker, and config loaders read `$env`, `$<NODE_ENV>` and `$meta` —
 * c12 deletes `$meta` from the config object whatever else it is told.
 * `extends` is the key config loaders take as "merge another file into
 * this one". This loader switches that off (`extend: false`), so a key
 * by that name does reach the config object. It stays reserved anyway:
 * the file format has no layering of its own, `extends` is the name it
 * would want if it gained some, and a section called `extends` would
 * disappear the moment anything switched merging back on.
 */
export function reservedConfigSectionName(name: string): boolean {
  return name === "extends" || name.startsWith("$");
}

/**
 * Attaches the version marker to a prisma.config.ts export. Each
 * top-level key names a config section, and the recognised section
 * names are exactly the ones the CLI's command families declare. Never
 * throws — bad section values are the section validator's problem, not
 * defineConfig's.
 */
export function defineConfig<T extends Record<string, unknown>>(
  config: T,
): T & { readonly $prismaConfig: number } {
  return Object.freeze({ ...config, $prismaConfig: PRISMA_CONFIG_VERSION });
}

function hasVersionMarker(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)[MARKER_KEY] === "number"
  );
}

function fileLevelConfig(diagnostic: Diagnostic): LoadedConfig {
  return { sections: {}, diagnostics: [{ section: null, diagnostic }] };
}

function missingMarkerDiagnostic(path: string): Diagnostic {
  return {
    code: "CLI.CONFIG_MISSING_MARKER",
    severity: "error",
    summary: `${path} was not written for this version of the Prisma CLI, so it cannot be used.`,
    why: "Configs for this CLI are created with defineConfig, which records a version marker on the exported object. This file's default export has no marker — it is most likely a Prisma 7 config, which uses the same filename — and the CLI stops rather than misread it.",
    nextActions: [
      {
        kind: "user-choice",
        label:
          "Migrate the file: wrap the exported object in defineConfig from @prisma/cli-engine and export the result as the default export.",
      },
    ],
    where: { path },
  };
}

function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return (newline === -1 ? text : text.slice(0, newline)).trim();
}

function unsupportedVersionDiagnostic(path: string, found: number): Diagnostic {
  return {
    code: "CLI.CONFIG_INVALID",
    severity: "error",
    summary: `${path} declares config version ${found}, but this CLI supports only version ${PRISMA_CONFIG_VERSION}.`,
    nextActions: [
      {
        kind: "user-choice",
        label:
          "Regenerate the config with a defineConfig matching this CLI, or update the CLI to a version that supports the declared config version.",
      },
    ],
    where: { path },
  };
}

function missingNamedFileDiagnostic(path: string): Diagnostic {
  return {
    code: "CLI.CONFIG_NOT_FOUND",
    severity: "error",
    summary: `--config named ${path}, and there is no file there.`,
    why: "A config file found by discovery may be absent — the section validators supply their defaults. A config file named on the command line may not: the CLI would otherwise run against different settings than the ones asked for.",
    nextActions: [
      {
        kind: "user-choice",
        label:
          "Correct the path passed to --config, or drop the flag to use the prisma.config.ts in the current directory.",
      },
    ],
    where: { path },
  };
}

/**
 * A top-level key that is not one of the CLI's section names. The set
 * of sections is closed — every command family declares its own — so an
 * unrecognised key is a typo or a leftover, and staying silent would
 * mean quietly ignoring settings the user wrote.
 *
 * One key cannot be reported this way: `$meta`. c12 reads it as layer
 * metadata and deletes it from the config object before returning,
 * whatever options this loader passes, so it never reaches this check.
 * On a config built by defineConfig — which freezes what it returns —
 * that delete throws, and the file is refused as unreadable instead.
 * Either way the user never gets the unknown-key message, which is why
 * buildCommandTree refuses to let a section claim the name.
 */
function unknownSectionDiagnostic(
  path: string,
  key: string,
  knownSections: readonly string[],
): Diagnostic {
  return {
    code: "CLI.CONFIG_UNKNOWN_SECTION",
    severity: "error",
    summary: `${path} has a top-level key '${key}', which is not a config section this CLI recognises.`,
    why:
      knownSections.length === 0
        ? "This CLI declares no config sections at all, so no top-level key in the file means anything to it."
        : `The sections this CLI recognises are: ${[...knownSections].sort().join(", ")}.`,
    nextActions: [
      {
        kind: "user-choice",
        label:
          "Remove the key, or rename it to one of the recognised section names.",
      },
    ],
    where: { path },
  };
}

function unreadableDiagnostic(path: string, cause: unknown): Diagnostic {
  const message = cause instanceof Error ? cause.message : String(cause);
  return {
    code: "CLI.CONFIG_UNREADABLE",
    severity: "error",
    summary: `${path} could not be evaluated: ${firstLine(message)}`,
    nextActions: [
      {
        kind: "user-choice",
        label: "Fix the error in the file, then run the command again.",
      },
    ],
    where: { path },
  };
}

/**
 * Evaluates the file at `path` and returns its default export. The c12
 * call is prisma/composer's `loadAppConfig` — explicit configFile, cwd
 * at that file's directory, the three lookups it turns off — with
 * prisma/prisma's dynamic import, so a run with no config file never
 * pays for loading c12 or jiti, plus the options below that composer
 * has no need of and this loader does.
 *
 * The loaded-file check is in both references: c12 is asked for one
 * exact path and must not answer with another.
 */
async function evaluateConfigFile(path: string): Promise<unknown> {
  const c12 = await import("c12");
  const result = await c12.loadConfig({
    name: "prisma",
    configFile: path,
    cwd: dirname(path),
    rcFile: false,
    globalRc: false,
    packageJson: false,
    // The five options composer leaves at their defaults and this
    // loader cannot. Composer's config has a fixed set of keys and no
    // `$`-prefixed marker, so none of these behaviours can reach it;
    // this CLI's top-level key space IS the section namespace, so every
    // one of them is reachable from an ordinary user config.
    //
    // envName defaults to process.env.NODE_ENV, and c12 then merges the
    // file's `$<NODE_ENV>` and `$env.<NODE_ENV>` blocks over the root.
    // A file with a `$production` block would mean one thing in a
    // normal shell and another under NODE_ENV=production. false turns
    // the merge off, so the file means the same thing everywhere.
    //
    // omit$Keys is already falsy by default, and this loader depends on
    // that: `$prismaConfig` is the version marker, so stripping
    // `$`-keys would make every valid config read as unmarked, and an
    // unrecognised `$`-key would vanish instead of being reported as an
    // unknown section. Pinned so a change of default cannot take both
    // away at once.
    //
    // extend defaults to reading a top-level `extends` key as an
    // instruction to merge further files into this one. Here `extends`
    // has to be an ordinary key like any other: with the directive on,
    // a section by that name disappears instead of being read, and the
    // merged-in file contributes sections without ever being checked
    // for the version marker.
    //
    // giget downloads and unpacks an `extends` value beginning http://,
    // https://, gh:, github:, gitlab: or bitbucket:, then evaluates
    // what it fetched. What a config file means must never depend on a
    // network fetch. Unreachable while extend is false, and pinned so
    // the two cannot come apart.
    //
    // dotenv reads a .env beside the config file into process.env.
    // Loading a config must not mutate the process. Falsy by default
    // today, and pinned because a change of default would turn reading
    // a file into a side effect on every later env lookup.
    envName: false,
    omit$Keys: false,
    extend: false,
    giget: false,
    dotenv: false,
  });
  // composer's comparison, not prisma/prisma's raw string equality:
  // realpath normalises the separators and casing c12 hands back on
  // Windows, where the raw compare fails on a file it did load.
  const loadedFile = result.configFile;
  if (
    typeof loadedFile !== "string" ||
    realpathSync(loadedFile) !== realpathSync(path)
  ) {
    throw new Error(
      `config loading resolved ${String(loadedFile)} instead of ${path}`,
    );
  }
  return result.config;
}

function sectionsOf(
  exported: Record<string, unknown>,
): Record<string, unknown> {
  const sections: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(exported)) {
    if (key !== MARKER_KEY) {
      sections[key] = value;
    }
  }
  return sections;
}

function unknownSections(
  path: string,
  sections: Record<string, unknown>,
  knownSections: readonly string[],
): LoadedConfig["diagnostics"] {
  const known = new Set(knownSections);
  return Object.keys(sections)
    .filter((key) => !known.has(key))
    .map((key) => ({
      section: null,
      diagnostic: unknownSectionDiagnostic(path, key, knownSections),
    }));
}

/**
 * The path the request asks for, always absolute: the file named by
 * --config, resolved against cwd, or prisma.config.ts in cwd.
 *
 * Absolute is not cosmetic, and it is one more thing than either
 * reference repository does — both are handed an absolute path before
 * they reach c12, so neither has to resolve one. Given a relative path,
 * c12 resolves it a second time against its own cwd and looks for a
 * file that is not there, and jiti cannot import a relative specifier
 * at all. Resolving here also makes the file's path in every diagnostic
 * absolute, and makes the loaded-file comparison compare like with
 * like.
 */
function requestedPath(cwd: string, request: ConfigRequest): string {
  const root = resolve(cwd);
  return request.configPath === undefined
    ? join(root, CONFIG_FILE_NAME)
    : resolve(root, request.configPath);
}

/**
 * The real-disk loader behind Runtime.loadConfig. The bin binds it to
 * the process cwd; tests hand in fixtures.
 */
export async function loadConfig(
  cwd: string,
  request: ConfigRequest,
): Promise<LoadedConfig> {
  const path = requestedPath(cwd, request);
  if (!existsSync(path)) {
    return request.configPath === undefined
      ? { sections: {}, diagnostics: [] }
      : fileLevelConfig(missingNamedFileDiagnostic(path));
  }
  let exported: unknown;
  try {
    exported = await evaluateConfigFile(path);
  } catch (cause) {
    return fileLevelConfig(unreadableDiagnostic(path, cause));
  }
  if (!hasVersionMarker(exported)) {
    return fileLevelConfig(missingMarkerDiagnostic(path));
  }
  const version = exported[MARKER_KEY] as number;
  if (version !== PRISMA_CONFIG_VERSION) {
    return fileLevelConfig(unsupportedVersionDiagnostic(path, version));
  }
  const sections = sectionsOf(exported);
  return {
    sections,
    diagnostics: unknownSections(path, sections, request.knownSections),
  };
}
