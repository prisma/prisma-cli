import path from "node:path";

import {
  COMPUTE_CONFIG_FILENAME,
  type ComputeConfigError,
  type ComputeConfigTargetError,
  type LoadedComputeConfig,
  loadComputeConfig as loadComputeConfigFromSdk,
} from "@prisma/compute-sdk/config";
import { matchError, type Result } from "better-result";

import { CliError } from "../../errors";

// The compute config contract (types, validation, discovery, loading) lives
// in @prisma/compute-sdk/config so the CLI, build-runner, and scaffolding
// share one implementation. Runtime values are imported straight from the
// SDK; this module re-exports the shared types and keeps the CLI-specific
// glue: flag/config precedence and CliError presentation.
export type {
  ComputeConfigError,
  ComputeConfigTargetError,
  ComputeDeployTarget,
  ComputeDeployTargetBuild,
  LoadedComputeConfig,
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

/** The `service` subcommand used in error guidance text, e.g. "create" or "domain add". */
export type ComputeConfigCommandName = string;

export function computeConfigErrorToCliError(
  error: ComputeConfigError | ComputeConfigTargetError,
  commandName: ComputeConfigCommandName,
): CliError {
  const command = `prisma-cli service ${commandName}`;
  return matchError(error, {
    ComputeConfigAmbiguousError: (ambiguous) =>
      new CliError({
        code: "COMPUTE_CONFIG_INVALID",
        domain: "app",
        summary: "Multiple compute config files found",
        why: ambiguous.message,
        fix: `Keep exactly one compute config file, preferably ${COMPUTE_CONFIG_FILENAME}.`,
        meta: { configPaths: ambiguous.configPaths },
        exitCode: 2,
        nextSteps: [command],
      }),
    ComputeConfigLoadError: (load) =>
      new CliError({
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
    ComputeConfigInvalidError: (invalid) =>
      new CliError({
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
    ComputeConfigTargetRequiredError: (required) =>
      new CliError({
        code: "COMPUTE_CONFIG_TARGET_REQUIRED",
        domain: "app",
        summary: "App target required",
        why: required.message,
        fix: `Pass the app target, for example ${command} <target>.`,
        meta: {
          configPath: required.configPath,
          availableTargets: required.availableTargets,
        },
        exitCode: 2,
        nextSteps: required.availableTargets.map(
          (target) => `${command} ${target}`,
        ),
      }),
    ComputeConfigTargetUnknownError: (unknown) =>
      new CliError({
        code: "COMPUTE_CONFIG_TARGET_UNKNOWN",
        domain: "app",
        summary: `Unknown app target "${unknown.requestedTarget}"`,
        why: unknown.message,
        fix:
          unknown.availableTargets.length > 0
            ? `Pass one of the configured targets: ${unknown.availableTargets.join(", ")}.`
            : "Remove the target argument; this config defines a single app.",
        meta: {
          configPath: unknown.configPath,
          requestedTarget: unknown.requestedTarget,
          availableTargets: unknown.availableTargets,
        },
        exitCode: 2,
        nextSteps:
          unknown.availableTargets.length > 0
            ? unknown.availableTargets.map((target) => `${command} ${target}`)
            : [command],
      }),
  });
}
