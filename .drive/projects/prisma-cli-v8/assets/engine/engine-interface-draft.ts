/**
 * DRAFT v8 — the unified CLI engine's public interface.
 * v1 initial · v2 round-1 fixes · v3 return-site presentation ·
 * v4 completed/errored, --format, log levels, prompt defaults ·
 * v5 round-3 closure · v6 Diagnostic, warnings fold, stream flatten ·
 * v7 outcome-first present, help/args/needs, command families ·
 * v8 packaging and residue rulings: ONE library package
 * (@prisma/cli-engine, with @stricli/core as an ordinary exact-pinned
 * dependency — bundling was considered and rejected: unusual for a
 * library, blinds security audit; R3's hiding is about types, which no
 * dependency violates) with a ./protocol subpath for types-only
 * consumers;
 * NextAction.journey dropped (no consumer); docs URLs derived from a
 * family-supplied base; committed versions for releases; auth library
 * lives in the CLI repo, distinct from Prisma Cloud. Prior versions
 * preserved as -v1…-v7.ts; reviews in ./reviews/.
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
 * error|warn — together, so the two shapes stay identical. The
 * amendment also adopts the `fix` → typed `nextActions` rename
 * (operator ruling, 2026-08-09), for the same reason.
 *
 * Everything a package imports for CLI purposes lives here (R3).
 * Requirement references (R1–R14) point at docs/architecture/
 * cli-engine-requirements.md in prisma-cli. Nothing from stricli appears —
 * it is an internal of the engine package.
 *
 * EXECUTION PROTOCOL. A handler receives (args, context), emits zero or
 * more events through context.report, and finishes one of two ways:
 *
 *   COMPLETED — it returns ok(ctx.present(outcome, presentations)): the
 *   command executed to its end. The outcome is what it concluded —
 *   data, diagnostics (recorded findings — data, never thrown), and,
 *   when the command documents exit codes, an explicit code at every
 *   return site. Presentation always runs for completed results.
 *
 *   ERRORED — it returns notOk(structuredError): the command did not
 *   complete. The engine renders the error envelope; there is no command
 *   presentation on the error path. The primary error is severity
 *   'error' by definition and carries its own typed `nextActions`
 *   (operator ruling, 2026-08-09: `fix` renamed — fix and nextActions
 *   solved the same problem); the envelope copies them.
 *
 * PRECONDITIONS (a command's `needs`) are enforced by the engine BEFORE
 * the handler runs: an invalid needed config section, missing
 * credentials, an absent optional dependency, or a non-interactive
 * context each fail the command early with the engine's own structured
 * error — a handler only ever runs in a world where it can operate.
 *
 * Session commands run until context.signal fires, then clean up and
 * return. Server commands hand the stdio conversation to a foreign
 * client. Liveness display is the engine's. Nothing command-family-authored
 * executes after the handler resolves.
 *
 * FORMATS AND LEVELS. `--format <human|json>`, auto-selected when
 * unspecified (human on a TTY stdout, json otherwise); `--json` is
 * shorthand for `--format json`. In json mode the engine emits one
 * StreamEvent per line. Format selects output shape ONLY (operator
 * ruling, 2026-08-09): interactivity is detected from the environment
 * (TTY stdin outside CI) and overridden by
 * `--interactive`/`--no-interactive`. An interactive json run may
 * prompt — the prompt UI writes to stderr, so stdout stays a clean
 * frame stream; a non-interactive prompt with no default fails
 * structurally.
 * Commentary is filtered by `--log-level <error|warn|info|verbose>`
 * (default info); `--verbose` is shorthand for `--log-level verbose`;
 * `-q/--quiet` for `--log-level error` (operator ruling, 2026-08-09: a
 * log-level alias only, not otherwise retained — it never changes what
 * a completed result renders).
 * CHANNELS, human mode (operator ruling, 2026-08-09): decoration goes
 * to stderr, machine-usable payload to stdout. Human Blocks,
 * next-action lines, and diagnostics are presentation prose on STDERR;
 * the `Presentations.stdout` payload lines (and `output` events with
 * channel 'data') are the only writes to STDOUT — human mode is
 * pipe-clean. json mode is unchanged: the frame stream owns stdout.
 * The engine injects the shared flag family on every non-server
 * command: --format/--json, --log-level/-v/--verbose, -q/--quiet,
 * -y/--yes, --interactive/--no-interactive, --color/--no-color.
 * Commands cannot declare flags with those names. Declared flag keys are
 * camelCase and transliterate to --kebab-case.
 *
 * EXIT CODES (R6): 0 completed; 1 bug only; 2 errored (expected,
 * structured); 3 user abort; 4–99 documented per command in
 * `exitCodes`; 130/143 delivered signals. The engine owns the whole
 * signal policy (operator ruling, 2026-08-09): the first delivered
 * signal fires context.signal and awaits teardown (settling 130/143);
 * a second exits immediately through the runtime's exit proxy — the
 * engine ends the process only ever via Runtime.exit.
 */

