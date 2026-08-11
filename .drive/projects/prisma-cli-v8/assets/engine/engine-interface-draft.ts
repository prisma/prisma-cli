/**
 * DRAFT v8 — the unified CLI engine's public interface.
 * v1 initial · v2 round-1 fixes · v3 return-site presentation ·
 * v4 completed/errored, --format, log levels, prompt defaults ·
 * v5 round-3 closure · v6 Diagnostic, warnings fold, stream flatten ·
 * v7 outcome-first present, help/args/needs, command families ·
 * v8 packaging and residue rulings, amended in review round 2
 * (normalized definition shapes, defineCommandFamily, one severity
 * scale, phantom-typed arg specs, ./testing subpath): ONE library
 * package
 * (@prisma/cli-engine, with @stricli/core as an ordinary exact-pinned
 * dependency — bundling was considered and rejected: unusual for a
 * library, blinds security audit; R3's hiding is about types, which no
 * dependency violates) with a ./protocol subpath for types-only
 * consumers;
 * NextAction.journey dropped (no consumer); docs URLs derived from a
 * family-supplied base; committed versions for releases; auth library
 * lives in the CLI repo, distinct from Prisma Cloud. Prior versions
 * preserved as -v1…-v7.ts; reviews in ./reviews/.
 * Amended 2026-08-10 for the credential-manager design rev 5 — the
 * SESSION MODEL (credential-manager-design.md, normative; rev 5
 * replaced rev 4's grants model): §4 gains ctx.session and the
 * CredentialManager entity surface (ctx.getCredentials removal is
 * STAGED — the engine still carries it until the swap's final stage);
 * §6 gains the managesCredentials capability; §10 gains
 * Runtime.credentialManager and the injected client config; §11 gains
 * manager seeding + fixtures.
 * Amended 2026-08-10 for the ENGINE INTERACTION AFFORDANCES (operator
 * rulings): consent tokens with the shared --confirm flag (§4a),
 * ctx.openUrl (§4), and prompt.browserWait (§4a). All three are
 * engine-owned so command code never reads TTY or CI state and never
 * invents its own consent-skipping flag.
 * Amended 2026-08-11 for S3 (the TERMINAL HANDOFF, contract
 * s3-composer.md): §4 gains ctx.spawn and §4c its shapes +
 * exitWithChildStatus; §6 gains the SpawnDeclarations (maySpawn) and
 * the two kind amendments (a maySpawn command rejects --json as soon
 * as the command is known — after routing, before the needs check and
 * before anything runs; a session settles non-zero through
 * exitWithChildStatus and no other way); §10 gains Runtime.spawn. D1
 * rulings: abort-ladder grace 5s; near-expiry refusal threshold 5min.
 * Re-amended after the PR-136 review round: handing credentials to the
 * child is a PRECONDITION, `needs: { credentials: 'child' }` — the
 * separate credentialsForSpawn declaration is gone, and the entailment
 * (child credentials imply the credentials need) is structural. The
 * manager gains the named engine-facing operation activeAccessToken()
 * for the spawn path's read, so the "engine never calls storage
 * methods" rule is absolute — no sanctioned exception.
 * exitWithChildStatus(child, opts?) takes { nextActions? }, rendered
 * to stderr before the exit (R-S3-4's reproduce hint).
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
 * -y/--yes, --confirm <value> (repeatable), --interactive/--no-interactive,
 * --color/--no-color.
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
 *     summary, why?, nextActions: readonly NextAction[] (always
 *     present, empty when there are none), where?, meta?, docsUrl? }
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

/** The commentary severity scale; also the log-level axis (one name —
 *  the --log-level flag selects a Severity). Distinct from Diagnostic
 *  severity: 'verbose' grades commentary, which never enters the
 *  envelope. Step outcomes are completion states, not severities. */
