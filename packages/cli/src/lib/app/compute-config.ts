import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Result, TaggedError, matchError } from "better-result";
import { createJiti } from "jiti";

import { COMPUTE_FRAMEWORKS, type ComputeFramework } from "../../config";
import { frameworkByKey, isConfigBackedBuildType, type FrameworkBuildType } from "./frameworks";
import { CliError } from "../../shell/errors";
import { sourceRootLineage } from "../fs/source-root";
import { COMPUTE_CONFIG_FILENAME, findComputeConfigCandidates } from "./compute-config-discovery";
import { normalizeRelativePath } from "./preview-build-settings";

export { COMPUTE_CONFIG_FILENAME, COMPUTE_CONFIG_FILENAMES } from "./compute-config-discovery";

export interface ComputeDeployTargetBuild {
  /** Build command, null to skip the build step, undefined when not configured. */
  command: string | null | undefined;
  /** Normalized output path relative to the app root, undefined when not configured. */
  outputDirectory: string | undefined;
}

export interface ComputeDeployTarget {
  /** `apps` map key, or null for a single-app `app` config. */
  key: string | null;
  name: string | null;
  /** Normalized app directory relative to the config file, or null for the config directory. */
  root: string | null;
  framework: ComputeFramework | null;
  entry: string | null;
  httpPort: number | null;
  /** `--env`-shaped inputs: dotenv file paths first, then NAME=VALUE assignments. */
  envInputs: string[];
  /** Build settings; non-null means the config owns build configuration. */
  build: ComputeDeployTargetBuild | null;
}

export interface LoadedComputeConfig {
  configPath: string;
  /** Directory containing the config file. Config-relative paths resolve from here. */
  configDir: string;
  relativeConfigPath: string;
  kind: "single" | "multi";
  targets: ComputeDeployTarget[];
}

export class ComputeConfigAmbiguousError extends TaggedError("ComputeConfigAmbiguousError")<{
  message: string;
  configPaths: string[];
}>() {
  constructor(configPaths: string[]) {
    super({
      message: `Multiple compute config files exist: ${configPaths.map((configPath) => path.basename(configPath)).join(", ")}. Keep exactly one.`,
      configPaths,
    });
  }
}

