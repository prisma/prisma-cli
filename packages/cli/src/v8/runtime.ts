import {
  type Credentials,
  type HostProcess,
  type InputStream,
  loadConfig,
  type Runtime,
} from "@prisma/cli-engine";
import { FileTokenStorage } from "../adapters/token-storage";
import { SERVICE_TOKEN_ENV_VAR } from "../lib/auth/client";

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

/** Token reads ignore the run's abort signal so they still work during
 *  teardown after the first Ctrl-C. */
export function makeGetCredentials(
  env: NodeJS.ProcessEnv,
): () => Promise<Credentials | undefined> {
  return async () => {
    const serviceToken = env[SERVICE_TOKEN_ENV_VAR]?.trim();
    if (serviceToken) {
      return { token: serviceToken };
    }
    const tokens = await new FileTokenStorage(env).getTokens();
    return tokens ? { token: tokens.accessToken } : undefined;
  };
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
    getCredentials: makeGetCredentials(proc.env),
    packageManager: detectPackageManager(proc.env),
  };
}
