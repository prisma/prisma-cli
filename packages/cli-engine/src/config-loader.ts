/**
 * The prisma.config.ts loader behind Runtime.loadConfig: resolve an
 * ordered chain of config files, evaluate each, check every one for the
 * definePrismaConfig version marker, and produce LoadedConfig.
 *
 * Discovery starts at the anchor directory — cwd, or with `--config`
 * the named file's own directory — and walks upward collecting every
 * prisma.config.ts, stopping at the repository boundary: the first
 * directory containing `.git`. No `.git` at or above the anchor means
 * the anchor directory only — every file on the chain is executed
 * TypeScript, and nothing outside the repository runs without explicit
 * consent. A file may end collection itself with `parent: false`, or
 * name its parent explicitly with `parent: "path"` (resolved against
 * the declaring file's directory); an explicit parent may cross the
 * repository boundary — naming it is the consent — and the chain is
 * cycle-checked. After an explicit link, automatic discovery resumes
 * from the parent file's own directory.
 *
 * Which section names a CLI recognises is not this module's business:
 * it hands back every top-level key each file had, and the engine — not
 * a Runtime member a host can replace — checks them against the
 * sections the mounted commands declare.
 *
 * Finding no file is not an error: section validators own absence, so
 * a chain with no files yields no sections and no diagnostics.
 * Absence of a file the user NAMED with --config is an error — they
 * said which file to read and it was not there. An evaluated file
 * WITHOUT the marker (a classic Prisma 7 config, which uses the same
 * filename) fails early with one typed diagnostic naming that file —
 * the loader never partially interprets an unmarked file, and never
 * guesses. A broken file anywhere on the chain fails resolution.
 *
 * Evaluation goes through c12, the same loader prisma/prisma and
 * prisma/composer use, because the shipped CLI runs on ordinary Node,
 * which cannot import a .ts file. c12 transpiles it with jiti first.
 * Every c12 feature beyond "evaluate this one file" is switched off
 * below — chain discovery is this loader's, never c12's.
 */
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Diagnostic } from "./protocol";
import type { LoadedConfig, LoadedConfigFile } from "./runtime";
import { PRISMA_CONFIG_VERSION } from "./runtime";

export const CONFIG_FILE_NAME = "prisma.config.ts";

const MARKER_KEY = "$prismaConfig";

const PARENT_KEY = "parent";

/**
 * Top-level keys the config file format keeps for itself, so no
 * section may be named one of them; buildCommandTree rejects the
 * declaration at construction.
 *
 * `$`-prefixed keys are metadata: `$prismaConfig` is the version
 * marker, and config loaders read `$env`, `$<NODE_ENV>` and `$meta` —
 * c12 deletes `$meta` from the config object whatever else it is told.
 * `parent` is the engine's chain directive: the loader reads it to
 * follow or end the chain and strips it from the sections, like the
 * marker.
 * `extends` is the key config loaders take as "merge another file into
 * this one". This loader switches that off (`extend: false`), so a key
 * by that name does reach the config object. It stays reserved anyway:
 * `parent` is this format's layering, and a section called `extends`
 * would disappear the moment anything switched c12's merging back on.
 *
 * `__proto__` is reserved for the reason `$meta` is: c12 merges layers
 * with defu, which drops the key rather than let a config file reach an
 * object's prototype, so a section by that name could never be read.
 */
export function reservedConfigSectionName(name: string): boolean {
  return (
    name === "extends" ||
    name === PARENT_KEY ||
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

function hasVersionMarker(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)[MARKER_KEY] === "number"
  );
}

function failedChain(
  files: readonly LoadedConfigFile[],
  diagnostic: Diagnostic,
): LoadedConfig {
  return { files, diagnostics: [{ section: null, diagnostic }] };
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
          "Correct the path passed to --config, or drop the flag to let the CLI discover prisma.config.ts from the current directory.",
      },
    ],
    where: { path },
  };
}

/** JSON where it can (true, null, 42, {}); String for what JSON has no
 *  spelling for (undefined cannot reach here, but bigint or a symbol
 *  can). */
function showParentValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function invalidParentDiagnostic(path: string, value: unknown): Diagnostic {
  return {
    code: "CLI.CONFIG_PARENT_INVALID",
    severity: "error",
    summary: `${path} declares parent: ${showParentValue(value)}, but parent must be false or a path string.`,
    why: "'parent' controls config discovery: false makes this file the last on the chain, and a path names the next file explicitly. Any other value is a mistake the CLI stops on rather than guesses about.",
    nextActions: [
      {
        kind: "user-choice",
        label:
          "Set parent to false or to the path of the parent config file, or remove it to let discovery continue upward.",
      },
    ],
    where: { path },
  };
}

