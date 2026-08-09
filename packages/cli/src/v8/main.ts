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
  exit(code: number): void;
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

/** First signal aborts the run; a second one force-exits (130/143). */
export function wireSignals(
  proc: SignalProcess,
  controller: AbortController,
): void {
  let delivered = false;
  const onSignal = (name: "SIGINT" | "SIGTERM"): void => {
    if (delivered) {
      proc.exit(name === "SIGINT" ? 130 : 143);
      return;
    }
    delivered = true;
    controller.abort(name);
  };
  proc.on("SIGINT", () => onSignal("SIGINT"));
  proc.on("SIGTERM", () => onSignal("SIGTERM"));
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

/** Token reads ignore the run signal so they still work during teardown
 *  after the first Ctrl-C. */
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

export async function assembleRuntime(
  proc: ProcessLike,
  signal: AbortSignal,
): Promise<Runtime> {
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
    signal,
    config: await loadConfig(proc.cwd()),
    getCredentials: makeGetCredentials(proc.env),
    packageManager: detectPackageManager(proc.env),
  };
}

/** The bin body: build, wire signals, run, return the exit code. A
 *  construction error prints one line to stderr and exits 1. */
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
  const controller = new AbortController();
  wireSignals(proc, controller);
  const runtime = await assembleRuntime(proc, controller.signal);
  return cli.run(proc.argv.slice(2), runtime);
}
