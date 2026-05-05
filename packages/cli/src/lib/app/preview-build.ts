import { execFile } from "node:child_process";
import { copyFile, cp, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { BunBuild, type BuildArtifact, type BuildStrategy } from "@prisma/compute-sdk";
import { resolveBunEntrypoint } from "./bun-project";

export type PreviewBuildType = "auto" | "bun" | "nextjs";
export type ResolvedPreviewBuildType = Exclude<PreviewBuildType, "auto">;

const NEXT_CONFIG_FILENAMES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.mts",
];

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
  if (options.buildType === "nextjs") {
    return {
      buildType: "nextjs",
      strategy: new PreviewNextjsBuild({ appPath: options.appPath }),
    };
  }

  if (options.buildType === "bun") {
    const entrypoint = await resolveBunEntrypoint(options.appPath, options.entrypoint);
    return {
      buildType: "bun",
      strategy: new BunBuild({
        appPath: options.appPath,
        entrypoint,
      }),
    };
  }

  const nextjsStrategy = new PreviewNextjsBuild({ appPath: options.appPath });
  if (await nextjsStrategy.canBuild()) {
    return {
      buildType: "nextjs",
      strategy: nextjsStrategy,
    };
  }

  const entrypoint = await resolveBunEntrypoint(options.appPath, options.entrypoint);
  return {
    buildType: "bun",
    strategy: new BunBuild({
      appPath: options.appPath,
      entrypoint,
    }),
  };
}

class PreviewNextjsBuild implements BuildStrategy {
  readonly #appPath: string;

  constructor(options: { appPath: string }) {
    this.#appPath = options.appPath;
  }

  async canBuild(): Promise<boolean> {
    return (await this.#hasNextConfig()) || (await this.#hasNextDependency());
  }

  async execute(): Promise<BuildArtifact> {
    await this.#runBuild();

    const standaloneDir = path.join(this.#appPath, ".next", "standalone");
    const standaloneStat = await stat(standaloneDir).catch(() => null);
    if (!standaloneStat?.isDirectory()) {
      throw new Error('Next.js build did not produce standalone output. Add output: "standalone" to your next.config file.');
    }

    const outDir = await mkdtemp(path.join(os.tmpdir(), "compute-build-"));

    try {
      const artifactDir = path.join(outDir, "app");
      await stageNextjsStandaloneArtifact({
        standaloneDir,
        artifactDir,
        appPath: this.#appPath,
      });

      const publicDir = path.join(this.#appPath, "public");
      if (await directoryExists(publicDir)) {
        await cp(publicDir, path.join(artifactDir, "public"), { recursive: true });
      }

      const staticDir = path.join(this.#appPath, ".next", "static");
      if (await directoryExists(staticDir)) {
        await cp(staticDir, path.join(artifactDir, ".next", "static"), { recursive: true });
      }

      return {
        directory: artifactDir,
        entrypoint: "server.js",
        defaultPortMapping: { http: 3000 },
        cleanup: () => rm(outDir, { recursive: true, force: true }),
      };
    } catch (error) {
      await rm(outDir, { recursive: true, force: true });
      throw error;
    }
  }

  async #hasNextConfig(): Promise<boolean> {
    let entries: string[];
    try {
      entries = await readdir(this.#appPath);
    } catch {
      return false;
    }

    return entries.some((entry) => NEXT_CONFIG_FILENAMES.includes(entry));
  }

  async #hasNextDependency(): Promise<boolean> {
    const packageJsonPath = path.join(this.#appPath, "package.json");
    let content: string;

    try {
      content = await readFile(packageJsonPath, "utf8");
    } catch {
      return false;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return false;
    }

    const deps = isRecord(parsed.dependencies) ? parsed.dependencies : {};
    const devDeps = isRecord(parsed.devDependencies) ? parsed.devDependencies : {};

    return "next" in deps || "next" in devDeps;
  }

  async #runBuild(): Promise<void> {
    const localBin = path.join(this.#appPath, "node_modules", ".bin", "next");
    const candidates = [
      { command: localBin, args: ["build"] },
      { command: "npx", args: ["next", "build"] },
      { command: "bunx", args: ["next", "build"] },
    ];

    for (const { command, args } of candidates) {
      try {
        await exec(command, args, this.#appPath);
        return;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          continue;
        }

        throw error;
      }
    }

    throw new Error("Could not find the Next.js CLI. Install it with `npm install next` or ensure npx/bunx is available.");
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

async function directoryExists(dirPath: string): Promise<boolean> {
  const dirStat = await stat(dirPath).catch(() => null);
  return dirStat?.isDirectory() ?? false;
}

function exec(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd }, (error, _stdout, stderr) => {
      if (error) {
        if ("code" in error && error.code === "ENOENT") {
          reject(Object.assign(new Error(`${command} not found`), {
            code: "ENOENT",
          }));
          return;
        }

        const message = stderr.trim() || error.message;
        reject(new Error(`Next.js build failed:\n${message}`));
        return;
      }

      resolve();
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
