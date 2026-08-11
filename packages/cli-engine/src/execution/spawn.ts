import {
  type AnyCommand,
  commandMaySpawn,
  commandNeedsCredentialsForSpawn,
} from "../commands";
import { credentialsRequiredError } from "../credential-errors";
import type { ActiveCredential } from "../credential-manager";
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

/**
 * D1 ruling (S3): a session expiring within this window is refused
 * before the handler runs. The child receives a snapshot of the token
 * and cannot refresh it, and the in-process work that precedes the
 * spawn creates platform resources, so the refusal has to come first.
 */
export const CREDENTIAL_NEAR_EXPIRY_MS = 5 * 60_000;

/** The live child's control block, held on the run state so the
 *  engine's signal policy and the reporting path can see it. */
export interface LiveSpawn {
  readonly recorded: ("SIGINT" | "SIGTERM")[];
  readonly buffered: EngineEvent[];
  child: SpawnedChild | undefined;
}

/** A signal delivered while a child owns the terminal: recorded for
 *  replay, never acted on. SIGTERM has no native path to the child —
 *  supervisors signal the engine's pid — so it is forwarded (a SIGTERM
 *  recorded before the adapter has returned the child is forwarded the
 *  moment it attaches). */
export function recordSignalDuringSpawn(
  live: LiveSpawn,
  signal: "SIGINT" | "SIGTERM",
): void {
  live.recorded.push(signal);
  if (signal === "SIGTERM") {
    live.child?.kill("SIGTERM");
  }
}

export function makeSpawn(
  invocation: Invocation,
  def: AnyCommand,
): (options: SpawnOptions) => Promise<ChildResult> {
  return async (options) => {
    const state = invocation.state;
    if (!commandMaySpawn(def)) {
      throw constructionError(
        `command '${state.commandId}' called ctx.spawn without declaring maySpawn`,
      );
    }
    if (state.liveSpawn !== undefined) {
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
    const live: LiveSpawn = { recorded: [], buffered: [], child: undefined };
    state.liveSpawn = live;
    try {
      const request: SpawnRequest = {
        command: options.command,
        args: options.args ?? [],
        cwd: options.cwd ?? invocation.runtime.cwd,
        env: await composeChildEnv(invocation, def, options.env),
      };
      return await runChild(invocation, live, spawnChild, request);
    } finally {
      state.liveSpawn = undefined;
      flushBufferedEvents(invocation, live.buffered);
      replayRecordedSignals(invocation, live.recorded);
    }
  };
}

async function runChild(
  invocation: Invocation,
  live: LiveSpawn,
  spawnChild: SpawnChild,
  request: SpawnRequest,
): Promise<ChildResult> {
  let child: SpawnedChild;
  try {
    child = spawnChild(request);
  } catch (cause) {
    throw spawnFailedError(request.command, cause);
  }
  live.child = child;
  if (live.recorded.includes("SIGTERM")) {
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
  const terminate = async (): Promise<void> => {
    if (ended.aborted) {
      return;
    }
    child.kill("SIGTERM");
    await invocation.delay(CHILD_TERMINATION_GRACE_MS, ended);
    if (!ended.aborted) {
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
 *  ctx.spawn already aborted. A second arms the force exit, which fires
 *  once the handler has resolved — the turn its cleanup was owed. */
function replayRecordedSignals(
  invocation: Invocation,
  recorded: readonly ("SIGINT" | "SIGTERM")[],
): void {
  if (recorded.length === 0) {
    return;
  }
  invocation.deliverSignal(recorded[0]);
  if (recorded.length > 1) {
    invocation.state.pendingForceExit = recorded[1];
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
  if (!commandNeedsCredentialsForSpawn(def)) {
    return env;
  }
  const credential = await activeSpawnCredential(invocation);
  env[SERVICE_TOKEN_ENV_VAR] = await spawnToken(invocation);
  if (credential.workspaceId !== undefined) {
    env[WORKSPACE_ID_ENV_VAR] = credential.workspaceId;
  }
  return env;
}

export async function activeSpawnCredential(
  invocation: Invocation,
): Promise<ActiveCredential> {
  const manager = invocation.runtime.credentialManager;
  if (manager === undefined) {
    throw credentialsRequiredError();
  }
  const credential = await manager.activeCredential();
  if (credential === null) {
    throw credentialsRequiredError();
  }
  return credential;
}

/**
 * The child's copy of the credential: the active credential's access
 * token, read at spawn time through `activeCredentialStorage()` — the
 * ONE place engine code calls a method on that storage
 * (credential-manager-design.md §11.5). The refresh token is never
 * injected: the child runs on a snapshot it cannot refresh.
 */
async function spawnToken(invocation: Invocation): Promise<string> {
  const manager = invocation.runtime.credentialManager;
  if (manager === undefined) {
    throw credentialsRequiredError();
  }
  const storage = await manager.activeCredentialStorage();
  const tokens = await storage.getTokens();
  if (tokens === null) {
    throw credentialsRequiredError("session-ended");
  }
  return tokens.accessToken;
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
