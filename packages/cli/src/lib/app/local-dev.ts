import { spawn, type SpawnOptions } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

import type { PreviewBuildType, ResolvedPreviewBuildType } from "./preview-build";
import { readBunPackageEntrypoint, readBunPackageJson, resolveBunEntrypoint } from "./bun-project";

const NEXT_CONFIG_FILENAMES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.mts",
];

export const DEFAULT_LOCAL_DEV_PORT = 3000;

export interface LocalRunResult {
  framework: ResolvedPreviewBuildType;
  entrypoint: string | null;
  port: number;
  command: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
}

interface CommandCandidate {
  command: string;
  args: string[];
  display: string;
}

export async function resolveLocalBuildType(
  appPath: string,
  buildType: PreviewBuildType,
): Promise<ResolvedPreviewBuildType | null> {
  if (buildType === "bun" || buildType === "nextjs") {
    return buildType;
  }

  return detectLocalBuildType(appPath);
}

export async function detectLocalBuildType(appPath: string): Promise<ResolvedPreviewBuildType | null> {
  if (await isNextProject(appPath)) {
    return "nextjs";
  }

  if (await isBunProject(appPath)) {
    return "bun";
  }

  return null;
}

export async function runLocalApp(options: {
  appPath: string;
  buildType: ResolvedPreviewBuildType;
  entrypoint?: string;
  port: number;
  env: NodeJS.ProcessEnv;
  spawnImpl?: typeof spawn;
}): Promise<LocalRunResult> {
  const spawnImpl = options.spawnImpl ?? spawn;

  if (options.buildType === "nextjs") {
    const localBin = path.join(
      options.appPath,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "next.cmd" : "next",
    );
    const command = await runWithFallback(
      [
        {
          command: localBin,
          args: ["dev", "--port", String(options.port)],
          display: `next dev --port ${options.port}`,
        },
        {
          command: "npx",
          args: ["next", "dev", "--port", String(options.port)],
          display: `next dev --port ${options.port}`,
        },
        {
          command: "bunx",
          args: ["next", "dev", "--port", String(options.port)],
          display: `next dev --port ${options.port}`,
        },
      ],
      {
        cwd: options.appPath,
        env: {
          ...options.env,
          PORT: String(options.port),
        },
      },
      spawnImpl,
      "Could not find the Next.js CLI. Install it with `npm install next` or ensure npx/bunx is available.",
    );

    return {
      framework: "nextjs",
      entrypoint: null,
      port: options.port,
      command: command.display,
      exitCode: command.exitCode,
      signal: command.signal,
    };
  }

  const entrypoint = await resolveBunEntrypoint(options.appPath, options.entrypoint);
  const command = await runWithFallback(
    [
      {
        command: "bun",
        args: ["--watch", entrypoint],
        display: `bun --watch ${entrypoint}`,
      },
    ],
    {
      cwd: options.appPath,
      env: {
        ...options.env,
        PORT: String(options.port),
      },
    },
    spawnImpl,
    "Bun is required to run this app locally. Install it from https://bun.sh.",
  );

  return {
    framework: "bun",
    entrypoint,
    port: options.port,
    command: command.display,
    exitCode: command.exitCode,
    signal: command.signal,
  };
}

async function isNextProject(appPath: string): Promise<boolean> {
  for (const fileName of NEXT_CONFIG_FILENAMES) {
    try {
      await access(path.join(appPath, fileName));
      return true;
    } catch {
      // ignore missing files
    }
  }

  const packageJson = await readBunPackageJson(appPath);
  return hasDependency(packageJson, "next");
}

async function isBunProject(appPath: string): Promise<boolean> {
  try {
    await access(path.join(appPath, "bun.lock"));
    return true;
  } catch {
    // ignore missing file
  }

  try {
    await access(path.join(appPath, "bun.lockb"));
    return true;
  } catch {
    // ignore missing file
  }

  const packageJson = await readBunPackageJson(appPath);
  if (!packageJson) {
    return false;
  }

  const hasEntrypoint = typeof readBunPackageEntrypoint(packageJson) === "string";
  const hasBunDependency = hasDependency(packageJson, "@types/bun") || hasDependency(packageJson, "bun");
  const scriptValues = typeof packageJson.scripts === "object" && packageJson.scripts !== null
    ? Object.values(packageJson.scripts)
    : [];
  const usesBunScripts = scriptValues.some((value) => typeof value === "string" && /\bbun\b/.test(value));

  return hasEntrypoint && (hasBunDependency || usesBunScripts);
}

function hasDependency(
  packageJson: Awaited<ReturnType<typeof readBunPackageJson>>,
  dependencyName: string,
): boolean {
  if (!packageJson) {
    return false;
  }

  const dependencyGroups = [packageJson.dependencies, packageJson.devDependencies];

  return dependencyGroups.some(
    (group) => typeof group === "object" && group !== null && dependencyName in group,
  );
}
async function runWithFallback(
  candidates: CommandCandidate[],
  options: SpawnOptions,
  spawnImpl: typeof spawn,
  missingCommandMessage: string,
): Promise<{
  display: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
}> {
  for (const candidate of candidates) {
    try {
      const result = await spawnCommand(candidate, options, spawnImpl);
      return {
        display: candidate.display,
        exitCode: result.exitCode,
        signal: result.signal,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }

      throw error;
    }
  }

  throw new Error(missingCommandMessage);
}

function spawnCommand(
  candidate: CommandCandidate,
  options: SpawnOptions,
  spawnImpl: typeof spawn,
): Promise<{
  exitCode: number;
  signal: NodeJS.Signals | null;
}> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(candidate.command, candidate.args, {
      ...options,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({
        exitCode: code ?? 1,
        signal,
      });
    });
  });
}
