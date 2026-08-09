# Round 4 — closure check (v5)

Reviewer pass: principal engineer. Scope: compile-verify the two type
mechanics, read the four closure changes for regressions, state whether the
loop closes. Prior artifacts: `code-review.md`, `-r2.md`, `-r3.md`.

## Verdict

**Both compile-checks pass. No regressions found. The loop is closed from my
lens.**

Every must-fix and should-rule-on item from round 3 is resolved, and two of
them are resolved better than I proposed. What remains is four small items I
had already graded as nits or documentation, listed at the end so they are
dispositioned rather than lost. None of them needs another review pass.

## (a) Alias mechanics — PASS

Tested against v5's declarations verbatim (`Char<S>` plus
`alias?: A & Char<A>` with `A extends string = never` on each builder).
TypeScript 5.6, `--strict`. Empty output — every assertion held:

| Case | Expected | Result |
|---|---|---|
| `flag.boolean({ brief, alias: 'f' })` | compiles | ✓ |
| `flag.string({ brief, alias: 'q' })` | compiles | ✓ |
| `flag.boolean({ brief })` — no alias, `never` default | compiles | ✓ |
| `flag.enum({ brief, values: ['a','b'], alias: 'F' })` | compiles | ✓ |
| `alias: 'ab'` | rejected | ✓ |
| `alias: ''` | rejected | ✓ |
| `alias: 'data-proxy'` | rejected | ✓ |
| `FlagSpec<'a' \| 'b' \| undefined>` from the enum | inference survives the added `A` parameter | ✓ |

The two cases I specifically wanted to confirm both hold: **omitting the alias
compiles** (the `= never` default does not poison the call, which was the
failure mode of my own first attempt in round 3), and **the empty string is
rejected** (`Char<''>` is `never`, since `''` does not match
`` `${string}${infer Rest}` ``). P01 is closed.

## (b) `TCode` threading — PASS

Tested through the realistic round trip, not just the direct call: catalogue on
the definition → `Omit<…, 'kind'>` in `defineCommand` → `CommandHandler<typeof
def>` in a separate handler file → `ctx.present`. Empty output:

| Case | Expected | Result |
|---|---|---|
| `outcomeCodes: { 4: '…', 5: '…' }` infers `TCode` | `4 \| 5`, both directions | ✓ |
| `ctx.present(…, { outcomeCode: 4 })` / `5` | compiles | ✓ |
| `ctx.present(…)` with no opts | compiles (omitted = 0) | ✓ |
| `ctx.present(…, { diagnostics: […], outcomeCode: 4 })` | compiles | ✓ |
| `ctx.present(…, { outcomeCode: 7 })` | rejected | ✓ |
| No catalogue declared → any `outcomeCode` | rejected (`TCode = never`) | ✓ |

Inference survives both the `Omit<>` wrapper and the second inference site
created by `handler`'s mention of `TCode`, which was the thing worth checking.
The no-catalogue case falling out as `never` is a bonus: a command that never
declared outcome codes cannot select one, so the catalogue is not merely
advisory.

**Control run** to prove the negative assertions are load-bearing rather than
vacuous: swapping the invalid `7` for a valid `5` makes the compiler report
`error TS2578: Unused '@ts-expect-error' directive` — confirming that in the
real test `outcomeCode: 7` genuinely errored. P02 is closed.

## Regression read of the other closure changes

