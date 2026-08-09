/**
 * DRAFT v3 — the unified CLI engine's public interface.
 * v1: initial. v2: round-1 review fixes. v3: presentation moved to the
 * return site (operator ruling): handlers materialize the active mode's
 * views via ctx.present at the point where the outcome is known; the
 * definition carries no presenters and no result generic. Prior versions
 * preserved as -v1.ts / -v2.ts; round-1 artifacts in ./reviews/.
 *
 * Everything a product package imports for CLI purposes lives here (R3).
 * Requirement references (R1–R14) point at docs/architecture/
 * cli-engine-requirements.md in prisma-cli. Nothing from stricli appears —
 * it is an internal of the engine package.
 *
 * The execution protocol: a handler receives (args, context), emits zero
 * or more events through context.report, and returns a Result when done —
 * a PresentedResult built with ctx.present, carrying pure data plus the
 * materialized views the active mode needs. Sync commands emit nothing;
 * progress and poll commands emit along the way (timeouts are the
 * handler's business). Session commands (defineSessionCommand) keep
 * emitting until context.signal fires, then clean up and return. Stdio
 * protocol servers (defineRawCommand) bypass the protocol by declaration.
 * Liveness display is the engine's: shown when a command runs quietly
 * past a threshold. Nothing product-authored executes after the handler
 * resolves — the engine receives values, never callbacks.
 *
 * `--json` is an ENGINE MODE, not a flag products declare or handlers
 * branch on. Every value command is json-capable by construction: the
 * envelope's `result` is the presented data, with `views.json` as an
 * optional override. In json mode the engine switches renderers,
 * suppresses prompts (they fail structurally), and frames every event as
 * one NDJSON line. The engine auto-selects json mode when stdout is not
 * a TTY — deliberate, agent-facing behavior. The engine injects the
 * shared flag family on every non-raw command: --json, -q/--quiet,
 * -v/--verbose, -y/--yes, --interactive/--no-interactive,
 * --color/--no-color. Products cannot declare flags with those names.
 *
 * Exit codes (R6): 0 ok; 1 bug only; 2 expected structured failure;
 * 3 user abort (Ctrl-C, or cancelling a gate the command cannot proceed
 * without); 4–99 command-specific outcome codes (declared per command
 * via `exitCode`); 130/143 delivered signals — the engine owns signal
 * wiring and code selection.
 */

// ————————————————————————————————————————————————————————————————————————
// Foundation types (from the zero-dependency foundation package, not here;
// shown for reading convenience)
// ————————————————————————————————————————————————————————————————————————

import type { CliStructuredError, Result } from '@prisma/cli-foundation'

/** The one severity scale (ADR 239's, the mature shipped one). Step
 *  outcomes are completion states, not severities — see EngineEvent. */
export type Severity = 'error' | 'warn' | 'info'

// ————————————————————————————————————————————————————————————————————————
// §1 Next actions — the one remediation shape (the platform CLI's shipped
// form, adopted whole)
// ————————————————————————————————————————————————————————————————————————

export interface NextAction {
  readonly kind: 'run-command' | 'user-choice' | 'edit-file' | 'done'
  /** Open string with a recommended starter set (journeys are grouping
   *  metadata; `kind` is the machine-branched field). */
  readonly journey: string
  readonly label: string
  readonly command?: string
  readonly commands?: readonly string[]
  readonly reason?: string
}

// ————————————————————————————————————————————————————————————————————————
// §2 Events — R14: one engine vocabulary, product extensions in `data`
// ————————————————————————————————————————————————————————————————————————

/**
 * The engine event envelope. `kind`-specific fields are the common
 * vocabulary the engine renders consistently (human mode) and frames
 * (json mode: one NDJSON line per event, `{ type, command, timestamp,
 * data }`). `data` is the product extension: passed through to machine
 * consumers untouched, never interpreted by the engine, documented and
 * versioned by the product as its own public API. A structure recurring
 * inside `data` across commands is the promotion signal (R14).
 *
 * Rendering destinations, human mode: `output` events with channel
 * 'data' are the command's data and go to OUR stdout (they are what
 * `log tail > file` captures); every other event is commentary and goes
 * to stderr. In json mode everything is one framed stream on stdout.
 *
 * Calling report() after the handler has resolved is a bug
 * (InternalError) — the engine has sealed the envelope by then. Events
 * emitted during teardown (after the signal, before resolution) are
 * normal.
 */
