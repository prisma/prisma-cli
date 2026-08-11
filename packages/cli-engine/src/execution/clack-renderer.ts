/**
 * Interactive prompt rendering backed by @clack/prompts, driven
 * entirely by Runtime streams. Selected only when the runtime's stdin
 * can enter raw mode (a real TTY); scripted answers, piped stdin, and
 * the test harness stay on the plain line renderer (prompts.ts owns the
 * branch). @clack/prompts is loaded by dynamic import here and nowhere
 * else, so the module never touches non-interactive runs. Clack's
 * spinner/log helpers install process-global handlers and must never be
 * used: progress remains engine events.
 *
 * Accepted quirk: clack reads process.stdout.columns for wrap width —
 * the one process-global read on the interactive path.
 */
import { Readable, Writable } from "node:stream";

import type { InputStream, OutputStream, Runtime } from "../runtime";

export function clackCapable(runtime: Runtime): boolean {
  return runtime.isTty.stdin && runtime.stdin.setRawMode !== undefined;
}

/** Presents the runtime's stdin to clack as a raw-mode-capable TTY. */
function toReadable(stdin: InputStream): Readable {
  const readable = Readable.from(stdin, { objectMode: false });
  Object.assign(readable, {
    isTTY: true,
    setRawMode: (enabled: boolean) => {
      stdin.setRawMode?.(enabled);
      return readable;
    },
  });
  return readable;
}

function toWritable(out: OutputStream): Writable {
  return new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      out.write(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      callback();
    },
  });
}

/**
 * Cancellation surfaces as clack's cancel symbol (isCancel), which
 * covers the \x03 byte path; prompts.ts maps it to CLI.PROMPT_CANCELLED.
 */
export interface ClackRenderer {
  confirm(
    question: string,
    initial: boolean | undefined,
  ): Promise<boolean | symbol>;
  /** Starts on No: Enter-through returns false; only explicit Yes grants. */
  consent(question: string): Promise<boolean | symbol>;
  /** Type-to-confirm: anything but the token re-prompts, so the only
   *  ways out are the exact token and cancelling. */
  confirmToken(question: string, token: string): Promise<string | symbol>;
  select<T extends string>(
    question: string,
    options: ReadonlyArray<{ value: T; label: string }>,
    initial: T | undefined,
  ): Promise<T | symbol>;
  text(
    question: string,
    placeholder: string | undefined,
    fallback: string | undefined,
  ): Promise<string | symbol>;
  isCancel(value: unknown): boolean;
}

export async function makeClackRenderer(
  stdin: InputStream,
  stderr: OutputStream,
): Promise<ClackRenderer> {
  const clack = await import("@clack/prompts");
  const input = toReadable(stdin);
  const output = toWritable(stderr);

  return {
    confirm: (question, initial) =>
      clack.confirm({
        input,
        output,
        message: question,
        initialValue: initial ?? false,
      }),
    consent: (question) =>
      clack.confirm({
        input,
        output,
        message: question,
        initialValue: false,
      }),
    confirmToken: (question, token) =>
      clack.text({
        input,
        output,
        message: `${question} Type ${token} to confirm.`,
        placeholder: token,
        validate: (value) =>
          value === token
            ? undefined
            : `Type ${token} exactly, or press Ctrl-C.`,
      }),
    select: <T extends string>(
      question: string,
      options: ReadonlyArray<{ value: T; label: string }>,
      initial: T | undefined,
    ) =>
      clack.select<T>({
        input,
        output,
        message: question,
        options: options.map((option) => ({
          value: option.value,
          label: option.label,
        })) as Parameters<typeof clack.select<T>>[0]["options"],
        initialValue: initial,
      }),
    text: (question, placeholder, fallback) =>
      clack.text({
        input,
        output,
        message: question,
        placeholder,
        defaultValue: fallback,
      }),
    isCancel: (value) => clack.isCancel(value),
  };
}