// ————————————————————————————————————————————————————————————————————————
// Protocol types — the ./protocol subpath of this same package: the
// shapes that cross package and process boundaries (CliStructuredError,
// Result, NextAction, Diagnostic). Types-only consumers (the repos'
// duplicated foundations, external tools) import the subpath and drag
// nothing else. Shown for reading convenience.
// ————————————————————————————————————————————————————————————————————————

import type { CliStructuredError, Diagnostic, NextAction, Result } from '@prisma/cli-engine/protocol'

/*
 * For reference — the foundation shapes this file leans on:
 *
 * Diagnostic — a recorded finding: pure data, never thrown, no stack.
 *   { code: 'NAMESPACE.SUBCODE', severity: 'error' | 'warn' | 'info',
 *     summary, why?, nextActions?: readonly NextAction[], where?,
 *     meta?, docsUrl? }
 *   `fix` prose is gone (operator ruling, 2026-08-09): remediation is
 *   typed nextActions, rendered as → lines in human mode.
 *   Field-for-field the settled error envelope (ADR 239) minus `ok` —
 *   identical scales included; the two shapes never diverge (the ADR
 *   239 amendment adopts the same rename).
 *
 * NextAction — the typed agent-facing follow-up (platform-shipped form,
 * minus its `journey` grouping label — dropped: no consumer branches on
 * it; R14's evidence rule readmits it if one appears):
 *   { kind: 'run-command' | 'user-choice' | 'edit-file' | 'done',
 *     label, command?, commands?, reason? }
 */

/** The commentary severity scale; also the log-level axis. Distinct from
 *  Diagnostic severity: 'verbose' grades commentary, which never enters
 *  the envelope. Step outcomes are completion states, not severities. */
export type Severity = 'error' | 'warn' | 'info' | 'verbose'
export type LogLevel = Severity

export type Format = 'human' | 'json'

// ————————————————————————————————————————————————————————————————————————
// §1 Events — R14: one engine vocabulary, command-family extensions in `data`
// ————————————————————————————————————————————————————————————————————————

/**
 * The engine event envelope. `kind`-specific fields are the common
 * vocabulary the engine renders consistently (human mode) and streams
 * (json mode, §9). `data` is the command family's extension: passed through to
 * machine consumers untouched, never interpreted by the engine,
 * documented and versioned by the owning command family as its own public API. A
 * structure recurring inside `data` across commands is the promotion
 * signal (R14).
 *
 * Rendering, human mode: `output` events with channel 'data' are the
 * command's data and go to OUR stdout; everything else is commentary on
 * stderr, filtered by the active log level. Events are transcript: they
 * are NEVER aggregated into any envelope (`remediation` included — it
 * is transcript-only, framed in json mode, unrendered in human mode).
 * Follow-ups are handler-owned: completed via `presentations.next`,
 * errored via the error's own `nextActions`. Findings that belong in
 * the envelope are diagnostics on the presented outcome, not events.
 *
 * report() is synchronous fire-and-forget; the engine buffers and writes
 * asynchronously. Calling it after the handler has resolved is a bug
 * (InternalError). Events during teardown (after the signal, before
 * resolution) are normal.
 */
