import { access, readFile } from "node:fs/promises";
import path from "node:path";

export interface BunPackageJsonLike {
  main?: unknown;
  module?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
}

export async function readBunPackageJson(appPath: string, signal?: AbortSignal): Promise<BunPackageJsonLike | null> {
  const packageJsonPath = path.join(appPath, "package.json");

  let content: string;
  signal?.throwIfAborted();
  try {
    content = await readFile(packageJsonPath, { encoding: "utf8", signal });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw new Error(
      `Failed to read ${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    return JSON.parse(content) as BunPackageJsonLike;
  } catch (error) {
    throw new Error(
      `Failed to parse ${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function readBunPackageEntrypoint(packageJson: BunPackageJsonLike | null): string | undefined {
  if (typeof packageJson?.main === "string") {
    return packageJson.main;
  }

  if (typeof packageJson?.module === "string") {
    return packageJson.module;
  }

  return undefined;
}

export async function resolveBunEntrypoint(
  appPath: string,
  explicitEntrypoint: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const packageJson = await readBunPackageJson(appPath, signal);
  const candidate = explicitEntrypoint ?? readBunPackageEntrypoint(packageJson);

  if (!candidate) {
    throw new Error("Entrypoint is required. Pass --entry or define package.json main or module.");
  }

  if (path.isAbsolute(candidate)) {
    throw new Error("Entrypoint must be a relative path.");
  }

  const normalized = path.normalize(candidate);
  if (
    normalized.startsWith("..") ||
    path.isAbsolute(normalized) ||
    normalized.includes(`${path.sep}..${path.sep}`)
  ) {
    throw new Error("Entrypoint must not escape the app directory.");
  }

  const entrypointPath = path.join(appPath, normalized);
  signal?.throwIfAborted();
  try {
    // access does not accept AbortSignal; check before and after the filesystem boundary.
    await access(entrypointPath);
    signal?.throwIfAborted();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`Entrypoint file does not exist: ${entrypointPath}`);
  }

  return normalized.split(path.sep).join("/");
}