export type Severity = 'error' | 'warn' | 'info' | 'verbose'

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
  /** Only the active format's presentation is materialized; the other
   *  format's fields are normalized to empty. `json` stays undefined
   *  when the handler supplied no json presentation — the envelope's
   *  `result` then falls back to `data`. */
  readonly presentation: {
    readonly human: readonly Block[]
    readonly stdout: readonly string[]
    readonly json: unknown
    readonly next: readonly NextAction[]
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

  /** The session this process is acting as (the manager's
   *  currentSession() pin), or null when signed out — on EVERY
   *  context. Read-only and local-only: safe to call anywhere; never
   *  touches the network. Raises the same single-sourced structured
   *  errors as the needs check for broken-but-not-signed-out states
   *  (sessions held none current; blank env token).
   *  ctx.getCredentials is DELETED (staged: the engine carries it
   *  until the swap's final stage) — the context ends with fewer auth
   *  surfaces than before: `api` + `session`, plus
   *  `credentialManager` for the commands that declare the §6
   *  capability. */
  readonly session: () => Promise<Session | null>

  /** The Management API client, constructed and owned by the ENGINE:
   *  the pinned session's client, built from the injected client
   *  config on first method CALL, once per run (process pinning makes
   *  the memoization correct). A stored session gets the SDK's
   *  refreshing path over manager.activeCredentialStorage(); an env
   *  session gets the SDK's static-token path with its error mapping
   *  at the call site. Request failures pass through the engine-side
   *  mapping (design §6): refreshTokenInvalid === true → the expired
   *  CLI.CREDENTIALS_REQUIRED; any other SDK AuthError → a state
   *  re-read for the workspace the client is BOUND to (session gone →
   *  session-ended CLI.CREDENTIALS_REQUIRED, otherwise the transient
   *  auth-service error) — state checks, never message parsing; the
   *  cause chain is walked for both AuthError and CLI structured
   *  errors. A request made while signed out throws the structured
   *  CLI.CREDENTIALS_REQUIRED error (the same constructor the
   *  needs.credentials check uses). */
  readonly api: ManagementApiClient

  /**
   * S3: hands the terminal to a child process and resolves when it
   * ends. Inherited stdio, same process group (POSIX) / console
   * (Windows), no detach — the terminal delivers Ctrl-C to the child
   * natively. While a child is live the engine neither aborts nor
   * exits: delivered signals are RECORDED and replayed into the
   * normal ladder on child exit (one recorded → ctx.signal aborts as
   * if just delivered; a signal past that arms a force exit fired
   * only after settlement and telemetry), so the engine always
   * outlives the child and no path force-exits from inside ctx.spawn.
   * SIGTERM — no native path to the child — is forwarded during the
   * window, and so is a SECOND recorded press of any signal (as
   * SIGTERM): when the engine was signalled directly and no group
   * delivered the first press, the escalation keeps the child
   * reachable. A programmatic abort terminates the child: SIGTERM, a
   * 5s grace (D1 ruling), SIGKILL. ctx.report during a live child is
   * buffered (capped, with a dropped-events marker on flush) and
   * flushed in order on exit; ctx.present, ctx.prompt, and a second
   * concurrent spawn are construction errors — and so is resolving or
   * throwing while the child is still live: a handler stays suspended
   * on the spawn promise. Only commands declaring `maySpawn` (§6) may
   * call it, and a maySpawn command whose Runtime supplies no spawn
   * adapter refuses before the needs check ever runs.
   * Handlers branch on `signal` before `exitCode`: a signal-killed
   * child is an abort, not a failure.
   */
  readonly spawn: (options: SpawnOptions) => Promise<ChildResult>

  /** The one way to emit while running (§1). */
  readonly report: (event: EngineEvent) => void

  /** Interactive input (§4a). */
  readonly prompt: PromptSurface

  /** Shows the user a URL and, interactively, opens it in their
   *  browser through the runtime's injected opener. The announcement
   *  is one `endpoint` event (§1): a stderr line in human mode, a
   *  frame in json mode, so the URL always reaches both a person and
   *  a machine consumer. A non-interactive run opens nothing and
   *  reports `{opened: false}` — the URL in the announcement is how it
   *  gets done by hand. NEVER an error: a host with no browser is not
   *  a failed command. To then WAIT for the user to finish in that
   *  browser, use prompt.browserWait (§4a). */
  readonly openUrl: (request: {
    readonly url: string
    /** The announcement label — what the URL is for, in the user's
     *  terms ("Finish signing in"). */
    readonly message: string
  }) => Promise<{ readonly opened: boolean }>

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

/** Superseded by the credential-manager surface below; carried only
 *  through the staged swap (Runtime.getCredentials fallback), then
 *  deleted. */
export interface Credentials {
  readonly token: string
}

// —— §4b The credential manager (design rev 5 §2/§3, normative) ——
// A set of per-workspace sessions, one current. Sessions are keyed
// by workspace id: at most one session per workspace. No conditional
// properties: absent = `T | undefined` with the key required.

/** The proof material. Only ever seen by the login flow (which mints
 *  it) and createSession (which stores it). */
export interface Credential {
  readonly token: string
  readonly refreshToken: string | undefined
  readonly expiresAt: Date | undefined
}

/** "Logged-in-edness", scoped to a workspace. Identified to users by
 *  its workspace. The token is INTERNAL: it lives in the stored
 *  record, never on this public shape. `source: "environment"` marks
 *  the ephemeral session composed from PRISMA_SERVICE_TOKEN; it never
 *  appears in sessions(). */
export interface Session {
  readonly workspaceId: string
  readonly workspaceName: string | undefined
  readonly expiresAt: Date | undefined
  readonly source: 'stored' | 'environment'
  readonly current: boolean
}

/** Manages sessions: six user-facing operations plus one
 *  engine-facing accessor. Custody, not user interaction: never opens
 *  a browser, never prompts. Env is a construction input. The manager
 *  resolves NO user input: commands resolve refs against sessions()
 *  and pass the matched Session. Full semantics (process pinning,
 *  env-override mutation rules, error single-sourcing, locking) are
 *  normative in credential-manager-design.md §3/§4/§6/§8. */
export interface CredentialManager {
  /** The session this PROCESS is acting as: pinned at first read (env
   *  token if set, else the file's current marker at that moment);
   *  other processes' marker moves never redirect it, this process's
   *  own mutations do. Local-only. */
  currentSession(): Promise<Session | null>
  /** The available sessions, read fresh from the file. Local-only.
   *  Under an env override the file's marker is still shown as
   *  `current`. */
  sessions(): Promise<readonly Session[]>
  /** Login's write: verifies the workspace_id claim matches, upserts
   *  by workspaceId, sets the marker and this process's pin. The name
   *  is fetched best-effort after the write. */
  createSession(credential: Credential, workspaceId: string): Promise<Session>
  /** Switch: sets the file's marker AND this process's pin. The
   *  argument is a workspace reference — only workspaceId is read,
   *  re-validated against freshly-read state. */
  useSession(session: Session): Promise<Session>
  /** Log out of one workspace. If it was current (marker or pin),
   *  that current is cleared — no auto-promotion. */
  endSession(session: Session): Promise<void>
  /** Log out entirely: remove all sessions and the marker. */
  endAllSessions(): Promise<void>
  /** ENGINE-FACING, not a user operation: the SDK TokenStorage view
   *  of the ACTIVE credential. Zero-argument — process pinning ruled
   *  there is one credential per process, and an environment
   *  credential may have no workspace id to key on; the earlier
   *  tokenStorage(workspaceId) is deleted rather than reshaped
   *  (credential-manager-design.md §11.5). The engine forwards it
   *  into SDK client config and never calls its methods itself — no
   *  exceptions; the engine's own token read is activeAccessToken(). */
  activeCredentialStorage(): Promise<TokenStorage>
  /** ENGINE-FACING (S3, amended after the PR-136 review): the active
   *  credential's ACCESS token, read fresh, for handing to a child
   *  process that authenticates as this process does. Never the
   *  refresh token — the child gets a snapshot it cannot refresh.
   *  Single consumer: ctx.spawn's credential injection. The read
   *  builds no second API client, so the one-client-per-process
   *  invariant holds (credential-manager-design.md §11.5). */
  activeAccessToken(): Promise<string | null>
}

/** The SDK's typed client and token-storage contract, re-exported by
 *  the engine so consumers never import @prisma/management-api-sdk
 *  directly. */
import type {
  ManagementApiClient as SdkClient,
  TokenStorage as SdkTokenStorage,
} from '@prisma/management-api-sdk'

export type ManagementApiClient = SdkClient
export type TokenStorage = SdkTokenStorage

/** SDK client construction config, injected by the bin beside the
 *  manager (§10). All four fields: the SDK's refreshing fetch
 *  requires the full config even though only login paths read
 *  redirectUri. */
export interface ManagementApiClientConfig {
  readonly clientId: string
  readonly redirectUri: string
  readonly apiBaseUrl: string
  readonly authBaseUrl: string
}

// —— §4c The terminal handoff (S3) ——

/** What a handler passes to ctx.spawn. */
export interface SpawnOptions {
  readonly command: string
  readonly args?: readonly string[]
  /** Defaults to ctx.cwd. */
  readonly cwd?: string
  /** Added to, and overriding, the invocation environment. The
   *  engine's credential variables are applied last and cannot be
   *  overridden. */
  readonly env?: Readonly<Record<string, string | undefined>>
}

/** How a child ended. Branch on `signal` first: a signal-killed child
 *  is an abort, not a failure. */
export interface ChildResult {
  readonly exitCode: number | null
  readonly signal: string | null
}

/** A fully composed child invocation, as the Runtime adapter receives
 *  it: env is the child's COMPLETE environment, credentials already
 *  injected by the engine (the active credential's access token, read
 *  at spawn time through the manager's activeAccessToken();
 *  PRISMA_WORKSPACE_ID alongside when the credential names a
 *  workspace, and DELETED from the inherited environment when it does
 *  not — the two variables are one protocol, written as a unit; the
 *  refresh token NEVER). */
export interface SpawnRequest {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string | undefined>>
}

/** The live child an adapter returns. `ended` rejects only when the
 *  child could not be launched; the engine phrases that as the
 *  structured CLI.SPAWN_FAILED. */
export interface SpawnedChild {
  readonly ended: Promise<ChildResult>
  readonly kill: (signal: 'SIGTERM' | 'SIGKILL') => void
}

/** The Runtime seam (§10): starts the child with INHERITED stdio, in
 *  the caller's own process group (POSIX) / console (Windows) — no
 *  `detached`, no new console. The bin adapts node:child_process; the
 *  engine never imports it. */
export type SpawnChild = (request: SpawnRequest) => SpawnedChild

/** Opaque: built exclusively by exitWithChildStatus. */
export interface ChildStatusSettlement {
  readonly exitCode: number
  readonly nextActions: readonly NextAction[]
}

/** The sanctioned "exit with the child's status verbatim" outcome:
 *  returned inside ok(...), it settles through the no-envelope bypass
 *  server commands already have — and ONLY from a command that
 *  declares maySpawn; anywhere else it is a construction error (the
 *  bypass is fenced, not merely documented). A signal-killed child
 *  settles 128 + the signal number for the portable signals; an
 *  unknown signal, or an adapter that cannot say how the child ended,
 *  settles 1 — unknown is never success. `nextActions` (a failed
 *  converge's reproduce hint, R-S3-4) render to stderr in the
 *  engine's next-action style before the process exits with the
 *  child's code; the envelope stays absent. */
export declare function exitWithChildStatus(
  child: ChildResult,
  opts?: { readonly nextActions?: readonly NextAction[] },
): ChildStatusSettlement

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
 *
 * Rendering is two-tier (S2a D4). A plain line renderer serves
 * scripted answers and any stdin that cannot enter raw mode (piped
 * stdin, the test harness); real TTYs — Runtime.isTty.stdin AND
 * Runtime.stdin.setRawMode present, no scripted answers — render
 * through @clack/prompts, loaded by dynamic import only on that path.
 * Both tiers write prompt UI to stderr and share the same structural
 * rules: --yes resolution, `--confirm` matching, and structural
 * failures are decided before the tier branch.
 *
 * CONSENT TOKENS AND --confirm (operator ruling, 2026-08-10). A
 * consent may declare a `token`: the natural noun of the action being
 * consented to — an app name, a hostname — not a yes/no word. The
 * token changes both halves of the prompt.
 *   Interactively it becomes TYPE-TO-CONFIRM: the user must type the
 *   token exactly. On the clack tier a wrong answer re-prompts (the
 *   only exits are the exact token and Ctrl-C); on the plain line
 *   tier — scripted answers, piped stdin — a wrong answer cannot be
 *   corrected, so it fails structurally (exit 2).
 *   Non-interactively (and under --yes, which is the same skip
 *   condition) the consent is satisfied iff one of the run's
 *   `--confirm <value>` values matches the token EXACTLY. Each value
 *   is consumed once per run, so two consents on one token need two
 *   --confirms. Otherwise the existing structural consent error
 *   (CLI.CONSENT_REQUIRED, exit 2), whose message now names the
 *   expected value and the literal `--confirm <token>` usage.
 *   A consent WITHOUT a token keeps today's yes/no rendering and stays
 *   non-interactively unsatisfiable — its error says the command
 *   should declare a token (the old "pass the command's explicit
 *   consent flag" wording described the abandoned per-command-flag
 *   doctrine: commands do not invent consent flags any more).
 * --yes is unchanged by all of this: it accepts declared defaults and
 * never grants consent, with or without a token. Clack's cancel symbol (including the \x03 byte
 * path) maps to the same CLI.PROMPT_CANCELLED exit-3 settlement.
 * Clack's spinner/log helpers are forbidden (process-global handlers);
 * progress remains engine events.
 *
 * Accepted quirk: clack reads process.stdout.columns for wrap width —
 * the one process-global read on the interactive path.
 */
