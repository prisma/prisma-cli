# Code review — unified CLI engine public interface (draft)

Reviewer pass: principal engineer (failure modes, operability, blast radius,
cost vs. benefit, constraints vs. assumptions). Naming, typology and overall
system shape are the architect's pass; where I hit one of those I say so and
move on.

Subject: `wip/designs/engine/engine-interface-draft.ts` (snapshot 2026-08-09).

Sources read in full: `cli-engine-requirements.md` (R1–R14),
`output-modes-survey.md`, `stricli-vs-clipanion.md`, the platform CLI shell
(`command-runner.ts`, `output.ts`, `runtime.ts`, `prompt.ts`,
`global-flags.ts`, `errors.ts`, `next-actions.ts`), Composer's
`operations/dev.ts`, `operations/shared.ts`, `dev/run-dev.ts`, and
`wip/designs/1a/design.md` (the host–product contract, whose §7.6 exit-code
table I treat as settled).

## Summary

The execution protocol at the centre of this draft is the right one. "Events
while running, one `Result` at the end, presenters turn the `Result` into
bytes" is a direct generalisation of the platform CLI's proven presenter
choke point, and it absorbs the ORM's progress spans and Composer's typed
event unions without contorting either. The `Block`/`Ui` pair genuinely makes
rendering impossible from a product, which is what R5 asks for. The lazy
`handler` loader is a one-to-one fit with stricli's `loader`. That core is
sound and I would build on it.

The draft is not yet buildable as written, for three separate classes of
reason.

First, the TypeScript does not compile in the ways it needs to. `ArgsOf`
silently drops all positionals because `positionals` is optional; a concrete
`CommandDefinition` is not assignable to the bare `CommandDefinition` that
`CommandSet` and `createCli` require; the brand symbols are unexported, which
breaks declaration emit; and typing a lazily loaded handler against its own
definition is circular. These are findings F01–F05 and they all have the same
fix: make `ArgsOf` take the flags and positionals objects rather than the
whole definition, and introduce an erased command type for mounting.

Second, several things the shipping CLIs demonstrably do cannot be said in
this vocabulary at all. There is no number flag and no flag default, so
`app domain wait --timeout 15m` has to parse its own string, which pushes
parse-time validation into handlers and straight past R6. There are no short
aliases, so `-q`, `-y`, `-v`, `-f` all disappear. Exit codes are stated as
0/1/2/3 while the settled contract table is 0/1/2/3/4–99/130/143, and
`migration check` already ships a 4 and the platform already ships a 130.
`Runtime` has no `env` and no `isTty.stdout`, so the engine cannot implement
its own CI detection or the deliberately-kept auto-JSON-on-non-TTY behaviour
without reaching around the injection seam — which is exactly what makes R7's
in-repo tests trustworthy. The success envelope slots the platform puts on
every command (`warnings`, `nextSteps`, `nextActions`) have nowhere to live,
and remediation is the second most recurring structure in the survey.

Third, the streaming half of the protocol is under-specified in the place
where it matters operationally. `prisma app logs` and `build logs --follow`
exist to have their output piped. The draft never says which stream an event
renders to, and the only candidate concept — the `output` event — uses
`stream` to mean the *child's* stream, not ours. If events render to stderr
(which the settled stream discipline implies), `prisma app logs > file`
produces an empty file. That is a shipped-behaviour regression hiding in an
unstated default.

Underneath those, two design questions are genuinely open rather than
oversights: R10's config-section registration is deliberately absent and the
current `LoadedConfig` shape cannot support the "fails only if a section it
needs is invalid" rule without it (F16); and the test harness has no way to
abort a run, which makes every session command — `dev`, `app logs`,
`build logs --follow` — untestable through the harness that R7 says is the
evidence (F19).

Pressure-test verdicts in short: `migration list` maps cleanly. `app deploy`
maps with one gap (two result shapes need a union `TResult`, which works, but
the SDK's `onStatusChange` has no matching event beyond `status`, which is
fine). Composer `dev` maps for events and `--fresh` but not for lifetime: the
handler must itself await the signal and then return a `Result` whose value is
a session that no longer exists, and `present.human` is asked to render it
(F12). `lsp` cannot be declared at all, because `raw` claims nothing else is
declared while the type still requires `flags` and `present` (F13).

## What looks solid

- **The one protocol.** Events during, `Result` at the end, presenters after.
  It is the platform CLI's `writeCommandSuccess` generalised, and it is the
  only thing in the corpus that can serve all three families.