**P12/C8 — diagnostics declared once at `ctx.present`.** Clean, and it fixes
more than I asked. `Block`'s `errors` member is gone (0 occurrences),
`PresentedResult.diagnostics` is the single declaration, and the engine both
renders them in human mode and serializes their envelopes into
`CompletedEnvelope.diagnostics`. The drift I flagged is now structurally
impossible rather than merely discouraged, and `PresentedResult` is plain data
again except for the diagnostics themselves, which the engine converts. The
`--quiet` regression I identified (`db verify` deliberately shows drift even
when quiet) is explicitly handled — "shown even under --quiet". The
`notOk`-versus-diagnostics test in the doc ("notOk when the command couldn't do
its job; diagnostics when finding these WAS the job") is the right line and is
stated where an author will read it.

One observation, not a defect: the guardrail — a severity-`error` diagnostic
requires a non-zero outcome code — is a runtime check firing at the return
site. That is the same late timing as the old P02, but unlike P02 it cannot be
typed, because it depends on the severity of runtime error values. A runtime
check is correct here. Worth making the engine's message for it explicit about
which of the two fixes the author wants (raise the outcome code, or move the
finding to `notOk`), since it fires after the work is done.

**P13 — errored diagnostics.** Symmetric with the completed side, `error`
retained as the primary. The engine can now express its own R10 failure: three
config typos serialize as three diagnostics rather than one flattened error.
The perverse incentive I flagged — returning `ok` purely to display several
problems — is gone, so `ok` keeps meaning "completed".

**P03 — `prompt.consent`.** Structurally undefaultable: no `opts` parameter
exists, so `--yes`, Enter-through and non-interactive contexts cannot satisfy
it. The operator's reframe from "destructive" to "explicit consent" is the
better framing — the property that matters is that the answer is not
inferable, which is broader than damage and easier to apply correctly at a
call site. `confirm` keeps its default for ordinary questions, so the two are
distinguishable by name at the point of use.

**P04 — `InputStream`.** `AsyncIterable<Uint8Array>` with an optional
`setRawMode`. Byte-exact, so `lsp`'s `Content-Length` framing can be
implemented correctly; decoding is explicitly the consumer's business; and
`setRawMode` being optional is right, since it is a platform capability rather
than a guarantee. Note the engine's own prompt machinery decodes internally,
which keeps the byte-level type from leaking into the prompt surface.

**ADR 239 amendment.** Recording it in the header as an implementation
prerequisite is the right call — it is the one change here that lands outside
this repo, and the promise analogy states the model more clearly than the
prose around it did. Worth carrying that sentence into the ADR itself.

## Still open (nits, no further review needed)

Listing these only so the closure is honest about what was not touched. All
were graded nit or documentation in round 3.

1. **P05 — flag defaults still do not narrow.** `flag.string({ default })`
   still returns `FlagSpec<string | undefined>` (no overloads present), so a
   defaulted flag keeps its `?? default` in the handler and the value is
   declared twice. Verified fix is in `code-review-r3.md`; worth taking when
   someone is next in the file.
2. **P06 — sessions have no stated terminal frame** in json mode, so a machine
   consumer cannot distinguish a clean stop from a crash except by the pipe
   closing. One sentence.
3. **P09 — `CommandHandler<D>` still matches only `CommandDefinition`**, so
   session and raw implementation files hand-write their signatures.
4. **P10 — `json + --quiet` precedence** still unstated; the materialization
   table covers `human + --quiet` only.

Plus the round-3 P11 nit list (the two map aliases being structurally
identical, the fate of `ok: true` section diagnostics, prompt capture in the
harness, `requiresCredentials` absent on raw, `createCli`'s "build time"
wording, `LogLevel = Severity`, no-file versus empty-file in `LoadedConfig`).

## Acceptance criteria

Unchanged from round 3 except R6, which the two closures resolve.

| Verdict | r3 | r4 | Requirements |
|---|---|---|---|
| PASS | 9 | **10** | R1, R4, R5, R6, R7, R9, R10, R12, R13, R14 |
| WEAK | 3 | **2** | R2, R3 |
| FAIL | 0 | **0** | — |
| NOT VERIFIED | 2 | **2** | R8, R11 |

**R6 WEAK → PASS.** Both reasons it was held are gone: the outcome code is now
typed against its catalogue (compile-verified above), and the errored envelope
carries multiple diagnostics, so the engine can express its own config-failure
case. The exit-code table, prompt cancellation mapping, and second-signal
behaviour were already in place.

The two remaining WEAKs are the same as before and neither is an interface
defect: **R2** is a review-and-lint property no interface can carry, and **R3**
is the one-line question of whether the engine re-exports the foundation's
`Result` / `CliStructuredError` / `NextAction` so products import one package
instead of two — an architect call, not an engineering gap. **R8** and **R11**
remain process requirements with no interface surface.

No requirement remains that this interface cannot express, and no requirement
is contradicted by its shape.