export interface PromptSurface {
  readonly confirm: (
    question: string,
    opts?: { readonly default?: boolean },
  ) => Promise<boolean>
  /**
   * A question requiring EXPLICIT consent — never inferable, not
   * necessarily destructive. Structurally undefaultable: no default
   * parameter exists, so --yes and Enter-through can never satisfy it.
   * `token` is the natural noun of the action; supplying one makes the
   * interactive prompt type-to-confirm and makes `--confirm <token>`
   * the one non-interactive way to grant it (§4a header).
   */
  readonly consent: (
    question: string,
    opts?: { readonly token?: string },
  ) => Promise<boolean>
  /**
   * On the clack tier, Enter picks the HIGHLIGHTED option — the
   * declared default when present, else the first option — so moving
   * the highlight and pressing Enter selects the highlighted value,
   * not the declared default.
   */
  readonly select: <T extends string>(
    question: string,
    options: ReadonlyArray<{ value: T; label: string }>,
    opts?: { readonly default?: T },
  ) => Promise<T>
  readonly text: (
    question: string,
    opts?: { readonly placeholder?: string; readonly default?: string },
  ) => Promise<string>
  /**
   * Sends the user to a URL and waits for them to finish there. It
   * announces the URL (the same one-line `endpoint` announcement
   * ctx.openUrl makes), opens the browser through the runtime's
   * injected opener, then calls `poll` on the ENGINE's injectable
   * clock at the engine's declared interval until it returns true.
   * Settles three ways: resolved (poll true); the structured timeout
   * error when `timeout` elapses first; the standard prompt-cancel
   * exit-3 settlement on Ctrl-C.
   *
   * Non-interactively it throws the structured interaction-required
   * error (exit 2) WITHOUT opening or polling anything, carrying the
   * URL so the user can finish by hand. A command that can do nothing
   * at all without an interactive terminal should say so declaratively
   * with `needs.interaction` (§6) and fail before it starts, rather
   * than reaching this error mid-run.
   */
  readonly browserWait: (request: {
    readonly url: string
    readonly message: string
    /** Has the user finished? Receives ctx.signal, so a polling
     *  request aborts with the command. */
    readonly poll: (signal: AbortSignal) => Promise<boolean>
    /** Milliseconds to keep polling before giving up. */
    readonly timeout: number
  }) => Promise<void>
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

export interface FlagSpec<T> {
  /** Phantom type carrier for inference; never present at runtime. */
  readonly __flag?: T
}

export declare const positional: {
  string(spec: { brief: string; placeholder: string }): PositionalSpec<string>
  optionalString(spec: { brief: string; placeholder: string }): PositionalSpec<string | undefined>
  /** Zero or more trailing values; at most one, declared last (order =
   *  declaration order; keys must not be integer-like). */
  variadic(spec: { brief: string; placeholder: string }): PositionalSpec<readonly string[]>
}
export interface PositionalSpec<T> {
  /** Phantom type carrier for inference; never present at runtime. */
  readonly __positional?: T
}

/** The parse SPI: a command's argument surface, one property. */
export interface ArgsSpec<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
> {
  readonly flags?: TFlags
  readonly positionals?: TPositionals
}

/** The normalized argument surface a definition carries: both
 *  namespaces always present, empty when the command declares none. */
export interface CommandArgs<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
> {
  readonly flags: TFlags
  readonly positionals: TPositionals
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
//
// Definitions carry NO conditional properties (operator ruling, round
// 2): the define* constructors accept ergonomic specs (optional help
// details, args, needs, exitCodes) and normalize them — every
// definition field is always present, with empty collections and
// explicit undefined.
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

/** The normalized help a definition carries. */
export interface CommandHelp {
  readonly summary: string
  readonly description: string | undefined
  readonly examples: readonly string[]
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
  /** Fail early with the sign-in error when unauthenticated. The
   *  'child' form (S3, amended after the PR-136 review — this
   *  precondition previously lived at the top level as
   *  credentialsForSpawn) additionally composes the active credential
   *  into every child environment and refuses the run before the
   *  handler when it expires within the 5-minute threshold (D1
   *  ruling). Requires maySpawn (construction error otherwise), and
   *  structurally entails the plain credentials need. */
  readonly credentials?: true | 'child'
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

/** The normalized preconditions a definition carries. */
export interface CommandNeeds<TConfig> {
  readonly config: ConfigSection<TConfig> | undefined
  readonly credentials: boolean | 'child'
  readonly dependencies: readonly string[]
  readonly interaction: boolean
}

export interface CommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
  TCode extends number = never,
  TManagesCredentials extends boolean = false,
> {
  readonly kind: 'result-command'
  readonly help: CommandHelp
  readonly args: CommandArgs<TFlags, TPositionals>
  readonly needs: CommandNeeds<TConfig>

  /**
   * The command's documented exit codes (4–99): code → meaning.
   * Rendered in help without executing anything; the keys type the
   * outcome's exitCode, making it REQUIRED at every return site (`0` or
   * a documented code). Empty = the command only exits 0/1/2/3 and the
   * outcome carries no exitCode.
   */
  readonly exitCodes: Readonly<Record<TCode, string>>

  /**
   * A CAPABILITY, not a need (design rev 5 §4): when true,
   * ctx.credentialManager appears on the context. Declaring it never
   * fails a run — documentation and testability, not enforcement.
   * Declared by exactly: auth login, auth logout, auth workspace
   * list, auth workspace use, auth workspace logout. whoami uses
   * ctx.session() only; sessions() lives ONLY on the manager, never
   * on the universal context.
   */
  readonly managesCredentials: TManagesCredentials

  /** See SpawnDeclarations (S3). */
  readonly maySpawn: boolean

  /** The handler function, referenced directly — never a dynamic import
   *  (operator ruling, 2026-08-09: "DO NOT DYNAMICALLY IMPORT HANDLERS").
   *  R9's keep-heavy-work-out-of-startup concern is the handler BODY's
   *  business: a handler that needs heavy dependencies imports them at
   *  execution time, inside itself. A handler defined in another file is
   *  imported statically and annotated CommandHandler<typeof def>. */
  readonly handler: Handler<TFlags, TPositionals, TConfig, TCode, TManagesCredentials>
}

export type Handler<
  TFlags extends Record<string, FlagSpec<unknown>>,
  TPositionals extends Record<string, PositionalSpec<unknown>>,
  TConfig,
  TCode extends number = never,
  TManagesCredentials extends boolean = false,
> = (
  args: Args<TFlags, TPositionals>,
  ctx: CommandContext<TConfig, TCode> &
    (TManagesCredentials extends true
      ? { readonly credentialManager: CredentialManager }
      : unknown),
) => Promise<Result<PresentedResult<unknown> | ChildStatusSettlement, CliStructuredError>>

/**
 * S3: the terminal-handoff declaration, accepted by defineCommand and
 * defineSessionCommand and normalized onto every definition (server
 * commands normalize maySpawn to false: they own stdio already).
 * `maySpawn` unlocks ctx.spawn and makes the command reject `--json`
 * as soon as the command is known — after routing, before the needs
 * check and before anything runs (the rule depends on which command
 * was selected, so "parse time" was loose wording) — exit 2, stated
 * in help (delegated terminal output cannot be framed). Handing
 * credentials to the child is a PRECONDITION, not a declaration:
 * `needs: { credentials: 'child' }` (see NeedsSpec).
 * Naming note (PR-136 review, considered and rejected): renaming
 * maySpawn to delegatesTerminal would state the --json rule's premise
 * directly, but the identifier is already woven through the S3 stack
 * (D2/D3 handlers, tests, this draft) and the rename's churn was
 * judged to outweigh the clarity gain. Do not re-open without new
 * evidence.
 */
export interface SpawnDeclarations {
  readonly maySpawn?: boolean
}

/** For impl files: `const run: CommandHandler<typeof migrateCommand> = …` */
export type CommandHandler<D> = D extends CommandDefinition<infer F, infer P, infer C, infer K, infer M>
  ? Handler<F, P, C, K, M>
  : never

/** Two overloads (implementation detail worth documenting: a generic
 *  TManagesCredentials inference site collapses under contextual
 *  typing, so the capability is a literal in each overload). */
export declare function defineCommand<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
  TCode extends number = never,
>(def: {
  readonly help: HelpSpec
  readonly args?: ArgsSpec<TFlags, TPositionals>
  readonly needs?: NeedsSpec<TConfig>
  readonly exitCodes?: Readonly<Record<TCode, string>>
  readonly managesCredentials: true
  readonly handler: Handler<TFlags, TPositionals, TConfig, TCode, true>
} & SpawnDeclarations): CommandDefinition<TFlags, TPositionals, TConfig, TCode, true>
export declare function defineCommand<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
  TCode extends number = never,
>(def: {
  readonly help: HelpSpec
  readonly args?: ArgsSpec<TFlags, TPositionals>
  readonly needs?: NeedsSpec<TConfig>
  readonly exitCodes?: Readonly<Record<TCode, string>>
  readonly handler: Handler<TFlags, TPositionals, TConfig, TCode>
} & SpawnDeclarations): CommandDefinition<TFlags, TPositionals, TConfig, TCode>

/**
 * A session command (dev, log tail): runs until the signal fires,
 * speaks entirely through events, returns Result<void>. No
 * presentation, no exit-code set.
 *
 * S3 amendments: a session supports json mode — the event stream is
 * its json surface — UNLESS it declares maySpawn, in which case it
 * rejects --json as soon as the command is known. A session that
 * returns ok(undefined)
 * exits 0; one that returns ok(exitWithChildStatus(child)) exits with
 * the child's status, which is the ONLY way a session settles
 * non-zero without erroring.
 */
export interface SessionCommandDefinition<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
> {
  readonly kind: 'session-command'
  readonly help: CommandHelp
  readonly args: CommandArgs<TFlags, TPositionals>
  readonly needs: CommandNeeds<TConfig>
  /** See SpawnDeclarations (S3). */
  readonly maySpawn: boolean
  readonly handler: (
    args: Args<TFlags, TPositionals>,
    ctx: CommandContext<TConfig>,
  ) => Promise<Result<void | ChildStatusSettlement, CliStructuredError>>
}

export declare function defineSessionCommand<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TPositionals extends Record<string, PositionalSpec<unknown>> = {},
  TConfig = undefined,
>(def: {
  readonly help: HelpSpec
  readonly args?: ArgsSpec<TFlags, TPositionals>
  readonly needs?: NeedsSpec<TConfig>
  readonly handler: SessionCommandDefinition<TFlags, TPositionals, TConfig>['handler']
} & SpawnDeclarations): SessionCommandDefinition<TFlags, TPositionals, TConfig>

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
  readonly help: CommandHelp
  readonly args: CommandArgs<TFlags, {}>
  readonly needs: CommandNeeds<TConfig>
  /** Always false — normalized so every definition carries the field
   *  and the engine reads it directly (S3, PR-136 review). */
  readonly maySpawn: false
  readonly handler: (
    args: Args<TFlags, {}>,
    io: {
      readonly stdin: InputStream
      readonly stdout: OutputStream
      readonly stderr: OutputStream
      readonly signal: AbortSignal
      readonly cwd: string
      readonly env: Readonly<Record<string, string | undefined>>
      readonly config: TConfig
    },
  ) => Promise<number>
}

export declare function defineServerCommand<
  TFlags extends Record<string, FlagSpec<unknown>> = {},
  TConfig = undefined,
>(def: {
  readonly help: HelpSpec
  readonly args?: ArgsSpec<TFlags, {}>
  readonly needs?: NeedsSpec<TConfig>
  readonly handler: ServerCommandDefinition<TFlags, TConfig>['handler']
}): ServerCommandDefinition<TFlags, TConfig>

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
  readonly configSection: ConfigSection<unknown> | undefined
  readonly commands: Readonly<Record<string, AnyCommand>>
  /** The family's documentation base URL. The engine derives each
   *  diagnostic's docs link from base + code; a diagnostic's own
   *  `docsUrl` field is the per-raise override (unused until a use case
   *  appears). */
  readonly docsBaseUrl: string | undefined
}

export declare function defineCommandFamily(spec: {
  readonly configSection?: ConfigSection<unknown>
  readonly commands: Readonly<Record<string, AnyCommand>>
  readonly docsBaseUrl?: string
}): CommandFamily

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
   *  streams. `hooks` is the bin's observation seam (S2a telemetry
   *  amendment): the engine's internal RunHooks stayed internal, and
   *  the minimal public surface growth is this optional parameter
   *  carrying only the settlement observer. */
  run(argv: readonly string[], runtime: Runtime, hooks?: CliRunHooks): Promise<number>
}

