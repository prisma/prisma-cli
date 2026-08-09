/**
 * DRAFT v6 — the unified CLI engine's public interface.
 * v1 initial · v2 round-1 fixes · v3 return-site presentation ·
 * v4 completed/errored, --format, log levels, prompt defaults ·
 * v5 round-3 closure · v6 operator line review: Diagnostic as a pure
 * data shape (findings are not thrown errors), warnings folded into
 * diagnostics, nextSteps deleted, commandId, flattened StreamEvent,
 * exitCode naming restored, result/session/server command kinds.
 * Prior versions preserved as -v1…-v5.ts; review artifacts in ./reviews/.
 *
 * THE MODEL, in one analogy (operator, 2026-08-09): commands settle like
 * promises. A command can COMPLETE — and its completion can be
 * successful or unsuccessful, both presented through the same machinery,
 * distinguished by exit code and diagnostics — or it can ERROR, which
 * aborts out of the normal process and gets its own special handling.
 *
 * Implementation prerequisite: ADR 239 (prisma/prisma) is amended so
 * completed-but-unsuccessful command results (verify/check/runner
 * findings) are carried as diagnostics with their dotted codes inside a
 * completed envelope with a documented exit code — not as structured
 * failures with exit 2, as it classifies them today. The amendment also
 * checks whether any shipped error uses severity 'info'; if none does,
 * the severity scale of CliStructuredError and Diagnostic trims to
 * error|warn — together, so the two shapes stay identical.
 *
 * Everything a product package imports for CLI purposes lives here (R3).
 * Requirement references (R1–R14) point at docs/architecture/
 * cli-engine-requirements.md in prisma-cli. Nothing from stricli appears —
 * it is an internal of the engine package.
 *
 * EXECUTION PROTOCOL. A handler receives (args, context), emits zero or
 * more events through context.report, and finishes one of two ways:
 *
 *   COMPLETED — it returns ok(ctx.present(data, presentations, opts)):
 *   the command executed to its end and has a result. A completed result
 *   may still be bad news; it carries diagnostics (recorded findings —
 *   data, not thrown errors) and an exit code from the command's
 *   documented set (`migration check` completes, presents its findings
 *   like any result, and exits 4). Presentation always runs for
 *   completed results.
 *
 *   ERRORED — it returns notOk(structuredError): the command did not
 *   complete. The engine renders the error envelope; there is no product
 *   presentation on the error path. The primary error of an errored
 *   command is severity 'error' by definition — a warning cannot abort a
 *   command. `remediation` events emitted before the error are
 *   aggregated into the errored envelope's nextActions.
 *
 * Session commands run until context.signal fires, then clean up and
 * return. Server commands hand the stdio conversation to a foreign
 * client. Liveness display is the engine's (shown when a command runs
 * quietly past a threshold). Nothing product-authored executes after the
 * handler resolves — the engine receives values, never callbacks.
 *
 * FORMATS AND LEVELS. `--format <human|json>`, auto-selected when
 * unspecified (human on a TTY stdout, json otherwise — deliberate
 * agent-facing behavior); `--json` is shorthand for `--format json`. In
 * json mode the engine suppresses prompts (they fail structurally) and
 * emits one StreamEvent per line. Commentary is filtered by `--log-level
 * <error|warn|info|verbose>` (default info); `--verbose` is shorthand
 * for `--log-level verbose`. The engine injects the shared flag family
 * on every non-server command: --format/--json, --log-level/-v/
 * --verbose, -q/--quiet, -y/--yes, --interactive/--no-interactive,
 * --color/--no-color. Products cannot declare flags with those names.
 * Product flag keys are camelCase and transliterate to --kebab-case.
 *
 * EXIT CODES (R6): 0 completed; 1 bug only; 2 errored (expected,
 * structured); 3 user abort (Ctrl-C, or cancelling a prompt the command
 * cannot proceed without); 4–99 documented per command in `exitCodes`;
 * 130/143 delivered signals. The engine owns signal wiring: first signal
 * fires context.signal and awaits handler teardown; a second signal
 * exits immediately with the signal's code.
 */

// ————————————————————————————————————————————————————————————————————————
// Foundation types (from the zero-dependency foundation package — which
// owns CliStructuredError, Result, NextAction, and Diagnostic, so the
// engine and both repos share them without cycles). Shown for reading
// convenience.
// ————————————————————————————————————————————————————————————————————————

