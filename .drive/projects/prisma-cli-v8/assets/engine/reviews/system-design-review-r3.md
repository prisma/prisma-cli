# System design review, round 3 (final) — the unified CLI engine's public interface (v4)

Subject: `wip/designs/engine/engine-interface-draft.ts` (v4), against `-v3.ts` and
my round-2 artifact `./reviews/system-design-review-r2.md`.

Pass: **architect**, same probes throughout: discriminator completeness,
consumer-vs-essence, concept-vs-mechanism, symmetry, reads-cold.

The operator rulings are settled and I do not re-argue them. Ruling 1 in
particular — completed/errored replacing success/failure, with `ctx.fail`
rejected — is not merely accepted here: it is a better answer than the one I
proposed, for reasons I set out under the disposition of B10.

**Headline: no structural concerns remain.** One item needs reconciliation with a
settled ADR before implementation (C1, narrowed by the `errors` block amendment —
see C8), two are small capability or typing defects with one-line fixes (C3, C4),
and everything else in this document is a nit. The verdict section says so plainly.

This round includes the operator-directed amendment that landed mid-review: the new
`Block` member `{ kind: 'errors', errors: CliStructuredError[] }`. It is probed in
**C8**, and it changes the disposition of C1 for the better.

---

## Part 1 — Disposition of round-2 findings

