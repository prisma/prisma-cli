/**
 * DRAFT — the unified CLI engine's public interface, for line-by-line review.
 *
 * Everything a product package imports for CLI purposes lives here (R3).
 * Requirement references (R1–R14) point at docs/architecture/
 * cli-engine-requirements.md in prisma-cli. Nothing from stricli appears —
 * it is an internal of the engine package.
 *
 * The one execution protocol (agreed 2026-08-09): a handler receives
 * (args, context), emits zero or more events through context.report, and
 * returns a Result when done. Sync commands emit nothing; progress and
 * poll commands emit along the way (timeouts are the handler's business);
 * session commands keep emitting until context.signal fires, then clean up
 * and return. Liveness display (spinner-equivalent) is the engine's: shown
 * when a command runs quietly past a threshold. Daemon management (mode 5)
 * is a separate design; `lsp`-style stdio servers bypass the protocol via
 * a declared raw mode (see CommandDefinition.raw).
 */

// ————————————————————————————————————————————————————————————————————————
// Foundation types (from the zero-dependency foundation package, not here;
// shown for reading convenience)
// ————————————————————————————————————————————————————————————————————————

import type { CliStructuredError, Result } from '@prisma/cli-foundation'

// ————————————————————————————————————————————————————————————————————————
// §1 Events — R14: one engine vocabulary, product extensions ride in `data`
// ————————————————————————————————————————————————————————————————————————

/**
 * The engine event envelope. `kind`-specific fields are the common
 * vocabulary the engine renders consistently (human mode) and frames
 * (--json mode: one line per event, `{ type, command, timestamp, data }`,
 * where the event body is the data). `data` is the product extension:
 * passed through to machine consumers untouched, never interpreted by the
 * engine, documented and versioned by the product as its own public API.
 *
 * Starter vocabulary, derived from the output-modes survey's recurring
 * structures (occurrence-ranked). Grows only by evidence: a structure
 * recurring inside `data` across commands is the promotion signal.
 */
export type EngineEvent =
  /** A named phase began. Engine renders it as a step line; steps may nest. */
  | { readonly kind: 'step-started'; readonly step: string; readonly data?: unknown }
  /** The phase ended. `outcome` drives the ✔/✘/⚠ glyph. */
  | {
      readonly kind: 'step-finished'
      readonly step: string
      readonly outcome: 'ok' | 'failed' | 'skipped' | 'warning'
      readonly data?: unknown
    }
  /** Progress inside a phase (counts, not percentages — survey: counts+summary). */
  | {
      readonly kind: 'progress'
      readonly step?: string
      readonly completed: number
      readonly total?: number
      readonly data?: unknown
    }
  /** A condition the user should know about; never fatal (fatal = the Result). */
  | { readonly kind: 'warning'; readonly message: string; readonly data?: unknown }
  /** Informational line the product wants shown (human) / framed (json). */
  | { readonly kind: 'notice'; readonly message: string; readonly data?: unknown }
  /**
   * Output from a child process or remote log stream, line-oriented.
   * Survey: three passthrough strategies exist today; this is the typed one.
   */
  | {
      readonly kind: 'output'
      readonly source: string
      readonly stream: 'stdout' | 'stderr'
      readonly line: string
      readonly data?: unknown
    }
  /**
   * A user-actionable follow-up surfaced mid-run (survey: remediation exists
   * in five encodings today — this is the one). Terminal remediation goes on
   * the Result's error (`fix`) or the success envelope's nextActions instead.
   */
  | {
      readonly kind: 'remediation'
      readonly label: string
      readonly command?: string
      readonly data?: unknown
    }
  /** A reachable endpoint became available (survey: endpoints/URLs, 3 families). */
  | {
      readonly kind: 'endpoint'
      readonly name: string
      readonly url: string
      readonly data?: unknown
    }
  /** A state transition in a watched external process (survey: poll loops). */
  | {
      readonly kind: 'status'
      readonly subject: string
      readonly status: string
      readonly data?: unknown
    }

// ————————————————————————————————————————————————————————————————————————
// §2 The handler context — R4: the whole world arrives as one argument
// ————————————————————————————————————————————————————————————————————————

export interface CommandContext<ConfigSection = unknown> {
  /** The product's validated section of prisma.config.ts (R10). Absent
   *  section: `undefined`; invalid section: the engine already failed the
   *  command before the handler ran, so handlers never see diagnostics. */
  readonly config: ConfigSection | undefined

