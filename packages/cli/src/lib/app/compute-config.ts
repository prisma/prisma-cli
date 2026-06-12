import path from "node:path";

import {
  COMPUTE_CONFIG_FILENAME,
  frameworkByKey,
  loadComputeConfig as loadComputeConfigFromSdk,
  type ComputeConfigError,
  type ComputeConfigTargetError,
  type ComputeDeployTarget,
  type ComputeFramework,
  type FrameworkBuildType,
  type LoadedComputeConfig,
} from "@prisma/compute-sdk/config";
import { matchError, type Result } from "better-result";

import { CliError } from "../../shell/errors";

// The compute config contract (types, validation, discovery, loading) lives
// in @prisma/compute-sdk/config so the CLI, build-runner, and scaffolding
// share one implementation. This module re-exports what app commands consume
// and keeps the CLI-specific glue: flag/config precedence and CliError
// presentation.
export {
  COMPUTE_CONFIG_FILENAME,
  COMPUTE_CONFIG_FILENAMES,
  ComputeConfigAmbiguousError,
  ComputeConfigInvalidError,
  ComputeConfigLoadError,
  ComputeConfigTargetRequiredError,
  ComputeConfigTargetUnknownError,
  computeTargetAppDir,
  inferComputeTargetFromCwd,
  normalizeComputeConfig,
  selectComputeDeployTarget,
  type ComputeConfigError,
  type ComputeConfigTargetError,
  type ComputeDeployTarget,
  type ComputeDeployTargetBuild,
  type LoadedComputeConfig,
} from "@prisma/compute-sdk/config";

/**
 * Loads the nearest compute config, searching from `cwd` up to the source
 * root (repository or workspace boundary). Thin adapter over the SDK loader
 * keeping the CLI's positional-signal call shape.
 */
export async function loadComputeConfig(
  cwd: string,
  signal?: AbortSignal,
): Promise<Result<LoadedComputeConfig | null, ComputeConfigError>> {
  return loadComputeConfigFromSdk(cwd, { signal });
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
