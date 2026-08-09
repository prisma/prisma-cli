# Code review round 3 — unified CLI engine public interface (v4)

Reviewer pass: principal engineer. Round-3 findings are numbered P01–P11 (F =
round 1, N = round 2).

Subject: `wip/designs/engine/engine-interface-draft.ts` (v4), read against v3
and my round-2 artifact `./reviews/code-review-r2.md`.

Three claims in this review were checked by compiling them rather than
reasoning about them (TypeScript 5.6, `--strict`). Where that happened I say
so and give the compiler's output.

## Summary

**The design is settled. What remains is not design work.** Every structural
question I raised across rounds 1 and 2 is now closed, both round-1 FAILs
stayed closed, and the semantics reframe is coherent. I would stop iterating
on the shape.

What remains is two type declarations that do not do what they say, one safety
property that is currently a convention where it could cheaply be a type, and
one under-specified stream contract. None of them changes a shape; all are
local edits to individual declarations. I am explicitly **not** calling this a
clean verdict, because two of them are defects rather than nits — but the
distance to clean is small and mechanical.

**P01 is a hard bug.** `SingleChar = string & { readonly length?: 1 }` does not
constrain aliases to one character — it rejects *every* string, including
`'q'`. TypeScript types `'q'.length` as `number`, never as `1`, so no string
literal can satisfy `{length?: 1}`. Compiled:

```
t.ts(4,5): error TS2322: Type 'string' is not assignable to type 'SingleChar'.
t.ts(5,5): error TS2322: Type 'string' is not assignable to type 'SingleChar'.
```

Line 4 is `alias: 'q'`. The fix introduced for N05 makes the `alias` field
unusable. A working formulation exists and I verified it.

**P02 is the one real gap left in an otherwise excellent mechanism.** The
outcome-code split — a documentable catalogue on the definition, selection at
the return site — is the right answer, better than what I proposed, because
the catalogue renders in help without executing anything. But
`opts?: { outcomeCode?: number }` is typed `number`, not against the
catalogue. So `ctx.present(data, p, { outcomeCode: 7 })` against a catalogue
of `{4, 5}` compiles, and the engine's verification fires at the return site —
after the command has done all of its work. A typo turns a successful
`migration check` into an internal error at exit. This is closable: I compiled
the fix, and TypeScript produces
`Type '7' is not assignable to type '4 | 5 | undefined'` at the call site.

**P03 is the item I would think hardest about.** The prompt-default rule is
clever and I like it — `--yes` accepts a declared default, no default means a
structured halt, so destructive confirmations "simply declare no default" and
`--yes` can never blast through them. But nothing *enforces* that a
destructive confirm declares no default. One product writing
`confirm('Delete production database?', { default: true })` re-opens the hole
silently. R5's own rationale is that convention "demonstrably did not hold the
line", and this is the highest-consequence convention in the file. Making it
structural is cheap: a separate `confirm.destructive(question)` that accepts
no `default` parameter at all turns the rule into a type error.

**P04 concerns the one named consumer of raw mode.** `InputStream extends
AsyncIterable<string>` does not say whether it yields chunks or lines, and it
yields decoded strings. An LSP server over stdio reads `Content-Length: N` and
then exactly N *bytes*; a decoded string cannot be counted in bytes when the
payload is multi-byte, and if the engine helpfully splits on newlines the
framing is destroyed outright (LSP payloads contain newlines). `lsp` is the
only command `defineRawCommand` exists for, so this contract should be settled
against it.

Two things I want to credit. Removing the `exitCode` callback makes "nothing
product-authored executes after the handler resolves" exception-free — that
invariant is now true as written, which it was not in v3. And resolving the
`--verbose` question through one log-level mechanism rather than a second
presentation member is the better of the two answers I offered; products emit
`verbose` messages as events they already had, and no new surface appeared.

I also withdraw one round-2 grade. I marked R13 WEAK because `probeDependency`
returns a bare boolean and each product authors its own missing-dependency
error. Re-reading R13, it asks that *the command* return that error — product
authorship is what the requirement specifies, not a deviation from it. With
`packageManager` added in v4, the command now has the facts to phrase "install
it with your own package manager". That is a PASS, and my round-2 WEAK
imported an R5 concern into an R13 verdict.

## Disposition of round-2 findings

