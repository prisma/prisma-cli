import {
  type HostProcess,
  type InputStream,
  loadConfig,
  type Runtime,
} from "@prisma/cli-engine";
import open from "open";
import {
  CLIENT_ID,
  DEFAULT_REDIRECT_URI,
  DEPRECATED_STATE_FILE_ENV_VAR,
  FileCredentialManager,
  fetchWorkspaceName,
  getApiBaseUrl,
  getAuthBaseUrl,
  resolveStateFilePath,
  STATE_FILE_ENV_VAR,
} from "../auth";

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

export function detectPackageManager(
  env: NodeJS.ProcessEnv,
): Runtime["packageManager"] {
  const userAgent = env.npm_config_user_agent ?? "";
  for (const name of ["pnpm", "yarn", "bun", "npm"] as const) {
    if (userAgent.startsWith(name)) {
      return name;
    }
  }
  return "unknown";
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
    config: await loadConfig(proc.cwd()),
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
    openUrl: async (url) => {
      await open(url);
    },
    managementApi: { baseUrl: apiBaseUrl },
    packageManager: detectPackageManager(proc.env),
  };
}
