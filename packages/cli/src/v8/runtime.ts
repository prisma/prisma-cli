import { fileURLToPath } from "node:url";
import {
  type HostProcess,
  type InputStream,
  loadConfig,
  type Runtime,
} from "@prisma/cli-engine";
import { runTelemetry } from "@repo/cli-telemetry";
import open from "open";
import {
  CLIENT_ID,
  DEFAULT_REDIRECT_URI,
  getApiBaseUrl,
  getAuthBaseUrl,
} from "../auth/client";
import { FileCredentialManager } from "../auth/credential-manager";
import {
  DEPRECATED_STATE_FILE_ENV_VAR,
  resolveStateFilePath,
  STATE_FILE_ENV_VAR,
} from "../auth/state-file";
import { fetchWorkspaceName } from "../auth/workspace-name";
import { runPackageManager } from "./package-manager-runner";
import { spawnChild } from "./spawn";

export type SignalProcess = Pick<HostProcess, "on" | "off" | "exit">;

export type { HostProcess };

/** Dumb wiring: forwards process signals to the engine's subscribers.
 *  The signal policy (first aborts, second force-exits) is the engine's. */
export function makeOnSignal(proc: SignalProcess): Runtime["onSignal"] {
  return (cb) => {
    const onInt = (): void => cb("SIGINT");
    const onTerm = (): void => cb("SIGTERM");
    proc.on("SIGINT", onInt);
    proc.on("SIGTERM", onTerm);
    return () => {
      proc.off("SIGINT", onInt);
      proc.off("SIGTERM", onTerm);
    };
  };
}

/**
 * Path to the compiled sender entry. In the workspace (dev runs and the
 * monorepo dist) the package specifier resolves to
 * `packages/cli-telemetry/dist/sender.js`; in the published cli the
 * telemetry package is bundled away, so the fallback resolves the copy
 * tsdown emits next to the v8 entry (`dist/v8/sender.js`).
 */
function resolveSenderPath(): string {
  try {
    return fileURLToPath(import.meta.resolve("@repo/cli-telemetry/sender"));
  } catch {
    return fileURLToPath(new URL("./sender.js", import.meta.url));
  }
}

/** PRISMA_COMPUTE_AUTH_FILE still names the credentials file, but
 *  PRISMA_AUTH_FILE is the supported name. Warned once per process. */
function warnOnDeprecatedStateFileEnvVar(proc: HostProcess): void {
  if (!resolveStateFilePath(proc.env).fromDeprecatedEnvVar) return;
  proc.stderr.write(
    `${DEPRECATED_STATE_FILE_ENV_VAR} is deprecated; use ${STATE_FILE_ENV_VAR} instead.\n`,
  );
}

export async function assembleRuntime(proc: HostProcess): Promise<Runtime> {
  const stdin: InputStream = {
    setRawMode:
      proc.stdin.isTTY === true && proc.stdin.setRawMode !== undefined
        ? (enabled) => {
            proc.stdin.setRawMode?.(enabled);
          }
        : undefined,
    [Symbol.asyncIterator]: () => proc.stdin[Symbol.asyncIterator](),
  };
  warnOnDeprecatedStateFileEnvVar(proc);
  const apiBaseUrl = getApiBaseUrl(proc.env);
  return {
    stdout: {
      write: (text) => {
        proc.stdout.write(text);
      },
    },
    stderr: {
      write: (text) => {
        proc.stderr.write(text);
      },
      get columns() {
        return proc.stderr.columns;
      },
    },
    stdin,
    cwd: proc.cwd(),
    env: proc.env,
    isTty: {
      stdin: proc.stdin.isTTY === true,
      stdout: proc.stdout.isTTY === true,
      stderr: proc.stderr.isTTY === true,
    },
    exit: (code) => proc.exit(code),
    onSignal: makeOnSignal(proc),
    loadConfig: (configPath) => loadConfig(proc.cwd(), configPath),
    credentialManager: new FileCredentialManager({
      env: proc.env,
      fetchWorkspaceName: fetchWorkspaceName(apiBaseUrl),
    }),
    managementApiClientConfig: {
      clientId: CLIENT_ID,
      redirectUri: DEFAULT_REDIRECT_URI,
      apiBaseUrl,
      authBaseUrl: getAuthBaseUrl(proc.env),
    },
    spawn: spawnChild,
    /** The engine has already decided and composed; the bin only forks
     *  the detached sender and hands the payload over. Every failure is
     *  swallowed inside runTelemetry. */
    spawnTelemetry: (payload) => {
      runTelemetry({ payload, senderPath: resolveSenderPath() });
    },
    openUrl: async (url) => {
      await open(url);
    },
    managementApi: { baseUrl: apiBaseUrl },
    runPackageManager,
  };
}
