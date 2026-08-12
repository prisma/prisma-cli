/**
 * Everything that touches the compute config on disk: finding an
 * existing one, writing a new one, and the JSON-to-TypeScript
 * conversion. The serialized bytes come from the compute SDK, so what a
 * user ends up with is byte-identical to the legacy command's output.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CliStructuredError } from "@prisma/cli-engine/protocol";
import {
  COMPUTE_CONFIG_FILENAME,
  COMPUTE_CONFIG_JSON_FILENAME,
  type ComputeConfig,
  findComputeConfigCandidates,
  findComputeConfigDir,
  frameworkByKey,
  type LoadedComputeConfig,
  normalizeComputeConfig,
  serializeComputeConfig,
  serializeComputeConfigJson,
} from "@prisma/compute-sdk/config";
import { initError } from "./errors";
import type {
  InitConfigFormat,
  InitFlags,
  InitResult,
  InitSettingRow,
  InitStepContext,
} from "./types";

const CUSTOM_BUILD_STUB = `
// framework "custom" deploys a prebuilt artifact. Add its build settings:
// build: {
//   command: "npm run build",
//   outputDirectory: "dist",
//   entrypoint: "server.js",
// },
`;

export interface ExistingConfig {
  readonly directory: string;
  readonly candidates: readonly string[];
}

/** Nearest existing compute config, searching from `cwd` up to the
 *  source root. Init routes on this: refuse, convert, or proceed fresh. */
export async function findExistingConfig(
  cwd: string,
  signal: AbortSignal,
): Promise<ExistingConfig | null> {
  const directory = await findComputeConfigDir(cwd, signal);
  if (!directory) {
    return null;
  }
  return {
    directory,
    candidates: await findComputeConfigCandidates(directory, signal),
  };
}

export function configExistsError(existingPath: string): CliStructuredError {
  return initError({
    code: "INIT.CONFIG_EXISTS",
    summary: "A compute config already exists",
    why: `${existingPath} already defines this repository's compute config, and init never overwrites or merges.`,
    fix: "Edit the existing config instead, or delete it first if you want init to regenerate it.",
    where: existingPath,
    meta: { existingConfigPath: existingPath },
  });
}

export function convertUnsupportedError(
  existingPath: string,
): CliStructuredError {
  return initError({
    code: "INIT.CONVERT_UNSUPPORTED",
    summary: "TypeScript configs do not convert to JSON",
    why: `${existingPath} may contain imports, expressions, or comments that the static ${COMPUTE_CONFIG_JSON_FILENAME} format cannot express, so an automatic conversion would be lossy.`,
    fix: `If the config is fully static, rewrite it by hand as ${COMPUTE_CONFIG_JSON_FILENAME} and delete ${path.basename(existingPath)}.`,
    where: existingPath,
    meta: { existingConfigPath: existingPath },
  });
}

function convertIncompleteError(
  jsonConfigPath: string,
  tsConfigPath: string,
): CliStructuredError {
  return initError({
    code: "INIT.CONVERT_INCOMPLETE",
    summary: "Conversion left two config files behind",
    why: `${path.basename(tsConfigPath)} was written but ${path.basename(jsonConfigPath)} could not be deleted, and rolling back the write also failed. Commands refuse to load a directory with two config files.`,
    fix: `Delete one file by hand: keep ${path.basename(tsConfigPath)} to finish the conversion, or keep ${path.basename(jsonConfigPath)} to undo it.`,
    meta: { jsonConfigPath, tsConfigPath },
  });
}

function convertInvalidError(
  jsonConfigPath: string,
  issues: readonly string[],
): CliStructuredError {
  return initError({
    code: "INIT.COMPUTE_CONFIG_INVALID",
    summary: `Invalid ${path.basename(jsonConfigPath)}`,
    why: issues.join(" "),
    fix: `Fix ${path.basename(jsonConfigPath)} and rerun the conversion.`,
    where: jsonConfigPath,
    meta: { configPath: jsonConfigPath, issues },
  });
}

/**
 * Conversion transports the existing config's values; it never
 * re-resolves settings. Refusing resolution flags beats silently
 * ignoring them.
 */
export function rejectConversionResolutionFlags(
  flags: InitFlags,
  step: InitStepContext,
): void {
  const passed = [
    flags.framework !== undefined ? "--framework" : null,
    flags.entry !== undefined ? "--entry" : null,
    flags.httpPort !== undefined ? "--http-port" : null,
    flags.name !== undefined ? "--name" : null,
    flags.region !== undefined ? "--region" : null,
  ].filter((flag): flag is string => flag !== null);
  if (passed.length === 0) {
    return;
  }
  throw initError({
    code: "INIT.CONVERSION_FLAGS_NOT_APPLICABLE",
    summary: `${passed.join(", ")} ${passed.length === 1 ? "does" : "do"} not apply when converting an existing config`,
    why: `--config-format ts with an existing ${COMPUTE_CONFIG_JSON_FILENAME} converts it as-is; settings are transported, never re-resolved.`,
    fix: `Convert first, then edit ${COMPUTE_CONFIG_FILENAME} directly.`,
    commands: [step.formatCommand(["init", "--config-format", "ts"])],
    meta: { flags: passed },
  });
}