export type EngineEvent =
  /** A named phase began. `id`/`parentId` express nesting (the ORM's
   *  span shape); omitted for flat steps. */
  | {
      readonly kind: 'step-started'
      readonly step: string
      readonly id?: string
      readonly parentId?: string
      readonly data?: unknown
    }
  /** The phase ended. `outcome` is a completion state and drives the
   *  ✔/✘/⚠/− glyph; it is not a severity. */
  | {
      readonly kind: 'step-finished'
      readonly step: string
      readonly id?: string
      readonly outcome: 'ok' | 'failed' | 'skipped' | 'warning'
      readonly data?: unknown
    }
  /** Progress inside a phase (counts, not percentages — survey evidence). */
  | {
      readonly kind: 'progress'
      readonly step?: string
      readonly completed: number
      readonly total?: number
      readonly data?: unknown
    }
  /**
   * A line of commentary with a severity ('warning' and 'notice' merged
   * onto the one scale). severity 'warn' events are additionally
   * aggregated by the engine into the success envelope's `warnings` —
   * emit once, appear in both places. 'error' is not valid here: fatal
   * problems are the Result's failure.
   */
  | {
      readonly kind: 'message'
      readonly severity: Exclude<Severity, 'error'>
      readonly text: string
      readonly data?: unknown
    }
  /**
   * Line-oriented output from a child process or remote stream.
   * `channel` is semantic: 'data' = the command's own output, routed to
   * our stdout; 'diagnostic' = commentary about the run, routed to
   * stderr. `source` names the emitter (service name, child binary),
   * not a pipe.
   */
  | {
      readonly kind: 'output'
      readonly source: string
      readonly channel: 'data' | 'diagnostic'
      readonly line: string
      readonly data?: unknown
    }
  /** A user-actionable follow-up surfaced mid-run; terminal ones belong
   *  in the presented views' `next` instead. */
  | { readonly kind: 'remediation'; readonly action: NextAction; readonly data?: unknown }
  /** A reachable endpoint became available. */
  | {
      readonly kind: 'endpoint'
      readonly name: string
      readonly url: string
      readonly data?: unknown
    }
  /** A state transition in a watched external process. `from` carries the
   *  prior state when known (survey: transitions, not snapshots). */
  | {
      readonly kind: 'status'
      readonly subject: string
      readonly status: string
      readonly from?: string
      readonly data?: unknown
    }
  /** A file or directory this run wrote that the user may care about. */
  | {
      readonly kind: 'artifact'
      readonly path: string
      readonly description?: string
      readonly data?: unknown
    }

// ————————————————————————————————————————————————————————————————————————
// §3 Presented results — presentation materializes at the return site
// ————————————————————————————————————————————————————————————————————————

/**
 * What a value command's handler returns inside `ok(...)`: pure data plus
 * the views the ACTIVE MODE already materialized. Built exclusively by
 * ctx.present — the context knows the mode, calls only the view functions
 * that mode needs, and the result crossing the product→engine boundary is
 * values all the way down (serializable, snapshotable, no callbacks).
 *
 * `data` is always present and is always what the envelope's `result`
 * serializes (json view overrides when supplied). View materialization by
 * mode: human mode → human + stdout + next; --quiet → stdout;
 * json mode → json + next.
 */
export interface PresentedResult<T> {
  readonly data: T
  readonly views: {
    readonly human?: readonly Block[]
    readonly stdout?: readonly string[]
    readonly json?: unknown
    readonly next?: readonly NextAction[]
  }
}

