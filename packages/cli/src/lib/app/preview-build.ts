import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AstroBuild,
  BunBuild,
  NuxtBuild,
  type BuildArtifact,
  type BuildStrategy,
} from "@prisma/compute-sdk";
import { readBunPackageJson, resolveBunEntrypoint } from "./bun-project";
import {
  PRISMA_APP_CONFIG_FILENAME,
  hasAnyPackageDependency,
  hasPackageDependency,
  hasRootFile,
  joinPosix,
  nextOutputRootFromStandaloneDirectory,
  resolvePreviewBuildSettings,
  runResolvedBuildCommand,
  type PreviewBuildSettings,
} from "./preview-build-settings";

export {
  PRISMA_APP_CONFIG_FILENAME,
  PRISMA_APP_CONFIG_SCHEMA_URL,
  resolveOrCreatePreviewBuildSettings,
  resolvePreviewBuildSettings,
  type PreviewBuildSettingsBuildType,
  type PreviewBuildSettings,
  type PreviewBuildSettingsResolution,
} from "./preview-build-settings";

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
    await normalizeArtifactSymlinks(artifact.directory, options.appPath, options.signal);
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

async function createPreviewBuildStrategy(options: {
  appPath: string;
  entrypoint?: string;
  buildType: ResolvedPreviewBuildType;
  signal?: AbortSignal;
  buildSettings?: PreviewBuildSettings;
}): Promise<BuildStrategy> {
  switch (options.buildType) {
    case "nextjs":
      return new PreviewNextjsBuild({ appPath: options.appPath, buildSettings: options.buildSettings });
    case "nuxt":
      return new NuxtBuild({ appPath: options.appPath });
    case "astro":
      return new AstroBuild({ appPath: options.appPath });
    case "tanstack-start":
      return new PreviewTanstackStartBuild({ appPath: options.appPath, buildSettings: options.buildSettings });
    case "bun": {
      const entrypoint = await resolveBunEntrypoint(options.appPath, options.entrypoint, options.signal);
      return new PreviewBunBuild({
        appPath: options.appPath,
        strategy: new BunBuild({
          appPath: options.appPath,
          entrypoint,
        }),
        buildSettings: options.buildSettings,
      });
    }
  }
}

class PreviewNextjsBuild implements BuildStrategy {
  readonly #appPath: string;
  readonly #buildSettings?: PreviewBuildSettings;

  constructor(options: { appPath: string; buildSettings?: PreviewBuildSettings }) {
    this.#appPath = options.appPath;
    this.#buildSettings = options.buildSettings;
  }