import type { CliStructuredError, Diagnostic, NextAction, Result } from '@prisma/cli-foundation'

/*
 * For reference — the foundation shapes this file leans on:
 *
 * Diagnostic — a recorded finding: pure data, never thrown, no stack.
 *   { code: 'NAMESPACE.SUBCODE', severity: 'error' | 'warn' | 'info',
 *     summary, why?, fix?, where?, meta?, docsUrl? }
 *   Field-for-field the settled error envelope (ADR 239) minus `ok` —
 *   identical scales included; the two shapes never diverge.
 *   CliStructuredError.toEnvelope() yields exactly this shape, so a
 *   thrown error and a recorded finding share one wire form. Aggregate
 *   operations (db verify, migration check, config validation) COLLECT
 *   Diagnostics; they do not construct Error instances per finding.
 *
 * NextAction — the typed agent-facing follow-up (platform-shipped form):
 *   { kind: 'run-command' | 'user-choice' | 'edit-file' | 'done',
 *     journey, label, command?, commands?, reason? }
 */

/** The commentary severity scale; also the log-level axis. Distinct from
 *  Diagnostic severity (error|warn): 'info' and 'verbose' grade
 *  commentary, which never enters the envelope. Step outcomes are
 *  completion states, not severities. */
export type Severity = 'error' | 'warn' | 'info' | 'verbose'
export type LogLevel = Severity

export type Format = 'human' | 'json'

// ————————————————————————————————————————————————————————————————————————
// §1 Events — R14: one engine vocabulary, product extensions in `data`
// ————————————————————————————————————————————————————————————————————————

/**
 * The engine event envelope. `kind`-specific fields are the common
 * vocabulary the engine renders consistently (human mode) and streams
 * (json mode, §9). `data` is the product extension: passed through to
 * machine consumers untouched, never interpreted by the engine,
 * documented and versioned by the product as its own public API. A
 * structure recurring inside `data` across commands is the promotion
 * signal (R14).
 *
 * Rendering, human mode: `output` events with channel 'data' are the
 * command's data and go to OUR stdout (what `log tail > file` captures);
 * everything else is commentary on stderr, filtered by the active log
 * level (`message` events by their severity; other kinds display at
 * info). Events are transcript: they are NOT aggregated into the
 * envelope (the one exception is `remediation` → nextActions). Findings
 * that belong in the envelope are diagnostics on the presented result,
 * not events.
 *
 * report() is synchronous fire-and-forget; the engine buffers and writes
 * asynchronously (no backpressure signal — accepted trade). Calling it
 * after the handler has resolved is a bug (InternalError). Events during
 * teardown (after the signal, before resolution) are normal.
 */
export type EngineEvent =
  /** A named phase began. `id`/`parentId` express nesting; omitted for
   *  flat steps. */
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
  /** Progress inside a phase (counts, not percentages). */
  | {
      readonly kind: 'progress'
      readonly step?: string
      readonly completed: number
      readonly total?: number
      readonly data?: unknown
    }
  /** A line of commentary at a severity; display-filtered by log level.
   *  Transcript only — never enters the envelope. 'error' is not valid
   *  here: fatal problems are the Result's error; envelope-worthy
   *  findings are diagnostics. */
  | {
      readonly kind: 'message'
      readonly severity: Exclude<Severity, 'error'>
      readonly text: string
      readonly data?: unknown
    }
  /** Line-oriented output from a child process or remote stream.
   *  `channel` is semantic: 'data' = the command's own output (our
   *  stdout); 'diagnostic' = commentary about the run (stderr). `source`
   *  names the emitter, not a pipe. */
  | {
      readonly kind: 'output'
      readonly source: string
      readonly channel: 'data' | 'diagnostic'
      readonly line: string
      readonly data?: unknown
    }
  /** A user-actionable follow-up surfaced mid-run. Aggregated into the
   *  final envelope's nextActions (completed OR errored). */
  | { readonly kind: 'remediation'; readonly action: NextAction; readonly data?: unknown }
  /** A reachable endpoint became available. */
  | {
      readonly kind: 'endpoint'
      readonly name: string
      readonly url: string
      readonly data?: unknown
    }
  /** A state transition in a watched external process; `from` carries
   *  the prior state when known. */
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
// §2 Presented results — presentation materializes at the return site
// ————————————————————————————————————————————————————————————————————————