| # | Round-2 finding | Disposition | Note |
|---|---|---|---|
| N01 | `exitCode` is a post-resolution callback; lost v2's typing | **Partial** | The callback is gone and the "no product code after resolution" invariant is now exception-free — that half is fully resolved, and the catalogue split is better than what I proposed. The typing half is not: selection is `number`, verified against the catalogue at runtime, at the return site. See **P02**. |
| N02 | `PresentedResult` hand-constructible | **Resolved** | Branded with an exported `PRESENTED` symbol, same idiom as `FLAG`. |
| N03 | `AnyCommand` has no runtime discriminant | **Resolved** | `kind: 'command' \| 'session' \| 'raw'` stamped by the `define*` functions via the `Omit<…, 'kind'>` pattern. I compiled the inference question this raises (does `Omit<>` wrapping break generic inference from `flags`?) — it does not. No concern. |
| N04 | `NextAction` on the wrong side of the package boundary | **Resolved** | Moved to `@prisma/cli-foundation`, so the engine and the error envelope share it with no cycle. |
| N05a | Flag defaults do not narrow | **Open** | Unchanged: `flag.number({ default: 900 })` still yields `FlagSpec<number \| undefined>`, so the handler keeps `?? 900` and the default lives in two places that can disagree. See **P05**; fix verified. |
| N05b | `alias` unconstrained | **Regressed** | `SingleChar` was added and rejects every string, including one-character ones. See **P01**. |
| N06 | `--verbose` selects no view | **Resolved** | One mechanism: `--log-level error\|warn\|info\|verbose`, a `verbose` message severity, `--verbose` as shorthand. No presentation member added. This is the better answer. |
| N07 | `--yes` and `--json --quiet` unspecified | **Partial** | The `--yes` mechanism is now fully specified and thoughtfully designed; the residual is that its safety property is convention-only (**P03**). `--json --quiet` precedence is still unstated — the materialization table covers `human+--quiet` only (**P10**). |
| N08 | Positional order is object key order | **Resolved** | Documented: declaration order is argument order, variadic last, keys must not be integer-like. Convention rather than type, but the failure is now named where an author will read it. |
| N09 | `CommandHandler<D>` covers only value commands | **Open** | Unchanged. Session and raw implementation files still hand-write the handler signature, which is the drift F02 was fixed to prevent. See **P09**. |
| N10 | `Views<T>`'s parameter unused | **Resolved** | Renamed to `Presentations` and de-genericised. The phantom parameter is gone. |
| N11 | Harness: no cwd, no mid-run events, no prompt capture | **Mostly resolved** | `cwd` and an `onEvent` live tap added — the two that mattered. Prompt capture is still absent (nit, in **P11**). |
| N12 | Fate of `ok: true` section diagnostics unstated | **Open** | Unchanged. Nit, in **P11**. |
| N13 | Validators load at startup | **Resolved** | Documented as "keep validators dependency-light: they load with the definition tree at startup (R9), not with the handler." Convention, but stated at the point of use. |
| N14 | `EventFrame` nests `data` inside `data` | **Resolved** | `Frame = EventFrame \| ResultFrame` with `event: EngineEvent`. The added `ResultFrame` also makes the json stream self-describing, which is more than I asked for. |
| F17 | No teardown deadline / second-signal behaviour | **Resolved** | "First signal fires context.signal and awaits handler teardown; a second signal exits immediately with the signal's code." |
| F18 | `report` backpressure | **Accepted trade** | Now explicit: "synchronous fire-and-forget; the engine buffers and writes asynchronously (no backpressure signal — accepted trade)". Legitimate. Residual: the buffer has no stated bound or drop policy (**P08**). |
| F22 | No way to declare a command needs auth | **Resolved** | `requiresCredentials` on value and session definitions; the engine fails early with one canonical sign-in error. |
| F23 | `createCli` claims build-time failure | **Open** | Unchanged doc-versus-mechanism gap. Nit, in **P11**. |
| F24 | Foundation import and Node types in the surface | **Mostly resolved** | `NodeJS.*` replaced by structural `OutputStream`/`InputStream` — the runtime-agnosticism concern is fully addressed. The remaining residual is that products import two of our packages; a re-export closes it (see R3 in the table). |
| F26 | `probeDependency` returns a bare boolean | **Resolved** | `packageManager` added, which is the missing fact for phrasing the install command. Grade corrected — see R13. |

**Counts:** resolved 14, partial 3, open 4 (three of which are nits), regressed 1.

## Fresh findings

### P01 — `SingleChar` rejects every string, so `alias` is unusable — MUST FIX

**Location:** §5, `export type SingleChar = string & { readonly length?: 1 }`
(line 383), used by all six flag factories.

**Issue:** TypeScript types the `length` property of any string, including a
one-character literal, as `number` — it does not compute literal lengths. So
no string is assignable to `{ readonly length?: 1 }`. Verified:

```
t.ts(4,5): error TS2322: Type 'string' is not assignable to type 'SingleChar'.
  Type 'string' is not assignable to type '{ readonly length?: 1 | undefined; }'.
t.ts(5,5): error TS2322: …
```

