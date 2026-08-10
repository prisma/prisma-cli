// biome-ignore-all lint/performance/useTopLevelRegex: Existing update-check parsing regexes are kept inline for readability.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getCliName, getCliVersion } from "./lib/version";

/** The exact runtime surface the update check reads; both the legacy
 *  shell's CliRuntime and the v8 bin's host process satisfy it. */
export interface UpdateCheckRuntime {
  readonly env: NodeJS.ProcessEnv;
  readonly argv: readonly string[];
  readonly stderr: { readonly isTTY?: boolean; write(text: string): unknown };
}

const UPDATE_CHECK_FILE_NAME = "update-check.json";
const FALLBACK_INSTALL_DOCS_URL =
  "https://www.prisma.io/docs/orm/tools/prisma-cli";
const NOTIFICATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = "https://registry.npmjs.org/@prisma%2fcli";
const REGISTRY_TIMEOUT_MS = 3_000;

export interface UpdateCheckState {
  packageName?: string;
  installedVersion?: string;
  latestVersion?: string;
  checkedAt?: string;
  notifiedAt?: string;
}

interface UpdateInstruction {
  type: "command" | "docs";
  value: string;
}

export class UpdateCheckStore {
  private readonly filePath: string;

  constructor(cacheDir: string) {
    this.filePath = path.join(cacheDir, UPDATE_CHECK_FILE_NAME);
  }

  async read(): Promise<UpdateCheckState | null> {
    try {
      return JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as UpdateCheckState;
    } catch (error) {
      if (isUnreadableCacheError(error)) {
        return null;
      }

      throw error;
    }
  }

