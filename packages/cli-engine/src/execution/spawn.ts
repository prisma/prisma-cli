import type { AnyCommand } from "../commands";
import { credentialsRequiredError } from "../credential-errors";
import {
  SERVICE_TOKEN_ENV_VAR,
  WORKSPACE_ID_ENV_VAR,
} from "../credential-manager";
import type { EngineEvent } from "../events";
import { CliStructuredError } from "../protocol";
import type {
  ChildResult,
  SpawnChild,
  SpawnedChild,
  SpawnOptions,
  SpawnRequest,
} from "../spawn";
import { constructionError } from "./command-tree";
import { makeDebugLog } from "./debug";
import type { Invocation } from "./engine";
import { firstLine } from "./rendering";
import { flushBufferedEvents } from "./reporting";

/**
 * D1 ruling (S3): how long a child terminated by a programmatic abort
 * has to exit on its own after SIGTERM before the engine sends SIGKILL.
 */
export const CHILD_TERMINATION_GRACE_MS = 5_000;

/** The delegated terminal's control block, held on the run state while
 *  a child owns the terminal. Three subsystems consult it, and what
 *  they care about is the delegation, not the process: signal delivery
 *  records instead of acting, reporting buffers instead of writing,
 *  and presentation refuses. */
export interface DelegatedTerminal {
  readonly recorded: ("SIGINT" | "SIGTERM")[];
  readonly buffered: EngineEvent[];
  dropped: number;
  child: SpawnedChild | undefined;
  /** Aborted to end a child the handler walked away from; the
   *  termination ladder arms on it exactly as it does on ctx.signal, so
   *  a child that has not attached yet is still terminated on attach. */
  readonly termination: AbortController;
  /** Resolves when the delegated window has fully closed — the child
   *  ended and the buffered events were flushed. Never rejects. */
  ended: Promise<void>;
}

/** A signal delivered while a child owns the terminal: recorded for
 *  replay, never acted on. SIGTERM has no native path to the child —
 *  supervisors signal the engine's pid — so it is forwarded (a SIGTERM
 *  recorded before the adapter has returned the child is forwarded the
 *  moment it attaches). A SECOND recorded signal forwards SIGTERM too:
 *  when the engine was signalled directly (no process group delivered
 *  the first press to the child), the second press is the user's
 *  escalation, and without the forward the child would be unreachable. */
export function recordSignalDuringSpawn(
  terminal: DelegatedTerminal,
  signal: "SIGINT" | "SIGTERM",
): void {
  terminal.recorded.push(signal);
  if (signal === "SIGTERM" || terminal.recorded.length > 1) {
    terminal.child?.kill("SIGTERM");
  }
}

export function makeSpawn(
  invocation: Invocation,
  def: AnyCommand,
): (options: SpawnOptions) => Promise<ChildResult> {
  return async (options) => {
    const state = invocation.state;
    if (!def.maySpawn) {
      throw constructionError(
        `command '${state.commandId}' called ctx.spawn without declaring maySpawn`,
      );
    }
    if (state.delegatedTerminal !== undefined) {
      throw constructionError(
        `command '${state.commandId}' called ctx.spawn while a child was still live (one live child per run)`,
      );
    }
    if (state.activePrompts > 0) {
      throw constructionError(
        `command '${state.commandId}' called ctx.spawn while a prompt owned the terminal`,
      );
    }
    if (state.packageOperationRunning) {
      throw constructionError(
        `command '${state.commandId}' called ctx.spawn while a package operation was still running`,
      );
    }
    const spawnChild = invocation.runtime.spawn;
    if (spawnChild === undefined) {
      throw new Error(
        "@prisma/cli-engine: the command declares maySpawn but the Runtime supplies no spawn adapter",
      );
    }
    // Claimed before the first await: a second ctx.spawn issued in the
    // same turn must see a live child, not a gap.
    const terminal: DelegatedTerminal = {
      recorded: [],
      buffered: [],
      dropped: 0,
      child: undefined,
      termination: new AbortController(),
      ended: Promise.resolve(),
    };
    state.delegatedTerminal = terminal;
    const running = runDelegated(
      invocation,
      def,
      terminal,
      spawnChild,
      options,
    );
    // Recorded in the same turn the terminal is claimed, so a handler
    // that abandons the promise still leaves the engine a handle to
    // wait on. The catch also keeps an abandoned rejection handled.
    terminal.ended = running.then(
      () => undefined,
      () => undefined,
    );
    return await running;
  };
}

