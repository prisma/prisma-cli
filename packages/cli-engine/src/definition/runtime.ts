import type { Diagnostic } from "../protocol";
import type { Credentials } from "./context";
import type { EngineEvent } from "./events";
import type { PresentedResult } from "./presentation";
import type { StreamEvent } from "./envelopes";
import type { InputStream, OutputStream } from "./streams";

export interface Cli {
  /**
   * Parse, execute, render, return the exit code. Never touches
   * process globals — it exits only through the runtime's exit proxy
   * (second-signal force exit) and writes only to the provided streams.
   */
  run(argv: readonly string[], runtime: Runtime): Promise<number>;
}

/** Everything environmental, injected once by the bin (or by a test). */
export interface Runtime {
  readonly stdout: OutputStream;
  readonly stderr: OutputStream;
  readonly stdin: InputStream;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly isTty: {
    readonly stdin: boolean;
    readonly stdout: boolean;
    readonly stderr: boolean;
  };
  /**
   * Ends the process. The bin passes process.exit; the engine is the
   * only caller (second-signal force exit, 130/143).
   */
  readonly exit: (code: number) => never;
  /**
   * Subscribes to delivered SIGINT/SIGTERM; returns the unsubscribe.
   * The bin is dumb wiring — the engine owns the whole signal policy:
   * the first signal aborts ctx.signal and awaits teardown; a second
   * calls exit(130|143) immediately.
   */
  readonly onSignal: (cb: (signal: "SIGINT" | "SIGTERM") => void) => () => void;
  /**
   * Loaded config + file-level diagnostics; the shell builds this via
   * the unified loader (R10). Tests hand in fixtures.
   */
  readonly config: LoadedConfig;
  readonly getCredentials: () => Promise<Credentials | undefined>;
  /**
   * Used by the ENGINE to phrase install commands (handlers never do —
   * see needs.dependencies and ctx.requireDependency).
   */
  readonly packageManager: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
}

export interface LoadedConfig {
  /**
   * Raw section values by name; validation happens per command via its
   * command family's section token.
   */
  readonly sections: Readonly<Record<string, unknown>>;
  /**
   * File-level problems (unevaluable module, missing version marker)
   * carry section: null and fail only commands with a needs.config
   * section; commands with no config need run normally.
   */
  readonly diagnostics: ReadonlyArray<{
    readonly section: string | null;
    readonly diagnostic: Diagnostic;
  }>;
}

/**
 * The config contract version defineConfig writes as the structural
 * `$prismaConfig` marker; the loader checks it before interpreting
 * anything (R10).
 */
export const PRISMA_CONFIG_VERSION = 1;

export interface TestCli {
  run(
    argv: readonly string[],
    opts?: {
      readonly stdin?: string;
      /**
       * Scripted prompt answers, consumed in order; a run that prompts
       * past the script fails the test.
       */
      readonly answers?: ReadonlyArray<string | boolean>;
      /**
       * Abort the run (session tests): its firing is delivered to the
       * engine as a signal (SIGTERM when the reason is 'SIGTERM',
       * SIGINT otherwise).
       */
      readonly abort?: AbortSignal;
      /** Live event tap, for asserting mid-session behavior. */
      readonly onEvent?: (event: EngineEvent) => void;
      readonly cwd?: string;
      readonly isTty?: { stdin?: boolean; stdout?: boolean; stderr?: boolean };
      readonly env?: Readonly<Record<string, string | undefined>>;
    },
  ): Promise<{
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    /** Parsed stream (events + the terminal result) when json mode. */
    readonly json: readonly StreamEvent[];
    /** Every EngineEvent the handler emitted, for semantic assertions. */
    readonly events: readonly EngineEvent[];
    /**
     * The PresentedResult the handler returned, for semantic assertions
     * without byte-scraping.
     */
    readonly presented?: PresentedResult<unknown>;
  }>;
}
