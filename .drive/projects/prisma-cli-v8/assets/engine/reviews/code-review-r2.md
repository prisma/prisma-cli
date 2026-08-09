# Code review round 2 — unified CLI engine public interface (v3)

Reviewer pass: principal engineer. Naming, typology and system shape remain
the architect's; referrals are marked.

Subject: `wip/designs/engine/engine-interface-draft.ts` (v3), read against v1
and v2 (`-v1.ts`, `-v2.ts`) and my round-1 artifact `./reviews/code-review.md`.

## Summary

v3 is a large improvement. Of the 25 round-1 findings, 15 are fully resolved,
7 are partly resolved with a named residual, and 3 are untouched. Both round-1
FAIL verdicts (R6 exit codes, R10 config sections) are cleared: exit codes now
span the settled table and config sections are bound to commands by a typed
token, which is what makes "a command fails only if a section it needs is
invalid" implementable rather than aspirational. The type-system defects that
made v1 unbuildable are genuinely fixed — I worked through each one and they
hold up.

The return-site presentation ruling is, I think, right, and for a reason
stronger than the one stated. Under v1/v2 a presenter ran after the handler
had returned, which meant it had to reconstruct which case it was in from the
result value alone, and a throw inside it happened after the command had
logically succeeded. Under v3 the views close over live context at the point
the outcome is known, and a throw in a view is just a handler throw. That is
a real reduction in the number of things that can go wrong.

Three things about the new shape need attention before this is settled.

**The one internal contradiction is `exitCode`.** The v3 header states that
"nothing product-authored executes after the handler resolves — the engine
receives values, never callbacks." `exitCode?: (data: unknown) => number` is
precisely a product-authored callback the engine invokes after resolution. It
is also the one place where moving presentation to the return site cost type
safety that v2 had: v2's signature was `(value: TResult) => number`, correctly
typed; v3's is `(data: unknown) => number`, so every command computing a
custom exit code casts. Both problems have the same fix, and it is the fix
v3's own thesis implies: carry the exit code as a value on the presented
result. See N01 — this is the finding I would act on first.

**The mode-to-view mapping has three unspecified interactions** that will be
decided by whoever implements first rather than by this document: what
`--verbose` does (there is no verbose view, so product-level detail under `-v`
— which both the ORM and the platform ship today — becomes unreachable);
what `--yes` does to `ctx.prompt.confirm` (handlers no longer see the flag, so
either the engine auto-answers or `-y` silently stops working in CI); and what
`--json --quiet` together mean, since the two modes select disjoint view sets.
N06 and N07.

**`AnyCommand` has no runtime discriminant.** The three definition types are
structurally near-identical and differ only in their handler's return type,
which is erased at runtime. The engine must decide, per mounted command,
whether to expect a `PresentedResult` or `void`, whether to inject the shared
flag family, and whether auto-json applies — and it has nothing to branch on.
The `define*` functions are the natural place to stamp a tag. N03.

Below that tier, the notable fresh items are: `PresentedResult` is
structurally constructible, so the "built exclusively by ctx.present"
invariant is documentation rather than type (N02); `NextAction` is declared in
the engine package but error envelopes carry next actions, which puts it on
the wrong side of the engine/foundation boundary (N04); flag `default`s do not
narrow the flag's type, so every defaulted flag still needs `?? default` in
the handler (N05); and positional order is object key order, which is both
implicit and, for integer-like keys, not insertion order at all (N08).

Pressure-test results in brief. Multi-return-path handlers work well and are
better than v2 — each return site builds its own views with the case in hand.
`migration check` maps except for the `exitCode` cast. Composer `dev` now maps
cleanly onto `defineSessionCommand` (`Result<void>`, event stream is the json
surface, `--fresh` as a boolean flag). `lsp` maps onto `defineRawCommand`.
`app deploy`'s two result shapes are no longer a problem at all, because there
is no result generic to unify — each path presents itself. That is a real
benefit of the ruling I did not anticipate.

## Round-1 finding disposition

