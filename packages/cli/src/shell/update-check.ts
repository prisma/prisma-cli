import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getCliName, getCliVersion } from "../lib/version";
import type { CliRuntime } from "./runtime";

const UPDATE_CHECK_FILE_NAME = "update-check.json";
const FALLBACK_INSTALL_DOCS_URL = "https://prisma.io/docs"; // TODO: replace with the canonical CLI installation docs URL.
const NOTIFICATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateCheckState {
  packageName?: string;
  installedVersion?: string;
  latestVersion?: string;
  checkedAt?: string;
  notifiedAt?: string;
}

export class UpdateCheckStore {
  private readonly filePath: string;

  constructor(cacheDir: string) {
    this.filePath = path.join(cacheDir, UPDATE_CHECK_FILE_NAME);
  }

  async read(): Promise<UpdateCheckState | null> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as UpdateCheckState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async write(state: UpdateCheckState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}

export async function maybeWriteCachedUpdateNotification(runtime: CliRuntime): Promise<void> {
  if (!canShowUpdateNotification(runtime)) {
    return;
  }

  const store = new UpdateCheckStore(resolveUpdateCheckCacheDir(runtime));
  const state = await store.read();
  const latestVersion = state?.latestVersion;

  if (!latestVersion || !isInstalledVersionStale(getCliVersion(), latestVersion)) {
    return;
  }

  if (state.notifiedAt && Date.now() - Date.parse(state.notifiedAt) < NOTIFICATION_INTERVAL_MS) {
    return;
  }

  runtime.stderr.write(renderUpdateNotification(latestVersion));
  await store.write({
    ...state,
    packageName: "@prisma/cli",
    installedVersion: getCliVersion(),
    notifiedAt: new Date().toISOString(),
  });
}

function canShowUpdateNotification(runtime: CliRuntime): boolean {
  if (runtime.env.NO_UPDATE_NOTIFIER !== undefined) {
    return false;
  }

  if (isTestRuntime(runtime.env) && runtime.env.PRISMA_CLI_TEST_ENABLE_UPDATE_CHECK !== "1") {
    return false;
  }

  if (runtime.env.CI || runtime.env.GITHUB_ACTIONS) {
    return false;
  }

  if (!runtime.stderr.isTTY) {
    return false;
  }

  if (runtime.argv.includes("--json") || runtime.argv.includes("--quiet") || runtime.argv.includes("-q")) {
    return false;
  }

  if (runtime.argv.includes("--version")) {
    return false;
  }

  return true;
}

function renderUpdateNotification(latestVersion: string): string {
  return [
    `Update available: ${getCliName()} ${getCliVersion()} -> ${latestVersion}`,
    `See ${FALLBACK_INSTALL_DOCS_URL} for update instructions.`,
    "",
  ].join("\n");
}

function resolveUpdateCheckCacheDir(runtime: CliRuntime): string {
  const configured = runtime.env.PRISMA_CLI_UPDATE_CHECK_DIR;
  if (configured?.trim()) {
    return path.resolve(configured);
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "prisma-cli");
  }

  if (process.platform === "win32") {
    const localAppData = runtime.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "prisma-cli", "cache");
  }

  const xdgCacheHome = runtime.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return path.join(xdgCacheHome, "prisma-cli");
}

function isTestRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.VITEST !== undefined || env.NODE_ENV === "test";
}

function isInstalledVersionStale(installedVersion: string, latestVersion: string): boolean {
  const installed = parseVersion(installedVersion);
  const latest = parseVersion(latestVersion);

  if (!installed || !latest) {
    return false;
  }

  return compareVersions(installed, latest) < 0;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseVersion(version: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? [],
  };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    const diff = left[key] - right[key];
    if (diff !== 0) {
      return diff;
    }
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];

    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;

    const diff = comparePrereleasePart(leftPart, rightPart);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function comparePrereleasePart(left: string, right: string): number {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : null;

  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber;
  }

  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;

  return left.localeCompare(right);
}
