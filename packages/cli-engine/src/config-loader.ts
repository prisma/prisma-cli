/**
 * The prisma.config.ts loader behind Runtime.loadConfig: resolve the
 * file, evaluate it, check the defineConfig version marker, and
 * produce LoadedConfig.
 *
 * Resolution is either the file `--config` named — no discovery at
 * all — or discovery: walk upward from cwd, taking prisma.config.ts
 * in each ancestor directory as a candidate. A candidate carrying
 * `root: true` stops the walk and becomes the anchor; otherwise the
 * walk reaches the filesystem root and the topmost candidate wins.
 * Each candidate is evaluated to read its `root` flag, so a candidate
 * that cannot be evaluated (or has no version marker) can never carry
 * `root: true`; it still counts as a candidate, and its diagnostics
 * surface if it ends up the anchor.
 *
 * Which section names a CLI recognises is not this module's business:
 * it hands back every top-level key the file had, and the engine — not
 * a Runtime member a host can replace — checks them against the
 * sections the mounted commands declare.
 *
 * Absence of an undiscovered file is not an error: section validators
 * own absence, so no prisma.config.ts in cwd or any ancestor yields no
 * sections and no diagnostics.
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
 *
 * `root` is a different kind of reservation: not mechanics, but the
 * first engine-owned file-level setting. It is an optional boolean the
 * loader reads during discovery — `root: true` stops the upward search
 * at that file — and surfaces on LoadedConfig, never as a section.
 */
export function reservedConfigSectionName(name: string): boolean {
  return (
    name === "root" ||
    name === "extends" ||
    name === "__proto__" ||
    name.startsWith("$")
  );
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

function invalidRootDiagnostic(path: string): Diagnostic {
  return {
    code: "CLI.CONFIG_ROOT_INVALID",
    severity: "error",
    summary: `${path} sets 'root' to a value that is not a boolean.`,
    why: "'root' is a file-level setting read during config discovery: 'root: true' stops the upward search at this file. It is not a config section, and only true or false mean anything.",
    nextActions: [
      {
        kind: "user-choice",
        label: "Set root to true or false, or remove the key.",
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
  const c12 = await import("c12");
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
    Object.entries(exported).filter(
      ([key]) => key !== MARKER_KEY && key !== "root",
    ),
  );
}

/**
 * Evaluates and interprets the one file at `path` (which exists and is
 * absolute). Absolute is not cosmetic, and it is one more thing than
 * either reference repository does — both are handed an absolute path
 * before they reach c12, so neither has to resolve one. Given a
 * relative path, c12 resolves it a second time against its own cwd and
 * looks for a file that is not there, and jiti cannot import a
 * relative specifier at all. An absolute path also makes the file's
 * path in every diagnostic absolute, and makes the loaded-file
 * comparison compare like with like.
 */
async function loadConfigFile(path: string): Promise<LoadedConfig> {
  let exported: unknown;
  try {
    exported = await evaluateConfigFile(path);
  } catch (cause) {
    return fileLevelConfig(path, unreadableDiagnostic(path, cause));
  }
  if (!hasVersionMarker(exported)) {
    return fileLevelConfig(path, missingMarkerDiagnostic(path));
  }
  const version = exported[MARKER_KEY] as number;
  if (version !== PRISMA_CONFIG_VERSION) {
    return fileLevelConfig(path, unsupportedVersionDiagnostic(path, version));
  }
  const root = exported.root;
  if (root !== undefined && typeof root !== "boolean") {
    return fileLevelConfig(path, invalidRootDiagnostic(path));
  }
  const loaded = { path, sections: sectionsOf(exported), diagnostics: [] };
  return root === undefined ? loaded : { ...loaded, root };
}

/**
 * The real-disk loader behind Runtime.loadConfig. The bin binds it to
 * the process cwd; tests hand in fixtures.
 */
export async function loadConfig(
  cwd: string,
  configPath?: string,
): Promise<LoadedConfig> {
  const base = resolve(cwd);
  if (configPath !== undefined) {
    const path = resolve(base, configPath);
    return existsSync(path)
      ? loadConfigFile(path)
      : fileLevelConfig(path, missingNamedFileDiagnostic(path));
  }
  let topmost: LoadedConfig | undefined;
  for (let dir = base; ; ) {
    const candidate = join(dir, CONFIG_FILE_NAME);
    if (existsSync(candidate)) {
      // biome-ignore lint/performance/noAwaitInLoops: candidates are read in walk order, and a `root: true` result ends the walk before the next candidate is touched.
      topmost = await loadConfigFile(candidate);
      if (topmost.root === true) {
        return topmost;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return (
    topmost ?? {
      path: join(base, CONFIG_FILE_NAME),
      sections: {},
      diagnostics: [],
    }
  );
}
