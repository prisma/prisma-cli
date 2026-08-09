# System design review, round 2 — the unified CLI engine's public interface (v3)

Subject: `wip/designs/engine/engine-interface-draft.ts` (v3). Compared against
`-v1.ts` and `-v2.ts` and against my round-1 artifact,
`./reviews/system-design-review.md`.

Pass: **architect**. Same lens and same probes as round 1: discriminator
completeness, consumer-vs-essence, concept-vs-mechanism, symmetry, reads-cold.
Implementation mechanics and failure modes go to the principal-engineer pass.

The six operator rulings are treated as settled. I do not re-argue them; where a
ruling creates a new consequence I say so and mark it as a consequence, not an
objection. Ruling 4 (`stdout` kept as a view name) is accepted without
qualification — see the disposition of A10.

---

## Part 1 — Disposition of round-1 findings

Legend: **resolved** / **partial** / **open** / **overruled**.

### Events

| # | Item | Disposition |
|---|---|---|
| A1 | `notice` vs `warning` — one axis, two kinds | **resolved.** Merged into `message` with `severity: Exclude<Severity,'error'>` (lines 128–133), and `'error'` correctly excluded because fatal is the `Result`. The aggregation rule ("emit once, appear in both places", lines 122–125) is a genuine improvement over anything shipped. |
| A2 | `output` / `stream: 'stdout'\|'stderr'` names pipes | **resolved.** `channel: 'data' \| 'diagnostic'` (line 144) is semantic and lets a remote log stream map onto it honestly. The kind is still called `output`; with `channel` semantic and `source` documented as "not a pipe", the ambiguity I raised is materially gone. One new interaction with `views.stdout` — see B14. |
| A3 | `status` drops the transition | **resolved.** `from?: string` added (line 164). Kind name unchanged; acceptable now that the payload is a transition. |
| A4 | steps have no identity, nesting only in prose | **resolved.** `id`/`parentId` on `step-started`, `id` on `step-finished` (lines 100–101, 109). |
| A5 | four spellings of severity | **resolved as ruled.** One `Severity` type (line 53) reused by `message` and `Block.summary.tone`. `step-finished.outcome` deliberately stays a completion state — that is a defensible distinction and the doc now states it (lines 104–105). One residue: `outcome` still contains `'warning'`, which is a severity word inside a completion-state set. `'ok' \| 'failed' \| 'skipped' \| 'partial'` would carry the "finished, but not cleanly" meaning without borrowing from the severity scale. Minor; noting, not pressing. |
| A6 | remediation spelled three ways | **resolved.** One `NextAction` (lines 60–69, the platform's shape adopted whole), used by the `remediation` event, `Views.next`, and both envelopes. |
| A7 | events have no sensitivity marker while `Block.fields` does | **open.** `Block.fields.rows[].sensitive` still exists (line 514); `endpoint.url` and `output.line` still cannot be marked, and `Ui` still has no masking helper. The survey's §C5 masking evidence stands. |
| A8 | files-written has no home | **resolved.** `artifact` event added (lines 167–173) with `path` and `description`. No corresponding `Block`, but `tree`/`list`/`fields` cover the terminal case adequately. |
| A9 | `endpoint.name` vs Composer's `address` | **open**, cosmetic; one clarifying word in the doc comment still worth adding. |

### Presentation

| # | Item | Disposition |
|---|---|---|
| A10 | `present.stdout` names a file descriptor | **overruled by operator (ruling 4).** Accepted. The v3 shape strengthens the operator's case rather than weakening it: `views.stdout` is now a pure `readonly string[]`, there is no stream handle anywhere near a product, and "stdout" is genuine shared vocabulary for CLI authors. I withdraw the finding. The one consequence worth a sentence of documentation is B14. |
| A11 | `Block` missing `tree`; `list` unevidenced | **partial.** `tree` added with a recursive `TreeNode` (lines 522–529) — the important half. `list` remains with no cited evidence and still overlaps a one-column `table` and an unlabelled `fields`. |
| A12 | `Ui` reads cold; `dim` is a rendering decision; no masking or path relativization | **open.** `Ui` is byte-identical to v1 (lines 531–536). |

### Context and runtime

| # | Item | Disposition |
|---|---|---|
| A13 | config section unbound — round-1's top gap | **resolved.** `ConfigSection<T>`, `SectionValidation<T>`, `defineConfigSection`, and `CommandDefinition.configSection` (§4, line 398) make R10 structural. `SectionValidation` carrying `diagnostics` on the `ok: true` branch is a nice touch — a valid section can still warn. One residual: section-name collision has no stated home (B17). |
| A14 | `Runtime` has no `env` | **resolved** (line 612), and correctly on `Runtime` only, not on `CommandContext`. |
| A15 | `isTty` missing `stdout` | **resolved** (line 613), and now load-bearing: json auto-selection keys off it (line 601). |
| A16 | `signal` duplicated on `Runtime` and `CommandContext` | **partial.** Both still present (lines 276, 614). The context's doc now explains what it is *for* (session lifetime, 130/143 selection), which reduces the confusion, but the relationship between the two is still unstated. |
| A17 | `Credentials` owned elsewhere but declared here; name too broad | **partial.** The comment now says "placeholder pending its design" (line 288), which is honest. The `getCredentials()` change to a call-time async resolver (line 262) is a genuine improvement I did not ask for and would have. Name still `Credentials`. |
| A18 | `PromptSurface` naming; no `--yes`; no typed destructive confirmation | **partial.** `--yes` is resolved by ruling 1 — it is engine-injected and `ctx.prompt.confirm` consults it, which is the right shape. The distinct error codes for "interaction unavailable" (exit 2) versus "user cancelled" (exit 3) (lines 267–270) is a real improvement. Still open: the type name, and typed destructive confirmation (`--confirm <project-id>`, survey §C11, 2/3 families). |
| A19 | no interactivity capability fact on the context | **open.** A handler still learns its environment only by attempting a prompt and reading the failure. `git connect`'s shipped "poll only when we can prompt" (`controllers/project.ts:1708-1717`) remains unexpressible. |

### Flags, positionals, definitions

| # | Item | Disposition |
|---|---|---|
| A20 | `flag.json()` a concept in the wrong clothes; family of seven | **resolved as ruled (ruling 1), with one omission.** `flag.json()` is gone; the family is engine-injected and reserved (lines 309–316). The omission: the injected family is `--json, --quiet, --verbose, --yes, --interactive, --color` — six of the seven shipped flags. `--trace` is missing, and the platform's error renderer literally prints "Re-run with --trace for deeper diagnostics" (`shell/output.ts`). Either fold it into `--verbose` explicitly or add it. See also B15 on the missing `--no-json`. |
| A21 | required-ness spelled with opposite defaults on the two sides | **open.** `flag.string` optional / `flag.requiredString`; `positional.string` required / `positional.optionalString` (lines 318–353). Unchanged. Still the clearest reads-cold failure in the file. |
| A22 | builder set incomplete | **resolved.** `flag.number` (line 325), `alias`, `default`, and `positional.variadic` (line 352) all added. Remaining absences (required `enum`, typed `repeated`) are defensible. |
| A23 | key→flag-name transliteration rule unstated | **open.** `alias`/`default` arrived; the rule that the record key becomes the flag name — and how `dryRun` becomes `--dry-run` — still appears nowhere. `hidden`/`deprecated` also still absent. |
| A24 | `raw` names the mechanism; three spellings for two states; `present` impossible-state | **resolved.** Split into three definition types with three `define*` functions (§7). The impossible state is now unrepresentable, which is the right fix. New findings on the split: B12, B13. |
| A25 | `handler` is really a loader | **open.** Still `handler: () => Promise<{ default: … }>` (line 403). The new `CommandHandler<typeof def>` helper (lines 420–424) is a good addition and makes the naming collision more visible, not less: `def.handler` is a loader, `CommandHandler` is the function type. |
| A26 | groups get a poorer declaration than commands | **open.** `groups: Record<string, { brief }>` unchanged (line 592). No `description`, no `examples`, no docs link — on either groups or commands. |
| A27 | `present` required even for `void` results | **resolved** by the session variant and by presentation moving to the return site. |

### Mounting and testing

| # | Item | Disposition |
|---|---|---|
| A28 | space-separated paths — right shape, needs a named type and an ordering rule | **partial.** Shape retained (correct). No `CommandPath` type, no stated grammar, no help-ordering rule. |
| A29 | `CommandSet` declared but unused; two meanings, one structure | **partial.** `CommandSet` now uses `AnyCommand` (line 580) but `createCli.commands` (line 593) and `createTestCli.commands` (line 638) are still two inline copies of the same structural type meaning *paths* rather than *names*. A reader still cannot tell the product-side map from the shell-side map. |
| A30 | shell can place a command but cannot rename it | **open.** |
| A31 | test harness is not the same machinery at the seam | **largely resolved.** `env`, `isTty`, `abort`, `answers`, and an injectable `now` all added (lines 642–658) — this is now a genuinely usable harness and the scripted-answers design ("a run that prompts past the script fails the test") is better than what I proposed. One residual: `config?: Record<string, unknown>` is still the raw section map, not `LoadedConfig`, so a product still cannot test the invalid-section path — the exact R10 behavior the new `ConfigSection` machinery exists to produce. |
| A32 | `json: unknown[]` models the transport | **open**, and now more consequential — see B16. |

### Missing concepts from round 1

| # | Item | Disposition |
|---|---|---|
| M1 | no success envelope | **resolved.** `SuccessEnvelope` / `ErrorEnvelope` (§9), with `warnings` aggregated from events and `nextSteps` derived from `nextActions` so the two cannot disagree. The strongest single improvement in the revision. |
| M2 | config version marker | **partial.** `LoadedConfig.diagnostics` now names "missing version marker" as a file-level problem and states that `section: null` fails every command (lines 626–627). The writer side (`defineConfig`) is still elsewhere by delegation, which is fine now that the reader side is explicit. |
| M3 | exit codes 4–99 | **resolved in policy, defective in typing.** The header declares 0/1/2/3, 4–99 per command, 130/143 for signals — a better answer than I asked for. The typing of `exitCode` is the subject of B7. |
| M4 | typed destructive confirmation | **open** (see A18). |
| M5 | poll timeouts | **open / accepted.** Still "the handler's business" (line 18), still with no engine-owned timeout error code or elapsed rendering. Worth recording as an accepted risk with a reason rather than leaving it as a parenthesis. |
| M6 | R13's dependency check | **resolved in placement, incomplete in shape** — `ctx.probeDependency` added (line 283). See B19. |
| M7 | telemetry / update-check | **open**, still unhomed; out of scope for this artifact. |
| M8 | durations | **open.** No `durationMs` anywhere; the engine can derive step durations now that steps have ids (A4 resolved), so this is smaller than it was. |

### Referrals from round 1

R1 (variance of `CommandDefinition` in collections) — **addressed** by `AnyCommand`
with `any` generics; see B13 for what that costs. R2 (`ArgsOf` over optional
`positionals`) — **addressed** by the `Args<TFlags, TPositionals>` split with
required parameters and optional definition members; the principal-engineer pass
should still confirm `{}` defaults behave. R3 (does inference land) — still needs
a compiled example, now including `ctx.present`. R4 (`report` sync vs
backpressure) — **open**; the doc adds a sealing rule (line 89) but not a
backpressure answer. R5 (events after the signal) — **resolved in contract**
(lines 89–92). R6 (test determinism) — **resolved** (`now`, line 643). R7
(`section: null`) — **resolved** (line 626).

---

## Part 2 — Fresh findings on the v3 shape

The move of presentation to the return site is a real improvement on the axis it
was chosen for. The v2 shape asked a presenter, declared in a different file at
startup, to reconstruct from a result value the case distinctions the handler had
already made — the classic "re-derive what you just knew" tax. Returning a
materialized view removes it, and the invariant it buys ("nothing product-authored
executes after the handler resolves — the engine receives values, never
callbacks", lines 23–24) is a strong, checkable property that also makes the
result snapshotable in tests. I would keep the ruling.

The findings below are about what the new shape names things, what it now cannot
express, and one place where the file contradicts its own stated invariant.

### The presented-result triple

**B1 — the interface lost its static inventory of what a command can produce, and
nothing replaces it.** In v2 a reader (and a build step, and a docs generator)
could look at a definition and see every output shape the command has. In v3 the
views exist only inside a handler, at one or more return sites, behind a lazy
import. R5 still holds in its stated form — a product still cannot render — but
the second-order property R5 buys, *reviewable* consistency, now has no
attachment point. The platform generates help and docs from static descriptors
today (`shell/command-meta.ts`, `shell/help.ts`), and R8 makes the shell's job
"integration proof", which implies something checkable.
*Consequence of ruling 5, not an objection.* The mitigation is cheap and partly
present: `TestCli.run().presented` (line 669) gives per-command evidence, so a
product-repo conformance test can assert every command's human view is non-empty
and its stdout view is pipe-clean. Say so in the doc, so the loss is a deliberate
trade with a named replacement rather than a silent one.

**B2 — `Views<T>` and `PresentedResult<T>['views']` are two different types with
the same name-word and the same member names — one is the recipe, one is the
dish.** (Lines 191–216.) `Views.human` is `(ui: Ui) => readonly Block[]`;
`views.human` is `readonly Block[]`. A reader who has learned one will misread the
other, and the compiler's error text when they are confused reads as nonsense
("Type '() => readonly Block[]' is not assignable to type 'readonly Block[]'").
Symmetry probe fires: parallel names for non-parallel things.
*Alternative:* name the builders for what they are and the values for what they
are — `ViewBuilders<T>` (or `Renderers`) supplied to `ctx.present`, and
`RenderedViews` inside the result. Two words, and the file reads cold correctly.

**B3 — `Views<T>` is generic in a parameter none of its members mention.** (Lines
211–216.) `human: (ui: Ui) => …`, `stdout: () => …`, `json: () => …`, `next:
() => …` — `T` appears nowhere. The views close over the data lexically, which is
the entire point of the ruling, so the parameter is decorative: `Views<Foo>` and
`Views<Bar>` are the same type, and `ctx.present<T>(data: T, views: Views<T>)`
gives a false impression that the views are checked against the data.
*Alternative:* drop the parameter — `Views` — and let `ctx.present<T>(data: T,
views: Views): PresentedResult<T>`. The relation between data and views is
lexical by design; the type should stop pretending otherwise.

**B4 — `ctx.present` is a verb meaning "display it", on a method that displays
nothing.** (Line 258.) It selects which view functions to call and returns a
value; the engine displays. In an interface whose founding premise is "products
cannot print", the most confusable possible name is a method called `present` that
does not present. It also sits next to `ctx.report`, which *does* emit — two
sibling methods with two similar verbs and opposite effects. A handler that calls
`ctx.present(...)` and forgets to return it has silently produced nothing, and the
name actively encourages that mistake.
*Alternative:* `ctx.outcome(data, views)` or `ctx.result(data, views)` — noun-ish,
reads as construction, and pairs correctly with the returned type's name.

**B5 — the mode→view-set mapping is prose, the mode set is not a type, and mode
combinations are undefined.** (Lines 186–189: "human mode → human + stdout + next;
`--quiet` → stdout; json mode → json + next".) Four problems, in ascending order
of importance.
  (a) There is no `OutputMode` type anywhere. The engine's central dispatch —
  which views get materialized, which renderer runs, whether prompts work — turns
  on a union that is never declared. Discriminator-completeness fires on an
  undeclared union.
  (b) Combinations are undefined. `--json --quiet` is accepted today by the
  platform (`resolveGlobalFlags` sets both) and resolved by json-first precedence
  (`command-runner.ts:118-127`). `--json --verbose`, and non-TTY-auto-json plus
  explicit `--quiet`, are the same question. The interface must name the precedence.
  (c) The one **required** member of `Views` is `human` (line 212) — the one view
  that json mode never materializes. The required/optional split runs opposite to
  the mode mapping.
  (d) `--quiet → stdout` alone means `next` is not materialized in quiet mode, so
  next actions vanish. Almost certainly intended; it should be stated, because
  `nextSteps`/`nextActions` are the survey's headline machine-facing asset.
*Alternative:* declare `export type OutputMode = 'human' | 'quiet' | 'json'`, put
the mapping in a table in that type's doc comment, and state the precedence when
several flags apply.

**B6 — `--verbose` is in the injected flag family but has no view, so every
product's shipped verbose content becomes inexpressible.** (Lines 33–35 vs
211–216.) The shipped behavior is substantial and cited in the survey §C9/§D: the
ORM renders `timings` only under `-v`, truncates conflict lists to three with a
"re-run with -v" footer (`formatters/errors.ts:54-98`), and shows `docsUrl` only
under `-v` (`errors.ts:99-101`); the platform appends timing diagnostics under
`--verbose` (`command-runner.ts:136-139`). Under v3 the handler cannot see the
flag (ruling 1, correctly), `ctx.present` receives no mode information, and
`Views` has no verbose member. So the only verbose content that can exist is
engine-generated decoration.
*Alternative:* add `verbose?: (ui: Ui) => readonly Block[]` to `Views`, materialized
and appended in verbose human mode. That keeps the product supplying words and the
engine deciding whether to show them, which is exactly R5's division. This is the
most concrete gap the new shape creates.

**B7 — `exitCode: (data: unknown) => number` is a callback the engine executes
after the handler resolves, in a file that says no such thing exists.** (Line 408
vs lines 23–24: "Nothing product-authored executes after the handler resolves —
the engine receives values, never callbacks.") It is also the one place where the
lost result generic bites hardest: the definition is loaded at startup and cannot
name a type produced by a module loaded at execution, so the author writes
`(data: unknown) => number` and casts — a cast in the machine-facing contract R6
exists to protect, where a wrong value silently produces a wrong exit code.
Answering the question directly: **no, `unknown` is not acceptable here, and the
fix is not to bring back `TResult`.** Apply the ruling's own argument
consistently: the outcome and its context are live at the return site, so the exit
code belongs there, where the data is typed.
*Alternative, and I think this is the clean split:*
  - **Declaration of the space stays on the definition** — `exitCodes?: Readonly<Record<number, string>>`, a documented catalogue (`4: 'integrity check failed'`) that help and docs can render without executing anything, and that the engine can validate against the 4–99 range at build time.
  - **Selection of the value moves to the return site** — `PresentedResult` gains `readonly exitCode?: number`, supplied through `ctx.present(data, views, { exitCode })` or as a fifth view. Typed, no cast, no post-resolution callback, and the header's invariant becomes true.

**B8 — the erasure is total: `Handler` returns `Result<PresentedResult<unknown>,
…>`, so no command's data type survives anywhere.** (Line 418.) Three
consequences. `SuccessEnvelope<T>` can never be instantiated with a real `T`.
`TestCli.run().presented?: PresentedResult<unknown>` forces every product-repo
test to cast before asserting on its own data — in the harness R7 calls
first-class. And `CommandHandler<typeof def>`, the helper whose stated purpose is
keeping definition and handler "in lockstep", now locks only args and config.
The ruling requires the *definition* to be free of the result type; it does not
require the *handler* to be.
*Alternative:* `Handler<TFlags, TPositionals, TConfig, TData = unknown>` returning
`Result<PresentedResult<TData>, …>`. An individual handler file keeps its type,
the definition stays result-free, and the erased form is only what the mount map
stores. Parameterize `TestCli.run<TData>()` the same way.

**B9 — view functions are now ordinary closures called conditionally, which
creates a class of mode-dependent bug the old shape made impossible.** Only the
active mode's functions run (lines 202–203), so a view function with a side effect
fires in one mode and not another, and a `human` closure that computes something
the handler needs is silently skipped under `--quiet` or `--json`. The old shape
had the engine call presenters exactly once, outside the handler. Nothing in the
contract says view functions must be pure.
*Alternative:* state it in `Views`'s doc comment — "pure; called at most once;
only in the active mode" — so the rule is part of the contract rather than folklore.
(The enforcement question is a referral.)

**B10 — failure got no presentation at all, yet `ErrorEnvelope` declares
`nextActions` with no way to populate it.** (Lines 555–564.) A failing handler
returns `notOk(error)` and the error carries ADR 239's `why`/`fix`/`docsUrl` —
one triple. But `ErrorEnvelope.nextActions: readonly NextAction[]` (line 563) has
no producer anywhere in the interface, and no failing command can render
structure. The survey's evidence is direct and load-bearing for two shipped
commands: `migration check` renders a per-failure list of `✗ [CODE] where: why`
plus a `fix:` per failure (`commands/migration-check.ts:604-698`), and `db verify`
renders a drift block on failure (`utils/formatters/verify.ts:140-158`). Neither
is portable to this interface. Symmetry probe fires as hard as it can: success
gained an entire presentation subsystem in this revision; failure lost the little
it had.
*Alternative:* `ctx.fail(error, views?)` producing a presented failure that
`notOk` carries, using the same `Views` vocabulary (`human` blocks + `next`
actions). It costs one method and makes `ErrorEnvelope`'s existing fields
truthful.

### The three definition variants

**B11 — the session variant contradicts two other paragraphs of the same file.**
(Lines 432–456.) (a) Lines 122–125 say severity-`warn` message events are
"aggregated by the engine into the success envelope's `warnings`"; a session has
no success envelope, so that sentence is false for sessions and the warnings a
long-running session emits have no terminal home. (b) "A session always supports
json mode: the event stream is its json surface" — but the platform's shipped
streaming runner emits a terminal `{type:'success'|'error'}` frame precisely so a
machine consumer knows the stream ended and how (`command-runner.ts:208-235`),
with exactly one command opting out because it carries its own terminal record.
The interface removes that guarantee without saying so.
*Alternative:* state that the engine emits a terminal frame for sessions in json
mode, and say where a session's warnings go (a terminal frame is the natural
answer, which resolves both halves at once).

**B12 — the three definitions duplicate their common members by copy, and the raw
variant's omissions look accidental rather than decided.** (Lines 380–492.)
`brief`/`description`/`examples`/`flags`/`positionals`/`configSection` are written
out three times with three different subsets. `RawCommandDefinition` has no
`examples`, no `positionals`, and — the substantive one — **no `configSection`,
and its `io` object carries no config**. The one command in the corpus that
motivates this variant is `lsp`, and a language server is precisely the consumer
that must read the user's `prisma.config.ts`. As written, a raw command cannot
obtain config at all without reading disk, which R4 forbids.
*Alternative:* extract a shared `CommandCommon { brief; description?; examples?;
docsUrl? }` that all three extend (so A26's future additions are one edit, not
three), and decide `configSection` for raw deliberately — I believe it must be
allowed, with the validated value handed in on `io`.

**B13 — `AnyCommand` is a union with no discriminant, and the engine cannot tell
its members apart at runtime.** (Lines 496–499.) `CommandDefinition` without an
`exitCode` and `SessionCommandDefinition` have *identical* runtime shapes: the
same members, and `handler` differing only in a return type that does not exist at
runtime. `RawCommandDefinition` is distinguishable only by the absence of
`positionals`/`configSection`, which are optional on the others. So `createCli`
receives a map of `AnyCommand` and has no reliable way to decide whether to inject
the shared flag family, whether to run the presentation pipeline, or whether to
hand the process's streams over. Using `any` in the erasure (the right pragmatic
fix for round-1's variance problem) removes even the type-level distinction.
*Alternative:* have the three `define*` functions stamp a discriminant —
`kind: 'value' | 'session' | 'raw'` — so `AnyCommand` is a real discriminated
union. They are identity functions today; making them not-quite-identity is a
one-line change and buys an exhaustive `switch` in the engine and in any
future tooling that walks a command set.

### Engine modes, flags, and the machine contract

**B14 — there are now two product-facing routes to stdout with different
vocabularies and no stated rule for choosing.** `views.stdout` (terminal, lines,
line 195) and `output` events with `channel: 'data'` (streaming, lines, documented
as "routed to OUR stdout", lines 84–87). A command that streams data lines and
also returns a payload writes to stdout through both. This is a consequence of
accepting ruling 4, not an argument against it.
*Alternative:* one sentence — streaming data uses `output`/`data`; the terminal
payload uses `views.stdout`; and state the ordering guarantee between them.

**B15 — json mode auto-selects on a non-TTY stdout and the flag family provides
no way to turn it off.** (Lines 31–32, 601; family at lines 33–35.) Piping any
command now changes the output's shape, so `prisma … | less`, `| tee run.log`, or
`| head` all get json rather than the human rendering. The ORM does this today but
ships `--format pretty` as the escape hatch (survey §D, `terminal-ui.ts:334`); the
platform does not auto-select at all. The interface adopts the more aggressive
behavior and removes the escape hatch. It is also internally asymmetric: both
other environment-sensing flags in the family have negative forms
(`--no-interactive`, `--no-color`) and this one does not.
*Alternative:* add `--no-json` to the injected family. (Related: `--trace` is
absent from the family though it is shipped and named in shipped error output —
see A20.)

**B16 — the json stream's frame vocabulary is ambiguous, and `EventFrame.data`
collides with the event's own `data`.** (Lines 566–573.) The doc says "in json
mode everything is one framed stream on stdout" (line 87), but `SuccessEnvelope`
and `ErrorEnvelope` carry no frame fields (no `type`, no `timestamp`), and
`EventFrame.type` is typed `EngineEvent['kind']`, which cannot express a terminal
success or error frame. The platform's shipped frames do include them
(`{type:'success'|'error', command, timestamp, …}`, `command-runner.ts:213-235`).
So a consumer cannot tell from the types whether the envelope is a frame in the
stream or a separate object after it — in the one contract that must be
unambiguous, because agents and CI parse it. Separately, `EventFrame.data:
EngineEvent` nests an event that itself has a `data` member, so a consumer reads
`frame.data.data` to reach the product extension; the platform's `data` meant the
payload.
*Alternative:* declare the frame union explicitly — `type: EngineEvent['kind'] |
'success' | 'error'` with the envelope frames included — and rename
`EventFrame.data` to `event`.

**B17 — nothing owns config-section name collisions.** (Lines 228–241, 589–594.)
Commands carry their own tokens and `createCli` never sees a section list, which
is a better design than the registry I proposed in round 1. But two products
registering the same `name` with different validators is now silently
last-one-wins, or worse, order-dependent. `createCli` already promises build-time
failure for collisions, unknown groups, and grammar violations (lines 585–587) —
add section-name conflicts to that same sentence.

**B18 — `probeDependency` returns a bare boolean, so the product cannot write the
error R13 requires.** (Lines 281–283.) R13 mandates "a structured error naming the
dependency and how to install it **with the user's own package manager**". Package
manager detection is environmental, and R4 forbids products from reading the
environment — so the handler literally cannot know whether to say `npm add`,
`pnpm add`, `yarn add`, or `bun add`. The probe as designed can only produce half
the required error.
*Alternative:* `requireDependency(specifier): Promise<Result<void,
CliStructuredError>>` — the engine detects the package manager and builds R13's
error, the handler just propagates it. Keep the boolean probe as well if commands
need to branch rather than fail.

**B19 — `PresentedResult` claims a single constructor that the type does not
enforce.** (Lines 179–199: "Built exclusively by ctx.present".) It is a public
exported interface with all-optional views, so it is hand-constructible and the
"exclusively" claim is a comment. That matters because the mode contract lives in
which views are populated: a hand-built result with a `human` view in json mode is
a silently wrong state.
*Alternative:* brand it with a private symbol, the technique the file already uses
twice for `FlagSpec` and `PositionalSpec`. `TestCli.run().presented` can still
expose it for reading.

---

## Part 3 — Referrals to the principal-engineer pass

- Does `ctx.present`'s inference land? `present: <T>(data: T, views: Views<T>)`
  with `Views<T>` not mentioning `T` (B3) means `T` is inferred solely from `data`
  — confirm the returned `PresentedResult<T>` narrows as intended in a real
  handler, including the union-of-return-sites case.
- Runtime discrimination of `AnyCommand` members (B13) — confirm whether the
  engine can in fact tell them apart today; if it can only do so by probing
  optional members, that is a correctness bug, not just a typing one.
- `report()` backpressure for a session emitting thousands of `output` events into
  a slow pipe (round-1 R4, still open).
- The sealing rule (line 89) says calling `report()` after resolution throws
  `InternalError` — check that a `finally` block or an unawaited promise in a
  handler cannot trip it as a matter of course.
- View functions invoked conditionally (B9): whether the engine can detect
  impurity, and what happens if a view function throws — mid-render failure after
  a successful operation is a nasty state.
- `Exclude<Severity, 'error'>` (line 130) in a published declaration file: confirm
  it emits readably for consumers rather than as an opaque conditional type.

---

## Verdict

v3 is a large improvement over v1, and most of it is the revision doing exactly
what the reviews asked: R10 is now structural, the success envelope exists, the
severity scale is single, remediation has one shape, the impossible
`raw`-plus-presenter state is gone, and the test harness became a real one. The
round-1 items that remain open are mostly small and mostly cosmetic — `Ui`, the
required-ness asymmetry, group declarations, path typing.

The new shape — presentation at the return site — is the right call on the axis it
was chosen for, and the invariant it buys ("the engine receives values, never
callbacks") is worth having. My substantive concerns are that the invariant is not
yet true, and that the move left two holes it did not intend to leave.

The invariant is not yet true because `exitCode` is a product-authored callback
the engine runs after the handler resolves, in the same file that declares no such
thing exists (B7). Moving the *selection* of the exit code to the return site
where the data is typed, and leaving a documentable *catalogue* on the definition,
resolves the contradiction and the `unknown` cast at once. That is my primary
recommendation.

The two holes are `--verbose`, which is in the injected flag family but has no
view, so every product's shipped verbose content becomes inexpressible (B6); and
failure, which gained nothing while success gained a subsystem, leaving
`ErrorEnvelope.nextActions` with no producer and two shipped commands
(`migration check`, `db verify`) unportable (B10). Both are closed by adding one
member each — `Views.verbose` and `ctx.fail(error, views)`.

Below those, three naming problems will cost every future reader: `ctx.present`
displays nothing (B4), `Views` and `views` are the recipe and the dish under one
word (B2), and `Views<T>` is generic in a parameter it never uses (B3). And one
defect is mechanical rather than aesthetic: `AnyCommand` is a union whose members
are runtime-indistinguishable, so the engine cannot reliably tell a session
command from a value command (B13) — a stamped `kind` discriminant fixes it in a
line.

Close B7, B6, B10, and B13, apply the three renames, and this interface expresses
its requirements. Nothing here argues for another structural revision.
