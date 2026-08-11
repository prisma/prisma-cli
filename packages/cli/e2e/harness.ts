/**
 * The real-API end-to-end harness.
 *
 * Every test here runs the SHIPPED binary (`dist/v8/cli.js`) as a child
 * process against the real management API. Nothing is mocked, because
 * the whole point is to catch the things a mock cannot: the API's real
 * id formats, its real response shapes, and the real credential path.
 *
 * The unit suite missed `wksp_`-prefixed workspace ids for a year
 * because its fixtures supplied both sides of every comparison. A test
 * that writes both sides can only ever confirm what its author already
 * believed.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The built binary, not the TypeScript sources. A stale or misbuilt
 *  dist is itself a shipping defect, so the artifact under test is the
 *  one users get. */
export const CLI_BINARY = path.resolve(
  import.meta.dirname,
  "../dist/v8/cli.js",
);

/** Deliberately not PRISMA_SERVICE_TOKEN: these tests create and delete
 *  real resources, so they must never pick up whatever credential a
 *  developer happens to have exported for their own work. */
const TOKEN_ENV_VAR = "PRISMA_E2E_SERVICE_TOKEN";
const WORKSPACE_ENV_VAR = "PRISMA_E2E_WORKSPACE_ID";

/** Set in CI so a missing credential fails the build. Without it a
 *  silently skipped suite looks exactly like a passing one, which is
 *  how end-to-end coverage quietly dies. */
const REQUIRED_ENV_VAR = "PRISMA_E2E_REQUIRED";

export interface E2eCredentials {
  readonly serviceToken: string;
  readonly workspaceId: string | undefined;
}

export function e2eCredentials(): E2eCredentials | null {
  const serviceToken = process.env[TOKEN_ENV_VAR]?.trim();
  if (!serviceToken) {
    if (process.env[REQUIRED_ENV_VAR] === "1") {
      throw new Error(
        `${TOKEN_ENV_VAR} is unset but ${REQUIRED_ENV_VAR}=1. The real-API ` +
          "suite must not be skipped here.",
      );
    }
    return null;
  }
  return {
    serviceToken,
    workspaceId: process.env[WORKSPACE_ENV_VAR]?.trim() || undefined,
  };
}

export interface CliRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** The terminal `result` frame of the `--json` stream. */
  readonly envelope: ResultEnvelope;
}

export interface ResultEnvelope {
  readonly ok: boolean;
  readonly commandId?: string;
  readonly result?: unknown;
  readonly error?: { readonly code?: string; readonly summary?: string };
  readonly exitCode?: number;
}

export interface RunOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Assert a successful envelope before returning. On by default: a
   *  happy-path test that forgets to check `ok` proves nothing. */
  readonly expectOk?: boolean;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * The child's environment is built from nothing rather than inherited.
 * An inherited HOME would let a developer's stored `auth.json` satisfy
 * a command that would have no credential in CI — the test would pass
 * on the laptop and fail, or worse silently degrade, everywhere else.
 */
function childEnvironment(
  credentials: E2eCredentials,
  home: string,
  extra: Readonly<Record<string, string | undefined>> = {},
): Record<string, string> {
  const base: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: process.env.TMPDIR,
    PRISMA_SERVICE_TOKEN: credentials.serviceToken,
    ...(credentials.workspaceId === undefined
      ? {}
      : { PRISMA_WORKSPACE_ID: credentials.workspaceId }),
    // Keep the first-run consent notice out of stdout, and keep these
    // runs out of the telemetry stream.
    PRISMA_NEXT_DISABLE_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    // A hosted CI runner has no browser and no operator; any command
    // that would prompt must fail loudly instead of hanging.
    CI: "1",
    ...extra,
  };
  return Object.fromEntries(
    Object.entries(base).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

/** The `--json` stream is one JSON object per line; the run's verdict is
 *  the terminal `result` frame. */
function parseResultFrame(stdout: string): ResultEnvelope {
  const frames = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as { kind?: string; envelope?: unknown }];
      } catch {
        return [];
      }
    });
  const result = frames.reverse().find((frame) => frame.kind === "result");
  if (result?.envelope === undefined) {
    throw new Error(
      `no terminal result frame in CLI output:\n${stdout.slice(0, 2000)}`,
    );
  }
  return result.envelope as ResultEnvelope;
}

