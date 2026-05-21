import os from "node:os";
import path from "node:path";

export const CLIENT_ID = "cmm3lndn701oo0uefvxzo0ivw";
export const DEFAULT_API_BASE_URL = "https://api.prisma.io";
export const SERVICE_TOKEN_ENV_VAR = "PRISMA_SERVICE_TOKEN";
export const AUTH_FILE_ENV_VAR = "PRISMA_COMPUTE_AUTH_FILE";

export function getApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.PRISMA_MANAGEMENT_API_URL?.trim() || DEFAULT_API_BASE_URL;
}

export function getAuthFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[AUTH_FILE_ENV_VAR];
  if (configured?.trim()) {
    return path.resolve(configured);
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "prisma", "auth.json");
  }

  if (process.platform === "win32") {
    const appData = env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "prisma", "auth.json");
  }

  const xdgConfigHome = env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(xdgConfigHome, "prisma", "auth.json");
}
