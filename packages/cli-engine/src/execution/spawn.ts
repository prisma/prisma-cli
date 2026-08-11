import type { AnyCommand } from "../commands";
import { credentialsRequiredError } from "../credential-errors";
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

const SERVICE_TOKEN_ENV_VAR = "PRISMA_SERVICE_TOKEN";
const WORKSPACE_ID_ENV_VAR = "PRISMA_WORKSPACE_ID";

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
    const debug = makeDebugLog(invocation.runtime);
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
    };
    state.delegatedTerminal = terminal;
    try {
      const request: SpawnRequest = {
        command: options.command,
        args: options.args ?? [],
        cwd: options.cwd ?? invocation.runtime.cwd,
        env: await composeChildEnv(invocation, def, options.env),
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
      // A handler that abandoned the spawn promise has already settled
      // the run by the time the child ends; its backlog has nowhere
      // valid to go and is dropped rather than reported as late bugs.
      if (!state.resolved) {
        flushBufferedEvents(invocation, terminal);
        replayRecordedSignals(invocation, terminal.recorded);
      }
    }
  };
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
  armTerminationLadder(invocation, child, ended.signal);
  try {
    return await child.ended;
  } catch (cause) {
    throw spawnFailedError(request.command, cause);
  } finally {
    ended.abort();
  }
}

/** A programmatic abort of ctx.signal (a delivered signal is recorded
 *  instead) terminates the child: SIGTERM, the grace period, SIGKILL. */
function armTerminationLadder(
  invocation: Invocation,
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
  if (invocation.signal.aborted) {
    void terminate();
    return;
  }
  invocation.signal.addEventListener("abort", () => void terminate(), {
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
 * operation, read at spawn time. The refresh token is never injected:
 * the child runs on a snapshot it cannot refresh.
 */
async function spawnToken(invocation: Invocation): Promise<string> {
  const manager = invocation.runtime.credentialManager;
  if (manager === undefined) {
    throw credentialsRequiredError();
  }
  const accessToken = await manager.activeAccessToken();
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