async function writeNew(configPath: string, source: string): Promise<void> {
  try {
    // wx: fail instead of clobbering a config that appeared since the check.
    await writeFile(configPath, source, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw configExistsError(configPath);
    }
    throw error;
  }
}

export interface WrittenConfig {
  readonly configPath: string;
  readonly filename: string;
}

export async function writeConfig(spec: {
  readonly cwd: string;
  readonly config: ComputeConfig;
  readonly format: InitConfigFormat;
  readonly custom: boolean;
  readonly signal: AbortSignal;
}): Promise<WrittenConfig> {
  const filename =
    spec.format === "json"
      ? COMPUTE_CONFIG_JSON_FILENAME
      : COMPUTE_CONFIG_FILENAME;
  const configPath = path.join(spec.cwd, filename);
  let source: string;
  if (spec.format === "json") {
    source = serializeComputeConfigJson(spec.config);
  } else {
    source = serializeComputeConfig(spec.config);
    if (spec.custom) {
      source += CUSTOM_BUILD_STUB;
    }
  }

  spec.signal.throwIfAborted();
  await writeNew(configPath, source);
  return { configPath, filename };
}

function stripJsonSchemaKey(parsed: unknown): unknown {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }
  const { $schema: _schema, ...config } = parsed as Record<string, unknown>;
  return config;
}

export interface Conversion {
  readonly tsConfigPath: string;
  readonly configDir: string;
  readonly settings: readonly InitSettingRow[];
  readonly app: InitResult["app"];
}

/**
 * The graduation path: an explicit `--config-format ts` over an existing
 * `prisma.compute.json` rewrites the same config as `prisma.compute.ts`
 * and deletes the JSON file, so a static config can grow into a
 * programmatic one. The values are transported, never re-resolved.
 */
export async function convertJsonConfig(
  jsonConfigPath: string,
  signal: AbortSignal,
): Promise<Conversion> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(jsonConfigPath, "utf8"));
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw convertInvalidError(jsonConfigPath, [
      error instanceof Error
        ? (error.message.split("\n")[0] as string)
        : String(error),
    ]);
  }

  // "$schema" is editor tooling metadata, not config; the TypeScript
  // format carries types through its import instead.
  const config = stripJsonSchemaKey(parsed);
  const normalized = normalizeComputeConfig(config, jsonConfigPath);
  if (normalized.isErr()) {
    throw convertInvalidError(jsonConfigPath, normalized.error.issues);
  }
  const loaded = normalized.value;
  const tsConfigPath = path.join(loaded.configDir, COMPUTE_CONFIG_FILENAME);

  signal.throwIfAborted();
  await writeNew(tsConfigPath, serializeComputeConfig(config as ComputeConfig));
  try {
    await rm(jsonConfigPath);
  } catch (error) {
    // Two coexisting config files are a hard loader error, so a failed
    // delete rolls the write back and leaves the JSON config untouched.
    try {
      await rm(tsConfigPath, { force: true });
    } catch {
      throw convertIncompleteError(jsonConfigPath, tsConfigPath);
    }
    throw error;
  }

  return {
    tsConfigPath,
    configDir: loaded.configDir,
    settings: conversionSettings(loaded),
    app: conversionApp(loaded),
  };
}

/** Preview rows for a conversion; every value is sourced from the JSON file. */
function conversionSettings(loaded: LoadedComputeConfig): InitSettingRow[] {
  const target = loaded.kind === "single" ? loaded.targets[0] : undefined;
  if (!target) {
    return [];
  }
  const source = COMPUTE_CONFIG_JSON_FILENAME;
  return [
    ...(target.name ? [{ key: "app", value: target.name, source }] : []),
    ...(target.framework
      ? [
          {
            key: "framework",
            value: frameworkByKey(target.framework).displayName,
            source,
          },
        ]
      : []),
    ...(target.entry ? [{ key: "entry", value: target.entry, source }] : []),
    ...(target.httpPort !== null
      ? [{ key: "http port", value: String(target.httpPort), source }]
      : []),
    ...(target.region ? [{ key: "region", value: target.region, source }] : []),
  ];
}

/**
 * App identity for the conversion result. Configs written by init pin
 * all of name, framework and httpPort; hand-written configs that omit
 * any of them (or define multiple apps) report null instead of a
 * partial identity.
 */
function conversionApp(loaded: LoadedComputeConfig): InitResult["app"] {
  const target = loaded.kind === "single" ? loaded.targets[0] : undefined;
  if (!target?.name || !target.framework || target.httpPort === null) {
    return null;
  }
  return {
    name: target.name,
    framework: target.framework,
    httpPort: target.httpPort,
    ...(target.entry ? { entry: target.entry } : {}),
    ...(target.region ? { region: target.region } : {}),
  };
}