async function runDelegated(
  invocation: Invocation,
  def: AnyCommand,
  terminal: DelegatedTerminal,
  spawnChild: SpawnChild,
  options: SpawnOptions,
): Promise<ChildResult> {
  const state = invocation.state;
  const debug = makeDebugLog(invocation.runtime);
  try {
    const request: SpawnRequest = {
      command: options.command,
      args: options.args ?? [],
      cwd: options.cwd ?? invocation.runtime.cwd,
      env: await composeChildEnv(invocation, def, options.env),
      output: state.format === "json" ? "diagnostic" : "inherit",
    };
    debug(
      `spawn: ${request.command} ${request.args.join(" ")} (cwd ${request.cwd})`,
    );
    const result = await runChild(invocation, terminal, spawnChild, request);
    debug(
      `spawn ended: exitCode=${String(result.exitCode)} signal=${String(result.signal)} recorded=[${terminal.recorded.join(",")}]`,
    );
    return result;
  } finally {
    state.delegatedTerminal = undefined;
    // The engine waits for an abandoned child before it settles, so the
    // run is still open here in every ordinary case. A spawn started by
    // detached work the handler left running is the exception: it ends
    // after settlement, and its backlog has nowhere valid to go.
    if (!state.resolved) {
      flushBufferedEvents(invocation, terminal);
      replayRecordedSignals(invocation, terminal.recorded);
    }
  }
}

/** A handler that resolved or threw with its child still live: the
 *  engine ends the child on the abort ladder and waits for it, because
 *  the engine outliving the child is not negotiable. */
export async function endAbandonedChild(
  terminal: DelegatedTerminal,
): Promise<void> {
  terminal.termination.abort();
  await terminal.ended;
}

async function runChild(
  invocation: Invocation,
  terminal: DelegatedTerminal,
  spawnChild: SpawnChild,
  request: SpawnRequest,
): Promise<ChildResult> {
  let child: SpawnedChild;
  try {
    child = spawnChild(request);
  } catch (cause) {
    throw spawnFailedError(request.command, cause);
  }
  terminal.child = child;
  if (terminal.recorded.includes("SIGTERM") || terminal.recorded.length > 1) {
    child.kill("SIGTERM");
  }
  const ended = new AbortController();
  armTerminationLadder(invocation, terminal, child, ended.signal);
  try {
    return recordCompletedChild(invocation, await child.ended);
  } catch (cause) {
    throw spawnFailedError(request.command, cause);
  } finally {
    ended.abort();
  }
}

/** The engine mints the result the handler sees and keeps it on the
 *  run: the settlement then reads the child's status from the engine's
 *  own record rather than from anything the handler hands back, and a
 *  handler whose spawn sits deep in its own layering can still ask how
 *  the child ended through ctx.lastChild(). */
function recordCompletedChild(
  invocation: Invocation,
  ended: ChildResult,
): ChildResult {
  const result = Object.freeze({
    exitCode: ended.exitCode,
    signal: ended.signal,
  });
  invocation.state.lastChild = result;
  return result;
}

/** A programmatic abort of ctx.signal (a delivered signal is recorded
 *  instead), or the engine ending a child the handler abandoned,
 *  terminates the child: SIGTERM, the grace period, SIGKILL. */
