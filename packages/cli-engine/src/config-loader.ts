/**
 * The prisma.config.ts loader behind Runtime.loadConfig: resolve the
 * file (the one `--config` named, otherwise prisma.config.ts in cwd —
 * cwd only, no walking up), evaluate it, check the defineConfig version
 * marker, and produce LoadedConfig.
 *
 * Which section names a CLI recognises is not this module's business:
 * it hands back every top-level key the file had, and the engine — not
 * a Runtime member a host can replace — checks them against the
 * sections the mounted commands declare.
 *
 * Absence of an undiscovered file is not an error: section validators
 * own absence, so no prisma.config.ts in cwd yields no sections and no
 * diagnostics.
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
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Diagnostic } from "./protocol";
import type { LoadedConfig } from "./runtime";
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
 *
 * `__proto__` is reserved for the reason `$meta` is: c12 merges layers
 * with defu, which drops the key rather than let a config file reach an
 * object's prototype, so a section by that name could never be read.
 */
export function reservedConfigSectionName(name: string): boolean {
  return name === "extends" || name === "__proto__" || name.startsWith("$");
}

/**
 * Attaches the version marker to a prisma.config.ts export. Each
 * top-level key names a config section, and the recognised section
 * names are exactly the ones the CLI's command families declare. Never
 * throws — bad section values are the section validator's problem, not
 * definePrismaConfig's.
 */
export function definePrismaConfig<T extends Record<string, unknown>>(
  config: T,
): T & { readonly $prismaConfig: number } {
  return Object.freeze({ ...config, $prismaConfig: PRISMA_CONFIG_VERSION });
}

/** @deprecated Renamed to {@link definePrismaConfig}: every family's
 *  config helper carries a unique name, so none needs an import alias. */
export const defineConfig = definePrismaConfig;

function hasVersionMarker(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)[MARKER_KEY] === "number"
  );
}

function fileLevelConfig(path: string, diagnostic: Diagnostic): LoadedConfig {
  return { path, sections: {}, diagnostics: [{ section: null, diagnostic }] };
}