| # | Item | Disposition |
|---|---|---|
| B1 | The interface lost its static inventory of what a command can produce | **Largely resolved.** The half that mattered for machines is now static and documented: `outcomeCodes` is a definition-level catalogue "rendered in help without executing anything" (lines 445–451). What is still dynamic is the human/stdout presentation, and `TestCli.presented` (line 760) is the stated replacement for checking it per command. Nit-level residue only. |
| B2 | `Views` (recipe) and `views` (dish) under one word | **Resolved.** `Presentations` for the input bundle (line 223), `presentation` for the materialized field (line 204). The two now read as different things because they are named as different things. |
| B3 | `Views<T>` generic in a parameter no member mentions | **Resolved.** `Presentations` is non-generic; `ctx.present<T>(data: T, presentations: Presentations, …)` (lines 272–276) now says exactly what is true — `T` comes from the data, the presentations close over it lexically. |
| B4 | `ctx.present` is a verb for a method that displays nothing | **Resolved in effect.** The name is unchanged, but the vocabulary around it changed and that was the actual problem. `ctx.present(data, presentations)` producing a `presentation` field reads as construction because the noun is now on both sides of the call. I withdraw the finding. |
| B5 | Mode set undeclared; combinations undefined | **Largely resolved.** `Format = 'human' \| 'json'` and `LogLevel` are declared types (lines 71–74), and format and log level are now cleanly orthogonal axes rather than one overloaded "mode". Two residual undefined combinations, both nits: C9 (`--json --quiet`) and C10 (whether `--quiet` implies a log level). |
| B6 | `--verbose` injected but with no presentation member | **Resolved as ruled (ruling 3), and better than my proposal.** One mechanism — severity-`verbose` `message` events filtered by `--log-level` — beats a second presentation member, because it keeps the product supplying words and the engine deciding display in exactly one place. One consequence worth knowing: verbose detail must now be *emitted during the run* as commentary rather than *composed into the final result blocks*, so the ORM's "truncated to 3, re-run with -v" pattern becomes a verbose message event on stderr rather than an expanded list inside the result. That is a fine trade; it should just be a known one. |
| B7 | `exitCode: (data: unknown) => number` — a post-resolution callback in a file that says none exist | **Resolved exactly as recommended.** Catalogue on the definition (`outcomeCodes`, line 451), typed selection at the return site (`ctx.present`'s `outcomeCode`, line 275). The header's invariant "nothing product-authored executes after the handler resolves" (lines 36–37) is now true. |
| B8 | Total erasure — no command's data type survives | **Open, nit.** `Handler` still returns `Result<PresentedResult<unknown>, …>` (line 466) and `TestCli.presented` is `PresentedResult<unknown>` (line 760), so product-repo tests cast before asserting on their own data. A defaulted fourth parameter (`Handler<F, P, C, TData = unknown>`) would fix it without touching the definition. Small enough to leave. |
| B9 | Presentation functions are conditionally-invoked closures with no purity rule | **Open, nit.** The `Presentations` doc (lines 213–222) still does not say "pure, called at most once, only for the active format". One sentence. |
| B10 | Failure got no presentation while success gained a subsystem | **Overruled by ruling 1 — and dissolved, not merely rejected.** This is the right call and I want to record why, because it is the best move in the revision. My finding rested on two shipped commands (`migration check`, `db verify`) needing to render structure on the error path. Under completed/errored semantics they are not on the error path: they executed to their end, they have a result, and bad news is a result. They present normally and carry an outcome code. The finding's premise was that "did not succeed" and "did not complete" were the same thing; the ruling separates them, which is a genuinely better model than adding a parallel presentation system for failures. The second half — `ErroredEnvelope.nextActions` having no producer — is answered too: remediation events aggregate into it, and the error's `fix` derives `nextSteps` (lines 637–639). Both halves closed. |
| B11 | The session variant contradicted two other paragraphs | **Resolved.** The result frame is now universal ("events while running, then exactly one result frame", lines 642–643), so a session does get a terminal frame and its `warn` messages do have an envelope to aggregate into. The two contradictions are gone. One typing nit remains: C8. |
| B12 | Three definitions duplicate common members; raw has no config | **Substantively resolved.** Raw gained `configSection` and `io.config` (lines 531, 541), which was the real problem — an LSP can now read the user's config without touching disk. The literal duplication of `brief`/`description`/`flags`/… across three interfaces remains, and raw still has no `examples`. Nit. |
| B13 | `AnyCommand` members are runtime-indistinguishable | **Resolved.** `kind: 'command' \| 'session' \| 'raw'` is a required member of each interface and stamped by the `define*` functions via `Omit<…, 'kind'>` (lines 427, 478, 493, 514, 527, 551). This is the cleanest possible form of the fix: authors never write it, the engine can `switch` on it, and the union is genuinely discriminated. |
| B14 | Two product-facing routes to stdout with no rule for choosing | **Partial, nit.** Both routes are documented (lines 89–90, 218–219) but the ordering guarantee between streamed `output`/`data` lines and the terminal `presentation.stdout` lines is still unstated. |
| B15 | json auto-selects on non-TTY with no escape hatch | **Resolved by ruling 2.** `--format <human\|json>` gives the escape hatch (`--format human`) that `--json` alone could not, and `--json` survives as the shorthand everyone already types. Note `--trace` is now absent from the injected family, which I read as the deliberate consequence of ruling 3's one-log-mechanism decision; worth one line confirming stack traces appear at `--log-level verbose`. |
| B16 | Frame vocabulary ambiguous; `frame.data.data` | **Resolved.** `Frame = EventFrame \| ResultFrame` (line 644), `EventFrame.event` (line 651), `ResultFrame.envelope` (line 658). The machine contract now says exactly what is on the wire. |
| B17 | Config-section name collisions unowned | **Partial, nit.** `createCli`'s doc lists "collisions, unknown groups, reserved-flag violations, and grammar violations" (lines 674–676); "collisions" reads as path collisions. Name section-name conflicts explicitly in that sentence. |
| B18 | `probeDependency` cannot phrase R13's install command | **Resolved.** `ctx.packageManager` (line 306), and the `probeDependency` doc now points at it (lines 299–302). |
| B19 | `PresentedResult` hand-constructible despite the "exclusively" claim | **Resolved.** Branded with a `PRESENTED` unique symbol (lines 183, 199) — the same technique the file already used twice, so it reads consistently. |

### Round-1 items still open in v4

All nit-level. `Ui` is unchanged since v1 — still no masking or path-relativization helper and `dim` is still an ANSI word (A12, A7). `list` remains the one `Block` with no cited evidence (A11). `signal` still appears on both `Runtime` and `CommandContext` without stating their relationship (A16). `handler` is still a loader named for what it returns (A25). Groups gained `description` (line 681) but still no `examples`, and neither groups nor commands carry a docs link (A26). The shell still cannot override a command's `brief` at the mount (A30). Poll timeouts remain the handler's business (M5).

Three round-1 items closed in v4 that I should record: **A21** (required-ness asymmetry) is settled by naming it — lines 353–356 now state it is deliberate and matches CLI convention, which is a legitimate resolution of a reads-cold problem; **A23** (transliteration) is settled by line 50; **M4** (typed destructive confirmation) is settled by the prompt-defaults design (lines 316–327), and settled *better* than I proposed: "destructive confirmations simply declare no default — `--yes` can never blast through them". That inverts the problem so the safe case is the default case, which is the right shape for a rule about destructive operations.

---

## Part 2 — Fresh findings on the v4 shapes

### C1 — A completed-but-bad result carries an integer where the settled conventions carry a dotted code. This needs reconciling with ADR 239.

Ruling 1 moves a class of outcomes off the error path: `migration check` finding 16
integrity violations, and `db verify` finding drift, are now completed results with
outcome codes (lines 20–23). ADR 239 currently classifies exactly those outcomes the
other way. Its exit-code section reads: "Expected `StructuredError` failures (usage,
config, precondition, **verify, runner**) → **2**", and its crosswalk assigns them
dotted codes today — `CONTRACT.VERIFY_FAILED`, `MIGRATION.RUNNER_FAILED`, and the
eighteen `MIGRATION.CHECK_*` codes converted from `PN-MIG-CHECK-NNN`.