function armTerminationLadder(
  invocation: Invocation,
  terminal: DelegatedTerminal,
  child: SpawnedChild,
  ended: AbortSignal,
): void {
  const debug = makeDebugLog(invocation.runtime);
  const terminate = async (): Promise<void> => {
    if (ended.aborted) {
      return;
    }
    debug(`spawn abort ladder: SIGTERM, ${CHILD_TERMINATION_GRACE_MS}ms grace`);
    child.kill("SIGTERM");
    await invocation.delay(CHILD_TERMINATION_GRACE_MS, ended);
    if (!ended.aborted) {
      debug("spawn abort ladder: grace elapsed, SIGKILL");
      child.kill("SIGKILL");
    }
  };
  const trigger = AbortSignal.any([
    invocation.signal,
    terminal.termination.signal,
  ]);
  if (trigger.aborted) {
    void terminate();
    return;
  }
  trigger.addEventListener("abort", () => void terminate(), {
    once: true,
    signal: ended,
  });
}

/** The recorded signals enter the engine's normal ladder: the first
 *  aborts ctx.signal as if just delivered, so the handler resumes from
 *  ctx.spawn already aborted. A signal past that point arms the force
 *  exit, which fires once the run has settled — the turn the handler's
 *  cleanup was owed, with telemetry delivered. When ctx.signal already
 *  aborted BEFORE the spawn, the first recorded signal is effectively
 *  the second overall and arms the force exit the same way: no path
 *  force-exits from inside ctx.spawn. */
function replayRecordedSignals(
  invocation: Invocation,
  recorded: readonly ("SIGINT" | "SIGTERM")[],
): void {
  if (recorded.length === 0) {
    return;
  }
  const state = invocation.state;
  if (invocation.signal.aborted) {
    state.pendingForceExit ??= recorded[0];
    return;
  }
  invocation.deliverSignal(recorded[0]);
  if (recorded.length > 1) {
    state.pendingForceExit = recorded[1];
  }
}

async function composeChildEnv(
  invocation: Invocation,
  def: AnyCommand,
  additions: Readonly<Record<string, string | undefined>> | undefined,
): Promise<Readonly<Record<string, string | undefined>>> {
  const env: Record<string, string | undefined> = {
    ...invocation.runtime.env,
    ...additions,
  };
  if (def.needs.credentials !== "child") {
    return env;
  }
  const credential = invocation.state.spawnCredential;
  if (credential === undefined) {
    throw credentialsRequiredError();
  }
  env[SERVICE_TOKEN_ENV_VAR] = await spawnToken(invocation);
  if (credential.workspaceId !== undefined) {
    env[WORKSPACE_ID_ENV_VAR] = credential.workspaceId;
  } else {
    // The two variables are one credential protocol, written as a
    // unit: a credential that names no workspace must not leave an
    // inherited PRISMA_WORKSPACE_ID paired with its token.
    delete env[WORKSPACE_ID_ENV_VAR];
  }
  return env;
}

/**
 * The child's copy of the credential: the manager's activeAccessToken()
 * operation, read fresh at spawn time. The near-expiry policy already ran
 * at preflight, before the handler; the spawn-time read refuses only a
 * token that is already expired, so a still-valid credential can never be
 * refused after the handler's pre-spawn work has created resources. The
 * refresh token is never injected: the child runs on a snapshot it cannot
 * refresh.
 */
async function spawnToken(invocation: Invocation): Promise<string> {
  const manager = invocation.runtime.credentialManager;
  if (manager === undefined) {
    throw credentialsRequiredError();
  }
  const accessToken = await manager.activeAccessToken({
    minimumValidityMs: 0,
    now: invocation.now(),
    signal: invocation.signal,
  });
  if (accessToken === null) {
    throw credentialsRequiredError("session-ended");
  }
  return accessToken;
}

function spawnFailedError(command: string, cause: unknown): CliStructuredError {
  return new CliStructuredError(
    "CLI.SPAWN_FAILED",
    `The program '${command}' could not be started.`,
    {
      why: firstLine(cause instanceof Error ? cause.message : String(cause)),
      nextActions: [
        {
          kind: "user-choice",
          label: `Make sure '${command}' is installed and on your PATH, then run the command again.`,
        },
      ],
      meta: { command },
    },
  );
}
