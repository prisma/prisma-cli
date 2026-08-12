import type { Readable } from "node:stream";
import type { PackageManagerRunner } from "@prisma/cli-engine";
import { execa } from "execa";

/** How much of a manager's stderr the failure carries, per the seam's
 *  contract. */
export const STDERR_TAIL_BYTES = 64 * 1024;

/** A missing executable or a signal kill leaves the child with no exit
 *  code of its own; the run still failed, and the engine reports it. */
const NO_EXIT_CODE = 1;

const LF = 0x0a;
const CR = 0x0d;
const LINE_BREAKS = [LF, CR];

/**
 * The engine redacts a URL by its scheme, and the bound cuts at an
 * arbitrary byte: a cut inside `https://` leaves `user:secret@host`,
 * which no pattern recognises. So the tail starts after the first line
 * break in what was kept. A window with no line break at all is one
 * truncated line whose start cannot be trusted, and is dropped.
 */
function fromLineStart(window: Buffer): Buffer {
  const breaks = LINE_BREAKS.map((byte) => window.indexOf(byte)).filter(
    (at) => at !== -1,
  );
  if (breaks.length === 0) {
    return Buffer.alloc(0);
  }
  const at = Math.min(...breaks);
  const span = window[at] === CR && window[at + 1] === LF ? 2 : 1;
  return window.subarray(at + span);
}

/** Keeps the last `limit` bytes by dropping whole chunks off the front,
 *  so a manager writing megabytes in small pieces does not recopy the
 *  window once per piece. */
function boundedTail(limit: number) {
  const chunks: Buffer[] = [];
  let written = 0;
  let kept = 0;
  return {
    push(chunk: Buffer): void {
      chunks.push(chunk);
      written += chunk.length;
      kept += chunk.length;
      let first = chunks[0];
      while (first !== undefined && kept - first.length >= limit) {
        chunks.shift();
        kept -= first.length;
        first = chunks[0];
      }
    },
    /** Every byte the child wrote, whether or not it was kept. */
    get bytes(): number {
      return written;
    },
    text(): string {
      const all = Buffer.concat(chunks);
      if (written <= limit) {
        return all.toString("utf8");
      }
      return fromLineStart(all.subarray(all.length - limit)).toString("utf8");
    },
  };
}

/** Decodes across chunk boundaries, so a multi-byte character split by
 *  the pipe is not delivered as two replacement characters. Returns the
 *  final decode: a child that died part-way through a character leaves
 *  bytes the decoder is still holding, and without it they are lost. */
function forward(
  source: Readable,
  emit: (text: string) => void,
  keep?: (chunk: Buffer) => void,
): () => void {
  const decoder = new TextDecoder();
  const emitDecoded = (text: string): void => {
    if (text !== "") {
      emit(text);
    }
  };
  source.on("data", (chunk: Buffer) => {
    keep?.(chunk);
    emitDecoded(decoder.decode(chunk, { stream: true }));
  });
  return () => {
    emitDecoded(decoder.decode());
  };
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
  const flushStdout = forward(subprocess.stdout, (text) =>
    onOutput("data", text),
  );
  const flushStderr = forward(
    subprocess.stderr,
    (text) => onOutput("diagnostic", text),
    tail.push,
  );
  const result = await subprocess;
  flushStdout();
  flushStderr();
  return {
    exitCode: result.exitCode ?? NO_EXIT_CODE,
    // A child that never started wrote nothing, and why it never
    // started is the only account of the failure anyone gets.
    stderr: tail.bytes === 0 ? (result.shortMessage ?? "") : tail.text(),
  };
};