export class ComputeConfigLoadError extends TaggedError("ComputeConfigLoadError")<{
  message: string;
  cause: unknown;
  configPath: string;
}>() {
  constructor(configPath: string, cause: unknown) {
    super({
      message: `Could not load ${path.basename(configPath)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
      configPath,
    });
  }
}

export class ComputeConfigInvalidError extends TaggedError("ComputeConfigInvalidError")<{
  message: string;
  configPath: string;
  issues: string[];
}>() {
  constructor(configPath: string, issues: string[]) {
    super({
      message: `${path.basename(configPath)} is invalid: ${issues.join(" ")}`,
      configPath,
      issues,
    });
  }
}

export type ComputeConfigError =
  | ComputeConfigAmbiguousError
  | ComputeConfigLoadError
  | ComputeConfigInvalidError;

export class ComputeConfigTargetRequiredError extends TaggedError("ComputeConfigTargetRequiredError")<{
  message: string;
  configPath: string;
  availableTargets: string[];
}>() {
  constructor(configPath: string, availableTargets: string[]) {
    super({
      message: `${path.basename(configPath)} defines multiple apps. Pass a target: ${availableTargets.join(", ")}.`,
      configPath,
      availableTargets,
    });
  }
}

export class ComputeConfigTargetUnknownError extends TaggedError("ComputeConfigTargetUnknownError")<{
  message: string;
  configPath: string;
  requestedTarget: string;
  availableTargets: string[];
}>() {
  constructor(configPath: string, requestedTarget: string, availableTargets: string[]) {
    super({
      message: `${path.basename(configPath)} does not define an app named "${requestedTarget}". Available: ${availableTargets.join(", ")}.`,
      configPath,
      requestedTarget,
      availableTargets,
    });
  }
}

export type ComputeConfigTargetError =
  | ComputeConfigTargetRequiredError
  | ComputeConfigTargetUnknownError;

/**
 * Loads the nearest compute config, searching from `cwd` up to the source
 * root (repository or workspace boundary). Without such a boundary only
 * `cwd` itself is checked, so discovery never escapes into unrelated
 * directories.
 */
export async function loadComputeConfig(
  cwd: string,
  signal?: AbortSignal,
): Promise<Result<LoadedComputeConfig | null, ComputeConfigError>> {
  return Result.gen(async function* () {
    for (const directory of await sourceRootLineage(cwd, signal)) {
      const candidates = await findComputeConfigCandidates(directory, signal);
      if (candidates.length === 0) {
        continue;
      }
      if (candidates.length > 1) {
        return Result.err(new ComputeConfigAmbiguousError(candidates));
      }

      const configPath = candidates[0]!;
      const exported = yield* Result.await(importComputeConfigModule(configPath));
      const normalized = yield* normalizeComputeConfig(exported, configPath);
      return Result.ok(normalized);
    }

    return Result.ok(null);
  });
}

async function importComputeConfigModule(
  configPath: string,
): Promise<Result<unknown, ComputeConfigLoadError>> {
  return Result.tryPromise({
    try: async () => {
      const ownConfigModulePath = resolveOwnConfigModulePath();
      const jiti = createJiti(import.meta.url, {
        // Keep Node's standard interop so `.default` exists only for a real
        // default export (ESM) or module.exports (CJS).
        interopDefault: false,
        // Re-import fresh so repeated loads in one process observe file edits.
        moduleCache: false,
        ...(ownConfigModulePath
          ? {
            alias: {
              // Resolve the typed helper to this running CLI so config files
              // work even when @prisma/cli is not installed in the project.
              "@prisma/cli/config": ownConfigModulePath,
            },
          }
          : {}),
      });
      const moduleNamespace = await jiti.import<Record<string, unknown>>(configPath);
      // Require an explicit default export instead of jiti's namespace
      // interop so named-export configs fail with a clear message.
      return moduleNamespace?.default;
    },
    catch: (cause) => new ComputeConfigLoadError(configPath, cause),
  });
}

function resolveOwnConfigModulePath(): string | null {
  // dist layout: dist/lib/app/compute-config.js -> dist/config.js
  // src layout (tsx/vitest): src/lib/app/compute-config.ts -> src/config.ts
  for (const candidate of ["../../config.js", "../../config.ts"]) {
    const candidatePath = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

const KNOWN_APP_KEYS = ["name", "root", "framework", "entry", "httpPort", "env", "build"] as const;
const KNOWN_ENV_KEYS = ["file", "vars"] as const;
const KNOWN_BUILD_KEYS = ["command", "outputDirectory"] as const;


export function normalizeComputeConfig(
  exported: unknown,
  configPath: string,
): Result<LoadedComputeConfig, ComputeConfigInvalidError> {
  const issues: string[] = [];
  const targets: ComputeDeployTarget[] = [];
  let kind: LoadedComputeConfig["kind"] = "single";

  if (!isPlainObject(exported)) {
    issues.push("The config must `export default defineComputeConfig({ ... })` with an object value.");
  } else {
    const hasApp = exported.app !== undefined;
    const hasApps = exported.apps !== undefined;

    for (const key of Object.keys(exported)) {
      if (key !== "app" && key !== "apps") {
        issues.push(`Unknown top-level key "${key}". Expected "app" or "apps".`);
      }
    }

    if (hasApp && hasApps) {
      issues.push("Use either `app` (single app) or `apps` (multi-app), not both.");
    } else if (hasApp) {
      const target = normalizeAppEntry(exported.app, "app", null, issues);
      if (target) {
        targets.push(target);
      }
    } else if (hasApps) {
      kind = "multi";
      if (!isPlainObject(exported.apps)) {
        issues.push("`apps` must be an object keyed by deploy target name.");
      } else {
        const entries = Object.entries(exported.apps);
        if (entries.length === 0) {
          issues.push("`apps` must define at least one app.");
        }
        for (const [key, value] of entries) {
          if (key.trim().length === 0) {
            issues.push("`apps` keys must be non-empty target names.");
            continue;
          }
          const target = normalizeAppEntry(value, `apps.${key}`, key, issues);
          if (target) {
            targets.push(target);
          }
        }
      }
    } else {
      issues.push("Define `app` for a single-app repository or `apps` for a multi-app repository.");
    }
  }

  if (issues.length > 0) {
    return Result.err(new ComputeConfigInvalidError(configPath, issues));
  }

  return Result.ok({
    configPath,
    configDir: path.dirname(configPath),
    relativeConfigPath: path.basename(configPath),
    kind,
    targets,
  });
}


/** Absolute app directory of a config target. */
export function computeTargetAppDir(config: LoadedComputeConfig, target: ComputeDeployTarget): string {
  return path.resolve(config.configDir, target.root ?? ".");
}

/**
 * Infers the deploy target whose app directory contains `cwd`, so commands
 * run from inside a target's root select it without a target argument. The
 * deepest matching root wins; an ambiguous tie infers nothing and falls back
 * to the explicit target-required error.
 */
export function inferComputeTargetFromCwd(config: LoadedComputeConfig, cwd: string): string | undefined {
  if (config.kind !== "multi") {
    return undefined;
  }

  const resolvedCwd = path.resolve(cwd);
  let bestKey: string | undefined;
  let bestDepth = -1;
  let bestIsTied = false;

  for (const target of config.targets) {
    const appDir = computeTargetAppDir(config, target);
    const relative = path.relative(appDir, resolvedCwd);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      continue;
    }

    const depth = appDir.split(path.sep).length;
    if (depth > bestDepth) {
      bestKey = target.key ?? undefined;
      bestDepth = depth;
      bestIsTied = false;
    } else if (depth === bestDepth) {
      bestIsTied = true;
    }
  }

  return bestIsTied ? undefined : bestKey;
}

function normalizeAppEntry(
  value: unknown,
  label: string,
  key: string | null,
  issues: string[],
): ComputeDeployTarget | null {
  if (!isPlainObject(value)) {
    issues.push(`\`${label}\` must be an object.`);
    return null;
  }

  for (const entryKey of Object.keys(value)) {
    if (!(KNOWN_APP_KEYS as readonly string[]).includes(entryKey)) {
      issues.push(`Unknown key "${entryKey}" in \`${label}\`. Expected one of: ${KNOWN_APP_KEYS.join(", ")}.`);
    }
  }

  const name = readOptionalNonEmptyString(value.name, `${label}.name`, issues);
  const entry = readOptionalNonEmptyString(value.entry, `${label}.entry`, issues);

  let root: string | null = null;
  if (value.root !== undefined) {
    const rawRoot = readOptionalNonEmptyString(value.root, `${label}.root`, issues);
    if (rawRoot) {
      const normalized = normalizeRelativePath(rawRoot)?.replace(/\/+$/, "");
      if (!normalized) {
        issues.push(`\`${label}.root\` must be a relative path inside the repository.`);
      } else if (normalized !== ".") {
        root = normalized;
      }
    }
  }

  let framework: ComputeFramework | null = null;
  if (value.framework !== undefined) {
    if (typeof value.framework === "string" && (COMPUTE_FRAMEWORKS as readonly string[]).includes(value.framework)) {
      framework = value.framework as ComputeFramework;
    } else {
      issues.push(`\`${label}.framework\` must be one of: ${COMPUTE_FRAMEWORKS.join(", ")}.`);
    }
  }

  if (entry && framework && !frameworkByKey(framework).usesEntrypoint) {
    issues.push(`\`${label}.entry\` is not supported with the ${framework} framework; it derives its entrypoint from build output.`);
  }

  let httpPort: number | null = null;
  if (value.httpPort !== undefined) {
    if (typeof value.httpPort === "number" && Number.isInteger(value.httpPort) && value.httpPort > 0 && value.httpPort <= 65535) {
      httpPort = value.httpPort;
    } else {
      issues.push(`\`${label}.httpPort\` must be an integer between 1 and 65535.`);
    }
  }

  const envInputs = normalizeEnvConfig(value.env, `${label}.env`, issues);
  const build = normalizeBuildConfig(value.build, `${label}.build`, issues);
  if (build && framework && !isConfigBackedBuildType(frameworkByKey(framework).buildType)) {
    issues.push(`\`${label}.build\` is not supported with the ${framework} framework; its build runs automatically during deploy.`);
  }

  return {
    key,
    name,
    root,
    framework,
    entry,
    httpPort,
    envInputs,
    build,
  };
}

function normalizeBuildConfig(value: unknown, label: string, issues: string[]): ComputeDeployTargetBuild | null {
  if (value === undefined) {
    return null;
  }

  if (!isPlainObject(value)) {
    issues.push(`\`${label}\` must be an object with \`command\` and/or \`outputDirectory\`.`);
    return null;
  }

  for (const buildKey of Object.keys(value)) {
    if (!(KNOWN_BUILD_KEYS as readonly string[]).includes(buildKey)) {
      issues.push(`Unknown key "${buildKey}" in \`${label}\`. Expected one of: ${KNOWN_BUILD_KEYS.join(", ")}.`);
    }
  }

  let command: string | null | undefined;
  if (value.command !== undefined) {
    if (value.command === null) {
      command = null;
    } else if (typeof value.command === "string" && value.command.trim().length > 0) {
      command = value.command.trim();
    } else {
      issues.push(`\`${label}.command\` must be a non-empty string, or null to skip the build step.`);
    }
  }

  let outputDirectory: string | undefined;
  if (value.outputDirectory !== undefined) {
    const normalized = typeof value.outputDirectory === "string"
      ? normalizeRelativePath(value.outputDirectory)?.replace(/\/+$/, "")
      : undefined;
    if (!normalized) {
      issues.push(`\`${label}.outputDirectory\` must be a relative path inside the app root.`);
    } else {
      outputDirectory = normalized;
    }
  }

  if (command === undefined && outputDirectory === undefined) {
    issues.push(`\`${label}\` must set \`command\` and/or \`outputDirectory\`.`);
    return null;
  }

  return { command, outputDirectory };
}

function normalizeEnvConfig(value: unknown, label: string, issues: string[]): string[] {
  if (value === undefined) {
    return [];
  }

  if (typeof value === "string") {
    const file = value.trim();
    if (file.length === 0) {
      issues.push(`\`${label}\` must be a non-empty dotenv file path when given as a string.`);
      return [];
    }
    return [file];
  }

  if (!isPlainObject(value)) {
    issues.push(`\`${label}\` must be a dotenv file path or an object with \`file\` and/or \`vars\`.`);
    return [];
  }

  for (const envKey of Object.keys(value)) {
    if (!(KNOWN_ENV_KEYS as readonly string[]).includes(envKey)) {
      issues.push(`Unknown key "${envKey}" in \`${label}\`. Expected one of: ${KNOWN_ENV_KEYS.join(", ")}.`);
    }
  }

  const envInputs: string[] = [];

  if (value.file !== undefined) {
    const files = Array.isArray(value.file) ? value.file : [value.file];
    for (const file of files) {
      if (typeof file !== "string" || file.trim().length === 0) {
        issues.push(`\`${label}.file\` must be a non-empty dotenv file path or an array of them.`);
        continue;
      }
      envInputs.push(file.trim());
    }
  }

  if (value.vars !== undefined) {
    if (!isPlainObject(value.vars)) {
      issues.push(`\`${label}.vars\` must be an object of NAME: value pairs.`);
    } else {
      for (const [varName, varValue] of Object.entries(value.vars)) {
        if (typeof varValue !== "string" || varValue.length === 0) {
          issues.push(`\`${label}.vars.${varName}\` must be a non-empty string.`);
          continue;
        }
        envInputs.push(`${varName}=${varValue}`);
      }
    }
  }

  return envInputs;
}

function readOptionalNonEmptyString(value: unknown, label: string, issues: string[]): string | null {
  if (value === undefined) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`\`${label}\` must be a non-empty string.`);
    return null;
  }

  return value.trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function selectComputeDeployTarget(
  config: LoadedComputeConfig,
  requestedTarget: string | undefined,
): Result<ComputeDeployTarget, ComputeConfigTargetError> {
  if (config.kind === "single") {
    const target = config.targets[0]!;
    if (requestedTarget && requestedTarget !== target.name) {
      return Result.err(new ComputeConfigTargetUnknownError(
        config.configPath,
        requestedTarget,
        target.name ? [target.name] : [],
      ));
    }
    return Result.ok(target);
  }

  const availableTargets = config.targets.map((target) => target.key!);
  if (!requestedTarget) {
    if (config.targets.length === 1) {
      return Result.ok(config.targets[0]!);
    }
    return Result.err(new ComputeConfigTargetRequiredError(config.configPath, availableTargets));
  }

  const matched = config.targets.find((target) => target.key === requestedTarget);
  if (!matched) {
    return Result.err(new ComputeConfigTargetUnknownError(config.configPath, requestedTarget, availableTargets));
  }

  return Result.ok(matched);
}