declare const PRESENTED: unique symbol

/**
 * What a completed command's handler returns inside `ok(...)`: pure data
 * plus the presentation the ACTIVE FORMAT already materialized. Built
 * exclusively by ctx.present (the brand makes hand-construction a type
 * error) — the context knows the format, calls only the presentation
 * functions it needs, and the value crossing the product→engine boundary
 * is data all the way down.
 *
 * `data` is always present and is what the envelope's `result`
 * serializes (json presentation overrides when supplied). Materialization
 * by format: human → human + stdout + next; human+--quiet → stdout;
 * json → json + next.
 */
export interface PresentedResult<T> {
  readonly [PRESENTED]: true
  readonly data: T
  /** The exit code selected at the return site; typed against the
   *  definition's documented `exitCodes`. Omitted = 0. */
  readonly exitCode?: number
  /**
   * The completed result's recorded findings (drift, verify failures) —
   * Diagnostics: data, never thrown. Declared ONCE here; the engine
   * renders them in human mode with the same layout as top-level errors
   * (shown even under --quiet) AND carries them verbatim into
   * CompletedEnvelope.diagnostics. One declaration, both surfaces,
   * impossible to diverge. Guardrail (runtime, at the return site): any
   * severity-'error' entry requires a non-zero exitCode — a genuine
   * could-not-complete belongs in notOk. The test: notOk when the
   * command couldn't do its job; diagnostics when finding these WAS the
   * job.
   */
  readonly diagnostics?: readonly Diagnostic[]
  readonly presentation: {
    readonly human?: readonly Block[]
    readonly stdout?: readonly string[]
    readonly json?: unknown
    readonly next?: readonly NextAction[]
  }
}
export { PRESENTED }

/**
 * The per-format presentation functions a handler supplies to
 * ctx.present. Only the active format's functions are invoked, at the
 * return site, where the outcome and its context are live. `human`
 * composes engine primitives (R5: Block is the only vocabulary);
 * `stdout` is the machine-consumable data lines the engine writes to
 * stdout — what --quiet leaves, what a pipe receives; `json` overrides
 * the envelope's `result` (default: the data itself); `next` supplies
 * the typed nextActions — agents branch on them; the human renderer
 * formats them as prose (no stored string form).
 */
export interface Presentations {
  readonly human: (ui: Ui) => readonly Block[]
  readonly stdout?: () => readonly string[]
  readonly json?: () => unknown
  readonly next?: () => readonly NextAction[]
}

// ————————————————————————————————————————————————————————————————————————
// §3 Config sections — R10 made structural
// ————————————————————————————————————————————————————————————————————————

/**
 * A product's named slice of prisma.config.ts. The token couples the
 * section name, its validated type, and its total validator — which
 * RETURNS findings (Diagnostics); it never throws (R10). Commands bind
 * to the token, which is how the engine knows which section a command
 * needs — and therefore which diagnostics fail which commands. Keep
 * validators dependency-light: they load with the definition tree at
 * startup (R9).
 */
export interface ConfigSection<T> {
  readonly name: string
  readonly validate: (raw: unknown) => SectionValidation<T>
}

export type SectionValidation<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export declare function defineConfigSection<T>(spec: {
  readonly name: string
  readonly validate: (raw: unknown) => SectionValidation<T>
}): ConfigSection<T>

// ————————————————————————————————————————————————————————————————————————
// §4 The handler context — R4: the whole world arrives as one argument
// ————————————————————————————————————————————————————————————————————————

export interface CommandContext<TConfig = undefined, TCode extends number = never> {
  /** The validated value of the command's declared config section, or
   *  undefined when the config file has no such section. An INVALID
   *  needed section never reaches the handler — the engine already
   *  failed the command with that section's diagnostics. */
  readonly config: TConfig | undefined