Line 4 is `alias: 'q'`; line 5 is `alias: 'ab'`. Both rejected.

**Why it matters:** short aliases were round-1 F07, and every shipping CLI in
the corpus has them. As written, no command can declare one — the feature is
not merely unenforced, it is inaccessible.

**Suggestion:** infer the alias as a type parameter and constrain it with a
template-literal recursion. Verified working — `'q'` compiles, `'ab'` errors,
omitting the field compiles:

```ts
type Char<S extends string> = S extends `${string}${infer R}`
  ? (R extends '' ? S : never)
  : never

// on each factory:
boolean<A extends string>(spec: { brief: string; alias?: A & Char<A> }): FlagSpec<boolean>
```

Alternatively drop the type and validate at construction — but the type
version works, so prefer it.

### P02 — The outcome code is not typed against its catalogue — MUST FIX

**Location:** §4, `present`'s `opts?: { readonly outcomeCode?: number }`
(line 275); §6, `outcomeCodes?: Readonly<Record<number, string>>` (line 451).

**Issue:** the catalogue is declared on the definition and the selection
happens at the return site, but nothing connects the two at compile time. The
engine verifies at runtime, which means at the return site — after the command
has finished all of its work.

**Why it matters:** a mistyped or stale outcome code (catalogue edited, call
site not) turns a command that ran correctly into an internal error at the
moment it was about to report success. That is the worst available time to
discover a one-character mistake, and it lands on the exit-code surface CI
branches on. It is also the last remaining place where the v3→v4 move cost
type safety that v2 had.

**Suggestion:** thread the catalogue's key type. Verified working:

```ts
// definition gains a fourth parameter, inferred from the catalogue literal:
export interface CommandDefinition<TFlags, TPositionals, TConfig, TOutcome extends number = never> {
  readonly outcomeCodes?: Readonly<Record<TOutcome, string>>
  // …
}
// context carries it; present narrows:
readonly present: <T>(data: T, presentations: Presentations,
                     opts?: { readonly outcomeCode?: TOutcome }) => PresentedResult<T>
```

`defineCommand({ outcomeCodes: { 4: 'drift', 5: 'stale' } })` infers
`TOutcome = 4 | 5`, and the compiler rejects a wrong code at the call site with
a message that names the valid ones:

```
error TS2322: Type '7' is not assignable to type '4 | 5 | undefined'.
```

That is exactly the error a product author wants. The runtime verification
stays as defence in depth.

Two smaller points in the same area. The 4–99 range is still unenforced —
worth validating the catalogue's keys at construction, where it is cheap.
And whether an explicit `{ outcomeCode: 0 }` is legal when the catalogue omits
`0` is currently ambiguous; say that 0 is always legal and always means
completed-nominally.

### P03 — Destructive-prompt safety is a convention where it could be a type

**Location:** §4a, `PromptSurface` and its doc comment (lines 316–342).

**Issue:** the rule is that `--yes` resolves a prompt to its declared default,
and that a prompt with no default halts. Safety for destructive operations
therefore rests entirely on the author remembering not to declare a default.
`confirm('Delete the production database?', { default: true })` compiles, and
under `--yes` it deletes without displaying anything.

**Why it matters:** R5 exists because "convention (style guides, review
comments) demonstrably did not hold the line" on much lower-stakes things than
this. The failure is silent, it is in the blast-radius category rather than
the annoyance category, and it will be introduced by someone adding a default
for a good local reason without knowing the rule it interacts with.

**Suggestion:** make destructiveness explicit rather than inferred from an
absence. A second method that structurally cannot take a default:

```ts
readonly confirm: (q: string, opts?: { readonly default?: boolean }) => Promise<Result<boolean, …>>
/** Never auto-answered: no default, --yes cannot satisfy it. Pairs with the
 *  command's own --force / --confirm <id> flag. */
readonly confirmDestructive: (q: string) => Promise<Result<boolean, …>>
```

Now "a destructive confirm has no default" is enforced by the signature, and
the call site is self-documenting in review. Whether it is two methods or one
method with a required `destructive: true` is a shape choice — architect
referral — but the property should not stay a convention.

Secondary, worth one line in the doc: adding an ordinary no-default prompt to
an existing command silently breaks every CI caller passing `-y`, because the
invocation now halts at exit 2. That is the correct behaviour, but it makes
"add a prompt" a breaking change, which is worth saying out loud.

### P04 — `InputStream` is under-specified and probably wrong for `lsp`

**Location:** §8, `export interface InputStream extends AsyncIterable<string> {}`
(line 605).