/** Local build/run strategy implied by a configured framework. */
export function computeFrameworkToBuildType(framework: ComputeFramework): FrameworkBuildType {
  return frameworkByKey(framework).buildType;
}

export interface MergedDeployInput {
  value: string;
  annotation: string;
}

export interface MergedComputeDeployInputs {
  framework: MergedDeployInput | undefined;
  entrypoint: MergedDeployInput | undefined;
  httpPort: MergedDeployInput | undefined;
  /** `--env` flags replace config env inputs entirely; they never merge. */
  envInputs: string[] | undefined;
  /** True when env inputs came from the config; their file paths then resolve from the config directory. */
  envInputsFromConfig: boolean;
  /** Config-provided app name; ranks below --app and PRISMA_APP_ID. */
  configAppName: MergedDeployInput | undefined;
  /** App directory relative to the config directory, or undefined for the config directory. */
  appRoot: string | undefined;
}

export function mergeComputeDeployInputs(options: {
  cli: {
    framework?: string;
    entrypoint?: string;
    httpPort?: string;
    envInputs?: string[];
  };
  target: ComputeDeployTarget | null;
  configFilename: string;
}): MergedComputeDeployInputs {
  const { cli, target, configFilename } = options;
  const configAnnotation = `set by ${configFilename}`;

  const framework = cli.framework
    ? { value: cli.framework, annotation: "set by --framework" }
    : target?.framework
      ? { value: target.framework, annotation: configAnnotation }
      : undefined;

  const entrypoint = cli.entrypoint
    ? { value: cli.entrypoint, annotation: "set by --entry" }
    : target?.entry
      ? { value: target.entry, annotation: configAnnotation }
      : undefined;

  const httpPort = cli.httpPort
    ? { value: cli.httpPort, annotation: "set by --http-port" }
    : target?.httpPort
      ? { value: String(target.httpPort), annotation: configAnnotation }
      : undefined;

  const cliEnvInputs = cli.envInputs && cli.envInputs.length > 0 ? cli.envInputs : undefined;
  const configEnvInputs = target && target.envInputs.length > 0 ? target.envInputs : undefined;
  const envInputs = cliEnvInputs ?? configEnvInputs;

  const configAppName = target?.name
    ? { value: target.name, annotation: configAnnotation }
    : target?.key
      ? { value: target.key, annotation: configAnnotation }
      : undefined;

  return {
    framework,
    entrypoint,
    httpPort,
    envInputs,
    envInputsFromConfig: !cliEnvInputs && configEnvInputs !== undefined,
    configAppName,
    appRoot: target?.root ?? undefined,
  };
}