  /** Builds the PresentedResult for the active format: calls only the
   *  presentation functions this format needs, at the return site. The
   *  only constructor of PresentedResult. `exitCode` is typed against
   *  the definition's documented `exitCodes` — a code outside them is a
   *  compile error at the call site. `diagnostics` are the completed
   *  result's recorded findings (see PresentedResult). */
  readonly present: <T>(
    data: T,
    presentations: Presentations,
    opts?: {
      readonly exitCode?: TCode
      readonly diagnostics?: readonly Diagnostic[]
    },
  ) => PresentedResult<T>

  /** Management-API credentials, resolved at call time so long-lived
   *  sessions survive token refresh. Undefined when unauthenticated.
   *  Commands declaring `requiresCredentials` never see undefined — the
   *  engine fails them early with the sign-in error. */
  readonly getCredentials: () => Promise<Credentials | undefined>

  /** The one way to emit while running (§1). */
  readonly report: (event: EngineEvent) => void

  /** Interactive input (§4a). */
  readonly prompt: PromptSurface

  /** Fires on Ctrl-C/SIGTERM (engine-owned; the engine records which
   *  signal for the 130/143 exit, and force-exits on a second signal).
   *  Session commands run until it fires; everything else aborts
   *  in-flight work with it. */
  readonly signal: AbortSignal

  /** Where the user invoked the CLI. Products never read process.cwd(). */
  readonly cwd: string

  /** R13: probe an optional peer dependency's availability from the
   *  user's project. Never throws; never installs. Pair with
   *  `packageManager` to phrase the install command in the structured
   *  error when it's absent. */
  readonly probeDependency: (specifier: string) => Promise<boolean>

  /** The user's detected package manager, for install-command phrasing. */
  readonly packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown'
}

export interface Credentials {
  /** Opaque to the engine; shape owned by the Cloud product's auth
   *  library (placeholder pending its design). */
  readonly token: string
  readonly workspaceId?: string
}

/**
 * §4a Prompts. Every prompt except `consent` may carry a
 * product-specified `default`. Interactively, Enter accepts the default.
 * Under --yes, a prompt WITH a default resolves to it without
 * displaying; a prompt WITHOUT a default cannot be operated and the
 * invocation halts with a structured error (exit 2). In
 * json/non-interactive/CI/non-TTY contexts the same default rule
 * applies as under --yes. User cancellation (Ctrl-C at the prompt) is a
 * distinct structured error the engine maps to exit 3.
 */
export interface PromptSurface {
  readonly confirm: (
    question: string,
    opts?: { readonly default?: boolean },
  ) => Promise<Result<boolean, CliStructuredError>>
  /**
   * A question requiring EXPLICIT consent — not necessarily destructive,
   * but never inferable. Structurally undefaultable: no default
   * parameter exists, so --yes, Enter-through, and non-interactive
   * contexts can never satisfy it; without a TTY it returns the
   * interaction-required structured error, and the command's fix names
   * the explicit flag that grants consent non-interactively.
   */
  readonly consent: (question: string) => Promise<Result<boolean, CliStructuredError>>
  readonly select: <T extends string>(
    question: string,
    options: ReadonlyArray<{ value: T; label: string }>,
    opts?: { readonly default?: T },
  ) => Promise<Result<T, CliStructuredError>>
  readonly text: (
    question: string,
    opts?: { readonly placeholder?: string; readonly default?: string },
  ) => Promise<Result<string, CliStructuredError>>
}

// ————————————————————————————————————————————————————————————————————————
// §5 Flags and positionals — R1: directly executable, typed by inference
// ————————————————————————————————————————————————————————————————————————

/**
 * Product-declared flags. The shared family (§header) is engine-injected
 * and reserved; handlers never see those values. Parse-time validation
 * failures become structured errors carrying the allowed values — never
 * framework strings.
 *
 * Deliberate asymmetry, matching CLI convention: flags are optional by
 * default (requiredString is the exception); positionals are required by
 * default (optionalString is the exception).
 */
export declare const flag: {
  string<A extends string = never>(spec: {
    brief: string
    placeholder?: string
    alias?: A & Char<A>
    default?: string
  }): FlagSpec<string | undefined>
  requiredString<A extends string = never>(spec: {
    brief: string
    placeholder?: string
    alias?: A & Char<A>
  }): FlagSpec<string>
  number<A extends string = never>(spec: {
    brief: string
    placeholder?: string
    alias?: A & Char<A>
    default?: number
  }): FlagSpec<number | undefined>
  boolean<A extends string = never>(spec: { brief: string; alias?: A & Char<A> }): FlagSpec<boolean>
  enum<const T extends readonly string[], A extends string = never>(spec: {
    brief: string
    values: T
    alias?: A & Char<A>
    default?: T[number]
  }): FlagSpec<T[number] | undefined>
  repeated<A extends string = never>(spec: {
    brief: string
    placeholder?: string
    alias?: A & Char<A>
  }): FlagSpec<readonly string[]>
}

