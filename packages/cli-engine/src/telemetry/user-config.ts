import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * The user-level config file. Persists the telemetry flag and the
 * installation UUID. Under the opt-out model the flag stays `undefined`
 * until the user makes an explicit choice (default-on first run mints
 * only the id via {@link ensureInstallationId}), and an env-var opt-out
 * never mutates disk. Once the id exists it survives any on → off → on
 * cycle, keeping the same UUID.
 *
 * Readers tolerate unknown fields for forward compat; writers merge
 * partials into the existing object so unknown fields are preserved.
 */
export interface UserConfig {
  readonly enableTelemetry?: boolean;
  readonly installationId?: string;
  readonly [key: string]: unknown;
}

const APP_DIR = "prisma";
const FILE_NAME = "config.json";

/** The invocation's environment, from `runtime.env`. */
type Env = Readonly<Record<string, string | undefined>>;

function set(raw: string | undefined): string | undefined {
  return raw !== undefined && raw.length > 0 ? raw : undefined;
}

/**
 * Resolves the user-level config directory:
 *   - Windows: `%APPDATA%\prisma\` (fallback: `%USERPROFILE%\AppData\Roaming\prisma\`).
 *   - Unix (incl. macOS): `$XDG_CONFIG_HOME/prisma/` if set, else
 *     `$HOME/.config/prisma/` per the XDG Base Directory Specification.
 *
 * XDG is chosen over the macOS-native `~/Library/Preferences/`
 * convention so the path resolution follows an environment variable and
 * matches the documented behaviour on all *nix platforms. The directory
 * is `prisma`, after the binary: the `prisma-next` name it carried is
 * retired with that binary, and nothing reads the old location — no
 * fallback, no migration.
 *
 * EVERY variable comes from the invocation's env — the engine reads no
 * process globals, and `os.homedir()` is one: it answers from the
 * process's own `$HOME`, not the invocation's. An env that names none of
 * them resolves to `undefined`: the preference store is unavailable, and
 * the engine then reads nothing, writes nothing and reports nothing.
 * Failing closed is the only safe direction for a privacy feature —
 * `runtime.env` is `process.env` in production, where `HOME` (or
 * `USERPROFILE`) is always set, so this is a test-shaped state.
 *
 * `process.platform` stays: it does not vary with an invocation and is
 * not modelled on the Runtime.
 */
function configDir(env: Env): string | undefined {
  if (process.platform === "win32") {
    const appData = set(env["APPDATA"]);
    if (appData !== undefined) {
      return join(appData, APP_DIR);
    }
    const userProfile = set(env["USERPROFILE"]);
    return userProfile === undefined
      ? undefined
      : join(userProfile, "AppData", "Roaming", APP_DIR);
  }
  const xdg = set(env["XDG_CONFIG_HOME"]);
  if (xdg !== undefined) {
    return join(xdg, APP_DIR);
  }
  const home = set(env["HOME"]);
  return home === undefined ? undefined : join(home, ".config", APP_DIR);
}

/**
 * Path to the user-level config file for this invocation, or `undefined`
 * when the environment says nothing about where the user's config
 * directory is. Callers treat `undefined` as "the preference store is
 * unavailable".
 */
export function userConfigPath(env: Env): string | undefined {
  const dir = configDir(env);
  return dir === undefined ? undefined : join(dir, FILE_NAME);
}

/**
 * Reads the user-level config. File-missing, unreadable, or malformed →
 * `{}` (the absence of consent is the same answer in every error mode).
 * Unknown fields from a future client are passed through verbatim.
 */
export function readUserConfig(env: Env): UserConfig {
  const path = userConfigPath(env);
  if (path === undefined || !existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed as UserConfig;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Merges `partial` into the current config and writes the result
 * atomically (temp file + rename) so a crash mid-write never leaves a
 * half-baked file readable on disk. Unknown fields already on disk are
 * preserved.
 *
 * When `partial.enableTelemetry === true` and no `installationId` is
 * stored yet, generates a v4 random UUID and persists both fields in the
 * same write. An existing `installationId` is never rotated. This is the
 * *explicit-consent* mint path: a `false` answer
 * (`writeUserConfig({ enableTelemetry: false })`) writes no id, and a
 * bare `writeUserConfig({ installationId })` mints nothing extra. The
 * default-on first-send path mints its id separately via
 * {@link ensureInstallationId}, which records no consent answer.
 */
export function writeUserConfig(env: Env, partial: Partial<UserConfig>): void {
  const current = readUserConfig(env);
  const merged: Record<string, unknown> = { ...current, ...partial };
  if (
    partial.enableTelemetry === true &&
    merged["installationId"] === undefined
  ) {
    merged["installationId"] = randomUUID();
  }
  const path = userConfigPath(env);
  if (path === undefined) {
    throw new Error(
      "@prisma/cli-engine: cannot resolve the user config directory — the environment sets none of XDG_CONFIG_HOME, HOME, APPDATA or USERPROFILE",
    );
  }
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");
  renameSync(tmpPath, path);
}

/**
 * Returns the stored `installationId`, minting and persisting a fresh v4
 * UUID when none exists yet. Crucially, this persists *only* the id —
 * `enableTelemetry` is left untouched (stays `undefined` on a default-on
 * first run), so no explicit consent the user never gave is recorded.
 *
 * Used by the default-on first-run fire path: the gating resolution has
 * already come back enabled, so this only ever runs when telemetry is on.
 */
export function ensureInstallationId(env: Env): string {
  const existing = readUserConfig(env).installationId;
  if (typeof existing === "string" && existing.length > 0) {
    return existing;
  }
  const installationId = randomUUID();
  writeUserConfig(env, { installationId });
  return installationId;
}