Two consequences, one of which matters.

The one that does not: per-item codes survive. `migration check`'s shipped json
already carries `failures[{ space, code, where, why, fix }]`, and that lives inside
`data`, so a consumer can still match individual violations by dotted code.

The one that does: **at the envelope level, a completed-but-bad result has no
`code` at all.** R6's own justification names three keys machine consumers branch
on — "agents, CI — branch on `ok`, `code`, and exit codes; that only works if
exactly one code space and one envelope exist." Under v4, the errored path provides
all three and the completed-with-outcome path provides two: `ok: true` and an
integer whose meaning is per-command and shares a numeric space (4–99) with every
other command's unrelated outcomes. A CI job that wants "did any Prisma command
report an integrity failure" can match `MIGRATION.CHECK_*` today and cannot match
anything tomorrow without knowing which command produced the 4.

*Alternative, one field:* let the catalogue carry the dotted code alongside the
meaning, and surface it on the envelope.

```ts
readonly outcomeCodes?: Readonly<Record<number, {
  readonly code: `${string}.${string}`   // ADR 239's one code space
  readonly meaning: string               // help text
}>>
```

with `CompletedEnvelope` gaining `readonly outcome?: { code: string; meaning: string }`
populated from the catalogue entry for the selected code. That keeps ADR 239's
single code space intact across both envelopes, costs nothing at the return site
(the handler still selects an integer), and makes the help rendering strictly
better because it can print the code next to the meaning.

Whether ADR 239's exit-code paragraph should also be amended (it currently sends
verify and runner failures to exit 2, which v4 sends to 4–99) is a decision for the
ADR's owner, not for this interface — but the two documents currently disagree and
one of them has to move. Flagging it as the one item to settle before
implementation.

**Narrowed by the `errors` block amendment.** The new `Block` member carries real
`CliStructuredError` values inside a completed result, so the dotted code space now
*does* have a first-class home on the completed path — which is direct evidence
that the design already agrees dotted codes belong there. What remains of C1 is
smaller than when I wrote it: the per-finding codes are handled, and only the
envelope-level outcome lacks a dotted counterpart. C8's fourth point proposes
engine-side aggregation that would close most of what is left.

### C2 — `ok` now means three different things in this file, and the envelope union has no name.