function missingParentDiagnostic(
  declaring: string,
  target: string,
): Diagnostic {
  return {
    code: "CLI.CONFIG_PARENT_NOT_FOUND",
    severity: "error",
    summary: `${declaring} names ${target} as its parent config, and there is no file there.`,
    nextActions: [
      {
        kind: "user-choice",
        label:
          "Correct the parent path, set parent to false, or remove it to let discovery continue upward.",
      },
    ],
    where: { path: declaring },
  };
}

function parentCycleDiagnostic(declaring: string, target: string): Diagnostic {
  return {
    code: "CLI.CONFIG_PARENT_CYCLE",
    severity: "error",
    summary: `${declaring} names ${target} as its parent config, but that file is already on the config chain.`,
    why: "Following the link again would loop forever, so resolution stops here.",
    nextActions: [
      {
        kind: "user-choice",
        label: "Break the cycle: point parent elsewhere or set it to false.",
      },
    ],
    where: { path: declaring },
  };
}

/** jiti reports an unresolvable import as "Cannot find module", Node's
 *  own resolver as "Cannot find package"; either can appear in the
 *  evaluation error chain depending on how the file is loaded. Node's
 *  ESM resolver names only the package, not the subpath — a missing
 *  `import "prisma/config"` reads "Cannot find package 'prisma'" — and
 *  the closing quote keeps a package like 'prisma-x' from matching. */