/** Single-character alias, enforced at the type level: `Char<'q'>` is
 *  'q'; `Char<'ab'>` is never. */
export type Char<S extends string> = S extends `${string}${infer Rest}`
  ? Rest extends ''
    ? S
    : never
  : never

declare const FLAG: unique symbol
export interface FlagSpec<T> {
  /** Phantom carrier for inference; exported so declaration emit works. */
  readonly [FLAG]: T
}
export { FLAG }

export declare const positional: {
  string(spec: { brief: string; placeholder: string }): PositionalSpec<string>
  optionalString(spec: { brief: string; placeholder: string }): PositionalSpec<string | undefined>
  /** Zero or more trailing values; at most one, declared last (order =
   *  declaration order; keys must not be integer-like). */
  variadic(spec: { brief: string; placeholder: string }): PositionalSpec<readonly string[]>
}
declare const POSITIONAL: unique symbol
export interface PositionalSpec<T> {
  readonly [POSITIONAL]: T
}
export { POSITIONAL }

/** What a handler receives: separate namespaces, symmetric access —
 *  `args.flags.to`, `args.positionals.name`. */
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
// §6 Command definitions — light at startup (R9), path-free (R12),
// runtime-discriminated by `kind` (stamped by the define* functions).
// Three modalities at equal rank: a result command runs to completion
// and presents; a session command runs until told to stop, speaking
// through events; a server command hands the stdio conversation to a
// foreign client.
// ————————————————————————————————————————————————————————————————————————

export interface CommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
  TCode extends number = never,
> {
  readonly kind: 'result-command'
  /** One line, imperative, shown in listings. */
  readonly brief: string
  /** Paragraph(s) for --help. Words only — the engine formats. */
  readonly description?: string
  /** Copy-pastable invocations, shown verbatim in help. */
  readonly examples?: readonly string[]

  readonly flags?: TFlags
  readonly positionals?: TPositionals

  /** Binds the command to its product's config section (§3). */
  readonly configSection?: ConfigSection<TConfig>

  /** Fail early with the sign-in error when unauthenticated; the handler
   *  then always receives credentials. */
  readonly requiresCredentials?: boolean

  /**
   * The command's documented exit codes (4–99): code → meaning.
   * Rendered in help without executing anything; the keys type
   * ctx.present's exitCode, so a code outside them is a compile error
   * at the return site. Absent = the command only exits 0/1/2/3.
   */
  readonly exitCodes?: Readonly<Record<TCode, string>>

  /** The heavy part, loaded only at execution (R9). The module's default
   *  export is the handler — annotate it with CommandHandler<typeof def>
   *  (type-only import of the light definition; no runtime cycle). */
  readonly handler: () => Promise<{ default: Handler<TFlags, TPositionals, TConfig, TCode> }>
}

export type Handler<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
  TConfig,
  TCode extends number = never,
> = (
  args: Args<TFlags, TPositionals>,
  ctx: CommandContext<TConfig, TCode>,
) => Promise<Result<PresentedResult<unknown>, CliStructuredError>>

/** For impl files: `const run: CommandHandler<typeof migrateCommand> = …` */
export type CommandHandler<D> = D extends CommandDefinition<infer F, infer P, infer C, infer K>
  ? Handler<F, P, C, K>
  : never

export declare function defineCommand<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
  TCode extends number = never,
>(
  def: Omit<CommandDefinition<TFlags, TPositionals, TConfig, TCode>, 'kind'>,
): CommandDefinition<TFlags, TPositionals, TConfig, TCode>

/**
 * A session command (dev, log tail): the handler runs until the signal
 * fires, speaks entirely through events, and returns Result<void>. No
 * presentation (the engine owns the close-out line), no exit-code set.
 * A session always supports json mode: the event stream is its json
 * surface.
 */