  async canBuild(signal?: AbortSignal): Promise<boolean> {
    const packageJson = await readBunPackageJson(this.#appPath, signal);
    return (await hasRootFile(this.#appPath, NEXT_CONFIG_FILENAMES, signal)) || hasPackageDependency(packageJson, "next");
  }

  async execute(signal?: AbortSignal): Promise<BuildArtifact> {
    const settings = this.#buildSettings ?? await resolvePreviewBuildSettings({
      appPath: this.#appPath,
      buildType: "nextjs",
      signal,
    });
    await runResolvedBuildCommand(this.#appPath, settings, "Next.js", signal);

    const standaloneDir = path.join(this.#appPath, settings.outputDirectory);
    if (!await directoryExists(standaloneDir, signal)) {
      // No `output: "standalone"` in next.config: the build itself
      // succeeded, so package the full tree and serve with `next start`
      // instead of failing. Bigger artifact, same running app.
      return stageNextjsFullTreeFallbackArtifact(this.#appPath, signal);
    }

    const outDir = await unsupportedFilesystemBoundary(signal, () => mkdtemp(path.join(os.tmpdir(), "compute-build-")));

    try {
      const artifactDir = path.join(outDir, "app");
      await stageNextjsStandaloneArtifact({
        standaloneDir,
        artifactDir,
        appPath: this.#appPath,
        signal,
      });
      const entrypoint = await findNextStandaloneEntrypoint(artifactDir, signal);
      await copyNextjsStaticAssets({
        appPath: this.#appPath,
        artifactDir,
        outputRoot: nextOutputRootFromStandaloneDirectory(settings.outputDirectory),
        entrypoint,
        signal,
      });

      return {
        directory: artifactDir,
        entrypoint,
        defaultPortMapping: { http: 3000 },
        cleanup: () => rm(outDir, { recursive: true, force: true }),
      };
    } catch (error) {
      await rm(outDir, { recursive: true, force: true });
      throw error;
    }
  }
}

const FULL_TREE_NEXT_START_ENTRYPOINT = "prisma-next-start.cjs";

// Bootstrap for apps built without `output: "standalone"`. Entering through
// the CLI bin (not `next/dist/server/lib/start-server`) keeps Next in charge
// of config loading, which is the part that drifts across Next majors.
const FULL_TREE_NEXT_START_SOURCE = [
  'process.env.NODE_ENV = "production";',
  'process.argv.push("start", "-p", process.env.PORT ?? "3000");',
  'require("next/dist/bin/next");',
  "",
].join("\n");

async function stageNextjsFullTreeFallbackArtifact(appPath: string, signal?: AbortSignal): Promise<BuildArtifact> {
  const outDir = await unsupportedFilesystemBoundary(signal, () => mkdtemp(path.join(os.tmpdir(), "compute-build-")));

  try {
    const artifactDir = path.join(outDir, "app");
    // node_modules ships on purpose: without standalone output the artifact
    // must carry the full runtime dependency tree for `next start`.
    await cp(appPath, artifactDir, {
      recursive: true,
      filter: (source) => path.basename(source) !== ".git",
    });
    await writeFile(path.join(artifactDir, FULL_TREE_NEXT_START_ENTRYPOINT), FULL_TREE_NEXT_START_SOURCE);

    return {
      directory: artifactDir,
      entrypoint: FULL_TREE_NEXT_START_ENTRYPOINT,
      defaultPortMapping: { http: 3000 },
      cleanup: () => rm(outDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(outDir, { recursive: true, force: true });
    throw error;
  }
}

class PreviewTanstackStartBuild implements BuildStrategy {
  readonly #appPath: string;
  readonly #buildSettings?: PreviewBuildSettings;

  constructor(options: { appPath: string; buildSettings?: PreviewBuildSettings }) {
    this.#appPath = options.appPath;
    this.#buildSettings = options.buildSettings;
  }

  async canBuild(signal?: AbortSignal): Promise<boolean> {
    const packageJson = await readBunPackageJson(this.#appPath, signal);
    return hasAnyPackageDependency(packageJson, TANSTACK_START_PACKAGES);
  }

  async execute(signal?: AbortSignal): Promise<BuildArtifact> {
    const settings = this.#buildSettings ?? await resolvePreviewBuildSettings({
      appPath: this.#appPath,
      buildType: "tanstack-start",
      signal,
    });
    await runResolvedBuildCommand(this.#appPath, settings, "TanStack Start", signal);

    const outputDir = path.join(this.#appPath, settings.outputDirectory);
    const entrypoint = "server/index.mjs";
    const entryPath = path.join(outputDir, entrypoint);
    const entryStat = await unsupportedFilesystemBoundary(signal, () => stat(entryPath).catch(() => null));
    if (!entryStat?.isFile()) {
      throw new Error(
        `TanStack Start build did not produce a Nitro node server entrypoint at ${joinPosix(settings.outputDirectory, entrypoint)}. `
          + `Ensure your vite.config includes the tanstackStart() and nitro() plugins with the default node preset, or update ${PRISMA_APP_CONFIG_FILENAME}.`,
      );
    }

    const outDir = await unsupportedFilesystemBoundary(signal, () => mkdtemp(path.join(os.tmpdir(), "compute-build-")));

    try {
      const artifactDir = path.join(outDir, "app");
      await unsupportedFilesystemBoundary(signal, () => cp(outputDir, artifactDir, {
        recursive: true,
        verbatimSymlinks: true,
      }));

      return {
        directory: artifactDir,
        entrypoint,
        defaultPortMapping: { http: 3000 },
        cleanup: () => rm(outDir, { recursive: true, force: true }),
      };
    } catch (error) {
      await rm(outDir, { recursive: true, force: true });
      throw error;
    }
  }
}

class PreviewBunBuild implements BuildStrategy {
  readonly #appPath: string;
  readonly #strategy: BuildStrategy;
  readonly #buildSettings?: PreviewBuildSettings;

  constructor(options: {
    appPath: string;
    strategy: BuildStrategy;
    buildSettings?: PreviewBuildSettings;
  }) {
    this.#appPath = options.appPath;
    this.#strategy = options.strategy;
    this.#buildSettings = options.buildSettings;
  }

  async canBuild(signal?: AbortSignal): Promise<boolean> {
    return this.#strategy.canBuild(signal);
  }

  async execute(signal?: AbortSignal): Promise<BuildArtifact> {
    const settings = this.#buildSettings ?? await resolvePreviewBuildSettings({
      appPath: this.#appPath,
      buildType: "bun",
      signal,
    });
    await runResolvedBuildCommand(this.#appPath, settings, "Bun", signal);

    return this.#strategy.execute(signal);
  }
}

const NEXT_CONFIG_FILENAMES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.mts",
] as const;

const TANSTACK_START_PACKAGES = [
  "@tanstack/react-start",
  "@tanstack/solid-start",
  "@tanstack/start",
] as const;

export async function stageNextjsStandaloneArtifact(options: {
  standaloneDir: string;
  artifactDir: string;
  appPath: string;
  signal?: AbortSignal;
}): Promise<void> {
  const standaloneRoot = path.resolve(options.standaloneDir);
  const artifactRoot = path.resolve(options.artifactDir);
  const appRoot = path.resolve(options.appPath);
  const sourceRoot = await resolveSourceRoot(appRoot, options.signal);

  await copyPathMaterializingSymlinks(standaloneRoot, artifactRoot, {
    standaloneRoot,
    appRoot,
    sourceRoot,
    signal: options.signal,
  });
  await hoistPnpmDependencies(path.join(artifactRoot, "node_modules"), options.signal);
}

async function copyNextjsStaticAssets(options: {
  appPath: string;
  artifactDir: string;
  outputRoot: string;
  entrypoint: string;
  signal?: AbortSignal;
}): Promise<void> {
  const serverSubpath = nextjsServerSubpath(options.entrypoint);
  const serverDir = serverSubpath
    ? path.join(options.artifactDir, serverSubpath)
    : options.artifactDir;

  const publicDir = path.join(options.appPath, "public");
  if (await directoryExists(publicDir, options.signal)) {
    await unsupportedFilesystemBoundary(options.signal, () => cp(publicDir, path.join(serverDir, "public"), {
      recursive: true,
      verbatimSymlinks: true,
    }));
  }

  const staticDir = path.join(options.appPath, options.outputRoot, "static");
  if (await directoryExists(staticDir, options.signal)) {
    await unsupportedFilesystemBoundary(options.signal, () => cp(staticDir, path.join(serverDir, options.outputRoot, "static"), {
      recursive: true,
      verbatimSymlinks: true,
    }));
  }
}

async function findNextStandaloneEntrypoint(artifactDir: string, signal?: AbortSignal): Promise<string> {
  const rootEntrypoint = path.join(artifactDir, "server.js");
  const rootStat = await unsupportedFilesystemBoundary(signal, () => stat(rootEntrypoint).catch(() => null));
  if (rootStat?.isFile()) {
    return "server.js";
  }

  const candidates: string[] = [];
  await walk(artifactDir);
  candidates.sort((left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right));

  const selected = candidates[0];
  if (!selected) {
    throw new Error(`Next.js standalone output did not contain server.js in ${artifactDir}`);
  }

  return selected;

  async function walk(directory: string): Promise<void> {
    const entries = await unsupportedFilesystemBoundary(signal, () => readdir(directory, { withFileTypes: true }));
    for (const entry of entries) {
      if (entry.name === "node_modules") {
        continue;
      }

      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name === "server.js") {
        candidates.push(path.relative(artifactDir, fullPath).split(path.sep).join("/"));
      }
    }
  }
}

export async function restageNextjsArtifact(artifact: BuildArtifact, appPath: string, signal?: AbortSignal): Promise<void> {
  const artifactDir = artifact.directory;
  const standaloneDir = path.join(appPath, ".next", "standalone");

  await unsupportedFilesystemBoundary(signal, () => rm(artifactDir, { recursive: true, force: true }));
  await stageNextjsStandaloneArtifact({
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
    await unsupportedFilesystemBoundary(signal, () => cp(publicDir, path.join(serverDir, "public"), {
      recursive: true,
      verbatimSymlinks: true,
    }));
  }

  const staticDir = path.join(appPath, ".next", "static");
  if (await directoryExists(staticDir, signal)) {
    await unsupportedFilesystemBoundary(signal, () => cp(staticDir, path.join(serverDir, ".next", "static"), {
      recursive: true,
      verbatimSymlinks: true,
    }));
  }
}

function nextjsServerSubpath(entrypoint: string): string {
  // SDK emits posix-style entrypoints (path.posix.join).
  const dir = path.posix.dirname(entrypoint);
  return dir === "." ? "" : dir;
}

async function hoistPnpmDependencies(nodeModulesDir: string, signal?: AbortSignal): Promise<void> {
  const pnpmNodeModulesDir = path.join(nodeModulesDir, ".pnpm", "node_modules");
  if (!await directoryExists(pnpmNodeModulesDir, signal)) {
    return;
  }

  const entries = await unsupportedFilesystemBoundary(signal, () => readdir(pnpmNodeModulesDir, { withFileTypes: true }));
  for (const entry of entries) {
    const sourcePath = path.join(pnpmNodeModulesDir, entry.name);

    if (entry.name.startsWith("@") && entry.isDirectory()) {
      const scopedEntries = await unsupportedFilesystemBoundary(signal, () => readdir(sourcePath, { withFileTypes: true }));
      for (const scopedEntry of scopedEntries) {
        const scopedDestination = path.join(nodeModulesDir, entry.name, scopedEntry.name);
        if (await pathExists(scopedDestination, signal)) {
          continue;
        }

        await unsupportedFilesystemBoundary(signal, () => mkdir(path.dirname(scopedDestination), { recursive: true }));
        await copyPathMaterializingSymlinks(
          path.join(sourcePath, scopedEntry.name),
          scopedDestination,
          {
            standaloneRoot: pnpmNodeModulesDir,
            appRoot: nodeModulesDir,
            sourceRoot: nodeModulesDir,
            signal,
          },
        );
      }
      continue;
    }

    const destinationPath = path.join(nodeModulesDir, entry.name);
    if (await pathExists(destinationPath, signal)) {
      continue;
    }

    await copyPathMaterializingSymlinks(sourcePath, destinationPath, {
      standaloneRoot: pnpmNodeModulesDir,
      appRoot: nodeModulesDir,
      sourceRoot: nodeModulesDir,
      signal,
    });
  }
}

export async function normalizeArtifactSymlinks(
  artifactDir: string,
  appPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const normalizedArtifactDir = path.resolve(artifactDir);
  const normalizedAppPath = path.resolve(appPath);

  await walkDirectory(normalizedArtifactDir);

  async function walkDirectory(directory: string): Promise<void> {
    const entries = await unsupportedFilesystemBoundary(signal, () => readdir(directory, { withFileTypes: true }));

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await walkDirectory(fullPath);
        continue;
      }

      if (!entry.isSymbolicLink()) {
        continue;
      }

      const target = await unsupportedFilesystemBoundary(signal, () => readlink(fullPath));
      const resolvedTarget = path.resolve(path.dirname(fullPath), target);

      if (isPathWithin(normalizedArtifactDir, resolvedTarget)) {
        continue;
      }

      if (!isPathWithin(normalizedAppPath, resolvedTarget)) {
        throw new Error(`Build artifact symlink escapes the app directory: ${resolvedTarget}`);
      }

      const targetStat = await unsupportedFilesystemBoundary(signal, () => stat(resolvedTarget));
      await unsupportedFilesystemBoundary(signal, () => rm(fullPath, { force: true, recursive: true }));
      await unsupportedFilesystemBoundary(signal, () => cp(resolvedTarget, fullPath, {
        recursive: targetStat.isDirectory(),
        dereference: true,
      }));

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

function isPathWithinWorkspaceDependency(sourceRoot: string, candidatePath: string): boolean {
  return isPathWithin(path.join(sourceRoot, "node_modules"), candidatePath);
}

async function copyPathMaterializingSymlinks(
  sourcePath: string,
  destinationPath: string,
  options: {
    standaloneRoot: string;
    appRoot: string;
    sourceRoot: string;
    signal?: AbortSignal;
  },
): Promise<void> {
  const sourceStat = await unsupportedFilesystemBoundary(options.signal, () => lstat(sourcePath));

  if (sourceStat.isSymbolicLink()) {
    const resolvedTarget = await resolveSymlinkTarget(sourcePath, options);
    if (resolvedTarget === null) {
      return;
    }
    await copyPathMaterializingSymlinks(resolvedTarget, destinationPath, options);
    return;
  }

  if (sourceStat.isDirectory()) {
    await unsupportedFilesystemBoundary(options.signal, () => mkdir(destinationPath, { recursive: true }));

    const entries = await unsupportedFilesystemBoundary(options.signal, () => readdir(sourcePath, { withFileTypes: true }));
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
    await unsupportedFilesystemBoundary(options.signal, () => mkdir(path.dirname(destinationPath), { recursive: true }));
    await unsupportedFilesystemBoundary(options.signal, () => copyFile(sourcePath, destinationPath));
    await unsupportedFilesystemBoundary(options.signal, () => chmod(destinationPath, sourceStat.mode));
  }
}

async function resolveSymlinkTarget(
  symlinkPath: string,
  options: {
    standaloneRoot: string;
    appRoot: string;
    sourceRoot: string;
    signal?: AbortSignal;
  },
): Promise<string | null> {
  const linkTarget = await unsupportedFilesystemBoundary(options.signal, () => readlink(symlinkPath));
  const resolvedTarget = path.resolve(path.dirname(symlinkPath), linkTarget);

  if (await pathExists(resolvedTarget, options.signal)) {
    if (
      !isPathWithin(options.appRoot, resolvedTarget) &&
      !isPathWithinWorkspaceDependency(options.sourceRoot, resolvedTarget)
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

    if (await pathExists(fallbackTarget, options.signal)) {
      return fallbackTarget;
    }
  }

  // pnpm's hoist layer (.pnpm/node_modules/*) contains speculative links that
  // are routinely dangling — Next's tracer doesn't always align with what pnpm
  // populated. Drop these silently. Dangling links elsewhere still throw so a
  // real missing dep doesn't get masked.
  if (isPnpmHoistLink(symlinkPath)) {
    return null;
  }

  throw new Error(
    `Next.js standalone symlink target is missing: ${symlinkPath} -> ${linkTarget} (resolved to ${resolvedTarget})`,
  );
}

function isPnpmHoistLink(symlinkPath: string): boolean {
  const parts = path.dirname(symlinkPath).split(path.sep);
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === ".pnpm" && parts[i + 1] === "node_modules") {
      return true;
    }
  }
  return false;
}

async function pathExists(targetPath: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await unsupportedFilesystemBoundary(signal, () => stat(targetPath));
    return true;
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
}

async function directoryExists(targetPath: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const targetStat = await unsupportedFilesystemBoundary(signal, () => stat(targetPath));
    return targetStat.isDirectory();
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
}

async function resolveSourceRoot(appRoot: string, signal?: AbortSignal): Promise<string> {
  let current = path.resolve(appRoot);

  while (true) {
    if (
      await pathExists(path.join(current, ".git"), signal) ||
      await pathExists(path.join(current, "pnpm-workspace.yaml"), signal) ||
      await pathExists(path.join(current, "bun.lock"), signal) ||
      await pathExists(path.join(current, "bun.lockb"), signal) ||
      await packageJsonDeclaresWorkspaces(current, signal)
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

async function packageJsonDeclaresWorkspaces(directory: string, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  try {
    const content = await readFile(path.join(directory, "package.json"), { encoding: "utf8", signal });
    const parsed = JSON.parse(content) as { workspaces?: unknown };
    return Boolean(parsed.workspaces);
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
}

async function unsupportedFilesystemBoundary<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
  // These Node fs promise APIs do not accept AbortSignal; check immediately before and after the boundary.
  signal?.throwIfAborted();
  const result = await operation();
  signal?.throwIfAborted();
  return result;
}