/**
 * The view functions a handler supplies to ctx.present. Only the active
 * mode's functions are invoked, at the return site, where the outcome and
 * its context are live — no case-reconstruction in a distant presenter.
 * `human` composes engine primitives (R5: Block is the only vocabulary);
 * `stdout` is the machine-consumable data lines the engine writes to
 * stdout — what --quiet leaves, what a pipe receives; `json` overrides
 * the envelope's `result` (default: the data itself); `next` supplies
 * nextActions — the envelope's human nextSteps derive from them.
 */
export interface Views<T> {
  readonly human: (ui: Ui) => readonly Block[]
  readonly stdout?: () => readonly string[]
  readonly json?: () => unknown
  readonly next?: () => readonly NextAction[]
}

// ————————————————————————————————————————————————————————————————————————
// §4 Config sections — R10 made structural
// ————————————————————————————————————————————————————————————————————————

/**
 * A product's named slice of prisma.config.ts. The token couples the
 * section name, its validated type, and its never-throwing validator;
 * commands bind to the token, which is how the engine knows which section
 * a command needs — and therefore which diagnostics fail which commands.
 */
export interface ConfigSection<T> {
  readonly name: string
  /** Total: any unknown in, diagnostics out. Never throws (R10). */
  readonly validate: (raw: unknown) => SectionValidation<T>
}

export type SectionValidation<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly CliStructuredError[] }
  | { readonly ok: false; readonly diagnostics: readonly CliStructuredError[] }

export declare function defineConfigSection<T>(spec: {
  readonly name: string
  readonly validate: (raw: unknown) => SectionValidation<T>
}): ConfigSection<T>

// ————————————————————————————————————————————————————————————————————————
// §5 The handler context — R4: the whole world arrives as one argument
// ————————————————————————————————————————————————————————————————————————

export interface CommandContext<TConfig = undefined> {
  /** The validated value of the command's declared config section (typed
   *  via the ConfigSection token), or undefined when the config file has
   *  no such section. An INVALID needed section never reaches the
   *  handler — the engine already failed the command with that section's
   *  diagnostics. */
  readonly config: TConfig | undefined

  /** Builds the PresentedResult for the active mode: calls only the view
   *  functions this mode needs, at the return site. The only constructor
   *  of PresentedResult. */
  readonly present: <T>(data: T, views: Views<T>) => PresentedResult<T>

  /** Management-API credentials, resolved at call time so long-lived
   *  sessions survive token refresh. Undefined when unauthenticated. */
  readonly getCredentials: () => Promise<Credentials | undefined>

  /** The one way to emit while running (§2). */
  readonly report: (event: EngineEvent) => void

  /** Interactive input. In json mode, non-interactive mode, CI, or
   *  without a TTY, every method returns a structured error instead of
   *  prompting. Distinct codes distinguish "interaction unavailable"
   *  (exit 2) from "user cancelled the prompt" (engine maps to exit 3). */
  readonly prompt: PromptSurface

  /** Fires on Ctrl-C/SIGTERM (engine-owned wiring; the engine records
   *  which signal, for the 130/143 exit). Session commands run until it
   *  fires; everything else aborts in-flight work with it. */
  readonly signal: AbortSignal

  /** Where the user invoked the CLI. Products never read process.cwd(). */
  readonly cwd: string

  /** R13's probe: is this optional peer dependency importable from the
   *  user's project? Never throws; never installs anything. */
  readonly probeDependency: (specifier: string) => Promise<boolean>
}