export interface MergedComputeLocalInputs {
  entrypoint: string | undefined;
  /** Resolved build type, or undefined for auto detection. */
  buildType: string | undefined;
  /** True when the build type came from the config framework, not a flag. */
  buildTypeFromConfig: boolean;
  port: string | undefined;
  /** App directory relative to the invocation directory, or undefined for the invocation directory. */
  appRoot: string | undefined;
}

/**
 * Merges CLI inputs for the local `app build` and `app run` commands with a
 * selected config target. Explicit flags win; `--build-type auto` is the
 * flag default and defers to the configured framework.
 */
export function mergeComputeLocalInputs(options: {
  cli: {
    entrypoint?: string;
    buildType?: string;
    port?: string;
  };
  target: ComputeDeployTarget | null;
}): MergedComputeLocalInputs {
  const { cli, target } = options;
  const cliBuildType = cli.buildType && cli.buildType !== "auto" ? cli.buildType : undefined;
  const configBuildType = target?.framework ? computeFrameworkToBuildType(target.framework) : undefined;

  return {
    entrypoint: cli.entrypoint ?? target?.entry ?? undefined,
    buildType: cliBuildType ?? configBuildType,
    buildTypeFromConfig: !cliBuildType && configBuildType !== undefined,
    port: cli.port ?? (target?.httpPort ? String(target.httpPort) : undefined),
    appRoot: target?.root ?? undefined,
  };
}

