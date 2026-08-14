import { spawn } from "node:child_process";
import { type Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ChildResult, SpawnChild } from "@prisma/cli-engine";

interface DiagnosticStream {
  write(text: string): unknown;
  once?(event: "drain", listener: () => void): unknown;
}

type ForwardingResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly cause: unknown };

/**
 * The engine's spawn seam, adapted to node:child_process. Human mode
 * inherits stdio; structured mode pipes both child output streams to
 * diagnostics. Neither mode detaches or opens a new console, so the child
 * stays in this process's group (POSIX) or console (Windows).
 */
export function makeSpawnChild(diagnostics: DiagnosticStream): SpawnChild {
  return (request) => {
    const structured = request.output === "diagnostic";
    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: request.env,
      stdio: structured ? ["inherit", "pipe", "pipe"] : "inherit",
    });
    const forwarding = forwardStructuredOutput(
      structured,
      child.stdout,
      child.stderr,
      diagnostics,
    );
    const processEnded = new Promise<ChildResult>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (exitCode, signal) => {
        resolve({ exitCode, signal });
      });
    });
    return {
      ended: processEnded.then(async (result) => {
        const output = await forwarding;
        if (!output.ok) throw output.cause;
        return result;
      }),
      kill: (signal) => {
        child.kill(signal);
      },
    };
  };
}

function forwardStructuredOutput(
  structured: boolean,
  stdout: Readable | null,
  stderr: Readable | null,
  diagnostics: DiagnosticStream,
): Promise<ForwardingResult> {
  if (!structured) return Promise.resolve({ ok: true });
  if (stdout === null || stderr === null) {
    return Promise.resolve({
      ok: false,
      cause: new Error("structured child output streams were not piped"),
    });
  }
  return Promise.all([
    forwardOutput(stdout, diagnostics),
    forwardOutput(stderr, diagnostics),
  ]).then(
    (): ForwardingResult => ({ ok: true }),
    (cause: unknown): ForwardingResult => ({ ok: false, cause }),
  );
}

/** Decode each child stream continuously and stop reading while the
 * diagnostic destination applies backpressure. The child status does not
 * settle until both streams have fully drained. */
function forwardOutput(
  source: Readable,
  diagnostics: DiagnosticStream,
): Promise<void> {
  const destination = new Writable({
    decodeStrings: false,
    write: (text: string, _encoding, done) => {
      try {
        if (
          diagnostics.write(text) === false &&
          diagnostics.once !== undefined
        ) {
          diagnostics.once("drain", () => done());
        } else {
          done();
        }
      } catch (cause) {
        done(cause instanceof Error ? cause : new Error(String(cause)));
      }
    },
  });
  return pipeline(source.setEncoding("utf8"), destination);
}