export type EngineEvent =
  | {
      readonly kind: 'step-started'
      readonly step: string
      readonly id?: string
      readonly parentId?: string
      readonly data?: unknown
    }
  | {
      readonly kind: 'step-finished'
      readonly step: string
      readonly id?: string
      readonly outcome: 'ok' | 'failed' | 'skipped' | 'warning'
      readonly data?: unknown
    }
  | {
      readonly kind: 'progress'
      readonly step?: string
      readonly completed: number
      readonly total?: number
      readonly data?: unknown
    }
  /** Commentary at a severity; display-filtered by log level. Transcript
   *  only. 'error' is not valid here: fatal problems are the Result's
   *  error; envelope-worthy findings are diagnostics. */
  | {
      readonly kind: 'message'
      readonly severity: Exclude<Severity, 'error'>
      readonly text: string
      readonly data?: unknown
    }
  | {
      readonly kind: 'output'
      readonly source: string
      readonly channel: 'data' | 'diagnostic'
      readonly line: string
      readonly data?: unknown
    }
  /** Transcript-only: framed in json mode, never rendered in human
   *  mode, never aggregated into any envelope. */
  | { readonly kind: 'remediation'; readonly action: NextAction; readonly data?: unknown }
  | {
      readonly kind: 'endpoint'
      readonly name: string
      readonly url: string
      readonly data?: unknown
    }
  | {
      readonly kind: 'status'
      readonly subject: string
      readonly status: string
      readonly from?: string
      readonly data?: unknown
    }
  | {
      readonly kind: 'artifact'
      readonly path: string
      readonly description?: string
      readonly data?: unknown
    }

// ————————————————————————————————————————————————————————————————————————
// §2 Outcomes and presented results — presentation materializes at the
// return site
// ————————————————————————————————————————————————————————————————————————

/**
 * What a command concluded, stated at the return site. `exitCode` is
 * REQUIRED at every return site iff the command documents exit codes
 * (`0` for the clean path, a documented code otherwise — the type makes
 * forgetting impossible exactly where a decision exists) and forbidden
 * otherwise. `diagnostics` may be omitted at the call site; the
 * presented result always carries an array.
 */
export type Outcome<T, TCode extends number = never> = [TCode] extends [never]
  ? {
      readonly data: T
      readonly diagnostics?: readonly Diagnostic[]
    }
  : {
      readonly data: T
      readonly exitCode: TCode | 0
      readonly diagnostics?: readonly Diagnostic[]
    }

declare const PRESENTED: unique symbol

/**
 * What a completed command's handler returns inside `ok(...)`: the
 * outcome plus the presentation the ACTIVE FORMAT already materialized.
 * Built exclusively by ctx.present (the brand makes hand-construction a
 * type error) — the context knows the format, calls only the
 * presentation functions it needs, and the value crossing the
 * handler→engine boundary is data all the way down.
 *
 * `data` is what the envelope's `result` serializes (json presentation
 * overrides when supplied). Materialization by format: human → human +
 * stdout + next; json → json + next. Human rendering writes the blocks,
 * next-action lines, and diagnostics to stderr and the `stdout` lines
 * to stdout (§header CHANNELS).
 *
 * Guardrail (runtime, at the return site): a severity-'error' diagnostic
 * requires a non-zero exitCode — a genuine could-not-complete belongs in
 * notOk. The test: notOk when the command couldn't do its job;
 * diagnostics when finding these WAS the job.
 */
export interface PresentedResult<T> {
  readonly [PRESENTED]: true
  readonly data: T
  /** 0 unless the outcome selected a documented code. */
  readonly exitCode: number
  /** Never undefined; empty when the outcome recorded no findings. */
  readonly diagnostics: readonly Diagnostic[]
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
 * return site. `human` composes engine primitives (R5), rendered to
 * stderr; `stdout` is the machine-consumable data lines — what a pipe
 * receives, the human mode's only stdout writes; `json` overrides the
 * envelope's `result` (default: the
 * data); `next` supplies the typed nextActions — agents branch on them;
 * the human renderer formats them as prose on stderr (no stored string
 * form).
 */
export interface Presentations {
  readonly human: (ui: Ui) => readonly Block[]
  readonly stdout?: () => readonly string[]
  readonly json?: () => unknown
  readonly next?: () => readonly NextAction[]
}

// ————————————————————————————————————————————————————————————————————————
// §3 Config sections — a FAMILY-level fact (one command family, one section)
// ————————————————————————————————————————————————————————————————————————

