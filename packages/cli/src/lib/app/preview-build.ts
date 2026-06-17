import { cp, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  AstroBuild,
  type BuildArtifact,
  type BuildStrategy,
  BunBuild,
  NestjsBuild,
  NextjsBuild,
  NuxtBuild,
  normalizeArtifactSymlinks,
  stageStandaloneArtifact,
  TanstackStartBuild,
} from "@prisma/compute-sdk";

import { resolveBunEntrypoint } from "./bun-project";
import type { PreviewBuildSettings } from "./preview-build-settings";

export {
  detectLegacyBuildSettings,
  hasAnyPackageDependency,
  hasPackageDependency,
  type LegacyBuildSettingsDetection,
  PRISMA_APP_CONFIG_FILENAME,
  type PreviewBuildSettings,
  type PreviewBuildSettingsBuildType,
  type PreviewBuildSettingsResolution,
  resolveConfiguredPreviewBuildSettings,
  resolveInferredPreviewBuildSettings,
  resolvePreviewBuildSettings,
} from "./preview-build-settings";

export const PREVIEW_BUILD_TYPES = [
  "auto",
  "bun",
  "nextjs",
  "nuxt",
  "astro",
  "nestjs",
  "tanstack-start",
] as const;

export type PreviewBuildType = (typeof PREVIEW_BUILD_TYPES)[number];
export type ResolvedPreviewBuildType = Exclude<PreviewBuildType, "auto">;

export const RESOLVED_PREVIEW_BUILD_TYPES = PREVIEW_BUILD_TYPES.filter(
  (buildType): buildType is ResolvedPreviewBuildType => buildType !== "auto",
);

export class PreviewBuildStrategy implements BuildStrategy {
  readonly #appPath: string;
  readonly #entrypoint?: string;
  readonly #buildType: PreviewBuildType;
  readonly #signal?: AbortSignal;
  readonly #buildSettings?: PreviewBuildSettings;

  constructor(options: {
    appPath: string;
    entrypoint?: string;
    buildType?: PreviewBuildType;
    signal?: AbortSignal;
    buildSettings?: PreviewBuildSettings;
  }) {
    this.#appPath = options.appPath;
    this.#entrypoint = options.entrypoint;
    this.#buildType = options.buildType ?? "auto";
    this.#signal = options.signal;
    this.#buildSettings = options.buildSettings;
  }

  async canBuild(signal = this.#signal): Promise<boolean> {
    const { strategy } = await resolvePreviewBuildStrategy({
      appPath: this.#appPath,
      entrypoint: this.#entrypoint,
      buildType: this.#buildType,
      signal,
      buildSettings: this.#buildSettings,
    });

    return strategy.canBuild(signal);
  }

  async execute(signal = this.#signal): Promise<BuildArtifact> {
    const { artifact } = await executePreviewBuild({
      appPath: this.#appPath,
      entrypoint: this.#entrypoint,
      buildType: this.#buildType,
      signal,
      buildSettings: this.#buildSettings,
    });

    return artifact;
  }
}

export async function executePreviewBuild(options: {
  appPath: string;
  entrypoint?: string;
  buildType?: PreviewBuildType;
  signal?: AbortSignal;
  buildSettings?: PreviewBuildSettings;
}): Promise<{
  artifact: BuildArtifact;
  buildType: ResolvedPreviewBuildType;
}> {
  const { strategy, buildType } = await resolvePreviewBuildStrategy({
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

export async function resolvePreviewBuildStrategy(options: {
  appPath: string;
  entrypoint?: string;
  buildType: PreviewBuildType;
  signal?: AbortSignal;
  buildSettings?: PreviewBuildSettings;
}): Promise<{
  strategy: BuildStrategy;
  buildType: ResolvedPreviewBuildType;
}> {
  if (options.buildType !== "auto") {
    const strategy = await createPreviewBuildStrategy({
      appPath: options.appPath,
      entrypoint: options.entrypoint,
      buildType: options.buildType,
      signal: options.signal,
      buildSettings: options.buildSettings,
    });

    return {
      buildType: options.buildType,
      strategy,
    };
  }

  for (const buildType of RESOLVED_PREVIEW_BUILD_TYPES) {
    // Bun is the fallback because it can build any valid Bun entrypoint.
    if (buildType === "bun") continue;

    const strategy = await createPreviewBuildStrategy({
      appPath: options.appPath,
      entrypoint: options.entrypoint,
      buildType,
      signal: options.signal,
      buildSettings: options.buildSettings,
    });

    if (await strategy.canBuild(options.signal)) {
      return {
        buildType,
        strategy,
      };
    }
  }

  return {
    buildType: "bun",
    strategy: await createPreviewBuildStrategy({
      appPath: options.appPath,
      entrypoint: options.entrypoint,
      buildType: "bun",
      signal: options.signal,
      buildSettings: options.buildSettings,
    }),
  };
}

/**
 * Constructs the SDK build strategy for a resolved framework. The strategies
 * run the framework build (and any `package.json` build script) and stage a
 * deployable artifact themselves; the CLI only resolves the Bun entrypoint,
 * which supports the `module` field on top of `main`.
 */
async function createPreviewBuildStrategy(options: {
  appPath: string;
  entrypoint?: string;
  buildType: ResolvedPreviewBuildType;
  signal?: AbortSignal;
  buildSettings?: PreviewBuildSettings;
}): Promise<BuildStrategy> {
  switch (options.buildType) {
    case "nextjs":
      return new NextjsBuild({
        appPath: options.appPath,
        buildSettings: options.buildSettings,
      });
    case "nuxt":
      return new NuxtBuild({ appPath: options.appPath });
    case "astro":
      return new AstroBuild({ appPath: options.appPath });
    case "nestjs":
      return new NestjsBuild({
        appPath: options.appPath,
        buildSettings: options.buildSettings,
      });
    case "tanstack-start":
      return new TanstackStartBuild({
        appPath: options.appPath,
        buildSettings: options.buildSettings,
      });
    case "bun": {
      const entrypoint = await resolveBunEntrypoint(
        options.appPath,
        options.entrypoint,
        options.signal,
      );
      return new BunBuild({
        appPath: options.appPath,
        entrypoint,
        buildSettings: options.buildSettings,
      });
    }
  }
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
