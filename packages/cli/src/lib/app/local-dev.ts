// biome-ignore-all lint/performance/noAwaitInLoops: Local app detection and command fallbacks must short-circuit sequentially.
// biome-ignore-all lint/performance/useTopLevelRegex: Existing package script regexes are kept inline for readability.
import { access } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";
import type { AppBuildType, ResolvedAppBuildType } from "./build";
import {
  readBunPackageEntrypoint,
  readBunPackageJson,
  resolveBunEntrypoint,
} from "./bun-project";

export type LocalBuildType = Extract<ResolvedAppBuildType, "bun" | "nextjs">;

const NEXT_CONFIG_FILENAMES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.mts",
];

export const DEFAULT_LOCAL_DEV_PORT = 3000;

export interface LocalRunResult {
  framework: LocalBuildType;
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
  buildType: AppBuildType,
  signal?: AbortSignal,
): Promise<LocalBuildType | null> {
  if (buildType === "bun" || buildType === "nextjs") {
    return buildType;
  }

  if (buildType !== "auto") {
    return null;
  }

  return detectLocalBuildType(appPath, signal);
}

export async function detectLocalBuildType(
  appPath: string,
  signal?: AbortSignal,
): Promise<LocalBuildType | null> {
  if (await isNextProject(appPath, signal)) {
    return "nextjs";
  }

  if (await isBunProject(appPath, signal)) {
    return "bun";
  }

  return null;
}

export async function runLocalApp(options: {
  appPath: string;
  buildType: LocalBuildType;
  entrypoint?: string;
  port: number;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}): Promise<LocalRunResult> {
  if (options.buildType === "nextjs") {
    // execa resolves Windows `.cmd` shims via PATHEXT (cross-spawn), so the
    // extensionless bin path works on every platform.
    const localBin = path.join(options.appPath, "node_modules", ".bin", "next");
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
        signal: options.signal,
      },
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

  const entrypoint = await resolveBunEntrypoint(
    options.appPath,
    options.entrypoint,
    options.signal,
  );
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
      signal: options.signal,
    },
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

async function isNextProject(
  appPath: string,
  signal?: AbortSignal,
): Promise<boolean> {
  for (const fileName of NEXT_CONFIG_FILENAMES) {
    signal?.throwIfAborted();
    try {
      // access does not accept AbortSignal; check before and after the filesystem boundary.
      await access(path.join(appPath, fileName));
      signal?.throwIfAborted();
      return true;
    } catch (error) {
      if (signal?.aborted) throw error;
      // ignore missing files
    }
  }

  const packageJson = await readBunPackageJson(appPath, signal);
  return hasDependency(packageJson, "next");
}

async function isBunProject(
  appPath: string,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted();
  try {
    // access does not accept AbortSignal; check before and after the filesystem boundary.
    await access(path.join(appPath, "bun.lock"));
    signal?.throwIfAborted();
    return true;
  } catch (error) {
    if (signal?.aborted) throw error;
    // ignore missing file
  }

  signal?.throwIfAborted();
  try {
    // access does not accept AbortSignal; check before and after the filesystem boundary.
    await access(path.join(appPath, "bun.lockb"));
    signal?.throwIfAborted();
    return true;
  } catch (error) {
    if (signal?.aborted) throw error;
    // ignore missing file
  }

  const packageJson = await readBunPackageJson(appPath, signal);
  if (!packageJson) {
    return false;
  }

  const hasEntrypoint =
    typeof readBunPackageEntrypoint(packageJson) === "string";
  const hasBunDependency =
    hasDependency(packageJson, "@types/bun") ||
    hasDependency(packageJson, "bun");
  const scriptValues =
    typeof packageJson.scripts === "object" && packageJson.scripts !== null
      ? Object.values(packageJson.scripts)
      : [];
  const usesBunScripts = scriptValues.some(
    (value) => typeof value === "string" && /\bbun\b/.test(value),
  );

  return hasEntrypoint && (hasBunDependency || usesBunScripts);
}

function hasDependency(
  packageJson: Awaited<ReturnType<typeof readBunPackageJson>>,
  dependencyName: string,
): boolean {
  if (!packageJson) {
    return false;
  }

  const dependencyGroups = [
    packageJson.dependencies,
    packageJson.devDependencies,
  ];

  return dependencyGroups.some(
    (group) =>
      typeof group === "object" && group !== null && dependencyName in group,
  );
}
async function runWithFallback(
  candidates: CommandCandidate[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  },
  missingCommandMessage: string,
): Promise<{
  display: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
}> {
  for (const candidate of candidates) {
    const result = await spawnCommand(candidate, options);
    if (result === "unavailable") {
      continue;
    }
    return {
      display: candidate.display,
      exitCode: result.exitCode,
      signal: result.signal,
    };
  }

  throw new Error(missingCommandMessage);
}

/**
 * Runs one candidate to completion with inherited stdio, returning its exit
 * information, or "unavailable" when the binary does not exist so the ladder
 * can try the next candidate. execa spawns through cross-spawn, so Windows
 * `.cmd` shims (npx, `node_modules/.bin` entries) resolve via PATHEXT instead
 * of failing with a false ENOENT.
 */
async function spawnCommand(
  candidate: CommandCandidate,
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  },
): Promise<
  | "unavailable"
  | {
      exitCode: number;
      signal: NodeJS.Signals | null;
    }
> {
  // The caller passes the full runtime env; extending over process.env again
  // would let parent vars leak past a deliberate omission.
  const result = await execa(candidate.command, candidate.args, {
    cwd: options.cwd,
    env: options.env,
    extendEnv: false,
    cancelSignal: options.signal,
    stdio: "inherit",
    reject: false,
  });

  if (result.code === "ENOENT") {
    return "unavailable";
  }
  // Started but did not spawn cleanly for another reason (e.g. EACCES):
  // surface it rather than misreporting it as an app exit.
  if (
    result.failed &&
    result.exitCode === undefined &&
    result.signal === undefined &&
    !result.isCanceled
  ) {
    throw new Error(result.shortMessage, { cause: result.cause });
  }

  return {
    exitCode: result.exitCode ?? 1,
    signal: (result.signal ?? null) as NodeJS.Signals | null,
  };
}