  /** Management-API credentials, however the user authenticated (R4's why). */
  readonly credentials: Credentials | undefined

  /** The one way to emit while running (§1). Safe to call after the signal
   *  fires (events during teardown render normally). */
  readonly report: (event: EngineEvent) => void

  /** Interactive input. Every method returns a structured error instead of
   *  prompting when interaction is unavailable (--json, --no-interactive,
   *  CI, non-TTY) — the platform CLI's canPrompt gate, engine-owned. */
  readonly prompt: PromptSurface

  /** Fires on Ctrl-C/SIGTERM (engine-owned wiring). Session commands run
   *  until it fires; everything else should abort in-flight work with it. */
  readonly signal: AbortSignal

  /** Where the user invoked the CLI. Products never read process.cwd(). */
  readonly cwd: string
}

export interface Credentials {
  /** Opaque to the engine; shape owned by the Cloud product's auth library. */
  readonly token: string
  readonly workspaceId?: string
}

export interface PromptSurface {
  readonly confirm: (question: string) => Promise<Result<boolean, CliStructuredError>>
  readonly select: <T extends string>(
    question: string,
    options: ReadonlyArray<{ value: T; label: string }>,
  ) => Promise<Result<T, CliStructuredError>>
  readonly text: (
    question: string,
    opts?: { placeholder?: string },
  ) => Promise<Result<string, CliStructuredError>>
}

// ————————————————————————————————————————————————————————————————————————
// §3 Flags and arguments — R1: directly executable, typed by inference
// ————————————————————————————————————————————————————————————————————————

/** Flag declarations. `flag.json()` is the shared flag-set entry for
 *  commands that support --json (there are no global flags). Parse-time
 *  validation failures become structured errors with the allowed values —
 *  never framework strings. */
export declare const flag: {
  string(spec: { brief: string; placeholder?: string }): FlagSpec<string | undefined>
  requiredString(spec: { brief: string; placeholder?: string }): FlagSpec<string>
  boolean(spec: { brief: string }): FlagSpec<boolean>
  enum<const T extends readonly string[]>(spec: {
    brief: string
    values: T
  }): FlagSpec<T[number] | undefined>
  repeated(spec: { brief: string; placeholder?: string }): FlagSpec<readonly string[]>
  /** The shared --json declaration; presence changes rendering, not parsing. */
  json(): FlagSpec<boolean>
}

declare const FLAG: unique symbol
export interface FlagSpec<T> { readonly [FLAG]: T }

export declare const positional: {
  string(spec: { brief: string; placeholder: string }): PositionalSpec<string>
  optionalString(spec: { brief: string; placeholder: string }): PositionalSpec<string | undefined>
}
declare const POSITIONAL: unique symbol
export interface PositionalSpec<T> { readonly [POSITIONAL]: T }

/** What the handler receives: each declared flag/positional, typed. */
export type ArgsOf<D extends CommandDefinition> = {
  readonly [K in keyof D['flags']]: D['flags'][K] extends FlagSpec<infer T> ? T : never
} & {
  readonly [K in keyof D['positionals']]: D['positionals'][K] extends PositionalSpec<infer T>
    ? T
    : never
}

// ————————————————————————————————————————————————————————————————————————
// §4 The command definition — light at startup (R9), path-free (R12)
// ————————————————————————————————————————————————————————————————————————

export interface CommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>> = Record<string, PositionalSpec<unknown>>,
  TResult = unknown,
  TConfig = unknown,
> {
  /** One line, imperative, shown in listings. */
  readonly brief: string
  /** Paragraph(s) for `--help`. Words only — the engine formats. */
  readonly description?: string
  /** Copy-pastable invocations, shown verbatim in help. */
  readonly examples?: readonly string[]

  readonly flags: TFlags
  readonly positionals?: TPositionals

  /**
   * The heavy part, loaded only at execution (R9). The module's default
   * export is the handler.
   */
  readonly handler: () => Promise<{
    default: (
      args: ArgsOf<CommandDefinition<TFlags, TPositionals>>,
      ctx: CommandContext<TConfig>,
    ) => Promise<Result<TResult, CliStructuredError>>
  }>

  /**
   * How a success Result renders (R5). The platform CLI's proven triple:
   * `human` is required prose (stderr); `stdout` is the machine-consumable
   * payload lines (what --quiet leaves); `json` projects the envelope's
   * `result` and defaults to the raw value. All composed from engine
   * primitives — there is no way to print.
   */
  readonly present: {
    readonly human: (value: TResult, ui: Ui) => readonly Block[]
    readonly stdout?: (value: TResult) => readonly string[]
    readonly json?: (value: TResult) => unknown
  }

  /**
   * Escape hatch for mode 7 (stdio protocol servers, e.g. `lsp`): the
   * command owns stdin/stdout wholesale; events, presenters, and --json do
   * not apply and the engine enforces that nothing else is declared.
   */
  readonly raw?: false | { readonly reason: string }
}

