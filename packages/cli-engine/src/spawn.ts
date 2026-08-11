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
 *  `exitCode`, and is an abort rather than a failure: exitWithChildStatus
 *  settles it as one, and a handler that reads the result itself branches
 *  on `signal` before `exitCode`. */
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
 * use. Built exclusively by exitWithChildStatus, and only settled by a
 * command that declares maySpawn. It carries no exit code, because the
 * code is not the handler's to state: the engine reads it off its own
 * record of the child. `nextActions` render to stderr before the
 * process exits with the child's code.
 */
export interface ChildStatusSettlement {
  readonly [CHILD_STATUS]: true;
  readonly nextActions: readonly NextAction[];
}

export interface ExitWithChildStatusOptions {
  /** Engine-styled guidance printed to stderr before the exit — a
   *  failed converge's reproduce hint. The envelope stays absent, and
   *  a signal-killed child drops these entirely: the user stopped the
   *  run, so there is nothing to reproduce. */
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
export function childExitCode(child: ChildResult): number {
  if (child.signal === null) {
    return child.exitCode ?? 1;
  }
  const signalNumber = SIGNAL_NUMBERS[child.signal];
  return signalNumber === undefined ? 1 : 128 + signalNumber;
}

/**
 * Settles the run with the status of the child the run spawned — the
 * one `ctx.lastChild()` reports. The handler names no child and no
 * code: this is how a real child's status reaches the exit code, not
 * how a handler picks one, so a run that spawned nothing is a
 * construction error at settlement.
 *
 * A signal-killed child overrules everything the caller asked for: it
 * settles 128 + the signal number with no `nextActions`, because the
 * user stopped the run and there is nothing to reproduce.
 */
export function exitWithChildStatus(
  options?: ExitWithChildStatusOptions,
): ChildStatusSettlement {
  return Object.freeze({
    [CHILD_STATUS]: true as const,
    nextActions: Object.freeze([...(options?.nextActions ?? [])]),
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
