import type { ChildProcess } from "node:child_process";
import { type Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ChildResult, SpawnChild, SpawnedChild } from "@prisma/cli-engine";
import spawn from "cross-spawn";

interface DiagnosticStream {
  write(text: string): unknown;
  once?(
    event: "drain" | "error" | "close",
    listener: (cause?: unknown) => void,
  ): unknown;
  off?(
    event: "drain" | "error" | "close",
    listener: (cause?: unknown) => void,
  ): unknown;
}

/** How long after the child exits the relay keeps reading its pipes. A
 *  grandchild that inherited them can hold EOF back forever; settlement
 *  must not wait on it, so the pipes are destroyed after this grace. */
const POST_EXIT_DRAIN_GRACE_MS = 5_000;

export interface SpawnChildOptions {
  readonly drainGraceMs?: number;
}

/**
 * The engine's spawn seam, adapted through cross-spawn. Human mode
 * inherits stdio; structured mode pipes both child output streams to
 * diagnostics; engine mode returns both to the engine. No mode detaches or
 * opens a new console, so the child stays in this process's group
 * (POSIX) or console (Windows).
 *
 * The child's own status settles the run: `ended` resolves from the
 * process `exit` event, waits for the diagnostic relay only up to the
 * drain grace, and never rejects for a relay failure — rejection is
 * reserved for a child that could not be launched at all.
 */
export function makeSpawnChild(
  diagnostics: DiagnosticStream,
  options?: SpawnChildOptions,
): SpawnChild {
  const drainGraceMs = options?.drainGraceMs ?? POST_EXIT_DRAIN_GRACE_MS;
  return (request) => {
    const structured = request.output === "diagnostic";
    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: request.env,
      stdio:
        request.output === "inherit" ? "inherit" : ["inherit", "pipe", "pipe"],
    });
    const processEnded = new Promise<ChildResult>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (exitCode, signal) => {
        resolve({ exitCode, signal });
      });
    });
    const kill = (signal: "SIGTERM" | "SIGKILL") => {
      child.kill(signal);
    };
    if (request.output === "engine") {
      return engineReadChild(child, kill, processEnded, drainGraceMs);
    }
    if (!structured) {
      return {
        ended: processEnded,
        kill: (signal) => {
          child.kill(signal);
        },
      };
    }
    const forwarding = forwardStructuredOutput(
      child.stdout,
      child.stderr,
      diagnostics,
    );
    return {
      ended: processEnded.then(async (result) => {
        const drainDeadline = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
        }, drainGraceMs);
        await forwarding;
        clearTimeout(drainDeadline);
        return result;
      }),
      kill: (signal) => {
        child.kill(signal);
      },
    };
  };
}

/** The engine reads both pipes. A grandchild that inherited them can
 *  hold them open after the child exits, so a pipe the engine has
 *  waited on with no output for the drain grace is closed, with an
 *  error that says why. Time the engine spends not reading, because
 *  its destination is slow, does not count. */
function engineReadChild(
  child: ChildProcess,
  kill: SpawnedChild["kill"],
  processEnded: Promise<ChildResult>,
  drainGraceMs: number,
): SpawnedChild {
  const exited = processEnded.then(
    () => undefined,
    () => undefined,
  );
  const sources = [child.stdout, child.stderr].filter(
    (source): source is Readable => source !== null,
  );
  const closed = Promise.all(
    sources.map((source) => {
      source.setEncoding("utf8");
      return new Promise((resolve) => source.once("close", resolve));
    }),
  );
  const readable = (source: Readable | null) =>
    source === null ? undefined : closeWhenIdle(source, exited, drainGraceMs);
  const stdout = readable(child.stdout);
  const stderr = readable(child.stderr);
  return {
    ended: processEnded.then(
      async (result) => {
        await closed;
        return result;
      },
      async (cause: unknown) => {
        await closed;
        throw cause;
      },
    ),
    kill,
    ...(stdout === undefined ? {} : { stdout }),
    ...(stderr === undefined ? {} : { stderr }),
  };
}

function closeWhenIdle(
  source: Readable,
  exited: Promise<void>,
  drainGraceMs: number,
): AsyncIterable<string> {
  let childExited = false;
  let waiting = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (childExited && waiting && deadline === undefined) {
      deadline = setTimeout(() => {
        source.destroy(
          new Error(
            `the pipe stayed open with no output for ${drainGraceMs}ms after the child exited, so it was closed`,
          ),
        );
      }, drainGraceMs);
    }
  };
  const disarm = () => {
    clearTimeout(deadline);
    deadline = undefined;
  };
  void exited.then(() => {
    childExited = true;
    arm();
  });
  return {
    [Symbol.asyncIterator]: () => {
      const chunks: AsyncIterator<string> = source[Symbol.asyncIterator]();
      return {
        next: async () => {
          waiting = true;
          arm();
          try {
            return await chunks.next();
          } finally {
            waiting = false;
            disarm();
          }
        },
        return: async () =>
          (await chunks.return?.()) ?? { done: true, value: undefined },
      };
    },
  };
}

/** Best-effort relay: a forwarding failure never rejects, so the child's
 *  real status still settles the run when the diagnostic sink dies. */
function forwardStructuredOutput(
  stdout: Readable | null,
  stderr: Readable | null,
  diagnostics: DiagnosticStream,
): Promise<void> {
  const sources = [stdout, stderr].filter(
    (source): source is Readable => source !== null,
  );
  return Promise.all(
    sources.map((source) => forwardOutput(source, diagnostics)),
  ).then(
    () => undefined,
    () => undefined,
  );
}

/** Decode each child stream continuously and stop reading while the
 *  diagnostic destination applies backpressure. A destination that
 *  errors or closes instead of draining fails the relay rather than
 *  stalling it. */
function forwardOutput(
  source: Readable,
  diagnostics: DiagnosticStream,
): Promise<void> {
  let pendingDone: ((cause?: Error) => void) | undefined;
  let pendingDrain: ((cause?: unknown) => void) | undefined;
  let failure: Error | undefined;
  const fail = (cause: Error) => {
    failure ??= cause;
    const done = pendingDone;
    pendingDone = undefined;
    done?.(cause);
  };
  const onSinkError = (cause?: unknown) => {
    fail(toError(cause));
  };
  const onSinkClose = () => {
    fail(new Error("the diagnostic stream closed during child output"));
  };
  diagnostics.once?.("error", onSinkError);
  diagnostics.once?.("close", onSinkClose);
  const destination = new Writable({
    decodeStrings: false,
    write: (text: string, _encoding, done) => {
      if (failure !== undefined) {
        done(failure);
        return;
      }
      try {
        if (
          diagnostics.write(text) === false &&
          diagnostics.once !== undefined
        ) {
          pendingDone = done;
          const onDrain = () => {
            pendingDrain = undefined;
            if (pendingDone !== done) return;
            pendingDone = undefined;
            done();
          };
          pendingDrain = onDrain;
          diagnostics.once("drain", onDrain);
        } else {
          done();
        }
      } catch (cause) {
        done(toError(cause));
      }
    },
  });
  // The diagnostic stream outlives this relay (it is the process's own
  // stderr), so every listener registered here is removed when the
  // pipeline settles — sequential children must not accumulate them.
  return pipeline(source.setEncoding("utf8"), destination).finally(() => {
    diagnostics.off?.("error", onSinkError);
    diagnostics.off?.("close", onSinkClose);
    if (pendingDrain !== undefined) diagnostics.off?.("drain", pendingDrain);
  });
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