| # | Round-1 finding | Disposition | Note |
|---|---|---|---|
| F01 | `ArgsOf` drops positionals | **Resolved** | `Args<TFlags, TPositionals>` takes both objects explicitly; `positionals` optionality no longer collapses the mapped type. Separate `flags`/`positionals` namespaces. |
| F02 | Handler typing is circular | **Resolved** | `CommandHandler<typeof def>` with a type-only import breaks the cycle; `import type` erases, so no runtime cycle. See N09 — the helper does not cover session or raw definitions. |
| F03 | Brand symbols unexported | **Resolved** | `export { FLAG }` / `export { POSITIONAL }` added; declaration emit will work. |
| F04 | Concrete command not assignable to bare `CommandDefinition` | **Resolved** | `AnyCommand` with `any` generics is assignable in both directions, so `CommandSet`, `createCli` and `createTestCli` accept real commands. Runtime discrimination is a separate problem (N03). |
| F05 | `TConfig` not inferable | **Resolved** | `configSection?: ConfigSection<TConfig>` is a direct inference site. Default `undefined` gives `config: undefined` when omitted. |
| F06 | No number flag, no defaults | **Partial** | `flag.number` and `default` added. But `default` does not narrow the return type — `flag.number({default: 15})` still yields `FlagSpec<number \| undefined>`, so handlers keep the `?? 15` (N05). |
| F07 | No short aliases | **Partial** | `alias?: string` added. Not constrained to one character, which is stricli's hard limit, so `alias: 'dp'` compiles and fails later (N05). |
| F08 | Positionals too thin | **Partial** | `variadic` added. Number and enum positionals still absent (acceptable). The "at most one, last" rule is unenforceable because positionals are an unordered `Record` (N08). |
| F09 | Flag/positional name collisions | **Resolved** | Separate namespaces make collision impossible by construction. |
| F10 | Exit codes contradict the settled table | **Partial** | 0/1/2/3/4–99/130/143 now stated; `exitCode` provides 4–99; the engine owns signal codes. Residuals: the callback is untyped and post-resolution (N01), the 4–99 range is not type-enforced, and whether a structured *failure* can carry a custom code is unstated. |
| F11 | Events have no defined stream | **Resolved** | `channel: 'data' \| 'diagnostic'` with routing documented — data to our stdout, everything else to stderr, all framed on stdout in json mode. This is the finding I was most concerned about and the fix is clean. |
| F12 | Session commands have no meaningful result | **Resolved** | `defineSessionCommand` returns `Result<void>`, no presentation, event stream is the json surface. Also subsumes the platform's `emitJsonSuccessEvent: false` case. |
| F13 | `raw` contradicts the type | **Resolved** | `defineRawCommand` is its own type with its own handler shape returning an exit code directly. Raw commands cannot take positionals — presumably deliberate; worth confirming for `lsp`. |
| F14 | `Runtime` missing `env` and `isTty.stdout` | **Resolved** | Both added; auto-json now has a field to read and the engine's CI detection stays inside the injection seam. |
| F15 | No envelope slots for warnings/next steps/actions | **Resolved** | `next` view supplies `nextActions`; `nextSteps` derives from them; `warnings` aggregates from severity-`warn` message events. "Emit once, appear in both places" is a good call. Derivation rule for `nextSteps` is unstated (minor). |
| F16 | Nothing says which config section a command needs | **Resolved** | `ConfigSection<T>` token plus `configSection` binding. Raw sections in `LoadedConfig`, validated per command, is exactly what makes the R10 rule implementable. Residual in N12. |
| F17 | Cancellation and exit-code path undefined | **Partial** | The engine now records which signal fired, and prompt failures carry distinct codes for "unavailable" (exit 2) versus "cancelled" (exit 3). **Still open:** no teardown deadline and no defined behaviour for a second Ctrl-C. A session that will not die remains unspecified. |
| F18 | `report` has no backpressure, no end of life | **Partial** | Report-after-resolution is now documented as an `InternalError`, which closes the envelope-corruption hole. Backpressure is untouched: `report` still returns `void` with no stated buffer bound, so a high-volume log tail on a slow pipe is still an unbounded-memory path. |
| F19 | Test harness cannot test session commands | **Partial** | `abort`, `answers`, `isTty`, `env`, `now` and the `presented` capture are all new and substantial — sessions are now testable. Residuals: no `cwd` knob (so commands writing artifacts relative to cwd write into the repo); events are only observable after the run, so "abort once ready" needs a timer rather than a condition; no capture of which prompts were asked (N11). |
| F20 | Steps have no identity | **Resolved** | `id`/`parentId` added, matching the ORM's span shape. |
| F21 | Credentials cannot refresh | **Resolved** | `getCredentials(): Promise<Credentials \| undefined>` on both context and runtime. Long sessions survive expiry. |
| F22 | No way to declare a command needs auth | **Open** | Unchanged. Every handler still checks `undefined` and writes its own "not authenticated" error, so the wording drifts per product — the same failure R5 exists to prevent, one layer down. |
| F23 | `createCli` claims build-time failure it cannot deliver | **Partial** | The comment now says "build time, not run time" explicitly, which sharpens the claim but does not change the mechanism: `createCli` returns `Cli`, not `Result`, so it can only throw when called. |
| F24 | Foundation import and Node types in the public surface | **Open** | `Result`/`CliStructuredError` still come from `@prisma/cli-foundation`; `NodeJS.WritableStream` etc. still appear in `Runtime` and in the raw command's `io`. N04 adds a new instance of the same boundary problem in the opposite direction. |
| F25 | Engine flags leak into `args` | **Resolved** | The shared family is engine-injected, reserved, and never reaches handlers; `--json` is now an engine mode rather than a declared flag. This is a better answer than the one I suggested. |
| F26 | No optional-dependency probe (R13's positive half) | **Partial** | `probeDependency(specifier): Promise<boolean>` added. A bare boolean means the handler still authors the "missing dependency, install it with your package manager" error, so the wording drifts per product; and a boolean cannot express the failure Composer actually hits, which is a resolvable-but-wrong-version conflict (`DEPS.EFFECT_VERSION_CONFLICT`), not absence. |

**Counts:** resolved 15, partial 7, open 3.

## Fresh findings

### N01 — `exitCode` is a post-resolution callback, and it lost the typing v2 had

**Location:** §7, `CommandDefinition.exitCode?: (data: unknown) => number`
(lines 405–408); header claim at lines 23–24.

**Issue:** two problems in one field. First, the v3 header states that nothing
product-authored executes after the handler resolves and that the engine
receives values, never callbacks — and this is a product-authored callback the
engine invokes after resolution. It is the only exception in the file. Second,
because v3 removed the result generic, the callback receives `unknown` where
v2's received `TResult`. Every command with a custom exit code now casts:
`exitCode: (data) => (data as CheckResult).failures.length > 0 ? 4 : 0`.

**Why it matters:** the cast is at the exact point round-1 F10 was trying to
make safe — a wrong cast produces a wrong exit code, which is the machine
surface agents and CI branch on, and no type checks it. The contradiction also
matters on its own terms: an invariant with one exception is an invariant
people stop trusting, and this one is load-bearing for the "values all the way
down, serializable, snapshotable" property v3 is selling.

**Suggestion:** move the exit code to the return site with everything else —
`ctx.present(data, views, { exitCode: 4 })`, or a third `Views` member. The
exit code is a fact about the outcome, known exactly where the outcome is
known. This removes the cast, removes the callback, restores the invariant,
and drops a field from the definition. It also relaxes a constraint the
current shape imposes without saying so: `exitCode` as a pure function of
`data` cannot express an exit code that depends on run context rather than on
the returned value.

While making that change, consider typing the code as a branded 4–99 value or
validating the range in the engine — a handler returning `300` or `-1` becomes
a nonsense shell status via mod 256.

### N02 — `PresentedResult` is structurally constructible, so the mode invariant is unenforced

**Location:** §3, `PresentedResult<T>` (lines 191–199); "Built exclusively by
ctx.present" (line 182).

**Issue:** `PresentedResult` is a plain interface with two public members. A
handler can return `{ data, views: { human: [...] } }` directly and satisfy the
type. Nothing marks it as engine-constructed.

**Why it matters:** the entire correctness argument for return-site
presentation is that the *context* decides which views to materialize, because
only it knows the mode. A hand-built literal breaks that silently: it might
carry a `human` view in json mode (harmless, wasted) or omit one in human mode
(the engine has nothing to render and must invent a fallback). Neither is
caught anywhere, and both are the kind of thing that gets copied once and then
spreads.

**Suggestion:** brand it exactly as `FlagSpec` is branded — an exported
`unique symbol` phantom member that only `ctx.present` can produce. The
mechanism is already in the file; this just applies it one more time.

### N03 — `AnyCommand` has no runtime discriminant

**Location:** §7, `AnyCommand` (lines 496–499); the three definition
interfaces.

**Issue:** `CommandDefinition`, `SessionCommandDefinition` and
`RawCommandDefinition` have the same field names and differ only in their
handler's return type, which is a type-level fact erased at runtime. `createCli`
receives `Record<string, AnyCommand>` and must decide, per command, whether to
await a `PresentedResult` or a `void`, whether to inject the shared flag
family (raw: no), whether auto-json applies (raw: no), and which help layout
to use.

**Why it matters:** with nothing to branch on, the engine either introspects
the loaded handler's return value at execution time — which means the decision
about flag injection and json mode, both of which must be made *before* the
handler loads, cannot be made at all — or it guesses. This is a genuine
blocker for the mounting path rather than a tidiness issue.

**Suggestion:** have `defineCommand` / `defineSessionCommand` /
`defineRawCommand` stamp a discriminant (`readonly kind: 'value' | 'session' |
'raw'`) and make `AnyCommand` a discriminated union on it. That also lets the
shell validate mounts sensibly, and narrows correctly in the engine's own
code.

### N04 — `NextAction` sits on the wrong side of the engine/foundation boundary

**Location:** §1, `NextAction` (lines 60–69); §9, `ErrorEnvelope.nextActions`
(line 563).

**Issue:** `NextAction` is declared in the engine package. But error envelopes
carry `nextActions`, and errors are raised at their origin inside product
operations, carried in `CliStructuredError` from `@prisma/cli-foundation`. For
a structured error to carry next actions, the foundation must reference
`NextAction` — which would make the foundation depend on the engine, inverting
the dependency the two-package split exists to establish.

**Why it matters:** it is a package cycle discovered at implementation time
rather than now. The workaround people reach for — errors carry
`nextSteps: string[]` while successes carry `NextAction[]` — is exactly the
"one concept spelled several ways" the survey ranks as the second most
recurring problem in the corpus, reintroduced at the success/failure seam.

**Suggestion:** move `NextAction` (and `Severity`, which has the same
property) into `@prisma/cli-foundation` and re-export from the engine.
Which package owns which type is an architect call; that the current
placement cannot work is not.

### N05 — Flag defaults do not narrow, and aliases are unconstrained

**Location:** §6, `flag.string` / `flag.number` / `flag.enum` (lines 317–339).

**Issue:** `flag.number({ brief, default: 900 })` returns
`FlagSpec<number | undefined>`. The whole purpose of a default is that the
value is always present, so the handler still writes `?? 900` — and now the
default lives in two places and can disagree. Separately, `alias?: string`
accepts any string, while stricli supports single-character aliases only.

**Why it matters:** the duplicated default is a correctness trap (help text
says one thing, the handler's fallback says another) and it removes the
benefit that motivated adding defaults at all. The alias type accepts values
that cannot work.

**Suggestion:** overload each factory so the presence of `default` produces the
non-optional spec type. Constrain `alias` to a one-character template-literal
type, or validate it when the tree is constructed and say so.

### N06 — `--verbose` has no view, so product-level detail under `-v` is unreachable

**Location:** §3, the mode-to-view mapping (lines 187–190).

**Issue:** the mapping covers human, `--quiet` and json. `--verbose` is in the
injected flag family but selects no view, and handlers cannot see it (by
design, correctly).

**Why it matters:** both shipping families put product detail behind `-v`
today — the ORM renders `timings` and expands truncated conflict lists, the
platform appends timing diagnostics. Under this shape the engine can add its
own detail under `-v` but a product can never add any. That may well be the
right ruling, but as an unstated omission it will be discovered when someone
tries to port `db verify`'s verbose conflict list and finds there is nowhere
to put it.

**Suggestion:** either add an optional `verbose?: (ui: Ui) => readonly Block[]`
view materialized only in verbose human mode, or state explicitly that `-v`
adds engine-owned detail only and that product detail belongs in `data`.

### N07 — `--yes` and `--json --quiet` semantics are unspecified

**Location:** header lines 33–35 (the injected flag family); §5,
`PromptSurface`.

**Issue:** two interactions are named nowhere. (a) Handlers no longer see
`--yes`, so what does it do? If it does not auto-answer `ctx.prompt.confirm`,
then `-y` has stopped working and every CI script that relies on it breaks.
If it does, then the engine is auto-confirming destructive operations, and the
platform's deliberately stronger pattern — typed confirmation, `--confirm
<project-id>` — must be documented as something `-y` does *not* satisfy.
(b) `--json --quiet` selects two disjoint view sets (json+next versus stdout);
precedence is undefined.

**Why it matters:** (a) is a destructive-operation safety question, which
makes it the highest-consequence unstated default in the file. (b) is minor
but will be resolved differently by different implementers.

**Suggestion:** state that `--yes` makes `prompt.confirm` return `true`
without prompting and that it does not satisfy typed confirmation, which stays
a declared flag. State that json mode wins over `--quiet`.

### N08 — Positional order comes from object key order

**Location:** §6, `positional` (lines 348–353); `positionals?: TPositionals`
as a `Record`.

**Issue:** positionals are declared in an unordered record, so argument order
is object key insertion order. That is stable for ordinary string keys but
*not* for integer-like keys, which JavaScript reorders to the front. The two
ordering rules the comments assert — variadic last, and by implication
optional after required — cannot be expressed or checked.

**Why it matters:** an implicit ordering rule carried by object literal syntax
is a subtle source of wrong argument binding, and the failure mode (arguments
silently swapped) is quiet.

**Suggestion:** at minimum, validate both rules when the tree is constructed
and document that declaration order is argument order. An ordered form (a
tuple, or `positionals: [named(...), named(...)]`) removes the class entirely
— that is a shape choice, so architect referral, but the current form does
need one of the two.

### N09 — `CommandHandler<D>` covers only value commands

**Location:** §7, `CommandHandler<D>` (lines 422–424).

**Issue:** the conditional matches `CommandDefinition` only. A session
command's implementation file has no helper and must hand-write
`(args: Args<F, P>, ctx: CommandContext<C>) => Promise<Result<void, ...>>`,
which is exactly the drift F02 was fixed to prevent. Raw commands likewise.

**Suggestion:** extend the conditional to all three definition types, or ship
`SessionHandler<D>` and `RawHandler<D>` alongside.

### N10 — `Views<T>`'s type parameter is unused

**Location:** §3, `Views<T>` (lines 211–216).

**Issue:** none of the four members mentions `T` — the view functions close
over the data lexically rather than receiving it. So `Views<T>` is
structurally `Views<anything>` and `T` is inferred solely from `present`'s
first argument.

**Why it matters:** low severity, but a phantom type parameter invites the
reader to believe a relationship is being checked when it is not. Someone will
eventually pass views that describe a different value than `data` and nothing
will complain.

**Suggestion:** either drop the parameter, or pass the data into the view
functions (`human: (data: T, ui: Ui) => Block[]`) so the relationship is real.
The second also makes views extractable into named module-level functions,
which helps multi-return-path handlers share view logic.

### N11 — The harness cannot observe events mid-run, control cwd, or capture prompts

**Location:** §11, `TestCli.run` options and result.

**Issue:** three residuals from F19. (a) `abort?: AbortSignal` requires the
test to decide *when* to abort, but events are only visible after `run()`
resolves — so the realistic session test ("come up, reach ready, then stop")
has to use a timer, which is the flaky-test pattern. (b) No `cwd` option, so a
command that writes artifacts relative to cwd writes into the product repo
during tests. (c) `answers` is consumed positionally with no capture of which
prompts were asked, so a test cannot assert that the destructive-operation
confirmation was actually shown — only that *something* consumed an answer.

**Why it matters:** (a) and (c) between them mean the two riskiest command
classes — sessions and destructive prompts — are testable in form but weakly
in substance.

**Suggestion:** add an `onEvent` callback (or `abortWhen: (e: EngineEvent) =>
boolean`) so aborts are condition-driven; add `cwd`; add `prompts` to the
result recording each question asked and the answer given.

Related, and worth one line: because only the active mode's views are
materialized, a single test run can never assert on both the human and the
json rendering. That is inherent to the design and fine — but it should be
stated, so product test suites are written to run both modes rather than
discovering one of them is uncovered later.

### N12 — Successful section validation may carry diagnostics with no defined fate

**Location:** §4, `SectionValidation<T>`'s `ok: true` branch (line 235).

**Issue:** the success branch carries `diagnostics: readonly
CliStructuredError[]` — non-fatal problems in an otherwise valid section. The
draft never says what the engine does with them.

**Why it matters:** they are presumably meant to surface as warnings, which
would mean they belong in the envelope's `warnings` array alongside the
severity-`warn` message events. If unstated, they get dropped, and a user's
deprecated-config-key warning silently never appears.

**Suggestion:** state that they render as warnings and join the envelope's
`warnings`, on the same path as `message` events.

Separately: `LoadedConfig` still cannot distinguish "no config file exists"
from "config file exists and is empty". Both produce `sections: {}`,
`diagnostics: []`. For a command that needs a section, both produce
`config: undefined` and the handler writes the same error, so this is probably
harmless — but "you have no prisma.config.ts" and "your prisma.config.ts is
missing the composer section" deserve different fixes, and only the product
can tell them apart if the engine gives it the fact.

### N13 — Config validators live in the eagerly loaded tree

**Location:** §4, `ConfigSection.validate`; §7, `configSection` on the
definition.

**Issue:** R9 keeps heavy dependencies behind the lazy `handler`. The
`ConfigSection` token — including its validator function — is referenced by
the static definition, so it and whatever it imports load at startup. A
validator built on a schema library (arktype and zod both appear in the
corpus) pulls that library into every invocation of every command, including
`prisma --help`.

**Why it matters:** R9's stated motivation is that `prisma migrate` can never
be slowed or taken down by a product it is not using. A shared config
validator undermines that for all commands at once, and it will not be
noticed until startup time is measured.

**Suggestion:** state the rule (validators must be dependency-free, or
hand-written predicates), or make the validator itself lazily loaded like the
handler. Worth deciding now, because it constrains how products write
validators.

### N14 — `EventFrame` nests an event's `data` inside the frame's `data`

**Location:** §9, `EventFrame` (lines 567–573).

**Issue:** `EventFrame.data` is the whole `EngineEvent`, which itself has a
`data` field for product extensions. Machine consumers read
`frame.data.data` for the extension payload, and `frame.type` duplicates
`frame.data.kind`.

**Why it matters:** minor, but this is the agent-facing wire format — the one
surface where a confusing shape is paid for by every consumer, forever, and
which is the hardest thing in the design to change later.

**Suggestion:** flatten the event's own fields into the frame, or rename one
of the two `data` fields. The platform's shipped shape
(`{type, command, timestamp, data}` where `data` is the payload) suggests
flattening.

## Deferred

Unchanged from round 1, and still correctly out of scope: config-section
*registration* mechanics beyond the token (the token is what R10 needed, and
it is now present), daemon management (mode 5), autocomplete, telemetry hooks,
and duration/timing events. One addition: whether raw commands should accept
positionals (`lsp` may want a path) is a small open question rather than a
defect.

## Acceptance-criteria verification

Same strict verdicts as round 1. **PASS** = the interface structurally
satisfies or enforces the requirement. **WEAK** = satisfiable, but the shape
does not enforce it. **FAIL** = the shape contradicts the requirement or
cannot express it. **NOT VERIFIED** = cannot be assessed from the draft.

| R | Requirement | R1 | R2 | Detail |
|---|---|---|---|---|
| R1 | One language, directly executable | PASS | **PASS** | Unchanged, and strengthened: `CommandHandler<typeof def>` removes the one path by which round 1's typing defects would have reintroduced a hand-maintained parallel description of the arguments. The declared object is still what runs. |
| R2 | Commands end in typed operation calls | WEAK | **WEAK** | Unchanged. The shape remains compatible and the thin case remains the natural one, but nothing prevents a fat handler. Return-site views arguably pull slightly the other way — presentation logic now lives in the handler file — though it is presentation, not business logic, so the requirement is not threatened. |
| R3 | The engine package is the whole contract | WEAK | **WEAK** | No stricli type appears; that goal still holds. The two round-1 leaks persist: products import `@prisma/cli-foundation` for `Result`/`CliStructuredError`, and `NodeJS.*` stream types remain in `Runtime` and in the raw command's `io`. N04 adds a third instance in the opposite direction — `NextAction` is on the engine side but is needed by foundation-owned errors, which as written is a package cycle. Fixable without design change, but no longer trivially. |
| R4 | Products receive a context, never the environment | PASS | **PASS** | Improved. `getCredentials()` replaces the static token, `probeDependency` gives the R13 check a sanctioned route that does not touch the environment directly, and `cwd` is still the only path to the working directory. Nothing in the context reaches disk, env or TTY. |
| R5 | Products have no presentational API | PASS | **PASS** | Held, and on a better footing. `Block` remains the only vocabulary, `Ui` still cannot write, and products no longer see `--json`/`--quiet`/`--verbose` at all, which removes the temptation round-1 F25 identified. Return-site materialization means no product code runs after resolution — with the single `exitCode` exception (N01). N06 records the cost: products cannot express verbose-only detail. |
| R6 | Errors and results follow the settled conventions | **FAIL** | **WEAK** | Cleared as a failure. The exit-code space now matches the settled table: 4–99 via `exitCode`, 130/143 engine-owned with the signal recorded, and prompt failures carry distinct codes so "interaction unavailable" (2) and "user cancelled" (3) are mechanically separable rather than string-matched. Not yet PASS: the custom code is computed by an untyped post-resolution callback (N01), the 4–99 range is not enforced anywhere, and whether a structured *failure* can carry a custom code is unstated. |
| R7 | Product-repo end-to-end tests are first-class | WEAK | **PASS** | Upgraded. `abort` makes session commands testable, `answers` makes prompt-bearing commands testable, `isTty`/`env`/`now` make mode selection and framing deterministic, and the `presented` capture allows semantic assertions without byte-scraping. Every command class can now be driven argv-in, bytes-out from a product repo, which is what the requirement asks. The residuals in N11 — no `cwd`, no mid-run event observation, no prompt capture — are real and worth fixing, but they narrow the quality of the tests rather than the class of commands that can be tested. |
| R8 | The shell's test burden is integration proof | NOT VERIFIED | **NOT VERIFIED** | Still an allocation-of-work requirement with no interface surface. Nothing obstructs it. Assess against the shell's test plan. |
| R9 | Static tree, lazy guts | PASS | **PASS** | The lazy `handler` is unchanged and still matches stricli's loader; help still renders from static declarations. Removing the presenters from the definition makes the static tree lighter than v2's, which is a real gain. One new leak to watch, not enough to change the verdict: `configSection.validate` is referenced from the static definition, so a schema library behind a validator lands in every invocation's startup path (N13). |
| R10 | One config file, validated by its products, never a crash | **FAIL** | **PASS** | Cleared, and this is the largest single improvement in v3. The `ConfigSection<T>` token couples name, type and never-throwing validator; `configSection` binds a command to exactly one section; `LoadedConfig` carries raw sections validated per command. That is what makes "a command fails only if a section it needs is invalid" implementable — a bad Composer section genuinely cannot touch `prisma migrate`. File-level problems (unevaluable module, missing `defineConfig` marker) are expressible as `section: null` diagnostics that fail everything, which is R10's fail-early rule. Residuals are small and named in N12. |
| R11 | Pinned versions, tandem releases | NOT VERIFIED | **NOT VERIFIED** | Release-process requirement, no interface surface. |
| R12 | The shell defines the command tree | PASS | **PASS** | Unchanged. No path appears in any definition; mount keys and group briefs live at `createCli`. `AnyCommand` now makes the mount maps actually typecheck, which round 1 found they did not. The overstated "fails the build" claim (F23) persists as a documentation-versus-mechanism gap, not a requirement failure. |
| R13 | The CLI never touches a package manager | WEAK | **WEAK** | The prohibition still holds absolutely — nothing installs or vendors. `probeDependency` gives the positive half a sanctioned route, which is progress. Still not PASS because the requirement's positive half is a *structured error naming the dependency and how to install it*, and a `Promise<boolean>` produces no error at all: each product writes its own wording, so the message drifts exactly as R5 predicts. A boolean also cannot express the failure Composer actually hits, which is a version conflict rather than absence. |
| R14 | One event vocabulary, engine-defined, with product extensions | PASS | **PASS** | Strengthened on every axis round 1 flagged: `id`/`parentId` restore the nesting the ORM's span model needs, `channel` gives data-versus-commentary routing, `artifact` and `from` were added on survey evidence, and `warning`/`notice` merged onto the one severity scale. `data?: unknown` remains the uniform extension point with the engine explicitly not interpreting it. The only blemish is the wire shape's double `data` (N14), which is a framing detail rather than a vocabulary one. |

### Summary counts

| Verdict | Round 1 | Round 2 | Requirements (round 2) |
|---|---|---|---|
| PASS | 6 | **8** | R1, R4, R5, R7, R9, R10, R12, R14 |
| WEAK | 4 | **4** | R2, R3, R6, R13 |
| FAIL | 2 | **0** | — |
| NOT VERIFIED | 2 | **2** | R8, R11 |
| **Total** | 14 | **14** | |

Movement: R6 FAIL → WEAK, R10 FAIL → PASS, R7 WEAK → PASS. No regressions.