/** The `app` subcommand used in error guidance text, e.g. "deploy" or "domain add". */
export type ComputeConfigCommandName = string;

export function computeConfigErrorToCliError(
  error: ComputeConfigError | ComputeConfigTargetError,
  commandName: ComputeConfigCommandName = "deploy",
): CliError {
  const command = `prisma-cli app ${commandName}`;
  return matchError(error, {
    ComputeConfigAmbiguousError: (ambiguous) => new CliError({
      code: "COMPUTE_CONFIG_INVALID",
      domain: "app",
      summary: "Multiple compute config files found",
      why: ambiguous.message,
      fix: `Keep exactly one compute config file, preferably ${COMPUTE_CONFIG_FILENAME}.`,
      meta: { configPaths: ambiguous.configPaths },
      exitCode: 2,
      nextSteps: [command],
    }),
    ComputeConfigLoadError: (load) => new CliError({
      code: "COMPUTE_CONFIG_INVALID",
      domain: "app",
      summary: `Could not load ${path.basename(load.configPath)}`,
      why: load.message,
      fix: `Fix the error in ${path.basename(load.configPath)} and rerun the command.`,
      where: load.configPath,
      meta: { configPath: load.configPath },
      exitCode: 2,
      nextSteps: [command],
    }),
    ComputeConfigInvalidError: (invalid) => new CliError({
      code: "COMPUTE_CONFIG_INVALID",
      domain: "app",
      summary: `Invalid ${path.basename(invalid.configPath)}`,
      why: invalid.issues.join(" "),
      fix: `Edit ${path.basename(invalid.configPath)} so it default-exports defineComputeConfig({ app }) or defineComputeConfig({ apps }).`,
      where: invalid.configPath,
      meta: { configPath: invalid.configPath, issues: invalid.issues },
      exitCode: 2,
      nextSteps: [command],
    }),
    ComputeConfigTargetRequiredError: (required) => new CliError({
      code: "COMPUTE_CONFIG_TARGET_REQUIRED",
      domain: "app",
      summary: "App target required",
      why: required.message,
      fix: `Pass the app target, for example ${command} <target>.`,
      meta: { configPath: required.configPath, availableTargets: required.availableTargets },
      exitCode: 2,
      nextSteps: required.availableTargets.map((target) => `${command} ${target}`),
    }),
    ComputeConfigTargetUnknownError: (unknown) => new CliError({
      code: "COMPUTE_CONFIG_TARGET_UNKNOWN",
      domain: "app",
      summary: `Unknown app target "${unknown.requestedTarget}"`,
      why: unknown.message,
      fix: unknown.availableTargets.length > 0
        ? `Pass one of the configured targets: ${unknown.availableTargets.join(", ")}.`
        : "Remove the target argument; this config defines a single app.",
      meta: {
        configPath: unknown.configPath,
        requestedTarget: unknown.requestedTarget,
        availableTargets: unknown.availableTargets,
      },
      exitCode: 2,
      nextSteps: unknown.availableTargets.length > 0
        ? unknown.availableTargets.map((target) => `${command} ${target}`)
        : [command],
    }),
  });
}