/**
 * A command family's named slice of prisma.config.ts, declared once in
 * the family's declaration (§10). The token couples the section name, its
 * validated type, and its total validator. Commands that need the
 * section reference the token in `needs.config`, which is how the
 * engine knows which commands an invalid section fails — and how
 * ctx.config gets its type.
 *
 * The validator OWNS absence: its input is the raw section value, or
 * undefined when the config file has no such section. A family that
 * wants defaults applies them here; one that requires the section emits
 * a section-required diagnostic here. It returns findings; it never
 * throws (R10). Keep validators dependency-light: they load with the
 * definition tree at startup (R9).
 */
export interface ConfigSection<T> {
  readonly name: string
  readonly validate: (raw: unknown | undefined) => SectionValidation<T>
}

/** Diagnostics on an OK validation are warnings: the engine writes them
 *  to stderr as commentary (log-level filtered, human and json alike);
 *  they never enter the stream or the envelope (operator ruling,
 *  2026-08-09). */
export type SectionValidation<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export declare function defineConfigSection<T>(spec: {
  readonly name: string
  readonly validate: (raw: unknown | undefined) => SectionValidation<T>
}): ConfigSection<T>

// ————————————————————————————————————————————————————————————————————————
// §4 The handler context — R4: the whole world arrives as one argument
// ————————————————————————————————————————————————————————————————————————

export interface CommandContext<TConfig = undefined, TCode extends number = never> {
  /** The validated value of the command's needed config section —
   *  exactly TConfig; absence semantics belong to the section's
   *  validator (§3). Commands with no config need get undefined. */
  readonly config: TConfig

  /** Builds the PresentedResult for the active format: "present this
   *  outcome, via these presentations." The only constructor of
   *  PresentedResult. */
  readonly present: <T>(
    outcome: Outcome<T, TCode>,
    presentations: Presentations,
  ) => PresentedResult<T>

  /** Management-API credentials, resolved at call time so long-lived
   *  sessions survive token refresh. Undefined when unauthenticated.
   *  Commands with needs.credentials never see undefined — the engine
   *  fails them early with the sign-in error. */
  readonly getCredentials: () => Promise<Credentials | undefined>

  /** The one way to emit while running (§1). */
  readonly report: (event: EngineEvent) => void

  /** Interactive input (§4a). */
  readonly prompt: PromptSurface

  /** Fires on Ctrl-C/SIGTERM (engine-owned; a second signal
   *  force-exits through the runtime's exit proxy). Session commands
   *  run until it fires; everything else aborts in-flight work with
   *  it. */
  readonly signal: AbortSignal

  /** Where the user invoked the CLI. Handlers never read process.cwd(). */
  readonly cwd: string

  /** The invocation's environment, from Runtime.env. Handlers read env
   *  via ctx.env, never process.env (R4). */
  readonly env: Readonly<Record<string, string | undefined>>

  /**
   * R13, the conditional form (evidence: composer needs @prisma/dev only
   * when the config declares postgres resources — unconditional needs
   * belong in `needs.dependencies`). Resolves when the optional peer
   * dependency is importable from the user's project; otherwise returns
   * the ENGINE'S structured missing-dependency error — install command
   * phrased by the engine with the user's package manager — for the
   * handler to pass to notOk. Handlers never craft install prose.
   */
  readonly requireDependency: (specifier: string) => Promise<Result<void, CliStructuredError>>
}

export interface Credentials {
  /** Opaque to the engine; shape owned by the Cloud auth
   *  library (placeholder pending its design). Workspace selection is
   *  session state, not a credential — it lives with that library, not
   *  here. */
  readonly token: string
}

/**
 * §4a Prompts (operator ruling, 2026-08-09: prompts return their answer
 * value, or throw). Every prompt resolves to its answered value
 * directly. Failures THROW engine-internal structured errors the engine
 * catches and settles: user cancellation (Ctrl-C/EOF at the prompt)
 * exits 3; a prompt that cannot be operated (no default under --yes or
 * non-interactive, an invalid answer) exits 2 as a structural error. A
 * handler that does not catch simply propagates and the engine settles;
 * one that catches cannot swallow the settlement — rethrow or notOk.
 *
 * Every prompt except `consent` may carry a declared
 * `default`. Interactively, Enter accepts the default. Under --yes, a
 * prompt WITH a default resolves to it without displaying; a prompt
 * WITHOUT a default cannot be operated and throws. In non-interactive
 * contexts (no TTY stdin, CI, --no-interactive — format never decides
 * interactivity) the same default rule applies; the prompt UI writes to
 * stderr, so an interactive json run prompts without touching the
 * stdout stream.
 */