**Issue:** two unresolved questions. First, chunking: nothing says whether an
iteration yields an arbitrary chunk or a line. Second, encoding: it yields
`string`, so bytes have already been decoded.

**Why it matters:** `defineRawCommand` exists for `lsp`, and an LSP server
over stdio parses `Content-Length: N\r\n\r\n` followed by exactly N **bytes**.
Decoded strings cannot be counted in bytes once any payload contains a
multi-byte character, so the framing parser cannot be written correctly. And
if the engine were to yield lines rather than chunks, framing breaks outright,
because LSP bodies contain newlines and the header/body boundary is
byte-counted, not line-counted. The one command this escape hatch was built
for may not fit through it.

**Why it is a real risk rather than theoretical:** the ORM `lsp` command today
hands the process to `connection.listen()` and lets the language-server
library own the raw stdio stream. Under this interface the engine interposes a
decoded string iterator between them.

**Suggestion:** type raw stdin as `AsyncIterable<Uint8Array>` — byte-exact and
still runtime-agnostic, since `Uint8Array` is a platform primitive rather than
a Node type. Offer a decoded string view separately if anything wants one.
Either way, state chunk-not-line semantics explicitly. Worth confirming
against the actual language-server entry point during the spike, since it is a
single known consumer and the answer is cheap to obtain.

The matching question on the output side: `OutputStream.write(text: string):
void` returns nothing, so a raw command cannot know its writes have drained
before it returns an exit code. Because the engine sets `process.exitCode`
rather than calling `process.exit`, the runtime will flush naturally — so this
is fine, but it is fine by accident and deserves a sentence.

### P05 — Flag defaults still do not narrow the flag's type

**Location:** §5, `flag.string` / `flag.number` / `flag.enum` (lines 358–380).
Carried over from N05a.

**Issue:** `flag.number({ brief, default: 900 })` returns
`FlagSpec<number | undefined>`.

**Why it matters:** the handler still writes `?? 900`, so the default is
declared twice and the two copies can drift — help text says one thing, the
handler falls back to another. It also removes the benefit that motivated
adding defaults in round 1.

**Suggestion:** overloads. Verified working — with `default` present the value
is `number`, without it `number | undefined`:

```ts
number(spec: { brief: string; placeholder?: string; default: number }): FlagSpec<number>
number(spec: { brief: string; placeholder?: string }): FlagSpec<number | undefined>
```

### P06 — Sessions have no defined end in json mode

**Location:** §9, `Frame` and `ResultFrame` (lines 642–659); §6, session
definitions returning `Result<void>`.

**Issue:** the comment says json mode emits "events while running, then
exactly one result frame". A session has no presentation and no result, so
whether it emits a terminal `ResultFrame` is unstated.

**Why it matters:** a machine consumer tailing `prisma log tail --json` needs
to know whether the stream ended cleanly, was aborted, or failed. Without a
terminal frame it can only infer that from the pipe closing, which cannot
distinguish a clean stop from a crash. The platform already solved this: its
`build logs` stream carries its own `terminal` record, and it sets
`emitJsonSuccessEvent: false` precisely because the wrapper's success event
would mislabel a failed stream as succeeded.

**Suggestion:** state that a session also emits exactly one terminal
`ResultFrame` carrying `ok` (and the error when it errored), with no `result`.
That gives every json stream in the CLI the same shape: events, then one
terminal frame.

### P07 — `ok` now means completed, not succeeded; that is a consumer-visible change

**Location:** §9, `CompletedEnvelope.ok` (lines 611–615) and the header's
COMPLETED/ERRORED framing.

**Issue:** an integrity failure in `migration check` is now `ok: true` with
`outcomeCode: 4` and exit 4. R6's stated rationale is that machine consumers
"branch on `ok`, `code`, and exit codes"; the answer to "did the check pass?"
is now `ok && outcomeCode === 0`, a two-field test where every existing
consumer performs a one-field test.

**Why it matters:** I think the semantics are right — "bad news is a result,
not an error" is a genuinely better model, and it is what lets a completed
result render through the normal presentation path. But it is a change in what
`ok` means, and the class of consumer most likely to get it wrong is an agent
writing the obvious `if (result.ok)`. The mitigation is already in place and
is the reason I am not grading this as a defect: `outcomeCode` is a
**required** field on `CompletedEnvelope`, always present, so the correct test
is always available and never `undefined`.

**Suggestion:** no interface change. Document the meaning of `ok` explicitly
where consumers will read it (the json contract docs, not only this file), and
note the specific migration: ORM `migration check` consumers branching on `ok`
must move to `outcomeCode`. Worth one line in whatever release note covers the
json surface.

### P08 — The event buffer has no stated bound or drop policy