`Result.ok` (foundation: no error), `SectionValidation.ok` (line 249: the section
validated), and `CompletedEnvelope.ok` / `ErroredEnvelope.ok` (lines 615, 631: the
command ran to its end). The third is narrower than the first, and a reader arriving
from ADR 239 or design 1a — where `ok: true` means "succeeded" — will misread it.
The doc comments do compensate (lines 612–614, 630), and keeping the wire field
named `ok` is correct because it is the shipped, settled envelope field.

Two small things worth doing anyway. First, state the semantic shift once, in a
prominent place — the header's EXECUTION PROTOCOL section is the natural home, and
it nearly does this already; one sentence saying "`ok` on the envelope means
completed, which is narrower than `Result.ok`" removes the trap. Second, declare
the union: `ResultFrame.envelope: CompletedEnvelope | ErroredEnvelope` (line 658)
writes it inline, so consumers of the json contract have no exported name for the
thing they parse. `export type Envelope = CompletedEnvelope | ErroredEnvelope`.

Nit.

### C3 — `SingleChar` does not express what it claims, and may not typecheck as intended.

```ts
export type SingleChar = string & { readonly length?: 1 }
```
(Lines 382–383.) `string` already carries `length: number`; intersecting an optional
`length: 1` on top does not constrain a string literal's length, because a literal's
apparent `length` is `number`, not `1`. Depending on how the checker resolves the
apparent member, this either rejects every string or constrains nothing — and the
doc comment concedes the real check is at construction ("longer strings are a
construction error"). A type that advertises a constraint it does not enforce is
worse than no type: a reader will trust it.

*Alternative:* either drop it and use `alias?: string` with the doc sentence and the
existing construction-time check (honest, and the check already exists), or, if a
compile-time guarantee is genuinely wanted, enumerate the alphabet as a literal
union — verbose but precise and machine-generatable. I would drop it.

Referral: the principal-engineer pass should confirm the actual checker behavior
before deciding which way to go.

### C4 — `InputStream` as `AsyncIterable<string>` cannot support the prompts the engine promises.

§8 (lines 597–605) replaces `NodeJS.*` with structural types for runtime
agnosticism, which is right and serves R4's "why" directly. But `Runtime.stdin` is
the only input the bin injects (line 695), and interactive prompts as shipped —
`@clack/prompts`, used by both families — need raw-mode keypress access to draw a
`select` with arrow keys or to intercept Ctrl-C at the prompt. An
`AsyncIterable<string>` can deliver lines; it cannot put a terminal into raw mode.
So the interface, as typed, admits only line-oriented prompts, while §4a describes
a prompt surface with `select` over labelled options and a distinct
cancel-at-the-prompt error (lines 316–342) that presumes keypress handling.

`OutputStream.write(text): void` is fine by comparison — cursor control and the
liveness display are ANSI escapes and go through `write` — and the missing return
value is the documented accepted trade (line 96).

*Alternative, one optional member:* extend the input type with the capability rather
than the mechanism —

```ts
export interface InputStream extends AsyncIterable<string> {
  /** Present only on a terminal; the engine degrades prompts without it. */
  readonly setRawMode?: (raw: boolean) => void
}
```

— which keeps the surface runtime-agnostic (a non-TTY runtime simply omits it) and
makes the degradation path explicit rather than accidental.

### C5 — `outcomeCode` is checked against the catalogue at runtime when it could be checked at compile time.

(Lines 270–271, 451.) `ctx.present`'s `opts.outcomeCode?: number` is verified by the
engine against the definition's catalogue. That is a real improvement on v3's
`(data: unknown) => number` — the catalogue is static, help can render it, and the
range is checkable at construction. But this is the machine-facing exit contract,
and a typo'd `44` for `4` is currently a runtime failure in the one place where a
wrong value is silently meaningful.

*Alternative, if it is cheap:* thread the catalogue's key union through the context —
`CommandContext<TConfig, TOutcome extends number = number>`, with `TOutcome` inferred
from `keyof CommandDefinition['outcomeCodes']` and `present`'s option typed
`outcomeCode?: TOutcome`. That makes an undeclared code a compile error and keeps
everything else unchanged. If threading a second parameter through `Handler` and
`CommandHandler` proves awkward, the runtime check is acceptable — the catalogue
being static is what mattered. Referral to the principal-engineer pass for the
feasibility call; nit either way.

### C6 — Two undefined combinations in the format/level matrix.

Both one-line documentation fixes.

(a) `--json --quiet` is not in the materialization table (lines 194–196: human,
human+`--quiet`, json). The platform resolves the equivalent by json-first
precedence (`command-runner.ts:118-127`); say so.

(b) The relationship between `-q/--quiet` and `--log-level` is unstated. As written
they are orthogonal — `--quiet` selects which *presentation* materializes,
`--log-level` filters *commentary* — which is a clean split and better than the
shipped CLIs manage. But it leaves `--quiet` alone still emitting step lines and
progress at level `info`, which is probably not what a user typing `--quiet`
expects. Either state that `--quiet` implies `--log-level error`, or state
explicitly that it does not.

Related nit: at `--log-level warn`, every non-`message` event kind is suppressed
(line 92 puts them all at `info`), so steps, progress, endpoints, artifacts, and
status transitions all vanish together. That is defensible but is a fairly blunt
grouping for six distinct event kinds; if evidence later shows users want progress
without step chatter, the per-kind level assignment is where to look.

### C7 — Residual asymmetries and small gaps

All nits, grouped for brevity.

- **`createTestCli.config` is still `Record<string, unknown>`** (line 726) while
  `Runtime.config` is `LoadedConfig` (line 702). So a product repo still cannot
  test the invalid-section path — the flagship behavior the new `ConfigSection`
  machinery exists to produce, and the one R10 calls out. Accepting
  `LoadedConfig | Record<string, unknown>` closes it. Also `credentials?: Credentials`
  (line 727) is a value where `Runtime` has a `getCredentials()` function, so token
  refresh cannot be exercised.
- **A session's completed envelope shape is unstated.** `CompletedEnvelope.result: T`
  is required (line 619) and a session returns `Result<void>`; say that a session's
  result frame carries `result: null, outcomeCode: 0`.
- **Two sources feed `nextActions` on the completed path** — aggregated `remediation`
  events (lines 152–153) and `presentation.next` (line 227) — with no stated order or
  duplicate rule.
- **`requiresCredentials`** (line 443) is a good addition, but `getCredentials()`
  still returns `Credentials | undefined` even for commands that declared it, so
  those handlers still handle an impossible `undefined`. Documenting the guarantee
  is enough; tightening the type is not worth threading another parameter.
- **`CommandSet` and `MountedTree`** (lines 665–670) are mutually assignable aliases,
  so "distinct alias so the two maps never read as one" is true for readers and not
  for the compiler. That is fine and I would not brand it — the mount map is written
  once, in one file, and reviewed as a literal.
- **`CompletedEnvelope` / `ErroredEnvelope`** name two different axes (completion,
  erroring) for one distinction. `Completed`/`Errored` is acceptable and every
  alternative I can construct on a single axis is worse. Recording that I looked.

### C8 — The new `errors` Block member (operator amendment)

```ts
| { readonly kind: 'errors'; readonly errors: ReadonlyArray<CliStructuredError> }
```

**The move is right, and one part of it is the best thing in §7.** Handing the
engine real `CliStructuredError` values and letting it render them with the same
layout it uses for top-level errors is exactly R5's argument applied where it was
previously leaking: without this, `migration check` and `db verify` would have had
to hand-format `✖ summary (CODE)` / Why / Fix into `Block.list` strings, and the
two error layouts in the CLI would have drifted within a release. The block takes
no `Ui` and needs none — the engine owns the layout completely, which is the
correct consequence of "products never hand-build error presentation". Five
observations, in order of importance.

**1. The name puts the word "error" on both sides of the file's central
distinction.** v4's whole model turns on ERRORED (did not complete) versus
COMPLETED (ran to its end, possibly with bad news). This block lives strictly on
the completed side and is called `errors`. A reader who has just learned that
distinction meets `kind: 'errors'` inside a completed result and has to un-learn it.
Reads-cold fires, and so does consumer-vs-essence: every other `Block` member names
a *layout* the engine draws (`summary`, `fields`, `table`, `list`, `tree`), while
this one names its payload's type.

The word the rest of the system already uses for exactly this concept is
**diagnostics**: `SectionValidation.diagnostics` and `LoadedConfig.diagnostics` in
this same file (lines 249–250, 713), and the ORM's shipped `migration status`
`diagnostics[]` with per-item `hints[]` (`json/schemas.ts:78-103`). All three mean
the same thing — structured findings produced by a run that completed.
*Alternative:* `kind: 'diagnostics'`, same payload. One word, and the completed and
errored paths stop sharing a root.

**2. It does invite misuse as a substitute for `notOk`, and the guardrail is
missing rather than weak.** A handler that hits a genuine did-not-complete condition
can now write `ok(ctx.present(data, { human: () => [{ kind: 'errors', errors: [e] }] }))`
and exit 0. It renders identically to a real error, so a human cannot tell; the only
signals that differ are the envelope's `ok` and the exit code — which are precisely
what agents and CI branch on. So the failure mode is invisible to people and wrong
for machines, which is the worst combination.

Two fixes, both cheap and neither requiring a new concept.
- *Write the test down.* The distinguishing question is crisp and currently unstated:
  use `notOk` when the command could not do its job; use this block when finding
  these was the job. One sentence in the doc comment.
- *Make the engine check it.* The engine renders the block, so it can see it. Require
  that a completed result containing severity-`error` entries also carries a non-zero
  `outcomeCode` from the catalogue — verifiable at the same point the engine already
  verifies the code against the catalogue (line 271). That turns "don't smuggle
  failures through the completed path" from advice into a rule, and it costs nothing
  for legitimate uses, which all have an outcome code anyway (`migration check` exits
  4, `db verify` exits on drift).

**3. `CliStructuredError` carries ADR 239's optional `severity`, so this block is not
always errors — which reinforces point 1 and raises a second question.** Config
diagnostics and lint findings are routinely `warn` or `info` (ADR 239 keeps those
values specifically for "advisory lint/budget surfaces"). So `kind: 'errors'` will
frequently carry non-errors. And it is unstated whether a `warn`-severity entry here
aggregates into `CompletedEnvelope.warnings`, which today is fed only by
severity-`warn` `message` events (line 622). Two producers of the same concept, one
aggregating and one silent. Say which.

**4. The data/json side is a convention where it could be structural — and this is
where the amendment can pay for itself twice.** The doc instructs the product: "In
the data/json side, carry the same errors as their envelopes (`toEnvelope()`)."
That is unenforced, and it is the second place in the file where the human and json
renderings of one result can silently disagree (the first being `presentation.json`
overriding `data`). But the engine already holds these values — and it already
performs exactly this kind of aggregation twice, pulling `warnings` from `message`
events and `nextActions` from `remediation` events.

*Alternative:* aggregate them the same way. `CompletedEnvelope` gains
`readonly diagnostics: readonly CliErrorEnvelope[]`, populated by the engine from
the block. Consistency becomes structural rather than remembered, the instruction to
products disappears, and — the second payment — the dotted codes reach machine
consumers on the completed path automatically, which is most of what C1 was about.
I would rank this the single most valuable follow-up in this document.

**5. Minor asymmetry with the errored path.** On the errored path the engine derives
`nextSteps` from the error's `fix` (line 638). On the completed path a block may
carry N errors each with its own `fix`, and none of them feed `nextSteps` or
`nextActions`. Almost certainly deliberate — N fixes would flood the envelope — but
it means a user gets "Fix:" lines in the human rendering that have no machine
counterpart, which inverts the usual direction of that gap. One sentence stating the
rule is enough.

---

## Part 3 — Referrals to the principal-engineer pass

- `SingleChar`'s actual checker behavior (C3) — does it reject every literal, accept
  everything, or something else?
- Feasibility of threading the outcome-code union through `CommandContext` (C5).
- Whether `ctx.present`'s inference lands across a handler with several return
  sites, now that `Presentations` is non-generic (B3's fix changes the inference
  shape).
- `Omit<CommandDefinition<…>, 'kind'>` as the `define*` parameter (lines 478, 514,
  551): confirm `Omit` over a generic interface preserves the mapped `flags`/
  `positionals` inference rather than widening it.
- The buffered, non-backpressuring `report()` (line 96) against a session emitting
  into a slow pipe — the trade is stated; the drop or unbounded-growth behavior is
  not.
- Second-signal force-exit (lines 55–57) interacting with the "calling report()
  after resolution is an InternalError" rule during teardown.

---

## Verdict

**Nothing structural remains. This is a clean pass.**

v4 closes every substantive finding from both prior rounds. The two I called
structural in round 2 are closed in the strongest available way: the outcome-code
catalogue with return-site selection makes the header's no-callbacks invariant
actually true, and the `kind` discriminant stamped by the `define*` functions turns
`AnyCommand` into a union the engine can genuinely switch on. The naming problems
are gone — `Presentations` and `presentation` are the recipe and the dish under two
words, and the surrounding vocabulary rehabilitated `ctx.present` without renaming
it.

Three rulings deserve to be recorded as improvements on what the reviews asked for,
not merely as decisions. Completed/errored semantics dissolved my B10 rather than
overruling it: separating "did not succeed" from "did not complete" is a better
model than bolting a second presentation system onto the error path, and it makes
the bad-news commands in the corpus expressible as what they are. One log mechanism
beat my proposed `verbose` presentation member, because it keeps display policy in
one place instead of two. And the prompt-default rule — a destructive confirmation
declares no default, so `--yes` structurally cannot pass it — is a better answer to
typed destructive confirmation than the `confirmDestructive` method I proposed,
because it makes the safe case the default case rather than an opt-in.

The late `errors` block amendment is the same kind of improvement: giving the engine
real `CliStructuredError` values to render, rather than letting products format
`✖ summary (CODE)` into strings, closes the last place where the two error layouts
in the CLI could drift. Its problems are a name and a missing check, not a shape —
call it `diagnostics` (the word the config machinery and the ORM already use, and it
stops the completed path sharing a root word with the errored path), and have the
engine require a non-zero outcome code when the block carries severity-`error`
entries, so the completed path cannot be used to smuggle failures past `ok`.

One item to settle before implementation, and it is a reconciliation rather than a
redesign: **C1**. Moving verify, runner, and check outcomes off the error path means
a completed-but-bad result reaches machine consumers with an integer and no dotted
code at the envelope level, while ADR 239 currently classifies exactly those
outcomes as structured failures with `CONTRACT.VERIFY_FAILED` /
`MIGRATION.RUNNER_FAILED` / `MIGRATION.CHECK_*` codes and exit 2. R6 names `code` as
one of the three keys consumers branch on. The `errors` block narrows this
considerably — the per-finding codes now have a home — and the cleanest completion
is C8's fourth point: have the engine aggregate that block into a
`CompletedEnvelope.diagnostics` field the same way it already aggregates warnings
from `message` events and next actions from `remediation` events. Adding the dotted
code to the outcome catalogue entries closes the remainder. The ADR's exit-code
paragraph then needs a corresponding amendment, which is its owner's call.

Below that, two small defects worth fixing while the file is open: `SingleChar`
claims a constraint it does not enforce (C3), and `InputStream` as a plain
`AsyncIterable<string>` cannot support the keypress-driven prompts §4a describes
(C4) — one optional `setRawMode` member resolves it and keeps the surface
runtime-agnostic.

Everything else in this document is a nit: undefined `--json --quiet` precedence,
the `--quiet`/`--log-level` relationship, `Ui`'s missing masking helper, the test
harness's config shape, an unnamed envelope union, whether `warn`-severity entries
in an `errors` block reach the envelope's `warnings`, and a handful of one-sentence
documentation additions. None of them should hold up implementation, and several
are better decided against real usage than in the abstract.

I have no further architectural concerns. The loop can close.
