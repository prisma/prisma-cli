import { cp, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  type BuildArtifact,
  type BuildStrategy,
  type BuildType,
  normalizeArtifactSymlinks,
  resolveBuildStrategy,
  stageStandaloneArtifact,
} from "@prisma/compute-sdk";
import {
  FRAMEWORKS,
  type FrameworkBuildType,
} from "@prisma/compute-sdk/config";

import type { AppBuildSettings } from "./build-settings";

export {
  type AppBuildSettings,
  type AppBuildSettingsBuildType,
  type AppBuildSettingsResolution,
  detectLegacyBuildSettings,
  hasAnyPackageDependency,
  hasPackageDependency,
  type LegacyBuildSettingsDetection,
  PRISMA_APP_CONFIG_FILENAME,
  resolveAppBuildSettings,
  resolveConfiguredAppBuildSettings,
  resolveInferredAppBuildSettings,
} from "./build-settings";

export type AppBuildType = BuildType;
export type ResolvedAppBuildType = FrameworkBuildType;

export const RESOLVED_APP_BUILD_TYPES: readonly ResolvedAppBuildType[] = [
  ...frameworkBuildTypesByLastOccurrence(),
];

export const APP_BUILD_TYPES: readonly AppBuildType[] = [
  "auto",
  ...RESOLVED_APP_BUILD_TYPES,
];

export const APP_BUILD_TYPE_LABELS = APP_BUILD_TYPES.join(", ");

function frameworkBuildTypesByLastOccurrence(): Set<FrameworkBuildType> {
  const buildTypes = new Set<FrameworkBuildType>();
  for (const framework of FRAMEWORKS) {
    if (buildTypes.has(framework.buildType)) {
      buildTypes.delete(framework.buildType);
    }
    buildTypes.add(framework.buildType);
  }
  return buildTypes;
}

export class AppBuildStrategy implements BuildStrategy {
  readonly #appPath: string;
  readonly #entrypoint?: string;
  readonly #buildType: AppBuildType;
  readonly #signal?: AbortSignal;
  readonly #buildSettings?: AppBuildSettings;

  constructor(options: {
    appPath: string;
    entrypoint?: string;
    buildType?: AppBuildType;
    signal?: AbortSignal;
    buildSettings?: AppBuildSettings;
  }) {
    this.#appPath = options.appPath;
    this.#entrypoint = options.entrypoint;
    this.#buildType = options.buildType ?? "auto";
    this.#signal = options.signal;
    this.#buildSettings = options.buildSettings;
  }

  async canBuild(signal = this.#signal): Promise<boolean> {
    const { strategy } = await resolveAppBuildStrategy({
      appPath: this.#appPath,
      entrypoint: this.#entrypoint,
      buildType: this.#buildType,
      signal,
      buildSettings: this.#buildSettings,
    });

    return strategy.canBuild(signal);
  }

  async execute(signal = this.#signal): Promise<BuildArtifact> {
    const { artifact } = await executeAppBuild({
      appPath: this.#appPath,
      entrypoint: this.#entrypoint,
      buildType: this.#buildType,
      signal,
      buildSettings: this.#buildSettings,
    });

    return artifact;
  }
}

export async function executeAppBuild(options: {
  appPath: string;
  entrypoint?: string;
  buildType?: AppBuildType;
  signal?: AbortSignal;
  buildSettings?: AppBuildSettings;
}): Promise<{
  artifact: BuildArtifact;
  buildType: ResolvedAppBuildType;
}> {
  const { strategy, buildType } = await resolveAppBuildStrategy({
    appPath: options.appPath,
    entrypoint: options.entrypoint,
    buildType: options.buildType ?? "auto",
    signal: options.signal,
    buildSettings: options.buildSettings,
  });
  const artifact = await strategy.execute(options.signal);

  try {
    await normalizeArtifactSymlinks(
      artifact.directory,
      options.appPath,
      options.signal,
    );
    return {
      artifact,
      buildType,
    };
  } catch (error) {
    await artifact.cleanup?.().catch(() => undefined);
    throw error;
  }
}

export async function resolveAppBuildStrategy(options: {
  appPath: string;
  entrypoint?: string;
  buildType: AppBuildType;
  signal?: AbortSignal;
  buildSettings?: AppBuildSettings;
}): Promise<{
  strategy: BuildStrategy;
  buildType: ResolvedAppBuildType;
}> {
  // Detection, per-framework construction, and Bun entrypoint resolution
  // (package.json `main`) all live in the SDK now; the CLI forwards. The CLI's
  // build types map 1:1 to the SDK's, and `auto` is the SDK default.
  return resolveBuildStrategy({
    appPath: options.appPath,
    buildType: options.buildType,
    entrypoint: options.entrypoint,
    buildSettings: options.buildSettings,
    signal: options.signal,
  });
}

/**
 * Re-stages a Next.js standalone artifact in place after a local rebuild, then
 * refreshes the static assets next to the server entrypoint. Used by the local
 * preview when files change on disk.
 */
export async function restageNextjsArtifact(
  artifact: BuildArtifact,
  appPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const artifactDir = artifact.directory;
  const standaloneDir = path.join(appPath, ".next", "standalone");

  await withSignal(signal, () =>
    rm(artifactDir, { recursive: true, force: true }),
  );
  await stageStandaloneArtifact({
    standaloneDir,
    artifactDir,
    appPath,
    signal,
  });

  // The SDK's Next.js strategy reports the entrypoint relative to the
  // artifact root (e.g. "server.js" for single-app, "apps/web/server.js"
  // for a monorepo). Next expects public/ and .next/static/ to live next
  // to server.js, so re-stage them at the same subpath.
  const serverSubpath = nextjsServerSubpath(artifact.entrypoint);
  const serverDir = serverSubpath
    ? path.join(artifactDir, serverSubpath)
    : artifactDir;

  const publicDir = path.join(appPath, "public");
  if (await directoryExists(publicDir, signal)) {
    await withSignal(signal, () =>
      cp(publicDir, path.join(serverDir, "public"), {
        recursive: true,
        verbatimSymlinks: true,
      }),
    );
  }

  const staticDir = path.join(appPath, ".next", "static");
  if (await directoryExists(staticDir, signal)) {
    await withSignal(signal, () =>
      cp(staticDir, path.join(serverDir, ".next", "static"), {
        recursive: true,
        verbatimSymlinks: true,
      }),
    );
  }
}

function nextjsServerSubpath(entrypoint: string): string {
  // SDK emits posix-style entrypoints (path.posix.join).
  const dir = path.posix.dirname(entrypoint);
  return dir === "." ? "" : dir;
}

async function directoryExists(
  targetPath: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const targetStat = await withSignal(signal, () => stat(targetPath));
    return targetStat.isDirectory();
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
}

async function withSignal<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  // These Node fs promise APIs do not accept AbortSignal; check immediately before and after the boundary.
  signal?.throwIfAborted();
  const result = await operation();
  signal?.throwIfAborted();
  return result;
}
