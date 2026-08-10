import os from "node:os";
import path from "node:path";

export const CLIENT_ID = "cmm3lndn701oo0uefvxzo0ivw";
export const DEFAULT_API_BASE_URL = "https://api.prisma.io";
export const DEFAULT_AUTH_BASE_URL = "https://auth.prisma.io";
export const SERVICE_TOKEN_ENV_VAR = "PRISMA_SERVICE_TOKEN";
export const AUTH_FILE_ENV_VAR = "PRISMA_COMPUTE_AUTH_FILE";

/**
 * The redirect the OAuth client is registered with. `performLogin`
 * replaces it with its own ephemeral callback server's port; the
 * refreshing client never reads it.
 */
export const DEFAULT_REDIRECT_URI = "http://localhost/auth/callback";

/**
 * The SDK's config demands a redirect URI even for a client that only
 * ever makes API calls with tokens it already has. Port 0 is the
 * honest value: no browser is ever sent here, and nothing listens.
 */
export const UNUSED_REDIRECT_URI = "http://localhost:0/auth/callback";

export function getApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.PRISMA_MANAGEMENT_API_URL?.trim() || DEFAULT_API_BASE_URL;
}

export function getAuthBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.PRISMA_AUTH_BASE_URL?.trim() || DEFAULT_AUTH_BASE_URL;
}

export function getAuthFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[AUTH_FILE_ENV_VAR];
  if (configured?.trim()) {
    return path.resolve(configured);
  }

  return defaultAuthFilePath(env);
}

export function defaultAuthFilePath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "prisma",
      "auth.json",
    );
  }

  if (process.platform === "win32") {
    const appData =
      env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "prisma", "auth.json");
  }

  const xdgConfigHome =
    env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(xdgConfigHome, "prisma", "auth.json");
}