export class E2eSession {
  readonly #credentials: E2eCredentials;
  readonly #home: string;
  readonly #workdirs: string[] = [];

  private constructor(credentials: E2eCredentials, home: string) {
    this.#credentials = credentials;
    this.#home = home;
  }

  static async open(credentials: E2eCredentials): Promise<E2eSession> {
    const home = await mkdtemp(path.join(os.tmpdir(), "prisma-e2e-home-"));
    return new E2eSession(credentials, home);
  }

  async close(): Promise<void> {
    await Promise.all(
      [this.#home, ...this.#workdirs].map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
    this.#workdirs.length = 0;
  }

  /** A throwaway working directory, so `.prisma/local.json` written by
   *  one test cannot change what another test resolves. Tracked so that
   *  close() takes them with it — several suites call this per test, and
   *  each one left a directory holding a project pin behind. */
  async workdir(): Promise<string> {
    const created = await mkdtemp(path.join(os.tmpdir(), "prisma-e2e-cwd-"));
    this.#workdirs.push(created);
    return created;
  }

  async run(
    args: readonly string[],
    options: RunOptions = {},
  ): Promise<CliRun> {
    // An unbuilt dist made every test here fail with "no terminal result
    // frame", which reads like the CLI misbehaving rather than like a
    // missing artifact. Say which it is.
    if (!existsSync(CLI_BINARY)) {
      throw new Error(
        `the CLI is not built: ${CLI_BINARY} does not exist. Run \`pnpm build\` first.`,
      );
    }
    const cwd = options.cwd ?? this.#home;
    const argv = args.includes("--json") ? [...args] : [...args, "--json"];

    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    try {
      const done = await execFileAsync(
        process.execPath,
        [CLI_BINARY, ...argv],
        {
          cwd,
          env: childEnvironment(this.#credentials, this.#home, options.env),
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: 32 * 1024 * 1024,
        },
      );
      stdout = done.stdout;
      stderr = done.stderr;
    } catch (failure) {
      const spawned = failure as {
        code?: number;
        stdout?: string;
        stderr?: string;
        killed?: boolean;
      };
      if (spawned.stdout === undefined) throw failure;
      // A timed-out child was killed, so its output stops mid-stream and
      // carries no result frame. Left alone that surfaces as "no
      // terminal result frame", which blames the CLI for the clock.
      if (spawned.killed === true) {
        const limit = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        throw new Error(
          `\`${argv.join(" ")}\` was killed after ${limit}ms\n` +
            `${(spawned.stderr ?? "").slice(0, 2000)}`,
        );
      }
      stdout = spawned.stdout;
      stderr = spawned.stderr ?? "";
      exitCode = typeof spawned.code === "number" ? spawned.code : 1;
    }

    const envelope = parseResultFrame(stdout);
    if (options.expectOk !== false && !envelope.ok) {
      throw new Error(
        `expected \`${argv.join(" ")}\` to succeed, but it failed with ` +
          `${envelope.error?.code ?? "(no code)"}: ` +
          `${envelope.error?.summary ?? "(no summary)"}\n${stderr.slice(0, 2000)}`,
      );
    }
    return { exitCode, stdout, stderr, envelope };
  }
}

/** Names every resource this run creates, so cleanup can recognise its
 *  own litter and a stray failure can never delete something a human
 *  made. These are the only prefixes cleanup will ever remove. */
export const SCRATCH_PREFIX = "e2e-";

/** The same marker for resources that reject hyphens — a Postgres
 *  database name among them. Anything sweeping a workspace for leftovers
 *  has to look for both forms, so both live here rather than being
 *  spelled out at a call site. */
export const SCRATCH_PREFIX_UNDERSCORE = "e2e_";

export function scratchName(label: string): string {
  const stamp = Date.now().toString(36);
  const salt = Math.random().toString(36).slice(2, 8);
  return `${SCRATCH_PREFIX}${label}-${stamp}-${salt}`;
}

/** `scratchName` in the underscore form, still recognisable as ours. */
export function scratchDatabaseName(label: string): string {
  return scratchName(label).replaceAll("-", "_");
}

export function isScratchName(name: string): boolean {
  return (
    name.startsWith(SCRATCH_PREFIX) ||
    name.startsWith(SCRATCH_PREFIX_UNDERSCORE)
  );
}