export interface PromptSurface {
  readonly confirm: (
    question: string,
    opts?: { readonly default?: boolean },
  ) => Promise<boolean>
  /**
   * A question requiring EXPLICIT consent — never inferable, not
   * necessarily destructive. Structurally undefaultable: no default
   * parameter exists, so --yes, Enter-through, and non-interactive
   * contexts can never satisfy it; the command documents the explicit
   * flag that grants consent non-interactively.
   */
  readonly consent: (question: string) => Promise<boolean>
  readonly select: <T extends string>(
    question: string,
    options: ReadonlyArray<{ value: T; label: string }>,
    opts?: { readonly default?: T },
  ) => Promise<T>
  readonly text: (
    question: string,
    opts?: { readonly placeholder?: string; readonly default?: string },
  ) => Promise<string>
}

// ————————————————————————————————————————————————————————————————————————
// §5 Flags and positionals — R1: directly executable, typed by inference
// ————————————————————————————————————————————————————————————————————————

/**
 * Command-declared flags. The shared flag family (§header) is engine-injected
 * and reserved; handlers never see those values. Parse-time validation
 * failures become structured errors carrying the allowed values.
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

/** The parse SPI: a command's argument surface, one property. */
export interface ArgsSpec<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
> {
  readonly flags?: TFlags
  readonly positionals?: TPositionals
}

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
// §6 Command definitions — path-free (R12), runtime-discriminated by
// `kind`. Definitions load their handler's import graph at startup;
// R9's remaining force is that handler bodies defer heavy work to
// execution time. Three modalities at equal rank:
// result / session / server.
// ————————————————————————————————————————————————————————————————————————

/** The help SPI: how the command shows itself in help output. Words
 *  only — the engine formats. */
export interface HelpSpec {
  /** One line, imperative, shown in listings. */
  readonly summary: string
  readonly description?: string
  /** Invocations WITHOUT the binary name (operator ruling, 2026-08-09):
   *  at help render time every `{bin}` is substituted with createCli's
   *  `name`; an example containing no `{bin}` gets the name prepended. */
  readonly examples?: readonly string[]
}

/**
 * The preconditions SPI: everything the engine enforces BEFORE the
 * handler runs. Each unmet need fails the command early with the
 * engine's own
 * structured error — consistent phrasing by construction, and a handler
 * never runs in a world where it can't operate.
 */
export interface NeedsSpec<TConfig> {
  /** The command family's config section token: validate it, fail me on its
   *  error diagnostics, hand me the value as ctx.config. */
  readonly config?: ConfigSection<TConfig>
  /** Fail early with the sign-in error when unauthenticated. */
  readonly credentials?: true
  /** Optional peer dependencies this command cannot run without; the
   *  engine probes resolvability and phrases the install error.
   *  (Conditional needs use ctx.requireDependency instead.) */
  readonly dependencies?: readonly string[]
  /**
   * Fail early (before execution, before side effects) in
   * non-interactive contexts (no TTY stdin, CI, or --no-interactive;
   * format never decides interactivity). This is a MECHANICAL
   * precondition — "an interactive terminal is required" — and
   * deliberately NOT an agent barrier: the client's nature is
   * unverifiable, and a flag claiming to exclude agents would be a
   * false guarantee. Anything requiring a verified human belongs
   * server-side, where identity actually exists.
   */
  readonly interaction?: true
}

export interface CommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
  TCode extends number = never,
