import {
  type Cli,
  type Credentials,
  createCli,
  type InputStream,
  loadConfig,
  type Runtime,
} from "@prisma/cli-engine";
import { FileTokenStorage } from "../adapters/token-storage";
import { SERVICE_TOKEN_ENV_VAR } from "../lib/auth/client";
import { getCliVersion } from "../lib/version";
import { authWhoamiCommand } from "./auth/whoami";

export function buildCli(): Cli {
  return createCli({
    name: "prisma-v8",
    version: getCliVersion(),
    products: [{ commands: { whoami: authWhoamiCommand } }],
    groups: {
      auth: { brief: "Manage local authentication for the CLI" },
    },
    commands: {
      "auth whoami": authWhoamiCommand,
    },
  });
}

export interface SignalProcess {
  on(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  exit(code: number): never;
}

export interface ProcessLike extends SignalProcess {
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  cwd(): string;
  readonly stdout: { write(text: string): unknown; isTTY?: boolean };
  readonly stderr: { write(text: string): unknown; isTTY?: boolean };
  readonly stdin: {
    isTTY?: boolean;
    setRawMode?(enabled: boolean): unknown;
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array>;
  };
}

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

export async function assembleRuntime(proc: ProcessLike): Promise<Runtime> {
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

/** The bin body: build, run, return the exit code. Signal policy lives
 *  in the engine; the bin only forwards signals and provides
 *  process.exit. A construction error prints one line to stderr and
 *  exits 1. */
export async function main(
  proc: ProcessLike,
  buildCliForRun: () => Cli = buildCli,
): Promise<number> {
  let cli: Cli;
  try {
    cli = buildCliForRun();
  } catch (cause) {
    proc.stderr.write(
      `${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return 1;
  }
  const runtime = await assembleRuntime(proc);
  return cli.run(proc.argv.slice(2), runtime);
}