**Location:** §1, "the engine buffers and writes asynchronously (no
backpressure signal — accepted trade)" (lines 96–97).

**Issue:** accepting the trade is reasonable — a `void` return keeps `report`
trivial to call and the alternative complicates every emit site. But an
unbounded buffer in front of a slow consumer is a memory failure mode, and
`log tail | slow-consumer` is a real invocation.

**Why it matters:** it is the one remaining way a well-behaved command can
take down the process, and it fails at exactly the moment a user is debugging
something else.

**Suggestion:** state a bound and what happens at the bound. There is
precedent in the corpus for the honest answer: Composer's `LogEvent` union
already carries `lines-dropped { count }`. Dropping with a visible count is
better than growing without limit, and the vocabulary for saying so exists.

### P09 — `CommandHandler<D>` still covers only value commands

**Location:** §6, `CommandHandler<D>` (lines 469–471). Carried over from N09.

**Issue:** the conditional matches `CommandDefinition` only, so session and
raw implementation files hand-write their handler signatures.

**Why it matters:** hand-written signatures drifting from their definitions is
exactly what F02 was fixed to prevent; the fix simply was not extended to two
of the three command kinds.

**Suggestion:** extend the conditional to all three, or ship `SessionHandler<D>`
and `RawHandler<D>` alongside.

### P10 — `--quiet`, `--log-level` and json mode have unstated interactions

**Location:** header lines 39–49; §2's materialization table (lines 194–196).

**Issue:** the table covers `human`, `human + --quiet`, and `json`. It does not
cover `json + --quiet`. Separately, `--quiet` and `--log-level` now overlap:
`--quiet` suppresses presentation, `--log-level error` suppresses commentary,
and `--quiet --log-level verbose` has no stated meaning.

**Why it matters:** minor, but two people will implement it two ways, and it
is one sentence to prevent.

**Suggestion:** state that json mode wins over `--quiet`, and that `--quiet`
governs presentation while `--log-level` governs commentary, so the two
compose rather than conflict.

### P11 — Remaining nits

Genuinely small; listing them so they are dispositioned rather than lost.

1. **`CommandSet` and `MountedTree` are the same type.** Both are
   `Readonly<Record<string, AnyCommand>>`, so the comment's "distinct alias so
   the two maps never read as one" is documentation only — a by-name map is
   assignable where a by-path map is expected. Branding one would make it real;
   leaving it is defensible.
2. **`SectionValidation`'s `ok: true` diagnostics have no stated fate** (N12).
   Presumably they render as warnings and join the envelope's `warnings`; say
   so, or they will be silently dropped.
3. **The harness does not capture which prompts were asked** (N11 residual).
   With prompt defaults now load-bearing for safety, a test cannot assert that
   a destructive confirmation was actually displayed — only that something
   consumed an answer.
4. **`requiresCredentials` is absent from `RawCommandDefinition`.** Probably
   deliberate for `lsp`; worth confirming rather than inheriting by omission.
5. **`createCli` still says "build time, not run time"** (F23) while remaining
   a function that can only throw when called.
6. **`LogLevel = Severity`** makes the level axis and the item axis the same
   type, so a `Severity` is assignable wherever a `LogLevel` is wanted. Harmless
   today; they may diverge later.
7. **`LoadedConfig` still cannot distinguish "no config file" from "config file
   present but empty"** (round-2 N12 residual). Both yield `config: undefined`
   for a command that needs a section, so the handler produces the same error
   for two situations with different fixes.

## Addendum — the `errors` Block (operator amendment, landed mid-review)

`Block` gained `{ kind: 'errors'; errors: ReadonlyArray<CliStructuredError> }`
for structured errors carried inside a COMPLETED result, engine-rendered with
the top-level error layout.

**The intent is right and the rendering half is a clear win.** "Products never
hand-build error presentation" is R5 applied to the one place it had escaped:
`migration check` today hand-formats `✗ [CODE] where: why` plus a `fix:` line,
and the survey ranks structured-error-with-code/why/fix as the single most
uniform structure in the corpus (3/3 families). Having the engine render that
layout in a completed result, identically to how it renders a top-level error,
is exactly the consistency R5 exists for. I would keep the concept.

The mechanism has one structural problem and one coverage gap.

### P12 — The same error list must be written two or three times, and the copies cannot be reconciled