/** Identity function; exists so TypeScript infers the generics (R1). */
export declare function defineCommand<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
  TResult,
  TConfig,
>(
  def: CommandDefinition<TFlags, TPositionals, TResult, TConfig>,
): CommandDefinition<TFlags, TPositionals, TResult, TConfig>

// ————————————————————————————————————————————————————————————————————————
// §5 Presentation primitives — the R5 vocabulary (survey: card patterns)
// ————————————————————————————————————————————————————————————————————————

/** Deliberately small; grows by the same evidence rule as events. */
export type Block =
  | { readonly kind: 'summary'; readonly tone: 'ok' | 'error' | 'warning' | 'info'; readonly text: string }
  | { readonly kind: 'fields'; readonly rows: ReadonlyArray<{ label: string; value: string; sensitive?: boolean }> }
  | { readonly kind: 'table'; readonly columns: readonly string[]; readonly rows: ReadonlyArray<readonly string[]> }
  | { readonly kind: 'list'; readonly items: readonly string[] }
  | { readonly kind: 'nextSteps'; readonly steps: readonly string[] }

/** Styling helpers usable inside block text; no direct writing. */
export interface Ui {
  readonly emphasize: (text: string) => string
  readonly dim: (text: string) => string
  readonly code: (text: string) => string
}

// ————————————————————————————————————————————————————————————————————————
// §6 Product export and shell mounting — R12: the shell owns the tree
// ————————————————————————————————————————————————————————————————————————

/** What a product package exports: named commands, no paths. */
export type CommandSet = Readonly<Record<string, CommandDefinition>>

/**
 * Shell-side construction. Paths are space-separated (`'db migrate'`);
 * group help text is declared with the mount, since groups belong to the
 * tree, not to products. Collisions and grammar violations fail the build.
 */
export declare function createCli(spec: {
  readonly name: string
  readonly version: string
  readonly groups: Readonly<Record<string, { readonly brief: string }>>
  readonly commands: Readonly<Record<string, CommandDefinition>>
}): Cli

export interface Cli {
  /**
   * Parse, execute, render, return the exit code (0/1/2/3 per R6; the
   * caller assigns process.exitCode — the engine never exits or writes to
   * anything but the provided streams).
   */
  run(argv: readonly string[], runtime: Runtime): Promise<number>
}

/** Everything environmental, injected once by the bin (or by a test). */
export interface Runtime {
  readonly stdout: NodeJS.WritableStream
  readonly stderr: NodeJS.WritableStream
  readonly stdin: NodeJS.ReadableStream
  readonly cwd: string
  readonly isTty: { readonly stdin: boolean; readonly stderr: boolean }
  readonly signal: AbortSignal
  /** Loaded config + per-section diagnostics; the shell builds this via the
   *  unified loader (R10). Tests hand in fixtures. */
  readonly config: LoadedConfig
  readonly credentials: Credentials | undefined
}

export interface LoadedConfig {
  readonly sections: Readonly<Record<string, unknown>>
  readonly diagnostics: ReadonlyArray<{ readonly section: string | null; readonly error: CliStructuredError }>
}

// ————————————————————————————————————————————————————————————————————————
// §7 The product-repo test harness — R7: same machinery, bytes out
// ————————————————————————————————————————————————————————————————————————

export declare function createTestCli(spec: {
  readonly commands: Readonly<Record<string, CommandDefinition>>
  readonly groups?: Readonly<Record<string, { readonly brief: string }>>
  readonly config?: Readonly<Record<string, unknown>>
  readonly credentials?: Credentials
}): TestCli

export interface TestCli {
  run(argv: readonly string[], opts?: { readonly stdin?: string }): Promise<{
    readonly exitCode: number
    readonly stdout: string
    readonly stderr: string
    /** The parsed --json event/envelope stream, when --json was passed. */
    readonly json: readonly unknown[]
    /** Every EngineEvent the handler emitted, for semantic assertions. */
    readonly events: readonly EngineEvent[]
  }>
}