const MISSING_PRISMA_CONFIG_MESSAGES = [
  "Cannot find module 'prisma/config'",
  "Cannot find package 'prisma/config'",
  "Cannot find package 'prisma'",
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

/** A plain `npm install prisma` would fetch `latest`, which can be the
 *  too-old version the `why` warns about — the example names the exact
 *  version, or is dropped when the host supplied none. */
function prismaConfigUnresolvedDiagnostic(
  path: string,
  cliVersion: string | undefined,
): Diagnostic {
  const example =
    cliVersion === undefined
      ? ""
      : ` (for example: npm install --save-dev prisma@${cliVersion})`;
  return {
    code: "CLI.CONFIG_UNREADABLE",
    severity: "error",
    summary: `${path} could not be evaluated: the 'prisma/config' entry point could not be resolved from this project.`,
    why: "The config file imports definePrismaConfig from the prisma npm package's 'prisma/config' entry point, which resolves from the project's node_modules. The package may be missing there — running the CLI through npx installs nothing into the project — or an installed version may be too old to provide the entry point.",
    nextActions: [
      {
        kind: "user-choice",
        label: `Install the prisma package matching this CLI's version as a dev dependency${example}, then run the command again.`,
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
    Object.entries(exported).filter(
      ([key]) => key !== MARKER_KEY && key !== PARENT_KEY,
    ),
  );
}

/** realpath where the path exists; the path itself where it does not
 *  (a cwd that is gone, a comparison candidate that was just checked). */
export function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The first directory at or above `dir` containing a `.git` entry —
 *  a directory in an ordinary checkout, a file in worktrees and
 *  submodules — or null when there is none all the way up. */
function repositoryBoundary(dir: string): string | null {
  let current = dir;
  while (true) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/** The directories automatic discovery scans from `start`: upward to
 *  the repository boundary inclusive, or `start` alone when no `.git`
 *  exists at or above it. */
function discoveryDirs(start: string): string[] {
  const boundary = repositoryBoundary(start);
  const dirs = [start];
  let current = start;
  while (boundary !== null && current !== boundary) {
    current = dirname(current);
    dirs.push(current);
  }
  return dirs;
}

/** Where discovery continues after the file in `dir`: the directories
 *  strictly above it, still inside its repository. Outside any
 *  repository, nothing above it is scanned. */
function dirsAbove(dir: string): string[] {
  return discoveryDirs(dir).slice(1);
}

/** A directory named prisma.config.ts is not a config file, for
 *  discovery and explicit `parent` links alike. */
function isFileAt(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function nextDiscoveredFile(
  dirs: readonly string[],
  collected: ReadonlySet<string>,
): string | null {
  for (const dir of dirs) {
    const candidate = join(dir, CONFIG_FILE_NAME);
    if (isFileAt(candidate) && !collected.has(realpathOr(candidate))) {
      return candidate;
    }
  }
  return null;
}

/** The next chain link: a file an explicit step named (--config or a
 *  `parent` path, known to exist), or the directories to scan for one. */
type NextLink =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "scan"; readonly dirs: readonly string[] };

type EvaluatedChainFile =
  | { readonly ok: true; readonly exported: Record<string, unknown> }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/** One file's evaluation and marker/version classification, every
 *  outcome carrying the diagnostic that names this file. */
async function evaluateChainFile(
  path: string,
  cliVersion: string | undefined,
): Promise<EvaluatedChainFile> {
  let exported: unknown;
  try {
    exported = await evaluateConfigFile(path);
  } catch (cause) {
    return {
      ok: false,
      diagnostic: importsMissingPrismaPackage(cause)
        ? prismaConfigUnresolvedDiagnostic(path, cliVersion)
        : unreadableDiagnostic(path, cause),
    };
  }
  if (!hasVersionMarker(exported)) {
    return { ok: false, diagnostic: missingMarkerDiagnostic(path) };
  }
  const version = exported[MARKER_KEY] as number;
  if (version !== PRISMA_CONFIG_VERSION) {
    return {
      ok: false,
      diagnostic: unsupportedVersionDiagnostic(path, version),
    };
  }
  return { ok: true, exported };
}

type LinkOutcome =
  | { readonly next: NextLink | null }
  | { readonly diagnostic: Diagnostic };

/** Where the chain goes after the file at `path` declared `parent`:
 *  false ends it, a path names the next file (checked to exist and to
 *  not close a cycle), absence resumes automatic discovery above. */
function followParent(
  path: string,
  parent: unknown,
  collected: ReadonlySet<string>,
): LinkOutcome {
  if (parent === false) {
    return { next: null };
  }
  if (typeof parent === "string") {
    const target = resolve(dirname(path), parent);
    if (!isFileAt(target)) {
      return { diagnostic: missingParentDiagnostic(path, target) };
    }
    // Realpath'd like a --config target: a symlinked parent traverses
    // and reports the real file, so its own relative parent and the
    // discovery above it anchor at the real directory.
    const real = realpathOr(target);
    if (collected.has(real)) {
      return { diagnostic: parentCycleDiagnostic(path, target) };
    }
    return { next: { kind: "file", path: real } };
  }
  if (parent !== undefined) {
    return { diagnostic: invalidParentDiagnostic(path, parent) };
  }
  return {
    next: { kind: "scan", dirs: dirsAbove(realpathOr(dirname(path))) },
  };
}

async function collectChain(
  first: NextLink,
  cliVersion: string | undefined,
): Promise<LoadedConfig> {
  const files: LoadedConfigFile[] = [];
  const collected = new Set<string>();
  let next: NextLink | null = first;
  while (next !== null) {
    const path =
      next.kind === "file"
        ? next.path
        : nextDiscoveredFile(next.dirs, collected);
    if (path === null) {
      break;
    }
    // biome-ignore lint/performance/noAwaitInLoops: each file's parent link is read from its evaluated export, so the chain can only be followed one file at a time.
    const evaluated = await evaluateChainFile(path, cliVersion);
    if (!evaluated.ok) {
      return failedChain(files, evaluated.diagnostic);
    }
    files.push({ path, sections: sectionsOf(evaluated.exported) });
    collected.add(realpathOr(path));
    const link = followParent(path, evaluated.exported[PARENT_KEY], collected);
    if ("diagnostic" in link) {
      return failedChain(files, link.diagnostic);
    }
    next = link.next;
  }
  return { files, diagnostics: [] };
}

/**
 * The real-disk loader behind Runtime.loadConfig. The bin binds it to
 * the process cwd and its own version; tests hand in fixtures.
 * `cliVersion` names the exact prisma version in the install guidance
 * when the 'prisma/config' entry point cannot be resolved; absent, the
 * guidance names no version rather than an example that installs the
 * wrong one.
 *
 * Every path handed onward is absolute — one more thing than either
 * reference repository does, since both are handed an absolute path
 * before they reach c12. Given a relative path, c12 resolves it a
 * second time against its own cwd and looks for a file that is not
 * there, and jiti cannot import a relative specifier at all. Resolving
 * here also makes the file's path in every diagnostic absolute, and
 * makes every chain-path comparison compare like with like. The anchor
 * directory is additionally resolved through symlinks, so discovered
 * files and the errors about them name real paths.
 */
export async function loadConfig(
  cwd: string,
  configPath?: string,
  cliVersion?: string,
): Promise<LoadedConfig> {
  const root = resolve(cwd);
  if (configPath === undefined) {
    return collectChain(
      { kind: "scan", dirs: discoveryDirs(realpathOr(root)) },
      cliVersion,
    );
  }
  const named = resolve(root, configPath);
  if (!existsSync(named)) {
    return failedChain([], missingNamedFileDiagnostic(named));
  }
  // Realpath'd like the automatic anchor: a symlinked --config yields
  // the same chain and the same real-path diagnostics as discovery.
  return collectChain({ kind: "file", path: realpathOr(named) }, cliVersion);
}
