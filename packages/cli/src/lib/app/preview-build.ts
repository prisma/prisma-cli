import { chmod, copyFile, cp, lstat, mkdir, readdir, readFile, readlink, rm, stat } from "node:fs/promises";
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

export const RESOLVED_PREVIEW_BUILD_TYPES = PREVIEW_BUILD_TYPES.filter(
  (buildType): buildType is ResolvedPreviewBuildType => buildType !== "auto",
);

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
    if (buildType === "nextjs") {
      await restageNextjsArtifact(artifact, options.appPath);
    }

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

  for (const buildType of RESOLVED_PREVIEW_BUILD_TYPES) {
    // Bun is the fallback because it can build any valid Bun entrypoint.
    if (buildType === "bun") continue;

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
  const sourceRoot = await resolveSourceRoot(appRoot);

  await copyPathMaterializingSymlinks(standaloneRoot, artifactRoot, {
    standaloneRoot,
    appRoot,
    sourceRoot,
  });
  await hoistPnpmDependencies(path.join(artifactRoot, "node_modules"));
}

export async function restageNextjsArtifact(artifact: BuildArtifact, appPath: string): Promise<void> {
  const artifactDir = artifact.directory;
  const standaloneDir = path.join(appPath, ".next", "standalone");

  await rm(artifactDir, { recursive: true, force: true });
  await stageNextjsStandaloneArtifact({
    standaloneDir,
    artifactDir,
    appPath,
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
  if (await directoryExists(publicDir)) {
    await cp(publicDir, path.join(serverDir, "public"), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }

  const staticDir = path.join(appPath, ".next", "static");
  if (await directoryExists(staticDir)) {
    await cp(staticDir, path.join(serverDir, ".next", "static"), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
}

function nextjsServerSubpath(entrypoint: string): string {
  const dir = path.posix.dirname(entrypoint);
  return dir === "." ? "" : dir;
}

async function hoistPnpmDependencies(nodeModulesDir: string): Promise<void> {
  const pnpmNodeModulesDir = path.join(nodeModulesDir, ".pnpm", "node_modules");
  if (!await directoryExists(pnpmNodeModulesDir)) {
    return;
  }

  const entries = await readdir(pnpmNodeModulesDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(pnpmNodeModulesDir, entry.name);

    if (entry.name.startsWith("@") && entry.isDirectory()) {
      const scopedEntries = await readdir(sourcePath, { withFileTypes: true });
      for (const scopedEntry of scopedEntries) {
        const scopedDestination = path.join(nodeModulesDir, entry.name, scopedEntry.name);
        if (await pathExists(scopedDestination)) {
          continue;
        }

        await mkdir(path.dirname(scopedDestination), { recursive: true });
        await copyPathMaterializingSymlinks(
          path.join(sourcePath, scopedEntry.name),
          scopedDestination,
          {
            standaloneRoot: pnpmNodeModulesDir,
            appRoot: nodeModulesDir,
            sourceRoot: nodeModulesDir,
          },
        );
      }
      continue;
    }

    const destinationPath = path.join(nodeModulesDir, entry.name);
    if (await pathExists(destinationPath)) {
      continue;
    }

    await copyPathMaterializingSymlinks(sourcePath, destinationPath, {
      standaloneRoot: pnpmNodeModulesDir,
      appRoot: nodeModulesDir,
      sourceRoot: nodeModulesDir,
    });
  }
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
    sourceRoot: string;
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
    sourceRoot: string;
  },
): Promise<string> {
  const linkTarget = await readlink(symlinkPath);
  const resolvedTarget = path.resolve(path.dirname(symlinkPath), linkTarget);

  if (await pathExists(resolvedTarget)) {
    if (
      !isPathWithin(options.appRoot, resolvedTarget) &&
      !isPathWithin(options.sourceRoot, resolvedTarget)
    ) {
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

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    const targetStat = await stat(targetPath);
    return targetStat.isDirectory();
  } catch {
    return false;
  }
}

async function resolveSourceRoot(appRoot: string): Promise<string> {
  let current = path.resolve(appRoot);

  while (true) {
    if (
      await pathExists(path.join(current, ".git")) ||
      await pathExists(path.join(current, "pnpm-workspace.yaml")) ||
      await pathExists(path.join(current, "bun.lock")) ||
      await pathExists(path.join(current, "bun.lockb")) ||
      await packageJsonDeclaresWorkspaces(current)
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(appRoot);
    }

    current = parent;
  }
}

async function packageJsonDeclaresWorkspaces(directory: string): Promise<boolean> {
  try {
    const content = await readFile(path.join(directory, "package.json"), "utf8");
    const parsed = JSON.parse(content) as { workspaces?: unknown };
    return Boolean(parsed.workspaces);
  } catch {
    return false;
  }
}
