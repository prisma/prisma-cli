/**
 * The terminal handoff: the shapes ctx.spawn, the Runtime adapter, and
 * the child-status settlement are built from. The engine never imports
 * node:child_process — the bin injects an adapter satisfying SpawnChild.
 */

/** A fully composed child invocation. `env` is the child's COMPLETE
 *  environment: the engine has already merged the invocation
 *  environment, the handler's additions, and the credential variables. */
export interface SpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** How a child ended. A signal-killed child carries `signal` and a null
 *  `exitCode`; handlers branch on `signal` first — a signal-killed child
 *  is an abort, not a failure. */
export interface ChildResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
}

/** The live child an adapter returns. */
export interface SpawnedChild {
  /** Resolves when the child ends. Rejects when it could not be
   *  launched at all; the engine phrases that as CLI.SPAWN_FAILED. */
  readonly ended: Promise<ChildResult>;
  readonly kill: (signal: "SIGTERM" | "SIGKILL") => void;
}

/**
 * The Runtime seam. The adapter starts the child with INHERITED stdio,
 * in the caller's own process group (POSIX) / console (Windows) — no
 * `detached`, no new console — so the terminal delivers Ctrl-C to the
 * child natively.
 */
export type SpawnChild = (request: SpawnRequest) => SpawnedChild;

/** What a handler passes to ctx.spawn. */
export interface SpawnOptions {
  readonly command: string;
  readonly args?: readonly string[];
  /** Defaults to ctx.cwd. */
  readonly cwd?: string;
  /** Added to, and overriding, the invocation environment. The engine's
   *  credential variables are applied last and cannot be overridden. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export const CHILD_STATUS: unique symbol = Symbol.for(
  "@prisma/cli-engine.childStatus",
);

/**
 * The sanctioned settlement outcome for "exit with the child's status
 * verbatim": no envelope, the same settlement bypass server commands
 * use. Built exclusively by exitWithChildStatus.
 */
export interface ChildStatusSettlement {
  readonly [CHILD_STATUS]: true;
  readonly exitCode: number;
}

const SIGNAL_NUMBERS: Readonly<Record<string, number>> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGILL: 4,
  SIGTRAP: 5,
  SIGABRT: 6,
  SIGBUS: 7,
  SIGFPE: 8,
  SIGKILL: 9,
  SIGUSR1: 10,
  SIGSEGV: 11,
  SIGUSR2: 12,
  SIGPIPE: 13,
  SIGALRM: 14,
  SIGTERM: 15,
};

/** A signal-killed child settles 128 + the signal number; otherwise the
 *  child's own exit code, verbatim. */
export function exitWithChildStatus(child: ChildResult): ChildStatusSettlement {
  if (child.signal !== null) {
    return Object.freeze({
      [CHILD_STATUS]: true as const,
      exitCode: 128 + (SIGNAL_NUMBERS[child.signal] ?? 0),
    });
  }
  return Object.freeze({
    [CHILD_STATUS]: true as const,
    exitCode: child.exitCode ?? 0,
  });
}

export function isChildStatusSettlement(
  value: unknown,
): value is ChildStatusSettlement {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[CHILD_STATUS] === true
  );
}
