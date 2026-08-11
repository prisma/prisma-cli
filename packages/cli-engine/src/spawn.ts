/**
 * The terminal handoff: the shapes ctx.spawn, the Runtime adapter, and
 * the child-status settlement are built from. The engine never imports
 * node:child_process — the bin injects an adapter satisfying SpawnChild.
 */
import type { NextAction } from "./protocol";

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

/** Marks a ChildResult the engine watched a real child produce. */
const ENGINE_SPAWNED: unique symbol = Symbol.for(
  "@prisma/cli-engine.engineSpawned",
);

function markEngineSpawned<T extends object>(value: T): T {
  return Object.freeze(
    Object.defineProperty(value, ENGINE_SPAWNED, { value: true }),
  );
}

export function isEngineSpawned(value: object): boolean {
  return (value as Record<symbol, unknown>)[ENGINE_SPAWNED] === true;
}

/**
 * The child result ctx.spawn hands back: the engine mints it from what
 * the adapter reported, so a handler cannot pass off an invented one as
 * a child's status. exitWithChildStatus carries the mark onto its
 * settlement and the settlement refuses an unmarked one.
 */
export function engineSpawnedResult(result: ChildResult): ChildResult {
  return markEngineSpawned({
    exitCode: result.exitCode,
    signal: result.signal,
  });
}

/**
 * The sanctioned settlement outcome for "exit with the child's status
 * verbatim": no envelope, the same settlement bypass server commands
 * use. Built exclusively by exitWithChildStatus, and only settled by a
 * command that declares maySpawn, from a child result the engine
 * itself produced. `nextActions` render to stderr before the process
 * exits with the child's code.
 */
export interface ChildStatusSettlement {
  readonly [CHILD_STATUS]: true;
  readonly exitCode: number;
  readonly nextActions: readonly NextAction[];
}

export interface ExitWithChildStatusOptions {
  /** Engine-styled guidance printed to stderr before the exit — a
   *  failed converge's reproduce hint. The envelope stays absent. */
  readonly nextActions?: readonly NextAction[];
}

/** Signal numbers shared by Linux, macOS and the BSDs. Numbers that
 *  differ by platform (SIGBUS, SIGUSR1, SIGUSR2, …) are deliberately
 *  absent — a wrong 128+n is worse than the unknown-signal fallback. */
const SIGNAL_NUMBERS: Readonly<Record<string, number>> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGILL: 4,
  SIGTRAP: 5,
  SIGABRT: 6,
  SIGFPE: 8,
  SIGKILL: 9,
  SIGSEGV: 11,
  SIGPIPE: 13,
  SIGALRM: 14,
  SIGTERM: 15,
};

/** A signal-killed child settles 128 + the signal number; otherwise the
 *  child's own exit code, verbatim. Unknown is never success: a signal
 *  outside the portable table, or an adapter that cannot say how the
 *  child ended (exitCode and signal both null), settles 1. */
function childExitCode(child: ChildResult): number {
  if (child.signal === null) {
    return child.exitCode ?? 1;
  }
  const signalNumber = SIGNAL_NUMBERS[child.signal];
  return signalNumber === undefined ? 1 : 128 + signalNumber;
}

/** Settles the run with the status of the child `ctx.spawn` returned.
 *  A result the engine did not produce is a construction error at
 *  settlement: this is how a real child's status reaches the exit code,
 *  not how a handler picks one. */
export function exitWithChildStatus(
  child: ChildResult,
  options?: ExitWithChildStatusOptions,
): ChildStatusSettlement {
  const settlement = {
    [CHILD_STATUS]: true as const,
    exitCode: childExitCode(child),
    nextActions: Object.freeze([...(options?.nextActions ?? [])]),
  };
  return isEngineSpawned(child)
    ? markEngineSpawned(settlement)
    : Object.freeze(settlement);
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