export interface SessionCommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
> {
  readonly kind: 'session-command'
  readonly brief: string
  readonly description?: string
  readonly examples?: readonly string[]
  readonly flags?: TFlags
  readonly positionals?: TPositionals
  readonly configSection?: ConfigSection<TConfig>
  readonly requiresCredentials?: boolean
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
>(
  def: Omit<SessionCommandDefinition<TFlags, TPositionals, TConfig>, 'kind'>,
): SessionCommandDefinition<TFlags, TPositionals, TConfig>

/**
 * A server command (lsp): a foreign client on the other end of stdio
 * owns the conversation, so the engine hands over the streams. Events,
 * presentation, formats, and prompts do not apply — by definition, not
 * by opt-out; the handler returns the exit code directly. Flags and
 * config are allowed; the shared flag family is NOT injected.
 */
export interface ServerCommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TConfig = undefined,
> {
  readonly kind: 'server-command'
  readonly brief: string
  readonly description?: string
  readonly flags?: TFlags
  readonly configSection?: ConfigSection<TConfig>
  readonly handler: () => Promise<{
    default: (
      args: Args<TFlags, {}>,
      io: {
        readonly stdin: InputStream
        readonly stdout: OutputStream
        readonly stderr: OutputStream
        readonly signal: AbortSignal
        readonly cwd: string
        readonly config: TConfig | undefined
      },
    ) => Promise<number>
  }>
}

export declare function defineServerCommand<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TConfig = undefined,
>(
  def: Omit<ServerCommandDefinition<TFlags, TConfig>, 'kind'>,
): ServerCommandDefinition<TFlags, TConfig>

/** Erased union for mount maps; `kind` is the runtime discriminant. */
export type AnyCommand =
  | CommandDefinition<any, any, any, any>
  | SessionCommandDefinition<any, any, any>
  | ServerCommandDefinition<any, any>

// ————————————————————————————————————————————————————————————————————————
// §7 Presentation primitives — the R5 vocabulary
// ————————————————————————————————————————————————————————————————————————

/** Deliberately small; grows by the same evidence rule as events. */
export type Block =
  | {
      readonly kind: 'summary'
      readonly tone: 'ok' | 'error' | 'warn' | 'info'
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
// NOTE: recorded findings are NOT a Block — they are diagnostics on the
// presented result; the engine renders them with the top-level error
// layout and carries them into the envelope, so the two surfaces cannot
// diverge.

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
// §8 Streams — minimal structural types; no NodeJS.* in the public
// surface (runtime-agnosticism, R4's why)
// ————————————————————————————————————————————————————————————————————————

export interface OutputStream {
  write(text: string): void
}
/** Byte-oriented, so server commands can implement byte-counted
 *  protocols (lsp's Content-Length framing). Decoding is the consumer's
 *  business; the engine's own prompt machinery decodes internally.
 *  setRawMode is present where the platform supports keypress input. */
export interface InputStream extends AsyncIterable<Uint8Array> {
  readonly setRawMode?: (enabled: boolean) => void
}

// ————————————————————————————————————————————————————————————————————————
// §9 Envelopes and the json stream
// ————————————————————————————————————————————————————————————————————————

export interface CompletedEnvelope<T = unknown> {
  /** ok = COMPLETED (the command executed to its end). A completed
   *  result may still carry findings and a non-zero exit code — bad news
   *  is a result, not an error. */
  readonly ok: true
  /** The command's stable dotted identity — its full mount path
   *  ('project.env.add'). The schema-dispatch key for machine consumers;
   *  says nothing about arguments. */
  readonly commandId: string
  /** The presented data (json presentation override when supplied). */
  readonly result: T
  /** From the documented set; 0 when unset. */
  readonly exitCode: number
  /** The recorded findings, verbatim from the presented result. */
  readonly diagnostics: readonly Diagnostic[]
  readonly nextActions: readonly NextAction[]
}

export interface ErroredEnvelope {
  /** ok = false: the command did NOT complete. */
  readonly ok: false
  readonly commandId: string
  /** The PRIMARY error — what aborted the command. Severity 'error' by
   *  definition. Shape: Diagnostic (a thrown CliStructuredError
   *  serializes to exactly this). */
  readonly error: Diagnostic
  /** Accompanying findings when the abort had several (three config
   *  typos are three diagnostics, not one flattened error). */
  readonly diagnostics: readonly Diagnostic[]
  /** Aggregated from remediation events. */
  readonly nextActions: readonly NextAction[]
}

/**
 * json mode emits one StreamEvent per line: the handler's events,
 * flattened with the stream metadata, then exactly one terminal
 * 'result' member carrying the envelope. One union, one discriminant
 * (`kind`).
 */
export type StreamEvent =
  | (EngineEvent & StreamMeta)
  | ({ readonly kind: 'result'; readonly envelope: CompletedEnvelope | ErroredEnvelope } & StreamMeta)

export interface StreamMeta {
  readonly commandId: string
  /** ISO 8601 UTC. Injectable clock in tests (§11). */
  readonly timestamp: string
}

// ————————————————————————————————————————————————————————————————————————
// §10 Product export and shell mounting — R12: the shell owns the tree
// ————————————————————————————————————————————————————————————————————————

/** What a product package exports: commands by NAME. */
export type CommandSet = Readonly<Record<string, AnyCommand>>

/** What the shell builds: commands by PATH (space-separated,
 *  'db migrate'). Distinct alias so the two maps never read as one. */
export type MountedTree = Readonly<Record<string, AnyCommand>>

/**
 * Shell-side construction. Group help is declared with the mount, since
 * groups belong to the tree, not to products. Collisions, unknown
 * groups, reserved-flag violations, and grammar violations fail
 * construction (build time, not run time).
 */
export declare function createCli(spec: {
  readonly name: string
  readonly version: string
  readonly groups: Readonly<Record<string, { readonly brief: string; readonly description?: string }>>
  readonly commands: MountedTree
}): Cli

export interface Cli {
  /** Parse, execute, render, return the exit code. Never calls
   *  process.exit; never touches streams other than the provided ones. */
  run(argv: readonly string[], runtime: Runtime): Promise<number>
}

/** Everything environmental, injected once by the bin (or by a test). */
export interface Runtime {
  readonly stdout: OutputStream
  readonly stderr: OutputStream
  readonly stdin: InputStream
  readonly cwd: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly isTty: { readonly stdin: boolean; readonly stdout: boolean; readonly stderr: boolean }
  readonly signal: AbortSignal
  /** Loaded config + per-section diagnostics; the shell builds this via
   *  the unified loader (R10). Tests hand in fixtures. */
  readonly config: LoadedConfig
  readonly getCredentials: () => Promise<Credentials | undefined>
  readonly packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown'
}

export interface LoadedConfig {
  /** Raw section values by name; validation happens per command via its
   *  ConfigSection token. */
  readonly sections: Readonly<Record<string, unknown>>
  /** File-level problems (unevaluable module, missing version marker) —
   *  section: null fails every command. */
  readonly diagnostics: ReadonlyArray<{
    readonly section: string | null
    readonly diagnostic: Diagnostic
  }>
}

// ————————————————————————————————————————————————————————————————————————
// §11 The product-repo test harness — R7: same machinery, bytes out
// ————————————————————————————————————————————————————————————————————————

export declare function createTestCli(spec: {
  readonly commands: MountedTree
  readonly groups?: Readonly<Record<string, { readonly brief: string }>>
  readonly config?: Readonly<Record<string, unknown>>
  readonly credentials?: Credentials
  readonly packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown'
  /** Fixed clock for deterministic stream timestamps. */
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
      /** Live event tap, for asserting mid-session behavior before
       *  aborting. */
      readonly onEvent?: (event: EngineEvent) => void
      readonly cwd?: string
      readonly isTty?: { stdin?: boolean; stdout?: boolean; stderr?: boolean }
      readonly env?: Readonly<Record<string, string | undefined>>
    },
  ): Promise<{
    readonly exitCode: number
    readonly stdout: string
    readonly stderr: string
    /** Parsed stream (events + the terminal result) when json mode. */
    readonly json: readonly StreamEvent[]
    /** Every EngineEvent the handler emitted, for semantic assertions. */
    readonly events: readonly EngineEvent[]
    /** The PresentedResult the handler returned (data + materialized
     *  presentation), for semantic assertions without byte-scraping. */
    readonly presented?: PresentedResult<unknown>
  }>
}