**Location:** §7, `Block.errors` and its doc ("In the data/json side, carry the
same errors as their envelopes (`toEnvelope()`)").

**Issue:** `Block` appears only in `Presentations.human`. So the human side
gets `CliStructuredError` instances via the block, and the data side must
carry the same errors again, converted by hand with `toEnvelope()`. Under
`--quiet` — where only `stdout` materializes — they must be written a third
time or they vanish.

Nothing couples the copies, and **nothing can**: only the active format's
presentation functions run, so in json mode the `human` function is never
invoked and the block never exists. There is no moment at which both lists are
in memory to be compared, by the engine or by a test. A handler that filters,
truncates, or forgets to update one side produces a human reading and a
machine reading that disagree about what the command found, silently and
undetectably.

Three concrete consequences:

1. **Forgetting `toEnvelope()` fails quietly rather than loudly.**
   `CliStructuredError` extends `Error`, and `message` is non-enumerable on
   `Error`, so `JSON.stringify` of a raw instance drops it while keeping the
   custom own fields. The output is a plausible-looking payload missing its
   summary — not an obvious failure. The instruction to convert is a doc
   comment with no type behind it.
2. **It breaks §2's own invariant.** `PresentedResult` is described as "data
   all the way down (serializable, snapshotable, no callbacks)". A live
   `CliStructuredError` is not plain data: it carries a `cause` chain that can
   reference arbitrary objects and a stack. Every other `Block` is strings and
   rows. The harness exposes `presented` for "semantic assertions without
   byte-scraping" — snapshotting one containing error instances gives unstable
   output.
3. **`db verify --quiet` regresses.** That command deliberately renders drift
   even under `--quiet` (survey §A1). Under the current materialization rule
   `--quiet` builds only `stdout`, so an `errors` block is never constructed
   and the drift disappears — unless the handler duplicates it into the stdout
   lines as well.

**Suggestion:** let the engine own the list once, format-independently. Either

```ts
ctx.present(data, presentations, { outcomeCode: 4, errors: findings })
```

or a format-independent member on `Presentations` (`errors?: () =>
readonly CliStructuredError[]`) that the engine always materializes. Either
way the engine renders them in human mode with its layout, serializes their
envelopes into the result envelope itself, and emits them under `--quiet`
according to one stated rule. Declared once, no `toEnvelope()` in product
code, no drift possible, and `PresentedResult` goes back to being plain data.

Note that the obvious cheaper fix — "the engine scans the human blocks for an
`errors` block and serializes what it finds" — does not work, precisely
because `human` is not invoked in json mode. That asymmetry is the argument
for pulling the declaration out of the presentation functions entirely.

**Also worth one line:** state whether the rendered error includes `meta`. The
corpus masks credentials in connection URLs deliberately
(`maskConnectionUrl`, `URL_CREDENTIALS_PATTERN`), and a drift or verification
error's `meta` is a plausible place for one to appear. `fields` already has
`sensitive`; the errors block has no equivalent, so the masking policy should
be stated as the engine's.

### P13 — Completed-with-errors covers the non-zero cases; the ERRORED side cannot express multiple errors

**Location:** §9, `ErroredEnvelope.error` (singular); §4, `CommandContext.config`
("the engine already failed the command with that section's diagnostics",
plural); §3, `SectionValidation.diagnostics` (an array).

Working through what products exit non-zero for today:

| Case | Covered? |
|---|---|
| `migration check` integrity failure (exit 4) | **Yes** — the motivating case, and a good fit: its `failures[{space, code, where, why, fix}]` already has the structured-error shape. |
| `db verify` drift (exit **1** today) | **Yes**, with a deliberate renumbering to an outcome code — exit 1 is now "bug only". Same class as the already-agreed "Compute's 1 renumbers to 2". Needs listing in migration notes; and see P12.3 for the `--quiet` interaction. |
| `db sign` verify failure (exit 1) | Yes, same renumbering. |
| Composer spawned-engine exit-status passthrough | **No.** A child exiting 137 cannot map into 4–99. The settled contract has "one documented exception" for this; v4's exit table does not mention it. Carried-over gap, not caused by this amendment. |
| A failure carrying *many* structured errors | **No** — see below. |

**Issue:** `ErroredEnvelope.error` is singular. But the engine's own R10 path
is plural: `SectionValidation` returns `diagnostics` as an array, and the
context doc promises the engine fails the command "with that section's
diagnostics". A config file with three invalid fields has three diagnostics
and one envelope slot.

**Why it matters:** the engine cannot express its own most likely failure. The
workarounds are both bad — pick one diagnostic and drop the rest, or nest the
others in `meta` where no consumer knows to look — and R10's whole point is
that a user's config typo becomes a good diagnostic rather than a stack trace.
Three typos should not become one diagnostic.

It also creates a perverse incentive now that the completed path renders
errors well: a command with several genuine failures is better off returning
`ok` with an errors block and an outcome code than returning `notOk`, purely
because the completed path can show all of them. That would make `ok` mean
"had something to display" rather than "completed", which undoes P07's
semantics.

**Suggestion:** allow the errored envelope to carry a list — either
`error` plus an optional `additionalErrors`, or make the field a non-empty
array. The human rendering already exists (it is the same layout the `errors`
block uses), so this is an envelope change rather than a rendering one.

### P14 — Two ways to show an error in human mode

**Location:** §7, `Block.summary` with `tone: 'error'` versus `Block.errors`.

Minor, and I raise it only so it is dispositioned: a product can render an
error condition either as a `summary` block with an error tone or as an
`errors` block. The intent is clearly that `errors` is for structured
`CliStructuredError` values and `summary` is for prose, but nothing says so,
and the corpus's history is that two ways of expressing one thing diverge.
One sentence in the `Block` doc is enough.

## Deferred

Unchanged and still correctly out of scope: config-section registration
mechanics beyond the token, daemon management (mode 5), autocomplete,
telemetry hooks, and duration/timing events. Nothing new joined this list in
v4.

## Acceptance-criteria verification

Same strict verdicts throughout. **PASS** = the interface structurally
satisfies or enforces the requirement. **WEAK** = satisfiable, but the shape
does not enforce it. **FAIL** = the shape contradicts or cannot express it.
**NOT VERIFIED** = cannot be assessed from the draft.

| R | Requirement | r1 | r2 | r3 | Detail |
|---|---|---|---|---|---|
| R1 | One language, directly executable | PASS | PASS | **PASS** | Unchanged. The declared object is what runs; `kind` is stamped by `define*` rather than hand-written, which removes a way to get it wrong. I compiled the question this raised — whether `Omit<…, 'kind'>` on the parameter breaks inference of `TFlags` from the `flags` literal — and it does not. |
| R2 | Commands end in typed operation calls | WEAK | WEAK | **WEAK** | Unchanged, and unchangeable from here: the shape is compatible and the thin handler is the natural one, but nothing structurally prevents business logic in a handler. This is a review-and-lint requirement, and I would stop expecting the interface to carry it. |
| R3 | The engine package is the whole contract | WEAK | WEAK | **WEAK** | Substantially improved. `NodeJS.*` is gone from the public surface, replaced by structural `OutputStream`/`InputStream`, which closes the runtime-agnosticism half; and `NextAction` moving to the foundation closes the package cycle. No third-party type appears anywhere, so R3's actual rationale — bounding third-party exposure, keeping internals replaceable — is fully satisfied. The one residual is literal rather than substantive: products still import two of *our* packages, because `Result`, `CliStructuredError` and `NextAction` live in the foundation. Re-exporting them from the engine makes this PASS and costs one line. Whether the engine should re-export or R3's wording should acknowledge the foundation is an architect call. |
| R4 | Products receive a context, never the environment | PASS | PASS | **PASS** | Improved again: `packageManager` gives handlers the one environmental fact they needed for R13 phrasing without reading the environment, and `requiresCredentials` removes the most common reason a handler would reach for anything else. Nothing in the context touches disk, env or TTY. |
| R5 | Products have no presentational API | PASS | PASS | **PASS** | Now exception-free, which it was not in v3. Removing the `exitCode` callback means the header's "nothing product-authored executes after the handler resolves" is literally true. `Block` remains the only vocabulary, `Ui` cannot write, and the `--verbose` question was answered by a log-level mechanism rather than a second presentation surface — so no new rendering authority reached products. |
| R6 | Errors and results follow the settled conventions | FAIL | WEAK | **WEAK** | Close to PASS and blocked on one thing. Everything expressible is now correct: the full exit-code table including 4–99 and 130/143, second-signal force-exit, prompt cancellation mapped to 3 versus unavailability to 2, `Result` throughout, and an outcome catalogue that renders in help without executing anything. Two things keep it WEAK. First, the code selected at the return site is typed `number` rather than against that catalogue, so validity is enforced at runtime after the work is done (**P02**); I verified the typed version compiles and produces `Type '7' is not assignable to type '4 \| 5 \| undefined'`. Second, the mid-review `errors` Block amendment exposed that `ErroredEnvelope.error` is singular while the engine's own config-diagnostics path is plural, so a multi-error failure cannot be expressed on the errored side (**P13**). Both are envelope/type edits rather than shape changes; fixing them moves R6 to PASS. |
| R7 | Product-repo end-to-end tests are first-class | WEAK | PASS | **PASS** | Held and improved: `cwd` and the `onEvent` live tap close the two residuals that mattered, so a session test can assert mid-run state and abort on a condition rather than a timer. Remaining gap is prompt capture (P11.3), which narrows what a test can assert about the new prompt-default safety rule but does not affect which commands are testable. |
| R8 | The shell's test burden is integration proof | NOT VERIFIED | NOT VERIFIED | **NOT VERIFIED** | Still an allocation-of-work requirement with no interface surface. Nothing obstructs it; assess against the shell's test plan. |
| R9 | Static tree, lazy guts | PASS | PASS | **PASS** | The lazy `handler` is unchanged. The one leak I flagged in round 2 — validators loading with the definition tree — is now documented at the point of use ("keep validators dependency-light"). Convention rather than structure, but stated where an author will read it, and the `outcomeCodes` catalogue being plain data means help still renders without executing product code. |
| R10 | One config file, validated by its products, never a crash | FAIL | PASS | **PASS** | Held. The `ConfigSection` token still couples name, type and never-throwing validator; `configSection` still binds a command to exactly one section, which is what makes "fails only if a section it needs is invalid" real. Residual nits only: the fate of non-fatal diagnostics on the success branch, and no-file versus empty-file being indistinguishable (P11.2, P11.7). |
| R11 | Pinned versions, tandem releases | NOT VERIFIED | NOT VERIFIED | **NOT VERIFIED** | Release-process requirement, no interface surface. |
| R12 | The shell defines the command tree | PASS | PASS | **PASS** | Held. No path appears in any definition; `MountedTree` names the by-path map at the mount site. The two map aliases being structurally identical (P11.1) is a documentation-versus-type nit, not a requirement gap. |
| R13 | The CLI never touches a package manager | WEAK | WEAK | **PASS** | Upgraded, partly on v4's change and partly correcting my own round-2 reading. The prohibition holds absolutely — nothing installs or vendors. R13's positive half asks that *the command* check at execution time and return a structured error naming the dependency and how to install it with the user's own package manager. `probeDependency` provides the check and `packageManager` (new in v4) provides the last missing fact for the install phrasing, so a product can now satisfy the requirement exactly as worded. My round-2 WEAK penalised product-authored error text, which is what R13 specifies rather than a deviation from it. |
| R14 | One event vocabulary, engine-defined, with product extensions | PASS | PASS | **PASS** | Held and tidied. The `Frame` union with a distinct `ResultFrame` removes the double-`data` awkwardness and makes the json stream self-describing. The vocabulary itself is unchanged from v3's already-strong state: nesting ids, data/diagnostic channel routing, `artifact`, `from`, one severity scale, and `data?: unknown` as the uniform untouched extension point. One unstated case: whether a session emits a terminal frame (**P06**). |

### Summary counts

| Verdict | r1 | r2 | r3 | Requirements (r3) |
|---|---|---|---|---|
| PASS | 6 | 8 | **9** | R1, R4, R5, R7, R9, R10, R12, R13, R14 |
| WEAK | 4 | 4 | **3** | R2, R3, R6 |
| FAIL | 2 | 0 | **0** | — |
| NOT VERIFIED | 2 | 2 | **2** | R8, R11 |
| **Total** | 14 | 14 | **14** | |

Movement since round 2: R13 WEAK → PASS. No regressions.

Of the three remaining WEAKs, one is closable by a verified edit (R6, via
P02), one is closable by a re-export or a wording decision (R3), and one is
not an interface property at all (R2). There is no requirement left that this
interface cannot express.

## Verdict

Not clean yet, and I want to be precise about the gap rather than round it in
either direction.

**Two must-fix defects:** P01 (`SingleChar` rejects every string — the alias
feature is inaccessible) and P02 (the outcome code is not typed against its
catalogue, so a wrong code fails at runtime after the command has done its
work). Both are single-declaration edits, both fixes are compiled and verified
in this review, and neither changes a shape.

**One safety property I would make structural before shipping:** P03, the
destructive-prompt convention.

**One contract to settle against its only consumer:** P04, `InputStream` for
`lsp`.

**One amendment to finish landing:** the `errors` Block is the right idea with
the wrong placement. Declared inside `Presentations.human`, the same error list
has to be written two or three times and the copies cannot be reconciled —
in json mode the human function never runs, so nothing can cross-check them
(P12). Moving the declaration out of the presentation functions, so the engine
renders *and* serialises one list, fixes it without giving up anything the
amendment was after. P13 is its companion on the errored side: the envelope
holds one error while the engine's own config path produces several.

Everything else — P05 through P11 and P14 — is small, and P07 needs
documentation rather than an interface change.

**The design is settled.** Rounds 1 and 2 found structural problems; round 3
found two broken type declarations, a safety convention, and one misplaced
amendment. If P01, P02 and P12 are fixed and P03, P04 and P13 are ruled on, I
would sign this off without another review pass.