  async write(state: UpdateCheckState): Promise<void> {
    const dir = path.dirname(this.filePath);
    const tempPath = path.join(
      dir,
      `${UPDATE_CHECK_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
    );
    await mkdir(dir, { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }
}

export async function maybeWriteCachedUpdateNotification(
  runtime: UpdateCheckRuntime,
): Promise<void> {
  if (!canRunUpdateCheck(runtime)) {
    return;
  }

  try {
    const cacheDir = resolveUpdateCheckCacheDir(runtime);
    const store = new UpdateCheckStore(cacheDir);
    const state = await store.read();
    const latestVersion = state?.latestVersion;

    if (
      latestVersion &&
      isInstalledVersionStale(getCliVersion(), latestVersion) &&
      shouldNotify(state)
    ) {
      runtime.stderr.write(
        renderUpdateNotification(
          latestVersion,
          selectUpdateInstruction(runtime.env),
        ),
      );
      await store.write({
        ...state,
        packageName: "@prisma/cli",
        installedVersion: getCliVersion(),
        notifiedAt: new Date().toISOString(),
      });
    }

    await scheduleRemoteDiscovery(runtime, store, state, cacheDir);
  } catch {
    return;
  }
}

export async function runUpdateDiscovery(options: {
  cacheDir: string;
  installedVersion: string;
  registryUrl?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<void> {
  try {
    const latestVersion = await fetchLatestVersion(
      options.registryUrl ?? REGISTRY_URL,
      options.fetchImpl ?? fetch,
    );
    if (!latestVersion) {
      return;
    }

    const store = new UpdateCheckStore(options.cacheDir);
    const previousState = await store.read();
    await store.write({
      ...previousState,
      packageName: "@prisma/cli",
      installedVersion: options.installedVersion,
      latestVersion,
      checkedAt: (options.now ?? new Date()).toISOString(),
    });
  } catch {
    return;
  }
}

function isUnreadableCacheError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "ENOENT" ||
    code === "EACCES" ||
    code === "EPERM" ||
    error instanceof SyntaxError
  );
}

export async function runUpdateDiscoveryWorker(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const cacheDir = env.PRISMA_CLI_UPDATE_CHECK_DIR;
  const installedVersion = env.PRISMA_CLI_UPDATE_CHECK_INSTALLED_VERSION;

  if (!cacheDir || !installedVersion) {
    return;
  }

  await runUpdateDiscovery({
    cacheDir,
    installedVersion,
    registryUrl: env.PRISMA_CLI_UPDATE_CHECK_REGISTRY_URL,
  });
}

function canRunUpdateCheck(runtime: UpdateCheckRuntime): boolean {
  if (runtime.env.NO_UPDATE_NOTIFIER !== undefined) {
    return false;
  }

  if (
    isTestRuntime(runtime.env) &&
    runtime.env.PRISMA_CLI_TEST_ENABLE_UPDATE_CHECK !== "1"
  ) {
    return false;
  }

  if (runtime.env.CI || runtime.env.GITHUB_ACTIONS) {
    return false;
  }

  if (!runtime.stderr.isTTY) {
    return false;
  }

  if (
    runtime.argv.includes("--json") ||
    runtime.argv.includes("--quiet") ||
    runtime.argv.includes("-q")
  ) {
    return false;
  }

  if (runtime.argv.includes("--version")) {
    return false;
  }

  return true;
}

function shouldNotify(state: UpdateCheckState): boolean {
  return !state.notifiedAt || isAtLeastIntervalAgo(state.notifiedAt);
}

async function scheduleRemoteDiscovery(
  runtime: UpdateCheckRuntime,
  store: UpdateCheckStore,
  state: UpdateCheckState | null,
  cacheDir: string,
): Promise<void> {
  if (state?.checkedAt && !isAtLeastIntervalAgo(state.checkedAt)) {
    return;
  }

  const checkedAt = new Date().toISOString();
  await store.write({
    ...state,
    packageName: "@prisma/cli",
    installedVersion: getCliVersion(),
    checkedAt,
  });

  if (isTestRuntime(runtime.env)) {
    return;
  }

  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return;
  }

  const child = spawn(process.execPath, [entrypoint], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PRISMA_CLI_RUN_UPDATE_CHECK_WORKER: "1",
      PRISMA_CLI_UPDATE_CHECK_DIR: cacheDir,
      PRISMA_CLI_UPDATE_CHECK_INSTALLED_VERSION: getCliVersion(),
      PRISMA_CLI_UPDATE_CHECK_REGISTRY_URL:
        runtime.env.PRISMA_CLI_UPDATE_CHECK_REGISTRY_URL ?? REGISTRY_URL,
    },
  });
  child.unref();
}

export function selectUpdateInstruction(
  env: NodeJS.ProcessEnv,
  processArgv: readonly string[] = process.argv,
): UpdateInstruction {
  const entrypoint = (processArgv[1] ?? "").replace(/\\/g, "/").toLowerCase();
  const userAgent = env.npm_config_user_agent?.toLowerCase() ?? "";
  const lifecycle = env.npm_lifecycle_event?.toLowerCase() ?? "";

  if (isEphemeralInvocation(entrypoint, lifecycle)) {
    return docsInstruction();
  }

  if (entrypoint.includes("/node_modules/.bin/")) {
    if (userAgent.startsWith("pnpm")) {
      return commandInstruction("pnpm add -D @prisma/cli@latest");
    }

    if (userAgent.startsWith("bun")) {
      return commandInstruction("bun add -d @prisma/cli@latest");
    }

    if (userAgent.startsWith("npm")) {
      return commandInstruction("npm install --save-dev @prisma/cli@latest");
    }
  }

  if (
    env.npm_config_global === "true" ||
    isLikelyGlobalNpmEntrypoint(entrypoint)
  ) {
    return commandInstruction("npm install --global @prisma/cli@latest");
  }

  return docsInstruction();
}

function renderUpdateNotification(
  latestVersion: string,
  instruction: UpdateInstruction,
): string {
  return [
    `Update available: ${getCliName()} ${getCliVersion()} -> ${latestVersion}`,
    renderUpdateInstruction(instruction),
    "",
  ].join("\n");
}

function renderUpdateInstruction(instruction: UpdateInstruction): string {
  if (instruction.type === "command") {
    return `Run ${instruction.value} to update.`;
  }

  return `See ${instruction.value} for update instructions.`;
}

function isEphemeralInvocation(entrypoint: string, lifecycle: string): boolean {
  return (
    lifecycle === "npx" ||
    lifecycle === "pnpx" ||
    entrypoint.includes("/_npx/") ||
    entrypoint.includes("/.bun/")
  );
}

function isLikelyGlobalNpmEntrypoint(entrypoint: string): boolean {
  return (
    /\/npm\/prisma-cli(\.cmd|\.exe)?$/.test(entrypoint) ||
    /\/npm-global\/bin\/prisma-cli$/.test(entrypoint)
  );
}

function commandInstruction(value: string): UpdateInstruction {
  return { type: "command", value };
}

function docsInstruction(): UpdateInstruction {
  return { type: "docs", value: FALLBACK_INSTALL_DOCS_URL };
}

function resolveUpdateCheckCacheDir(runtime: UpdateCheckRuntime): string {
  const configured = runtime.env.PRISMA_CLI_UPDATE_CHECK_DIR;
  if (configured?.trim()) {
    return path.resolve(configured);
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "prisma-cli");
  }

  if (process.platform === "win32") {
    const localAppData =
      runtime.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "prisma-cli", "cache");
  }

  const xdgCacheHome =
    runtime.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return path.join(xdgCacheHome, "prisma-cli");
}

function isTestRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.VITEST !== undefined || env.NODE_ENV === "test";
}

function isAtLeastIntervalAgo(value: string): boolean {
  const timestamp = Date.parse(value);
  return (
    Number.isNaN(timestamp) ||
    Date.now() - timestamp >= NOTIFICATION_INTERVAL_MS
  );
}

function isInstalledVersionStale(
  installedVersion: string,
  latestVersion: string,
): boolean {
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

async function fetchLatestVersion(
  registryUrl: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);

  try {
    const response = await fetchImpl(registryUrl, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const metadata = (await response.json()) as {
      "dist-tags"?: { latest?: unknown };
    };
    const latest = metadata["dist-tags"]?.latest;
    return typeof latest === "string" ? latest : null;
  } finally {
    clearTimeout(timeout);
  }
}
