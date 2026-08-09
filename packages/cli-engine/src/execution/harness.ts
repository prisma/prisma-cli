import type { CommandFamily, MountedTree } from "../command-family";
import type { Credentials } from "../context";
import type { StreamEvent } from "../envelopes";
import type { EngineEvent } from "../events";
import type { PresentedResult } from "../presentation";
import type { Runtime, TestCli } from "../runtime";
import { buildEngine } from "./run";

function inputStreamFromString(text: string) {
  const bytes = new TextEncoder().encode(text);
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
      if (bytes.length > 0) {
        yield bytes;
      }
    },
  };
}

/**
 * The test harness: the same engine over in-memory streams (R7). The
 * harness hands the engine no real process access at all — its exit
 * proxy throws and its streams are in-memory — which is how "the engine
 * never touches process globals and writes only to provided streams" is
 * proven by construction.
 */
export function createTestCli(spec: {
  readonly commandFamilies?: readonly CommandFamily[];
  readonly commands: MountedTree;
  readonly groups?: Readonly<Record<string, { readonly brief: string }>>;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly credentials?: Credentials;
  readonly packageManager?: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
  /** Fixed clock for deterministic stream timestamps. */
  readonly now?: () => Date;
}): TestCli {
  const engine = buildEngine(
    {
      name: "prisma-test",
      version: "0.0.0",
      commandFamilies: spec.commandFamilies ?? [],
      groups: spec.groups ?? {},
      commands: spec.commands,
    },
    { now: spec.now },
  );
  return {
    async run(argv, opts) {
      let stdoutText = "";
      let stderrText = "";
      const frames: StreamEvent[] = [];
      const events: EngineEvent[] = [];
      let presented: PresentedResult<unknown> | undefined;
      const signalListeners = new Set<(signal: "SIGINT" | "SIGTERM") => void>();
      const deliverSignal = (reason: unknown): void => {
        const signal = reason === "SIGTERM" ? "SIGTERM" : "SIGINT";
        for (const listener of [...signalListeners]) {
          listener(signal);
        }
      };
      const runtime: Runtime = {
        stdout: {
          write: (text) => {
            stdoutText += text;
          },
        },
        stderr: {
          write: (text) => {
            stderrText += text;
          },
        },
        stdin: inputStreamFromString(opts?.stdin ?? ""),
        cwd: opts?.cwd ?? "/",
        env: opts?.env ?? {},
        isTty: {
          stdin: opts?.isTty?.stdin ?? false,
          stdout: opts?.isTty?.stdout ?? false,
          stderr: opts?.isTty?.stderr ?? false,
        },
        exit: (code: number): never => {
          throw new Error(
            `@prisma/cli-engine: runtime.exit(${code}) reached the test harness`,
          );
        },
        onSignal: (cb) => {
          signalListeners.add(cb);
          return () => {
            signalListeners.delete(cb);
          };
        },
        config: { sections: spec.config ?? {}, diagnostics: [] },
        getCredentials: async () => spec.credentials,
        packageManager: spec.packageManager ?? "unknown",
      };
      const running = engine.execute(argv, runtime, {
        onEvent: (event) => {
          events.push(event);
          opts?.onEvent?.(event);
        },
        onPresented: (value) => {
          presented = value;
        },
        onStreamEvent: (frame) => {
          frames.push(frame);
        },
        answers: opts?.answers,
      });
      const abort = opts?.abort;
      if (abort !== undefined) {
        if (abort.aborted) {
          deliverSignal(abort.reason);
        } else {
          abort.addEventListener("abort", () => deliverSignal(abort.reason), {
            once: true,
          });
        }
      }
      const exitCode = await running;
      return {
        exitCode,
        stdout: stdoutText,
        stderr: stderrText,
        json: frames,
        events,
        presented,
      };
    },
  };
}