- **`present` as a triple.** `human` to stderr, `stdout` for the machine
  payload, `json` for the envelope projection is exactly the platform's
  proven `renderHuman`/`renderStdout`/`renderJson`, including the property
  that `--quiet` leaves a clean pipe. `bucket key create`'s secret-to-stdout
  case survives this design unchanged.
- **`Block` and `Ui`.** There is no `print`, no colour function that writes,
  no exit. A product that wanted to diverge could not. `fields.sensitive`
  carries the secret-masking the platform built into its UI layer.
- **Lazy `handler`.** A direct match for stricli's `loader`, and it keeps
  Composer's import-time crash history classified rather than fatal at
  startup (R9's actual motivation).
- **Path-free commands, mounting-side tree.** `CommandSet` has no paths and
  `createCli` supplies them. That is R12 structurally, and it is also what
  lets a product mount a command anywhere in its own e2e tests.
- **`data?: unknown` on every event.** The R14 extension mechanism is
  present on every variant, uniformly, with the engine explicitly not
  interpreting it. This is the right shape.
- **Prompts return `Result` rather than throwing.** The platform's
  prompt layer throws a `usageError` and then string-matches its own summary
  to detect cancellation (`isPromptCancelError`, prompt.ts:98-100). Returning
  a value is strictly better.

## Findings

### F01 — `ArgsOf` silently drops every positional

**Location:** §3, `ArgsOf`, lines 182–188; `positionals?: TPositionals` at line 208.

**Issue:** `positionals` is declared optional, so `D['positionals']` has type
`TPositionals | undefined`. `keyof` over a union is the intersection of the
members' keys, and `keyof undefined` is `never`, so the second half of the
intersection evaluates to `{}`. Every positional vanishes from the handler's
argument type, with no error anywhere.

**Why it matters:** `app deploy <entry>`, `database show <id>`,
`app domain wait <hostname>` — most of the corpus takes positionals. Handlers
would read `args.entry` and get a compile error, or worse, authors would add
an index signature to make it go away.

**Suggestion:** stop parameterising `ArgsOf` on the definition. Make it
`ArgsOf<TFlags, TPositionals>` taking the two objects directly, defaulting
`TPositionals` to `{}`. That also fixes F02 and F04.

### F02 — Typing a lazily loaded handler against its own definition is circular

**Location:** §4, `handler`, lines 214–219.

**Issue:** the handler lives in a separate module (that is the point of the
loader). To type its `args` parameter the author must write something like
`ArgsOf<typeof myCommand>` — but `myCommand`'s own type depends on the
handler's type, which depends on `myCommand`. TypeScript will resolve this to
`any` or report a circularity, depending on how it is written.

**Why it matters:** the only escape is to hand-write the args type in the
handler module, which then drifts from the flag declarations silently. That
is precisely the "separate data structure a translator interprets" that R1
exists to prevent, reintroduced at the file boundary.

**Suggestion:** with F01's fix, authors declare `const flags = {...}` once,
export it, and both the definition and the handler refer to
`ArgsOf<typeof flags, typeof positionals>`. No cycle. Consider shipping a
`Handler<typeof flags, typeof positionals, TConfig>` alias so the handler
module has one thing to import.

### F03 — The brand symbols are not exported, so declaration emit fails

**Location:** §3, `declare const FLAG: unique symbol` (line 171) and
`declare const POSITIONAL: unique symbol` (line 178).

**Issue:** `FlagSpec` and `PositionalSpec` are exported interfaces whose only
member is keyed by a non-exported `unique symbol`. Emitting `.d.ts` for this
package produces TS4033/TS4023 ("has or is using private name").

**Why it matters:** the engine package ships types; this is a hard build
failure the moment `declaration: true` is on.

**Suggestion:** export the symbol declarations (they can stay undocumented),
or brand with a `declare const brand: unique symbol` exported from an
`internal` entry point that the public types reference.

### F04 — A concrete command is not assignable to the bare `CommandDefinition`

**Location:** §6, `CommandSet` (line 276) and `createCli`'s
`commands: Readonly<Record<string, CommandDefinition>>` (line 287); §7,
`createTestCli` (line 323).

**Issue:** `CommandDefinition`'s defaults make `present.human` have signature
`(value: unknown, ui: Ui) => Block[]`. Under `strictFunctionTypes`, assigning
a command whose `present.human` takes `(value: MigrationList, ui)` requires
`unknown` to be assignable to `MigrationList`, which it is not. The same
argument applies to `handler`'s `args` parameter. So the very commands
`createCli` is supposed to receive will be rejected by it.

**Why it matters:** this is not a corner case — it is the primary call site.
Every product's `CommandSet` export and every `createCli` call breaks, and
the usual fix people reach for (`as any`) erases the whole type story.

**Suggestion:** introduce an explicitly erased mount-side type — e.g.
`AnyCommandDefinition = CommandDefinition<any, any, any, any>` (or a
deliberately opaque `MountableCommand` the engine produces) — and type
`CommandSet`, `createCli` and `createTestCli` against that. The precise
definition stays on the authoring side where inference matters.

### F05 — `TConfig` is not inferable, so `ctx.config` will be `unknown` in practice

**Location:** §4, `CommandDefinition`'s `TConfig` parameter (line 198) and its
single use inside `handler`'s `ctx` parameter (line 217).

**Issue:** `TConfig` appears only in a contravariant position inside a lazily
imported module's function parameter. `defineCommand` has nothing to infer it
from unless the handler module explicitly annotates its `ctx` parameter,
which is the thing the circularity in F02 makes awkward.

**Why it matters:** in the common case every handler gets
`CommandContext<unknown>` and casts. That defeats the point of typing the
config section at all.

**Suggestion:** make the config section an explicit, declared part of the
definition rather than a free type parameter — see F16, which needs a runtime
section name anyway. One field solves both.

### F06 — No number flag and no defaults, so parse-time validation leaks into handlers

**Location:** §3, the `flag` object, lines 158–169.

**Issue:** the vocabulary is string, requiredString, boolean, enum, repeated,
json. There is no number, no duration, and no `default` on any of them.

**Why it matters:** `app domain wait --timeout` (default 15m, with `0` meaning
"probe once") and the SDK's `timeoutSeconds`/`pollIntervalMs` are real,
shipping, and cannot be declared here. The handler ends up parsing and
validating the string, which means the failure surfaces as a handler error
after routing rather than as the typed parse error R6 wants — and stricli's
own scanner errors, the thing the framework evaluation praised most (criterion
6), go unused for this class of flag.

**Suggestion:** add `flag.number({ brief, default?, min?, max? })` and a
`default` option to `string`/`enum`/`boolean`. Defaults also remove the
`?? fallback` noise from every handler.

### F07 — No short aliases

**Location:** §3, the `flag` object.

**Issue:** nothing declares `-q`, `-y`, `-v`, `-f`, `-n`. Stricli supports
exactly one-character aliases (per the evaluation, weakness 5); the draft
does not expose that capability.

**Why it matters:** every shipping CLI in the corpus has them
(`global-flags.ts:13-21`). Dropping them is a user-visible regression, and
it will be discovered after the vocabulary is frozen.

**Suggestion:** add `short?: string` to the flag specs and validate it is one
character at build time. Note that stricli cannot do long aliases, so
deprecation renames need the engine's own hidden-second-flag trick — worth
recording now.

### F08 — Positionals are too thin: no number, no enum, no variadic

**Location:** §3, `positional`, lines 174–177.

**Issue:** only `string` and `optionalString`.

**Why it matters:** variadic positionals appear in the corpus (multi-argument
commands) and enum positionals would let the "did you mean" machinery stricli
already computes apply to subjects, not just flags.

**Suggestion:** add `rest()` (variadic) at minimum; number and enum if the
tree needs them. Flag anything not added as a deliberate exclusion so it does
not get re-litigated.

### F09 — Flag and positional names can collide silently

**Location:** §3, `ArgsOf`'s intersection, lines 182–188.

**Issue:** `ArgsOf` intersects the flag keyspace with the positional keyspace.
A flag named `name` and a positional named `name` produce
`string & (string | undefined)` — one merged key, no error, and at runtime one
value overwrites the other depending on the engine's merge order.

**Why it matters:** it is a quiet correctness bug, and the merge order is an
engine implementation detail no author will know.

**Suggestion:** either detect the collision at the type level (a conditional
type resolving to a `never`-valued error field is enough to make it a compile
error) or separate the keyspaces (`args.flags.x` / `args.positionals.y`).
Which of those is right is a shape question — architect referral.

### F10 — Exit codes 0/1/2/3 contradict the settled table

**Location:** §6, `Cli.run` doc comment, lines 292–296.

**Issue:** the settled host–product contract (`wip/designs/1a/design.md` §7.6)
is `0` ok, `1` bug, `2` expected failure, `3` user declined, `130`/`143`
signals, `4`–`99` command-specific outcome codes, plus one documented
passthrough exception for spawned-engine exit statuses. The draft names four
codes and gives a command no way to express any of the others.

**Why it matters:** this is not hypothetical. `migration check` already exits
`4` on integrity failure via `exitOverride`
(`migration-check/exit-codes.ts:1-3`), the platform's `commandCanceledError`
already exits `130` (`errors.ts:129-139`), and Composer already passes an
alchemy child's status through (`render-error.ts:27-37`). Machine consumers
branching on exit codes is a stated R6 goal; a code space the engine cannot
express is a code space each product will re-invent behind the engine's back.

**Suggestion:** state that `CliStructuredError` carries an optional
`exitCode` in the 4–99 range (the platform's `CliError.exitCode` already
does), define how signal-driven termination reaches 130/143 (see F17), and
name the child-passthrough exception explicitly.

### F11 — Events have no defined stream, and the streaming-data case has no home

**Location:** §1, the `output` event (lines 69–75); §2, `report` (line 117).

**Issue:** the draft never says where events render in human mode. The
`output` event's `stream` field describes the *child's* stream, not ours,
so there is no way to say "this line is the data the user asked for and
belongs on our stdout".

**Why it matters:** `prisma app logs`, `build logs --follow`, and
`app run` exist to be piped. Today `build logs` routes NDJSON records to
stdout or stderr by `source`/`level` (`controllers/build.ts:34-150`). If the
engine renders all events to stderr — which the settled stream discipline
implies — then `prisma app logs > out.txt` yields an empty file. That is a
silent regression discovered by a user, not by us.

**Suggestion:** state the routing rule explicitly, and give a command a way to
declare that its event stream *is* its data — either a distinct event kind
(`data`, going to stdout) or a `channel: 'data' | 'progress'` discriminator on
`output`. While you are there, say that `--quiet` suppresses progress events
but never data events, matching what `--quiet` already means for `present`.

### F12 — Session commands have no meaningful `Result`, and `present` is required anyway

**Location:** §4, `present` (required, lines 228–232); the header's protocol
note, lines 12–14.

**Issue:** for a session command the value *is* the session, which no longer
exists once the handler returns. Composer's `dev()` returns
`Result<DevSession, …>` and the CLI adapter then owns the lifetime
(`run-dev.ts`). Under this interface the handler must instead await the signal
itself, tear down, and return some invented `Result` whose `present.human` is
asked to render a summary of a session that has ended.

**Why it matters:** every session command gets a fake result type and a
no-op presenter, and the shape of that fake becomes de facto convention
without ever being designed. It also removes the deliberate property Composer
records: the host owns signals and the operation never touches them.

**Suggestion:** make `present` optional, or add an explicit
`kind: 'session'` (or `present: 'none'`) that declares "the stream is the
output; there is no end-state rendering". This is the same knob the platform
already needs — `build logs` sets `emitJsonSuccessEvent: false` for exactly
this reason (`commands/build/index.ts:52-55`).

### F13 — `raw` contradicts the rest of the type

**Location:** §4, `raw?: false | { reason: string }`, lines 234–239.

**Issue:** the comment says "the engine enforces that nothing else is
declared", but `flags` and `present` are both required properties. A `raw`
command such as `lsp` cannot be written without declaring an empty `flags`
object and a presenter that will never run.

**Why it matters:** `lsp` is a real command; the escape hatch does not
currently escape anything.

**Suggestion:** make `CommandDefinition` a union — the normal shape versus a
`RawCommandDefinition` with `brief`, `description`, `flags` and a raw handler
taking the runtime streams. Then "nothing else is declared" is enforced by the
type rather than by a runtime check.

### F14 — `Runtime` is missing `env` and `isTty.stdout`

**Location:** §6, `Runtime`, lines 300–311.

**Issue:** there is no `env`, and `isTty` covers stdin and stderr but not
stdout.

**Why it matters:** two concrete consequences.
(a) The engine's own interactivity check needs `env.CI` — the platform's
`canPrompt` reads it directly (`runtime.ts:114`). Colour policy needs
`NO_COLOR`/`FORCE_COLOR`. With no `env` on `Runtime`, the engine reads
`process.env`, and the moment it does, R7's in-repo tests stop being able to
simulate CI or a non-colour terminal — which is the property that makes those
tests evidence.
(b) The deliberately-kept auto-JSON behaviour keys on stdout not being a TTY
(`utils/global-flags.ts:67-69`). The interface has no field to read.

**Suggestion:** add `env: Readonly<Record<string, string | undefined>>` and
`isTty.stdout`. Both are cheap and both are already in the platform's
`CliRuntime`.

### F15 — The success envelope has no slots for warnings, next steps, or next actions

**Location:** §4, `present` and the handler's `Result<TResult, …>` return.

**Issue:** the handler returns a bare value. The platform's `CommandSuccess<T>`
carries `warnings`, `nextSteps` and `nextActions` alongside `result` on every
command (`output.ts:9-15`), and renders warnings in human mode too so degraded
steps are never silent (`command-runner.ts:130-135`).

**Why it matters:** remediation is the second-most-recurring structure in the
survey, currently spelled five different ways, and unifying it is a stated
R14 goal. If the only place to put it is inside `present.json`, it ends up
nested in `result` where no cross-command consumer can find it — recreating
the ORM's "remediation buried in per-command shapes" problem the survey calls
out by name. `Block.nextSteps` covers human mode only.

**Suggestion:** let the handler return `Result<Success<TResult>, …>` where
`Success` carries `value` plus optional `warnings`/`nextSteps`/`nextActions`,
or make those a second, engine-owned channel the handler can add to. Either
way they must reach the JSON envelope without passing through `present.json`.

### F16 — R10's central rule is inexpressible: nothing says which section a command needs

**Location:** §2, `CommandContext.config` (lines 106–110); §6, `LoadedConfig`
(lines 313–316).

**Issue:** `CommandContext`'s comment asserts that the engine already failed
the command when its section is invalid, but nothing in `CommandDefinition`
names a section. `LoadedConfig` is an untyped `sections` record plus
diagnostics keyed by `section: string | null`. The engine cannot match one to
the other.

**Why it matters:** "a command fails only if a section it needs is invalid" is
the whole reason per-section diagnostics exist — one product's config typo must
not brick another product's commands. As written the engine has exactly two
implementable choices, and both are wrong: fail every command if any section
is bad, or fail none. There is also no expression of the `defineConfig`
version marker, whose absence R10 says must fail early with a typed error —
today that can only appear as a diagnostic with `section: null`, which is
indistinguishable from a general file problem.

**Suggestion:** put the section name on the definition (`configSection:
'composer'`), which also gives `TConfig` something to infer from (F05). Give
`LoadedConfig` an explicit discriminated top-level state so "no config file",
"file present but unmarked", and "file valid, section X invalid" are three
distinguishable things rather than three shapes of the same record. Section
registration and validators are legitimately a separate design, but the
*name* has to be here or the rule cannot be enforced.

### F17 — Cancellation, teardown, and the signal-to-exit-code path are undefined

**Location:** §2, `signal` (lines 124–126); §6, `Runtime.signal` (line 306).

**Issue:** three gaps sit together. The engine cannot tell which signal fired
(`AbortSignal` alone does not say SIGINT versus SIGTERM), so 130 versus 143
is unreachable. Nothing bounds teardown — a handler that hangs after abort
leaves the CLI unresponsive, and a second Ctrl-C has no defined effect.
And `PromptSurface` returns the same `Result` failure for "no TTY available"
as for "user pressed Ctrl-C", which the engine must distinguish to choose
exit 2 versus exit 3.

**Why it matters:** this is the 2am path. A `dev` session that will not die on
Ctrl-C is the single most common CLI complaint, and it is currently
unspecified rather than decided.

**Suggestion:** state that `signal.reason` carries a typed cancellation value
naming the signal; define a teardown grace period after which the engine
returns the signal code regardless; define what a second signal does. Give the
prompt failures distinct, documented codes so the exit-code mapping is
mechanical rather than a string match.

### F18 — `report` has no backpressure and no defined end of life

**Location:** §2, `report: (event: EngineEvent) => void`, line 117.

**Issue:** `report` returns `void`, so a handler tailing a high-volume log has
no signal to slow down; `stream.write()` returning `false` is invisible. The
draft also says `report` is safe to call after the signal fires, but says
nothing about after the handler's promise settles.

**Why it matters:** unbounded buffering on a slow pipe is a memory failure
mode in exactly the commands that stream. And a late `report` from a detached
task — a timer, a child process that has not been awaited — writing after the
JSON envelope has been printed corrupts the `--json` contract for machine
consumers, which is the one contract agents depend on.

**Suggestion:** either return a `boolean`/`Promise<void>` for backpressure, or
document that the engine buffers with a stated bound and what happens when it
is hit. Separately, state that `report` becomes a no-op once the handler's
promise settles, and that the engine drains before writing the envelope.

### F19 — The test harness cannot test any session command

**Location:** §7, `TestCli.run`, lines 330–338.

**Issue:** `run(argv, { stdin })` has no abort handle, no cwd, no env, and no
TTY control. For a session command `run()` simply never resolves. The `stdin`
string also cannot drive a clack prompt, which reads raw keypresses (arrow
keys for `select`), so prompt-bearing commands are untestable too.

**Why it matters:** R7 says in-repo tests are the evidence about the shipped
CLI. Under this harness the untestable set is `dev`, `app logs`,
`build logs --follow`, `app run`, and every wizard — which is most of what
actually breaks. Nor can a test cover F14's auto-JSON behaviour, since there
is no TTY knob.

**Suggestion:** add `signal`, `cwd`, `env`, and `isTty` to the `run` options,
and replace the `stdin` string with a scripted prompt responder (an ordered
list of answers, plus the recorded prompts in the result so tests can assert
what was asked). Both are small; both are the difference between a harness
that covers the risky commands and one that covers the easy ones.

### F20 — Steps have no identity, so the nesting the comment promises does not work

**Location:** §1, `step-started` / `step-finished` (lines 44–52).

**Issue:** the pair is correlated only by the `step` string, and the comment
says "steps may nest". The one implementation in the corpus that actually
nests uses `spanId` plus `parentSpanId` (`control-api/types.ts:91-111`),
precisely because a name is not unique — the ORM's per-migration spans are
`operation:<op.id>` children of `apply`.

**Why it matters:** two concurrent steps with the same name (two contract
spaces both applying) cannot be told apart, and a renderer cannot build the
tree. This is the one place where the draft's vocabulary is strictly weaker
than the code it generalises.

**Suggestion:** add `id` and optional `parentId`, exactly as the span model
does. `step` stays as the human label.

### F21 — Credentials are a static token with no refresh path

**Location:** §2, `Credentials` (lines 132–136); §6, `Runtime.credentials`.

**Issue:** a plain `{ token, workspaceId? }` captured once at startup.

**Why it matters:** a `dev` session runs for hours. A token captured at
minute zero expires at minute ninety, and every subsequent management-API
call fails with an auth error that looks like a bug. Nothing in this shape
allows refresh.

**Suggestion:** make it a provider — `getToken(): Promise<Result<string, …>>`
— so refresh is possible without changing the interface later. The opacity
the comment wants is preserved.

### F22 — Commands cannot declare that they need authentication

**Location:** §2, `credentials: Credentials | undefined`.

**Issue:** every handler that needs auth must check for `undefined` and build
its own "not authenticated" structured error.

**Why it matters:** the platform already centralises this
(`authRequiredError`, `errors.ts:101-115`) with consistent wording, next
steps, and exit code. Pushing it into every handler is the presentational
drift R5 exists to kill, one layer down: the error text becomes per-product.

**Suggestion:** `requiresAuth: true` on the definition, with the engine
producing the one canonical error. Whether that belongs on the engine at all,
given `credentials` is Cloud-specific, is a shape question — architect
referral.

### F23 — `createCli` is documented as failing at build time but can only throw at startup

**Location:** §6, `createCli`, lines 283–288; "Collisions and grammar
violations fail the build."

**Issue:** `createCli` is a runtime function taking a `Record`. Duplicate
object keys are a TypeScript error, but a command mounted at `'db'` colliding
with a group named `'db'`, or a path violating the agreed grammar, can only be
detected when the function runs. Throwing there also conflicts with the stated
rule that the engine never exits and only writes to the provided streams.

**Why it matters:** "fails the build" and "throws on every user invocation
including `--help`" are very different guarantees, and the draft claims the
first while the shape delivers the second.

**Suggestion:** say plainly that validation happens at `createCli` time and
returns a `Result` (or is asserted by a shell-repo test that calls it), and
keep a separate lint/build step if a genuine build-time check is wanted.

### F24 — `@prisma/cli-foundation` and `NodeJS.WritableStream` both sit in the public surface

**Location:** line 25 (the foundation import); §6, `Runtime`'s stream fields.

**Issue:** R3 says products import the engine package "and nothing else for
CLI purposes". `Result` and `CliStructuredError` come from a second package.
Separately, `NodeJS.WritableStream` is a Node-global type in a surface that
R4 wants runtime-agnostic; stricli deliberately uses a minimal structural
`{ write, getColorDepth? }` instead.

**Why it matters:** the foundation split is almost certainly correct
(structured errors are raised at their origin, inside operations, which must
not depend on the engine), but then the engine should re-export so products
have one import. And the Node type quietly makes the public surface
node-only, which is one of R4's three stated reasons.

**Suggestion:** re-export `Result` and `CliStructuredError` from the engine
package. Replace the stream types with a structural interface. Whether the
two-package split is right is an architect question; the re-export and the
stream type are not.

### F25 — `flag.json()` is engine-behavioural but arrives in `args`

**Location:** §3, `flag.json()`, line 168.

**Issue:** as a `FlagSpec<boolean>` in the flags record, `json` appears in
`ArgsOf` and therefore in the handler's arguments. The engine can identify it
at runtime (it produced the spec object), so switching renderers and
suppressing prompts and progress is implementable — that part works.

**Why it matters:** a handler that can see `args.json` will eventually branch
on it, which is the R5 violation the whole design is built to prevent. It also
raises the question of the other engine-behavioural flags the platform proves
are needed and the draft omits entirely: `--quiet`, `--verbose`, `--trace`,
`--yes`, `--no-interactive`, `--color/--no-color`
(`global-flags.ts:23-45`). With no global flags, each must come from a shared
declaration, and only `json` has one.

**Suggestion:** exclude engine-owned flags from `ArgsOf` (a `FlagSpec` variant
the mapped type filters out), and add the rest of the shared set. `--yes` is
the interesting one: it must reach `ctx.prompt` so `confirm` auto-answers,
which argues it is context state, not an argument.

## Deferred

These are real, but they are scope expansions rather than gaps in this draft.

- **Config-section registration and validators (R10's other half).** The
  draft says this is a separate design and I agree. What cannot be deferred
  is the section *name* on the definition — without it the engine cannot
  implement the "only the sections it needs" rule at all (F16).
- **Daemon management (mode 5).** Explicitly out of scope in the header.
  The survey's finding that Composer's daemons have no user-facing
  stop/status is worth carrying into that design, not this one.
- **Autocomplete.** Stricli ships `proposeCompletions`; nothing in this draft
  touches it. Fine to leave until the tree is stable, but note that a
  completion surface constrains the flag vocabulary, so decide before
  freezing F06–F08.
- **Telemetry.** Both the ORM and the platform fork a detached child on every
  invocation. Neither `Runtime` nor `Cli` has a hook. Deliberate, presumably —
  but it should be an explicit decision rather than an omission.
- **Duration and timing events.** The survey ranks durations 2/3 and both
  families render them under `--verbose`. There is no timing concept in the
  event vocabulary. Adding one is speculative until a renderer needs it; the
  evidence rule the draft sets for itself says wait.

## Acceptance-criteria verification

Verdicts for a design artifact: **PASS** = the interface structurally
satisfies or enforces the requirement. **WEAK** = satisfiable, but the shape
does not enforce it. **FAIL** = the shape contradicts the requirement or
cannot express it. **NOT VERIFIED** = cannot be assessed from the draft.

| R | Requirement | Verdict | Detail |
|---|---|---|---|
| R1 | One language, directly executable | **PASS** | `defineCommand` is an identity function; the declared object is what the engine runs. No product-side schema, no interpreter. The typing defects (F01–F05) are bugs in the expression, not a return to a two-stage design — except that F02's workaround (hand-written arg types in the handler module) would reintroduce exactly the drift R1 forbids, so fixing it is R1 work. |
| R2 | Commands end in typed operation calls | **WEAK** | The shape is compatible: `handler` returns `Result<TResult, CliStructuredError>`, which is the operations client's own return type, so the thin-wiring case is the natural one. But nothing prevents a handler containing logic, and `TResult` being free-form makes a fat handler no harder to write than a thin one. Enforcement is a review/lint concern, not an interface one. |
| R3 | The engine package is the whole contract | **WEAK** | No stricli type appears anywhere — the primary goal holds, and `FlagSpec`/`PositionalSpec` being opaque brands means even the parse vocabulary is ours. Two leaks: `Result` and `CliStructuredError` come from `@prisma/cli-foundation`, so products import two packages (F24); and `NodeJS.WritableStream` puts a Node-global type in the surface, which is a third-party type in the sense R4 cares about even if not in the sense R3 names. Both fixable without design change. |
| R4 | Products receive a context, never the environment | **PASS** | `CommandContext` carries config, credentials, `report`, `prompt`, `signal`, `cwd`, and offers no way to reach disk, env, or the TTY. `cwd` is explicitly there so products never call `process.cwd()`. Two follow-ups that do not change the verdict: the engine itself loses injectability because `Runtime` has no `env` (F14), and there is no sanctioned way to probe for an optional module (F13's R13 counterpart, F26 below). |
| R5 | Products have no presentational API | **PASS** | Structurally enforced. `present` returns `Block[]`; `Ui` returns strings and cannot write; there is no print, no colour policy, no exit. `stdout: (value) => string[]` is the one raw-bytes path and it mirrors the platform's proven `renderStdout`, which exists so `--quiet` leaves a clean pipe. The gaps I found are about what products *cannot say* (F11, F15), not about what they can render. |
| R6 | Errors and results follow the settled conventions | **FAIL** | The `Result`/`CliStructuredError` half is right and used consistently, including on the prompt surface. The exit-code half contradicts the settled table: the draft names 0/1/2/3 and gives a command no way to express 4–99 or the signal codes, while `migration check` already exits 4, the platform's cancel path already exits 130, and Composer already passes a child's status through (F10). Cancellation cannot even reach 130/143 because the interface does not say which signal fired (F17), and prompt failures do not distinguish "no TTY" (exit 2) from "user declined" (exit 3). |
| R7 | Product-repo end-to-end tests are first-class | **WEAK** | `createTestCli` is instance-based, takes only the product's own commands, returns real bytes plus exit code, and — better than the current CLIs — exposes `events` for semantic assertions without forcing `--json`. That much is a genuine match. But the harness cannot abort a run, so every session command hangs forever; cannot script keypress-driven prompts, so every wizard is untestable; and has no cwd/env/TTY knobs, so the auto-JSON and interactivity behaviours cannot be covered (F19). The untestable set is the risky set. |
| R8 | The shell's test burden is integration proof | **NOT VERIFIED** | This is an allocation-of-work requirement, not an interface one. Nothing in the draft obstructs it — `createCli` plus an injected `Runtime` gives the shell the same argv-in/bytes-out path products get. Re-assess against the shell's test plan. |
| R9 | Static tree, lazy guts | **PASS** | `handler: () => Promise<{ default }>` is exactly stricli's `loader`, and everything help needs (`brief`, `description`, `examples`, `flags`, `positionals`) is static, so full help renders without invoking a loader. One caveat that does not change the verdict: `present` also sits in the static definition, so a presenter that reaches for a heavy formatting library silently drags it into startup. Worth a documented rule. |
| R10 | One config file, validated by its products, never a crash | **FAIL** | The requirement's operative rule — "a command fails only if a section it needs is invalid" — cannot be implemented against this shape, because no command declares which section it needs and `LoadedConfig` is an untyped record keyed by strings the engine cannot match to commands (F16). The `defineConfig` version marker has no representation either; an unmarked classic Prisma 7 file can only appear as a diagnostic with `section: null`, indistinguishable from any other whole-file problem — and R10 calls a silently misparsed v7 file the worst launch bug available. Section registration is legitimately deferred; the section *name* is not. |
| R11 | Pinned versions, tandem releases | **NOT VERIFIED** | A release-process requirement with no interface surface. `createCli` takes a `version` string, which is unrelated. |
| R12 | The shell defines the command tree | **PASS** | `CommandDefinition` contains no path and `CommandSet` is a flat name→definition record; paths exist only as keys in `createCli`, alongside group briefs that are declared at the mount because groups belong to the tree. `createTestCli` taking the same records is what lets a product mount a command anywhere for its own tests, which is R12's stated escape valve. Only caveat: "collisions fail the build" overstates what a runtime `Record` can guarantee (F23). |
| R13 | The CLI never touches a package manager | **WEAK** | Nothing in the interface installs, downloads, or vendors anything, so the prohibition holds. The requirement's positive half does not: a handler needing an optional peer has no sanctioned way to probe for it. A bare `await import('x')` in a handler is arguably a permitted runtime check (the stricli evaluation says the framework does not interfere), but with no helper every product hand-rolls the try/catch and its own error wording — the same per-product drift F22 describes for auth. Suggest `ctx.optionalDependency(name): Promise<Result<Module, CliStructuredError>>` so the "missing dependency, install it with your own package manager" error is written once. |
| R14 | One event vocabulary, engine-defined, with product extensions | **PASS** | The union is a genuine generalisation of the surveyed structures, the common fields are required rather than optional (so products must fill them), and `data?: unknown` sits on every variant as the pass-through extension with the engine explicitly not interpreting it. The occurrence-ranked derivation is exactly the evidence discipline R14 asks for. Two weaknesses that do not sink it: steps lack the ids the one nesting implementation in the corpus needs (F20), and the vocabulary has no way to mark an event as data rather than decoration, which is where the streaming commands break (F11). |

### Summary counts

| Verdict | Count | Requirements |
|---|---|---|
| PASS | 6 | R1, R4, R5, R9, R12, R14 |
| WEAK | 4 | R2, R3, R7, R13 |
| FAIL | 2 | R6, R10 |
| NOT VERIFIED | 2 | R8, R11 |
| **Total** | **14** | |
