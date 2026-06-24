import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type BuildSettings,
  resolveBuildSettings,
  resolveConfiguredBuildSettings,
} from "@prisma/compute-sdk";
import type { ConfigBackedBuildType } from "@prisma/compute-sdk/config";
import type { ResolvedAppBuildType } from "./build";
import type { BunPackageJsonLike } from "./bun-project";

export type AppBuildSettingsBuildType = Extract<
  ResolvedAppBuildType,
  ConfigBackedBuildType
>;

/** Legacy build-settings file: no longer read or written, only detected for migration. */
export const PRISMA_APP_CONFIG_FILENAME = "prisma.app.json";

/**
 * Build settings shape. Identical to the SDK's `BuildSettings`; kept as a
 * CLI-facing alias so existing imports stay stable while the resolution logic
 * lives in `@prisma/compute-sdk`.
 */
export type AppBuildSettings = BuildSettings;

export interface AppBuildSettingsResolution {
  /** "config" when the compute config owns the settings, "inferred" otherwise. */
  status: "config" | "inferred";
  /** The compute config path when status is "config". */
  configPath: string | null;
  relativeConfigPath: string | null;
  settings: AppBuildSettings;
}

export type LegacyBuildSettingsDetection =
  | { kind: "absent" }
  | { kind: "matching"; configPath: string }
  | { kind: "invalid"; configPath: string }
  | {
      kind: "custom";
      configPath: string;
      buildCommand: string | null;
      outputDirectory: string;
    };

/**
 * Detects a leftover `prisma.app.json`. The file is no longer used: one that
 * matches the effective settings is reported for deletion, one with custom
 * values must be migrated to the compute config so builds never silently
 * change.
 */
export async function detectLegacyBuildSettings(options: {
  appPath: string;
  effective: AppBuildSettings;
  signal?: AbortSignal;
}): Promise<LegacyBuildSettingsDetection> {
  const configPath = path.join(options.appPath, PRISMA_APP_CONFIG_FILENAME);
  let content: string;
  try {
    options.signal?.throwIfAborted();
    content = await readFile(configPath, {
      encoding: "utf8",
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { kind: "absent" };
  }

  let legacy: { buildCommand: string | null; outputDirectory: string };
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const buildCommand =
      parsed.buildCommand === null || typeof parsed.buildCommand === "string"
        ? typeof parsed.buildCommand === "string"
          ? parsed.buildCommand.trim() || null
          : null
        : undefined;
    const outputDirectory =
      typeof parsed.outputDirectory === "string"
        ? normalizeRelativePath(parsed.outputDirectory)
        : undefined;
    if (buildCommand === undefined || !outputDirectory) {
      return { kind: "invalid", configPath };
    }
    legacy = { buildCommand, outputDirectory };
  } catch {
    return { kind: "invalid", configPath };
  }

  const matches =
    legacy.buildCommand === options.effective.buildCommand &&
    legacy.outputDirectory === options.effective.outputDirectory;
  return matches
    ? { kind: "matching", configPath }
    : { kind: "custom", configPath, ...legacy };
}

/** Resolves build settings purely from framework inference; nothing is read or written. */
export async function resolveInferredAppBuildSettings(options: {
  appPath: string;
  buildType: ResolvedAppBuildType;
  signal?: AbortSignal;
}): Promise<AppBuildSettingsResolution> {
  return {
    status: "inferred",
    configPath: null,
    relativeConfigPath: null,
    settings: await resolveBuildSettings(options),
  };
}

/**
 * Resolves build settings when the compute config owns them: configured
 * fields win, omitted fields fall back to framework defaults.
 */
export async function resolveConfiguredAppBuildSettings(options: {
  appPath: string;
  buildType: AppBuildSettingsBuildType;
  configured: {
    command: string | null | undefined;
    outputDirectory: string | undefined;
    entrypoint?: string | undefined;
  };
  /** Absolute path of the compute config file owning these settings. */
  configPath: string;
  signal?: AbortSignal;
}): Promise<AppBuildSettingsResolution> {
  const configFilename = path.basename(options.configPath);
  const settings = await resolveConfiguredBuildSettings({
    appPath: options.appPath,
    buildType: options.buildType,
    configured: options.configured,
    source: `set by ${configFilename}`,
    signal: options.signal,
  });

  return {
    status: "config",
    configPath: options.configPath,
    relativeConfigPath: configFilename,
    settings,
  };
}

/** Inferred build settings for a resolved framework. Delegates to the SDK. */
export const resolveAppBuildSettings = resolveBuildSettings;

export function hasPackageDependency(
  packageJson: BunPackageJsonLike | null,
  dependencyName: string,
): boolean {
  return hasAnyPackageDependency(packageJson, [dependencyName]);
}

export function hasAnyPackageDependency(
  packageJson: BunPackageJsonLike | null,
  dependencyNames: readonly string[],
): boolean {
  if (!packageJson) {
    return false;
  }

  const dependencyGroups = [
    packageJson.dependencies,
    packageJson.devDependencies,
  ];
  return dependencyGroups.some((group) => {
    if (!group || typeof group !== "object") {
      return false;
    }

    return dependencyNames.some((dependencyName) => dependencyName in group);
  });
}

function normalizeRelativePath(value: string): string | undefined {
  const raw = value.trim().replace(/\\/g, "/");
  if (raw.length === 0 || raw.split("/").includes("..")) {
    return undefined;
  }
  // Windows drive-relative paths ("C:dir") escape the base directory but
  // are not absolute under either path.win32 or path.posix.
  if (/^[A-Za-z]:/.test(raw)) {
    return undefined;
  }

  const normalized = path.posix.normalize(raw);
  const segments = normalized.split("/");
  if (
    path.win32.isAbsolute(value) ||
    path.posix.isAbsolute(normalized) ||
    segments.includes("..")
  ) {
    return undefined;
  }

  return normalized === "." ? "." : normalized;
}
