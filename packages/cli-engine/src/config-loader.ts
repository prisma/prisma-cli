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
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Diagnostic } from "./protocol";
import type { ConfigRequest, LoadedConfig } from "./runtime";
import { PRISMA_CONFIG_VERSION } from "./runtime";

export const CONFIG_FILE_NAME = "prisma.config.ts";

const MARKER_KEY = "$prismaConfig";

/**
 * Top-level keys that never reach the loader as ordinary config data.
 * c12 reads `extends` as an instruction to merge another config layer,
 * and `$`-prefixed keys are metadata: c12 owns `$env`, `$<NODE_ENV>`
 * and `$meta`, and `$prismaConfig` is this loader's version marker. A
 * command family may not own a section with one of these names;
 * buildCommandTree rejects it at construction.
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
    summary:
      "This prisma.config.ts was not written for this version of the Prisma CLI, so it cannot be used.",
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
    summary: `prisma.config.ts declares config version ${found}, but this CLI supports only version ${PRISMA_CONFIG_VERSION}.`,
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
 * One key cannot be reported this way: `extends`. c12 consumes it as a
 * merge directive and removes it before the loader sees the object, so
 * a section named `extends` never reaches this check. That is why
 * buildCommandTree refuses to let a command family claim the name.
 */
function unknownSectionDiagnostic(
  path: string,
  key: string,
  knownSections: readonly string[],
): Diagnostic {
  return {
    code: "CLI.CONFIG_UNKNOWN_SECTION",
    severity: "error",
    summary: `prisma.config.ts has a top-level key '${key}', which is not a config section this CLI recognises.`,
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
    summary: `prisma.config.ts could not be evaluated: ${firstLine(message)}`,
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
 * call is prisma/composer's `loadAppConfig` verbatim — explicit
 * configFile, cwd at that file's directory, the three lookups it turns
 * off, and nothing else — with prisma/prisma's dynamic import, so a run
 * with no config file never pays for loading c12 or jiti.
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
  });
  if (result.configFile !== path) {
    throw new Error(
      `config loading resolved ${String(result.configFile)} instead of ${path}`,
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

/** The path the request asks for: the file named by --config, resolved
 *  against cwd, or prisma.config.ts in cwd. */
function requestedPath(cwd: string, request: ConfigRequest): string {
  return request.configPath === undefined
    ? join(cwd, CONFIG_FILE_NAME)
    : resolve(cwd, request.configPath);
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
