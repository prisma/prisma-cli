import type { Readable } from "node:stream";
import type { PackageManagerRunner } from "@prisma/cli-engine";
import { execa } from "execa";

const STDERR_TAIL_BYTES = 64 * 1024;

/** A missing executable or a signal kill leaves the child with no exit
 *  code of its own; the run still failed, and the engine reports it. */
const NO_EXIT_CODE = 1;

function boundedTail(limit: number) {
  let bytes = Buffer.alloc(0);
  return {
    push(chunk: Buffer): void {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > limit) {
        bytes = bytes.subarray(bytes.length - limit);
      }
    },
    text: (): string => bytes.toString("utf8"),
  };
}

/** Decodes across chunk boundaries, so a multi-byte character split by
 *  the pipe is not delivered as two replacement characters. */
function forward(
  source: Readable,
  emit: (text: string) => void,
  keep?: (chunk: Buffer) => void,
): void {
  const decoder = new TextDecoder();
  source.on("data", (chunk: Buffer) => {
    keep?.(chunk);
    const text = decoder.decode(chunk, { stream: true });
    if (text !== "") {
      emit(text);
    }
  });
}

/**
 * Spawns the package manager the engine composed. Its output streams
 * out as the child writes it; its stderr also comes back bounded for
 * the caller's failure predicate. Every failure — a non-zero exit, an
 * executable that is not installed, an abort — resolves.
 */
export const runPackageManager: PackageManagerRunner = async ({
  file,
  args,
  cwd,
  signal,
  onOutput,
}) => {
  const tail = boundedTail(STDERR_TAIL_BYTES);
  const subprocess = execa(file, [...args], {
    cwd,
    cancelSignal: signal,
    stdin: "ignore",
    buffer: false,
    reject: false,
  });
  forward(subprocess.stdout, (text) => onOutput("data", text));
  forward(subprocess.stderr, (text) => onOutput("diagnostic", text), tail.push);
  const result = await subprocess;
  const written = tail.text();
  return {
    exitCode: result.exitCode ?? NO_EXIT_CODE,
    // A child that never started wrote nothing, and why it never
    // started is the only account of the failure anyone gets.
    stderr: written === "" ? (result.shortMessage ?? "") : written,
  };
};