/**
 * S2a telemetry amendment. The observation hooks a bin may attach to
 * a run — deliberately narrower than the engine's internal hook set
 * (whose other members are test seams reachable only through the
 * ./testing harness, which also accepts an `onSettled` tap).
 */
export interface CliRunHooks {
  /** Fired exactly once per run, after settlement (exit code final,
   *  terminal output written). Never fired for --help/--version, and
   *  never for a run that failed before reaching a mounted command
   *  (nothing executed, so there is no snapshot). Errors thrown by
   *  the hook are swallowed — a telemetry bug must not break a
   *  command. */
  readonly onSettled?: (summary: RunSummary) => void
}

/** What onSettled receives. `durationMs` comes from the engine's
 *  injectable clock (§11), never from wall time directly.
 *  `commandId` is derived from the same mount entry as
 *  `snapshot.commandPath` and always equals
 *  `snapshot.commandPath.join('.')`; both fields are kept on purpose
 *  (id for addressing, snapshot as the value-free wire projection). */
export interface RunSummary {
  readonly commandId: string
  readonly exitCode: number
  readonly durationMs: number
  readonly snapshot: EngineCommandSnapshot
}

/**
 * What telemetry records about an invocation, captured when argv is
 * parsed. It says which command ran and which flags were given, and
 * never what any of them was set to: the command-path segments, the
 * flag NAMES with where each value came from,
 * and a bare count of positionals. Flag `source` derives from what
 * the engine knows at parse time: flags explicitly present on argv
 * are 'cli'; the engine reads no flags from the environment today,
 * so everything else is 'default' ('env' is reserved for a future
 * env-sourced flag mechanism).
 */
