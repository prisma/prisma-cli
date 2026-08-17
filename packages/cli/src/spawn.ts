import { spawn } from "node:child_process";
import { type Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ChildResult, SpawnChild } from "@prisma/cli-engine";

interface DiagnosticStream {
  write(text: string): unknown;
  once?(
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
 * The engine's spawn seam, adapted to node:child_process. Human mode
 * inherits stdio; structured mode pipes both child output streams to
 * diagnostics. Neither mode detaches or opens a new console, so the child
 * stays in this process's group (POSIX) or console (Windows).
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
      stdio: structured ? ["inherit", "pipe", "pipe"] : "inherit",
    });
    const processEnded = new Promise<ChildResult>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (exitCode, signal) => {
        resolve({ exitCode, signal });
      });
    });
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
  let failure: Error | undefined;
  const fail = (cause: Error) => {
    failure ??= cause;
    const done = pendingDone;
    pendingDone = undefined;
    done?.(cause);
  };
  diagnostics.once?.("error", (cause) => {
    fail(toError(cause));
  });
  diagnostics.once?.("close", () => {
    fail(new Error("the diagnostic stream closed during child output"));
  });
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
          diagnostics.once("drain", () => {
            if (pendingDone !== done) return;
            pendingDone = undefined;
            done();
          });
        } else {
          done();
        }
      } catch (cause) {
        done(toError(cause));
      }
    },
  });
  return pipeline(source.setEncoding("utf8"), destination);
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