> {
  readonly kind: 'result-command'
  readonly help: HelpSpec
  readonly args?: ArgsSpec<TFlags, TPositionals>
  readonly needs?: NeedsSpec<TConfig>

  /**
   * The command's documented exit codes (4–99): code → meaning.
   * Rendered in help without executing anything; the keys type the
   * outcome's exitCode, making it REQUIRED at every return site (`0` or
   * a documented code). Absent = the command only exits 0/1/2/3 and the
   * outcome carries no exitCode.
   */
  readonly exitCodes?: Readonly<Record<TCode, string>>

  /** The handler function, referenced directly — never a dynamic import
   *  (operator ruling, 2026-08-09: "DO NOT DYNAMICALLY IMPORT HANDLERS").
   *  R9's keep-heavy-work-out-of-startup concern is the handler BODY's
   *  business: a handler that needs heavy dependencies imports them at
   *  execution time, inside itself. A handler defined in another file is
   *  imported statically and annotated CommandHandler<typeof def>. */
  readonly handler: Handler<TFlags, TPositionals, TConfig, TCode>
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
 * A session command (dev, log tail): runs until the signal fires,
 * speaks entirely through events, returns Result<void>. No
 * presentation, no exit-code set. A session always supports json mode:
 * the event stream is its json surface.
 */
export interface SessionCommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
> {
  readonly kind: 'session-command'
  readonly help: HelpSpec
  readonly args?: ArgsSpec<TFlags, TPositionals>
  readonly needs?: NeedsSpec<TConfig>
  readonly handler: (
    args: Args<TFlags, TPositionals>,
    ctx: CommandContext<TConfig>,
  ) => Promise<Result<void, CliStructuredError>>
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
 * by opt-out; the handler returns the exit code directly. The shared
 * flag family is NOT injected.
 */
export interface ServerCommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TConfig = undefined,
> {
  readonly kind: 'server-command'
  readonly help: HelpSpec
  readonly args?: ArgsSpec<TFlags, {}>
  readonly needs?: NeedsSpec<TConfig>
  readonly handler: (
    args: Args<TFlags, {}>,
    io: {
      readonly stdin: InputStream
      readonly stdout: OutputStream
      readonly stderr: OutputStream
      readonly signal: AbortSignal
      readonly cwd: string
      readonly config: TConfig
    },
  ) => Promise<number>
}

export declare function defineServerCommand<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TConfig = undefined,
>(
  def: Omit<ServerCommandDefinition<TFlags, TConfig>, 'kind'>,
): ServerCommandDefinition<TFlags, TConfig>

/** Erased union for command families and mount maps; `kind` discriminates. */
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
  | { readonly kind: 'tree'; readonly roots: readonly TreeNode[] }
// NOTE: recorded findings are NOT a Block — they are the outcome's
// diagnostics; the engine renders them with the top-level error layout
// and carries them into the envelope, so the two surfaces cannot
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
// surface
// ————————————————————————————————————————————————————————————————————————

export interface OutputStream {
  write(text: string): void
}
/** Byte-oriented, so server commands can implement byte-counted
 *  protocols (lsp's Content-Length framing). setRawMode is present
 *  where the platform supports keypress input. */
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
  readonly result: T
  readonly exitCode: number
  /** The recorded findings, verbatim from the presented outcome. */
  readonly diagnostics: readonly Diagnostic[]
  readonly nextActions: readonly NextAction[]
}

export interface ErroredEnvelope {
  /** ok = false: the command did NOT complete. */
  readonly ok: false
  readonly commandId: string
  /** The PRIMARY error — what aborted the command. Severity 'error' by
   *  definition. A thrown CliStructuredError serializes to exactly this
   *  shape. */
  readonly error: Diagnostic
  /** Accompanying findings when the abort had several (three config
   *  typos are three diagnostics, not one flattened error). */
  readonly diagnostics: readonly Diagnostic[]
  /** Copied from the error's own nextActions — the uniform consumer
   *  read path (envelope.nextActions) on both settlement paths. */
  readonly nextActions: readonly NextAction[]
}

/** json mode emits one StreamEvent per line: the handler's events,
 *  flattened with the stream metadata, then exactly one terminal
 *  'result' member carrying the envelope. */
export type StreamEvent =
  | (EngineEvent & StreamMeta)
  | ({ readonly kind: 'result'; readonly envelope: CompletedEnvelope | ErroredEnvelope } & StreamMeta)

export interface StreamMeta {
  readonly commandId: string
  /** ISO 8601 UTC. Injectable clock in tests (§11). */
  readonly timestamp: string
}

// ————————————————————————————————————————————————————————————————————————
// §10 Command families and shell mounting — R12: the shell owns the
// tree; a command family owns its section
// ————————————————————————————————————————————————————————————————————————

/**
 * The unit of contribution and ownership a package exports for CLI
 * purposes: its config section (declared once — a family-level fact)
 * and its commands by NAME. The unified config loader consumes the
 * sections; the shell mounts the commands. A command whose needs.config
 * token is not its command family's section is a construction error.
 */
export interface CommandFamily {
  readonly configSection?: ConfigSection<unknown>
  readonly commands: Readonly<Record<string, AnyCommand>>
  /** The family's documentation base URL. The engine derives each
   *  diagnostic's docs link from base + code; a diagnostic's own
   *  `docsUrl` field is the per-raise override (unused until a use case
   *  appears). */
  readonly docsBaseUrl?: string
}

/** What the shell builds: commands by PATH (space-separated,
 *  'db migrate'). */
export type MountedTree = Readonly<Record<string, AnyCommand>>

/**
 * Shell-side construction. Group help is declared with the mount, since
 * groups belong to the tree, not to command families. Collisions, unknown
 * groups, reserved-flag violations, grammar violations, and
 * foreign-section references fail construction (build time, not run
 * time).
 */
export declare function createCli(spec: {
  readonly name: string
  readonly version: string
  readonly commandFamilies: readonly CommandFamily[]
  readonly groups: Readonly<Record<string, { readonly brief: string; readonly description?: string }>>
  readonly commands: MountedTree
}): Cli

export interface Cli {
  /** Parse, execute, render, return the exit code. Never touches
   *  process globals — it exits only through the runtime's exit proxy
   *  (second-signal force exit) and writes only to the provided
   *  streams. */
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
  /** Ends the process. The bin passes process.exit; the engine is the
   *  only caller (second-signal force exit, 130/143). */
  readonly exit: (code: number) => never
  /** Subscribes to delivered SIGINT/SIGTERM; returns the unsubscribe.
   *  The bin is dumb wiring — the engine owns the whole signal policy:
   *  the first signal aborts ctx.signal and awaits teardown; a second
   *  calls exit(130|143) immediately. */
  readonly onSignal: (cb: (signal: 'SIGINT' | 'SIGTERM') => void) => () => void
  /** Loaded config + file-level diagnostics; the shell builds this via
   *  the unified loader (R10). Tests hand in fixtures. */
  readonly config: LoadedConfig
  readonly getCredentials: () => Promise<Credentials | undefined>
  /** Used by the ENGINE to phrase install commands (handlers never
   *  do — see needs.dependencies and ctx.requireDependency). */
  readonly packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown'
}

/** The minimal process surface a bin adapts a Runtime from — Node's
 *  `process` satisfies it structurally; the engine never reads it. */
export interface HostProcess {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string | undefined>>
  cwd(): string
  readonly stdout: { write(text: string): unknown; isTTY?: boolean }
  readonly stderr: { write(text: string): unknown; isTTY?: boolean }
  readonly stdin: {
    isTTY?: boolean
    setRawMode?(enabled: boolean): unknown
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array>
  }
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  exit(code: number): never
}

export interface LoadedConfig {
  /** Raw section values by name; validation happens per command via its
   *  command family's section token. */
  readonly sections: Readonly<Record<string, unknown>>
  /** File-level problems (unevaluable module, missing version marker)
   *  carry section: null and fail only commands with a needs.config
   *  section (operator ruling, 2026-08-09: the CLI still runs; a
   *  command that needs no config runs normally). */
  readonly diagnostics: ReadonlyArray<{
    readonly section: string | null
    readonly diagnostic: Diagnostic
  }>
}

// ————————————————————————————————————————————————————————————————————————
// §11 The test harness — R7: same machinery, bytes out
// ————————————————————————————————————————————————————————————————————————

export declare function createTestCli(spec: {
  readonly commandFamilies?: readonly CommandFamily[]
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
      /** Abort the run (session tests): its firing is delivered to the
       *  engine as a signal (SIGTERM when the reason is 'SIGTERM',
       *  SIGINT otherwise). */
      readonly abort?: AbortSignal
      /** Live event tap, for asserting mid-session behavior. */
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
    /** The PresentedResult the handler returned, for semantic
     *  assertions without byte-scraping. */
    readonly presented?: PresentedResult<unknown>
  }>
}
