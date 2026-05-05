import { chmod, copyFile, cp, lstat, mkdir, readdir, readlink, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  AstroBuild,
  BunBuild,
  NextjsBuild,
  NuxtBuild,
  TanstackStartBuild,
  type BuildArtifact,
  type BuildStrategy,
} from "@prisma/compute-sdk";
import { resolveBunEntrypoint } from "./bun-project";

export const PREVIEW_BUILD_TYPES = [
  "auto",
  "bun",
  "nextjs",
  "nuxt",
  "astro",
  "tanstack-start",
] as const;

export type PreviewBuildType = typeof PREVIEW_BUILD_TYPES[number];
export type ResolvedPreviewBuildType = Exclude<PreviewBuildType, "auto">;

export class PreviewBuildStrategy implements BuildStrategy {
  readonly #appPath: string;
  readonly #entrypoint?: string;
  readonly #buildType: PreviewBuildType;

  constructor(options: { appPath: string; entrypoint?: string; buildType?: PreviewBuildType }) {
    this.#appPath = options.appPath;
    this.#entrypoint = options.entrypoint;
    this.#buildType = options.buildType ?? "auto";
  }

  async canBuild(): Promise<boolean> {
    const { strategy } = await resolvePreviewBuildStrategy({
      appPath: this.#appPath,
      entrypoint: this.#entrypoint,
      buildType: this.#buildType,
    });

    return strategy.canBuild();
  }

  async execute(): Promise<BuildArtifact> {
    const { artifact } = await executePreviewBuild({
      appPath: this.#appPath,
      entrypoint: this.#entrypoint,
      buildType: this.#buildType,
    });

    return artifact;
  }
}

export async function executePreviewBuild(options: {
  appPath: string;
  entrypoint?: string;
  buildType?: PreviewBuildType;
}): Promise<{
  artifact: BuildArtifact;
  buildType: ResolvedPreviewBuildType;
}> {
  const { strategy, buildType } = await resolvePreviewBuildStrategy({
    appPath: options.appPath,
    entrypoint: options.entrypoint,
    buildType: options.buildType ?? "auto",
  });
  const artifact = await strategy.execute();

  try {
    await normalizeArtifactSymlinks(artifact.directory, options.appPath);
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
}): Promise<{
  strategy: BuildStrategy;
  buildType: ResolvedPreviewBuildType;
}> {
  if (options.buildType !== "auto") {
    const strategy = await createPreviewBuildStrategy({
      appPath: options.appPath,
      entrypoint: options.entrypoint,
      buildType: options.buildType,
    });

    return {
      buildType: options.buildType,
      strategy,
    };
  }

  for (const buildType of ["nextjs", "nuxt", "astro", "tanstack-start"] as const) {
    const strategy = await createPreviewBuildStrategy({
      appPath: options.appPath,
      entrypoint: options.entrypoint,
      buildType,
    });

    if (await strategy.canBuild()) {
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
    }),
  };
}

async function createPreviewBuildStrategy(options: {
  appPath: string;
  entrypoint?: string;
  buildType: ResolvedPreviewBuildType;
}): Promise<BuildStrategy> {
  switch (options.buildType) {
    case "nextjs":
      return new NextjsBuild({ appPath: options.appPath });
    case "nuxt":
      return new NuxtBuild({ appPath: options.appPath });
    case "astro":
      return new AstroBuild({ appPath: options.appPath });
    case "tanstack-start":
      return new TanstackStartBuild({ appPath: options.appPath });
    case "bun": {
      const entrypoint = await resolveBunEntrypoint(options.appPath, options.entrypoint);
      return new BunBuild({
        appPath: options.appPath,
        entrypoint,
      });
    }
  }
}

export async function stageNextjsStandaloneArtifact(options: {
  standaloneDir: string;
  artifactDir: string;
  appPath: string;
}): Promise<void> {
  const standaloneRoot = path.resolve(options.standaloneDir);
  const artifactRoot = path.resolve(options.artifactDir);
  const appRoot = path.resolve(options.appPath);

  await copyPathMaterializingSymlinks(standaloneRoot, artifactRoot, {
    standaloneRoot,
    appRoot,
  });
}

export async function normalizeArtifactSymlinks(
  artifactDir: string,
  appPath: string,
): Promise<void> {
  const normalizedArtifactDir = path.resolve(artifactDir);
  const normalizedAppPath = path.resolve(appPath);

  await walkDirectory(normalizedArtifactDir);

  async function walkDirectory(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await walkDirectory(fullPath);
        continue;
      }

      if (!entry.isSymbolicLink()) {
        continue;
      }

      const target = await readlink(fullPath);
      const resolvedTarget = path.resolve(path.dirname(fullPath), target);

      if (isPathWithin(normalizedArtifactDir, resolvedTarget)) {
        continue;
      }

      if (!isPathWithin(normalizedAppPath, resolvedTarget)) {
        throw new Error(`Build artifact symlink escapes the app directory: ${resolvedTarget}`);
      }

      const targetStat = await stat(resolvedTarget);
      await rm(fullPath, { force: true, recursive: true });
      await cp(resolvedTarget, fullPath, {
        recursive: targetStat.isDirectory(),
        dereference: true,
      });

      if (targetStat.isDirectory()) {
        await walkDirectory(fullPath);
      }
    }
  }
}

function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

async function copyPathMaterializingSymlinks(
  sourcePath: string,
  destinationPath: string,
  options: {
    standaloneRoot: string;
    appRoot: string;
  },
): Promise<void> {
  const sourceStat = await lstat(sourcePath);

  if (sourceStat.isSymbolicLink()) {
    const resolvedTarget = await resolveSymlinkTarget(sourcePath, options);
    await copyPathMaterializingSymlinks(resolvedTarget, destinationPath, options);
    return;
  }

  if (sourceStat.isDirectory()) {
    await mkdir(destinationPath, { recursive: true });

    const entries = await readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      await copyPathMaterializingSymlinks(
        path.join(sourcePath, entry.name),
        path.join(destinationPath, entry.name),
        options,
      );
    }

    return;
  }

  if (sourceStat.isFile()) {
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
    await chmod(destinationPath, sourceStat.mode);
  }
}

async function resolveSymlinkTarget(
  symlinkPath: string,
  options: {
    standaloneRoot: string;
    appRoot: string;
  },
): Promise<string> {
  const linkTarget = await readlink(symlinkPath);
  const resolvedTarget = path.resolve(path.dirname(symlinkPath), linkTarget);

  if (await pathExists(resolvedTarget)) {
    if (!isPathWithin(options.appRoot, resolvedTarget)) {
      throw new Error(`Build artifact symlink escapes the app directory: ${resolvedTarget}`);
    }

    return resolvedTarget;
  }

  if (isPathWithin(options.standaloneRoot, resolvedTarget)) {
    const fallbackTarget = path.join(
      options.appRoot,
      path.relative(options.standaloneRoot, resolvedTarget),
    );

    if (await pathExists(fallbackTarget)) {
      return fallbackTarget;
    }
  }

  throw new Error(
    `Next.js standalone symlink target is missing: ${symlinkPath} -> ${linkTarget} (resolved to ${resolvedTarget})`,
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