function missingMarkerDiagnostic(path: string): Diagnostic {
  return {
    code: "CLI.CONFIG_MISSING_MARKER",
    severity: "error",
    summary: `${path} was not written for this version of the Prisma CLI, so it cannot be used.`,
    why: "Configs for this CLI are created with definePrismaConfig, which records a version marker on the exported object. This file's default export has no marker — it is most likely a Prisma 7 config, which uses the same filename — and the CLI stops rather than misread it.",
    nextActions: [
      {
        kind: "user-choice",
        label:
          "Migrate the file: wrap the exported object in definePrismaConfig from @prisma/cli-engine and export the result as the default export.",
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
    code: "CLI.CONFIG_VERSION_UNSUPPORTED",
    severity: "error",
    summary: `${path} declares config version ${found}, but this CLI supports only version ${PRISMA_CONFIG_VERSION}.`,
    nextActions: [
      {
        kind: "user-choice",
        label:
          "Regenerate the config with a definePrismaConfig matching this CLI, or update the CLI to a version that supports the declared config version.",
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

/** jiti reports an unresolvable import as "Cannot find module", Node's
 *  own resolver as "Cannot find package"; either can appear in the
 *  evaluation error chain depending on how the file is loaded. */
const MISSING_PRISMA_CONFIG_MESSAGES = [
  "Cannot find module 'prisma/config'",
  "Cannot find package 'prisma/config'",
];

/** The walk is depth-limited so a cyclic `cause` chain terminates. */
const CAUSE_CHAIN_LIMIT = 10;

function importsMissingPrismaPackage(cause: unknown): boolean {
  let error: unknown = cause;
  for (
    let depth = 0;
    depth < CAUSE_CHAIN_LIMIT && error instanceof Error;
    depth += 1, error = error.cause
  ) {
    const message = error.message;
    if (MISSING_PRISMA_CONFIG_MESSAGES.some((text) => message.includes(text))) {
      return true;
    }
  }
  return false;
}

function prismaConfigUnresolvedDiagnostic(path: string): Diagnostic {
  return {
    code: "CLI.CONFIG_UNREADABLE",
    severity: "error",
    summary: `${path} could not be evaluated: the 'prisma/config' entry point could not be resolved from this project.`,
    why: "The config file imports definePrismaConfig from the prisma npm package's 'prisma/config' entry point, which resolves from the project's node_modules. The package may be missing there — running the CLI through npx installs nothing into the project — or an installed version may be too old to provide the entry point.",
    nextActions: [
      {
        kind: "user-choice",
        label:
          "Install the prisma package matching this CLI's version as a dev dependency (for example: npm install --save-dev prisma), then run the command again.",
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
 * Everything c12 does beyond evaluating the one file it was handed.
 * Composer leaves the last five at their defaults and can afford to:
 * its config has a fixed set of keys, where every top-level key here is
 * a user-authored section name, so all five are reachable from an
 * ordinary config file.
 */
const EVALUATE_ONE_FILE_ONLY = {
  rcFile: false,
  globalRc: false,
  packageJson: false,
  /** Else `$production` blocks merge over the root under NODE_ENV. */
  envName: false,
  /** Else `$prismaConfig` is stripped and every config reads unmarked. */
  omit$Keys: false,
  /** Else `extends` is a merge directive rather than a section name. */
  extend: false,
  /** Else an `extends` URL is fetched over the network and evaluated. */
  giget: false,
  /** Else a neighbouring .env is read into process.env. */
  dotenv: false,
} as const;

/**
 * Evaluates the file at `path` and returns its default export. The call
 * is prisma/composer's `loadAppConfig` with prisma/prisma's dynamic
 * import, so a run with no config file never pays for c12 or jiti.
 *
 * The loaded-file check is in both references: c12 is asked for one
 * exact path and must not answer with another.
 */
async function evaluateConfigFile(path: string): Promise<unknown> {
  // Imported via its realpath: under pnpm symlink layouts c12's own
  // dependencies are only reachable from its real location in the store.
  const c12 = await import(
    pathToFileURL(realpathSync(fileURLToPath(import.meta.resolve("c12")))).href
  );
  const result = await c12.loadConfig({
    name: "prisma",
    configFile: path,
    cwd: dirname(path),
    ...EVALUATE_ONE_FILE_ONLY,
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

/** Built with fromEntries rather than assigned key by key: assigning a
 *  key named `__proto__` runs Object.prototype's setter instead of
 *  creating an own property, so that one key would disappear from
 *  Object.keys and never be reported as unrecognised. */
function sectionsOf(
  exported: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(exported).filter(([key]) => key !== MARKER_KEY),
  );
}

/**
 * The file to read, always absolute: the one --config named, resolved
 * against cwd, or prisma.config.ts in cwd.
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
function fileToRead(cwd: string, configPath: string | undefined): string {
  const root = resolve(cwd);
  return configPath === undefined
    ? join(root, CONFIG_FILE_NAME)
    : resolve(root, configPath);
}

/**
 * The real-disk loader behind Runtime.loadConfig. The bin binds it to
 * the process cwd; tests hand in fixtures.
 */
export async function loadConfig(
  cwd: string,
  configPath?: string,
): Promise<LoadedConfig> {
  const path = fileToRead(cwd, configPath);
  if (!existsSync(path)) {
    return configPath === undefined
      ? { path, sections: {}, diagnostics: [] }
      : fileLevelConfig(path, missingNamedFileDiagnostic(path));
  }
  let exported: unknown;
  try {
    exported = await evaluateConfigFile(path);
  } catch (cause) {
    return fileLevelConfig(
      path,
      importsMissingPrismaPackage(cause)
        ? prismaConfigUnresolvedDiagnostic(path)
        : unreadableDiagnostic(path, cause),
    );
  }
  if (!hasVersionMarker(exported)) {
    return fileLevelConfig(path, missingMarkerDiagnostic(path));
  }
  const version = exported[MARKER_KEY] as number;
  if (version !== PRISMA_CONFIG_VERSION) {
    return fileLevelConfig(path, unsupportedVersionDiagnostic(path, version));
  }
  return { path, sections: sectionsOf(exported), diagnostics: [] };
}