export interface EngineCommandSnapshot {
  /** Mount-path segments ('telemetry status' → ['telemetry',
   *  'status']). Never includes the binary name. */
  readonly commandPath: readonly string[]
  /** One entry per flag the command accepts (the engine-injected
   *  shared family first, then the command's own declarations), in
   *  the user-facing kebab-case spelling. */
  readonly flags: ReadonlyArray<{ readonly name: string; readonly source: 'cli' | 'env' | 'default' }>
  readonly positionalCount: number
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
  /** The credential manager the bin wires (design rev 5 §4). The
   *  engine prefers it for the needs check, ctx.session, and ctx.api.
   *  Optional only during the staged swap; getCredentials below is
   *  the fallback and is deleted — with the optionality — in the
   *  swap's final mechanical stage. */
  readonly credentialManager?: CredentialManager
  /** SDK client construction config the bin injects beside the
   *  manager; the engine builds ctx.api from it (the same config
   *  feeds performLogin). Required whenever a credentialManager is
   *  wired; optional only during the staged swap. */
  readonly managementApiClientConfig?: ManagementApiClientConfig
  readonly getCredentials: () => Promise<Credentials | undefined>
  /** Opens a URL in the user's browser — the login flow's opener,
   *  wired by the bin so the engine never depends on it. Called only
   *  for interactive sessions; a throw means "did not open" and never
   *  fails a command; absent means this host cannot open a browser,
   *  and the URL is announced instead. */
  readonly openUrl?: (url: string) => Promise<void> | void
  /** S3: the terminal-handoff seam (§4c) — starts a child with
   *  inherited stdio, wired by the bin as a node:child_process
   *  adapter so the engine never imports it. Absent means this host
   *  cannot hand the terminal to a child: ctx.spawn then fails with
   *  the engine's internal error. */
  readonly spawn?: SpawnChild
  /** Management API endpoint config; the bin derives baseUrl from env
   *  (getApiBaseUrl). */
  readonly managementApi: { readonly baseUrl: string }
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
// §11 The test harness — R7: same machinery, bytes out. Lives on its
// own public subpath, `@prisma/cli-engine/testing` (composer's
// ./testing convention): the main entry ships no test machinery.
// ————————————————————————————————————————————————————————————————————————

export declare function createTestCli(spec: {
  readonly commandFamilies?: readonly CommandFamily[]
  readonly commands: MountedTree
  readonly groups?: Readonly<Record<string, { readonly brief: string }>>
  readonly config?: Readonly<Record<string, unknown>>
  /** Legacy seed for the staged-swap getCredentials fallback: selects
   *  a manager-less runtime. Mutually exclusive with the manager
   *  seeds below; deleted with the swap's final stage. */
  readonly credentials?: Credentials
  /** Convenience manager seed: createSession runs its real claims
   *  derivation on this credential (mint the token with mintTestJwt). */
  readonly credential?: Credential
  /** Session-model seeding: stored sessions mirroring the state
   *  file's records, and the file's current marker. */
  readonly sessions?: ReadonlyArray<{
    readonly workspaceId: string
    readonly workspaceName: string | undefined
    readonly credential: Credential
  }>
  readonly currentWorkspaceId?: string
  /** Composes the ephemeral env session; also exported to each run's
   *  env as PRISMA_SERVICE_TOKEN. */
  readonly environmentToken?: string
  /** The SDK client construction config; defaults point every
   *  endpoint at test.invalid hosts (the design's local-endpoint
   *  fixture surface). */
  readonly managementApiClientConfig?: ManagementApiClientConfig
  /** baseUrl defaults to "https://test.invalid"; when `client` is
   *  supplied, ctx.api IS that object (the uniform mock seam). */
  readonly managementApi?: {
    readonly baseUrl?: string
    readonly client?: ManagementApiClient
  }
  readonly packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown'
  /** Fixed clock for deterministic stream timestamps; a clock that
   *  advances also drives prompt.browserWait's timeout, whose waiting
   *  is instant under the harness. */
  readonly now?: () => Date
  /** The browser opener behind ctx.openUrl and prompt.browserWait.
   *  Defaults to one that succeeds without doing anything — a real
   *  browser is never a test dependency; pass a spy to assert what was
   *  opened, or a thrower for the could-not-open path. */
  readonly openUrl?: (url: string) => Promise<void> | void
  /** S3: the spawn adapter behind ctx.spawn. Defaults to the scripted
   *  fake below; the real-child tests pass a node:child_process
   *  adapter, which is how the engine package itself never imports
   *  one. Every run records its spawns — command, args, cwd, env
   *  KEYS (values never: a recording must not carry token material),
   *  and the signals the engine delivered. */
  readonly spawn?: SpawnChild
  /** S3: scripts the built-in fake child (defaults to exit 0). The
   *  script receives the composed SpawnRequest and a nextKill()
   *  awaiting each engine-delivered signal, so it can model a child
   *  that ignores SIGTERM and dies only on SIGKILL. */
  readonly spawnScript?: (
    request: SpawnRequest,
    child: { readonly nextKill: () => Promise<'SIGTERM' | 'SIGKILL'> },
  ) => ChildResult | Promise<ChildResult>
}): TestCli

/** Mints an unsigned JWT whose payload is exactly `claims` — the
 *  harness's claim source (`sub`, `workspace_id`, `exp`, `email`) for
 *  createSession derivation, migration, and expiry tests. The rest of
 *  the design's fixture surface (the token-endpoint scripting,
 *  legacy-store builder, deterministic clock, second-process lock
 *  holder) lands with the real manager implementation, whose behavior
 *  it exercises. */
export declare function mintTestJwt(claims: Readonly<Record<string, unknown>>): string

export interface TestCli {
  /** The MUTABLE in-memory credential manager backing the runs: the
   *  full CredentialManager interface — with the design's
   *  process-pinning semantics (currentSession fixed at first read;
   *  its own mutations move it) — plus state(), which reads the whole
   *  stored state back after a run, and overwriteStoredState(), which
   *  applies a write as ANOTHER process would (never moves the pin).
   *  Undefined only when the legacy `credentials` seed selected the
   *  manager-less fallback runtime. */
  readonly credentialManager:
    | (CredentialManager & {
        state(): {
          readonly sessions: ReadonlyArray<{
            readonly workspaceId: string
            readonly workspaceName: string | undefined
            readonly credential: Credential
          }>
          readonly currentWorkspaceId: string | null
        }
        overwriteStoredState(state: {
          readonly sessions?: ReadonlyArray<{
            readonly workspaceId: string
            readonly workspaceName: string | undefined
            readonly credential: Credential
          }>
          readonly currentWorkspaceId?: string | null
        }): void
      })
    | undefined
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
      /** Settlement tap (S2a telemetry amendment): receives the
       *  RunSummary the engine fires after settlement (once, mounted
       *  runs only). */
      readonly onSettled?: (summary: RunSummary) => void
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
     *  assertions without byte-scraping; undefined when the run never
     *  presented. */
    readonly presented: PresentedResult<unknown> | undefined
  }>
}