export interface Credentials {
  /** Opaque to the engine; shape owned by the Cloud product's auth
   *  library (placeholder pending its design). */
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
// §6 Flags and positionals — R1: directly executable, typed by inference
// ————————————————————————————————————————————————————————————————————————

/**
 * Product-declared flags. The shared family (--json, --quiet, --verbose,
 * --yes, --interactive, --color) is engine-injected and reserved — it
 * never appears here and handlers never see those values; they change
 * engine behavior, not handler input. Parse-time validation failures
 * (bad enum value, non-numeric --timeout) become structured errors
 * carrying the allowed values — never framework strings.
 */
export declare const flag: {
  string(spec: {
    brief: string
    placeholder?: string
    alias?: string
    default?: string
  }): FlagSpec<string | undefined>
  requiredString(spec: { brief: string; placeholder?: string; alias?: string }): FlagSpec<string>
  number(spec: {
    brief: string
    placeholder?: string
    alias?: string
    default?: number
  }): FlagSpec<number | undefined>
  boolean(spec: { brief: string; alias?: string }): FlagSpec<boolean>
  enum<const T extends readonly string[]>(spec: {
    brief: string
    values: T
    alias?: string
    default?: T[number]
  }): FlagSpec<T[number] | undefined>
  repeated(spec: { brief: string; placeholder?: string; alias?: string }): FlagSpec<readonly string[]>
}

declare const FLAG: unique symbol
export interface FlagSpec<T> {
  /** Phantom carrier for inference; exported so declaration emit works. */
  readonly [FLAG]: T
}
export { FLAG }

export declare const positional: {
  string(spec: { brief: string; placeholder: string }): PositionalSpec<string>
  optionalString(spec: { brief: string; placeholder: string }): PositionalSpec<string | undefined>
  /** Zero or more trailing values; at most one, last. */
  variadic(spec: { brief: string; placeholder: string }): PositionalSpec<readonly string[]>
}
declare const POSITIONAL: unique symbol
export interface PositionalSpec<T> {
  readonly [POSITIONAL]: T
}
export { POSITIONAL }

/**
 * What a handler receives. Flags and positionals live in separate
 * namespaces (no silent collisions, symmetric access): `args.flags.to`,
 * `args.positionals.name`.
 */
export interface Args<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
> {
  readonly flags: { readonly [K in keyof TFlags]: TFlags[K] extends FlagSpec<infer T> ? T : never }
  readonly positionals: {
    readonly [K in keyof TPositionals]: TPositionals[K] extends PositionalSpec<infer T> ? T : never
  }
}

// ————————————————————————————————————————————————————————————————————————
// §7 Command definitions — light at startup (R9), path-free (R12), and
// free of the result type (presentation lives at the return site)
// ————————————————————————————————————————————————————————————————————————

export interface CommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
> {
  /** One line, imperative, shown in listings. */
  readonly brief: string
  /** Paragraph(s) for --help. Words only — the engine formats. */
  readonly description?: string
  /** Copy-pastable invocations, shown verbatim in help. */
  readonly examples?: readonly string[]

  readonly flags?: TFlags
  readonly positionals?: TPositionals

  /** Binds the command to its product's config section (§4). The engine
   *  fails the command before loading the handler if this section is
   *  invalid; other sections' problems don't touch this command (R10). */
  readonly configSection?: ConfigSection<TConfig>

  /** The heavy part, loaded only at execution (R9). The module's default
   *  export is the handler — annotate it with CommandHandler<typeof def>
   *  (type-only import of the light definition; no runtime cycle). */
  readonly handler: () => Promise<{ default: Handler<TFlags, TPositionals, TConfig> }>

  /** Command-specific outcome code (4–99), a pure function of the
   *  presented data; omit for plain 0. (`migration check` exits 4 on
   *  drift.) */
  readonly exitCode?: (data: unknown) => number
}

export type Handler<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
  TConfig,
> = (
  args: Args<TFlags, TPositionals>,
  ctx: CommandContext<TConfig>,
) => Promise<Result<PresentedResult<unknown>, CliStructuredError>>

/** For impl files: `const run: CommandHandler<typeof migrateCommand> = …`
 *  — keeps definition and handler in lockstep without a runtime cycle. */
export type CommandHandler<D> = D extends CommandDefinition<infer F, infer P, infer C>
  ? Handler<F, P, C>
  : never

export declare function defineCommand<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
>(def: CommandDefinition<TFlags, TPositionals, TConfig>): CommandDefinition<TFlags, TPositionals, TConfig>

/**
 * Mode 4 — sessions (dev, log tail): the handler runs until the signal
 * fires, speaks entirely through events, and returns Result<void>. There
 * is no presentation — the engine owns the standard close-out line — and
 * no exitCode (0, or the failure's code, or the signal's). A session
 * always supports json mode: the event stream is its json surface.
 */
export interface SessionCommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
> {
  readonly brief: string
  readonly description?: string
  readonly examples?: readonly string[]
  readonly flags?: TFlags
  readonly positionals?: TPositionals
  readonly configSection?: ConfigSection<TConfig>
  readonly handler: () => Promise<{
    default: (
      args: Args<TFlags, TPositionals>,
      ctx: CommandContext<TConfig>,
    ) => Promise<Result<void, CliStructuredError>>
  }>
}

export declare function defineSessionCommand<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
>(def: SessionCommandDefinition<TFlags, TPositionals, TConfig>): SessionCommandDefinition<TFlags, TPositionals, TConfig>

/**
 * Mode 7 — stdio protocol servers (lsp): the command owns stdin/stdout
 * wholesale. Events, presentation, json mode, and prompts do not apply;
 * the handler returns the exit code directly. Flags are allowed (an lsp
 * takes options); the shared flag family is NOT injected.
 */
export interface RawCommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
> {
  readonly brief: string
  readonly description?: string
  readonly flags?: TFlags
  readonly handler: () => Promise<{
    default: (
      args: Args<TFlags, {}>,
      io: {
        readonly stdin: NodeJS.ReadableStream
        readonly stdout: NodeJS.WritableStream
        readonly stderr: NodeJS.WritableStream
        readonly signal: AbortSignal
        readonly cwd: string
      },
    ) => Promise<number>
  }>
}

export declare function defineRawCommand<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
>(def: RawCommandDefinition<TFlags>): RawCommandDefinition<TFlags>

/** Erased union for mount maps and command sets (concrete definitions are
 *  assignable here; the generics live on define*). */
export type AnyCommand =
  | CommandDefinition<any, any, any>
  | SessionCommandDefinition<any, any, any>
  | RawCommandDefinition<any>

// ————————————————————————————————————————————————————————————————————————
// §8 Presentation primitives — the R5 vocabulary
// ————————————————————————————————————————————————————————————————————————

/** Deliberately small; grows by the same evidence rule as events. */
export type Block =
  | {
      readonly kind: 'summary'
      readonly tone: 'ok' | Severity
      readonly text: string
    }
  | {
      readonly kind: 'fields'
      readonly rows: ReadonlyArray<{ label: string; value: string; sensitive?: boolean }>
    }
  | {
      readonly kind: 'table'
      readonly columns: readonly string[]
      readonly rows: ReadonlyArray<readonly string[]>
    }
  | { readonly kind: 'list'; readonly items: readonly string[] }
  /** The corpus's most-rendered human structure (migration graphs,
   *  service trees). */
  | { readonly kind: 'tree'; readonly roots: readonly TreeNode[] }

export interface TreeNode {
  readonly label: string
  readonly children?: readonly TreeNode[]
}

/** Styling helpers usable inside block text; no direct writing. */
export interface Ui {
  readonly emphasize: (text: string) => string
  readonly dim: (text: string) => string
  readonly code: (text: string) => string
}

// ————————————————————————————————————————————————————————————————————————
// §9 Envelopes — the json contract (Layer 6, platform-proven)
// ————————————————————————————————————————————————————————————————————————

export interface SuccessEnvelope<T = unknown> {
  readonly ok: true
  /** Stable dotted command id derived from the mount path ('db.migrate'). */
  readonly command: string
  /** The presented data (json view override when supplied). */
  readonly result: T
  /** Aggregated from severity-'warn' message events. */
  readonly warnings: readonly string[]
  /** Derived from nextActions — the human-string form. */
  readonly nextSteps: readonly string[]
  readonly nextActions: readonly NextAction[]
}

export interface ErrorEnvelope {
  readonly ok: false
  readonly command: string
  /** The CliErrorEnvelope fields (code, severity, summary, why, fix,
   *  where, meta, docsUrl) — nested, per the settled envelope rule. */
  readonly error: unknown
  readonly warnings: readonly string[]
  readonly nextSteps: readonly string[]
  readonly nextActions: readonly NextAction[]
}

/** One NDJSON line per event in json mode. */
export interface EventFrame {
  readonly type: EngineEvent['kind']
  readonly command: string
  /** ISO 8601 UTC. Injectable clock in tests (§11). */
  readonly timestamp: string
  readonly data: EngineEvent
}

// ————————————————————————————————————————————————————————————————————————
// §10 Product export and shell mounting — R12: the shell owns the tree
// ————————————————————————————————————————————————————————————————————————

/** What a product package exports: NAMED commands, no paths. */
export type CommandSet = Readonly<Record<string, AnyCommand>>

/**
 * Shell-side construction. Mount keys are space-separated paths
 * ('db migrate'); group help text is declared with the mount, since
 * groups belong to the tree, not to products. Collisions, unknown
 * groups, and grammar violations fail construction (build time, not
 * run time).
 */
export declare function createCli(spec: {
  readonly name: string
  readonly version: string
  readonly groups: Readonly<Record<string, { readonly brief: string }>>
  readonly commands: Readonly<Record<string, AnyCommand>>
}): Cli

export interface Cli {
  /**
   * Parse, execute, render, return the exit code. The engine never calls
   * process.exit and never touches streams other than the ones provided.
   * Auto-selects json mode when runtime.isTty.stdout is false (deliberate
   * agent-facing behavior), unless the command is raw.
   */
  run(argv: readonly string[], runtime: Runtime): Promise<number>
}

/** Everything environmental, injected once by the bin (or by a test). */
export interface Runtime {
  readonly stdout: NodeJS.WritableStream
  readonly stderr: NodeJS.WritableStream
  readonly stdin: NodeJS.ReadableStream
  readonly cwd: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly isTty: { readonly stdin: boolean; readonly stdout: boolean; readonly stderr: boolean }
  readonly signal: AbortSignal
  /** Loaded config + per-section diagnostics; the shell builds this via
   *  the unified loader (R10). Tests hand in fixtures. */
  readonly config: LoadedConfig
  readonly getCredentials: () => Promise<Credentials | undefined>
}

export interface LoadedConfig {
  /** Raw section values by name; validation happens per command via its
   *  ConfigSection token. */
  readonly sections: Readonly<Record<string, unknown>>
  /** File-level problems (unevaluable module, missing version marker) —
   *  section: null fails every command. */
  readonly diagnostics: ReadonlyArray<{
    readonly section: string | null
    readonly error: CliStructuredError
  }>
}

// ————————————————————————————————————————————————————————————————————————
// §11 The product-repo test harness — R7: same machinery, bytes out
// ————————————————————————————————————————————————————————————————————————

export declare function createTestCli(spec: {
  readonly commands: Readonly<Record<string, AnyCommand>>
  readonly groups?: Readonly<Record<string, { readonly brief: string }>>
  readonly config?: Readonly<Record<string, unknown>>
  readonly credentials?: Credentials
  /** Fixed clock for deterministic EventFrame timestamps. */
  readonly now?: () => Date
}): TestCli

export interface TestCli {
  run(
    argv: readonly string[],
    opts?: {
      readonly stdin?: string
      /** Scripted prompt answers, consumed in order; a run that prompts
       *  past the script fails the test. */
      readonly answers?: ReadonlyArray<string | boolean>
      /** Abort the run (session tests): fires the context signal. */
      readonly abort?: AbortSignal
      readonly isTty?: { stdin?: boolean; stdout?: boolean; stderr?: boolean }
      readonly env?: Readonly<Record<string, string | undefined>>
    },
  ): Promise<{
    readonly exitCode: number
    readonly stdout: string
    readonly stderr: string
    /** Parsed json output (envelope + event frames) when json mode was on. */
    readonly json: readonly unknown[]
    /** Every EngineEvent the handler emitted, for semantic assertions. */
    readonly events: readonly EngineEvent[]
    /** The PresentedResult the handler returned (data + materialized
     *  views), for semantic assertions without byte-scraping. */
    readonly presented?: PresentedResult<unknown>
  }>
}
