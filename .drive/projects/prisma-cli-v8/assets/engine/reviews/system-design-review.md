# System design review — the unified CLI engine's public interface

Subject: `wip/designs/engine/engine-interface-draft.ts` (a design artifact: type
declarations and doc comments, not shipping code).

Pass: **architect**. The lens is system shape, vocabulary, boundaries,
dependency direction, and conceptual integrity. Implementation correctness,
failure modes, and operability are the principal-engineer pass's job; where I
noticed something in that territory I list it under "Referrals" instead of
arguing it here.

Sources read in full: `cli-engine-requirements.md` (R1–R14),
`wip/designs/engine/output-modes-survey.md`, prisma/prisma
`docs/architecture docs/adrs/ADR 239 - Errors are structural envelopes with
dotted namespace codes.md`, composer `ADR-0043`/`ADR-0044` (titles and
decisions), the sibling foundation design `wip/designs/1a/design.md`, and the
platform CLI shell layer (`wip/repos/prisma-cli/packages/cli/src/shell/`:
`output.ts`, `command-runner.ts`, `global-flags.ts`, `runtime.ts`, `ui.ts`,
`errors.ts`, `prompt.ts`, `help.ts`, `next-actions.ts`).

Note on ADR 245: no such file exists in this repo (the ADR series stops at 243).
The `Result` conventions it is cited for are, however, recorded in
`wip/designs/1a/design.md` §"Results carry one discriminator", and the draft
matches them. The draft's use of `CliStructuredError` from
`@prisma/cli-foundation` also matches design 1a (which settles both the class
name and the package name) even though ADR 239's own example spells the
interface `StructuredError`. No action; recording it so a later reader does not
"fix" it in the wrong direction.

---

## 1. What is being introduced

In plain language, the draft proposes nine concepts.

1. **An event vocabulary** (`EngineEvent`, nine members). A running command can
   say: a phase started, a phase ended with an outcome, N of M items are done,
   here is a warning, here is a note, here is a line a child process printed,
   here is something you could do about it, here is a URL that now works, here
   is a state change in something I am watching. Each member may carry a
   product-defined `data` payload the engine never interprets (R14).

2. **A handler's world** (`CommandContext`). One object holding the product's
   config section, credentials, the function that emits events, a prompting
   surface, an abort signal, and the working directory. R4's "the whole world
   arrives as one argument".

3. **A declaration vocabulary for arguments** (`flag.*`, `positional.*`). Small
   builder functions whose return types carry a phantom type parameter, so that
   `ArgsOf` can compute the handler's argument type by inference (R1).

4. **A command declaration** (`CommandDefinition`): the words shown in help, the
   flags and positionals, a function that lazily imports the real handler (R9),
   a presenter triple, and an escape hatch for commands that take over stdin and
   stdout.

5. **A presentation vocabulary** (`Block`, `Ui`). A product returns a list of
   structured blocks — a summary line, a label/value list, a table, a bullet
   list, a next-steps list — plus three text-styling helpers. There is no way to
   write bytes (R5).

6. **A product's export surface** (`CommandSet`): named commands with no paths.

7. **Shell-side mounting** (`createCli`): the shell supplies the binary's name
   and version, the group headings, and a map from space-separated path to
   command (R12).

8. **The injected environment** (`Runtime`, `LoadedConfig`): streams, cwd, TTY
   facts, a signal, the loaded config with per-section diagnostics, credentials.

9. **An in-repo test harness** (`createTestCli`, `TestCli`): argv in, bytes and
   events out, using the production machinery (R7).

The overall shape is right, and the derivation discipline is visible: almost
every member of `EngineEvent` and `Block` can be traced to a numbered structure
in the survey's §C ranking. The findings below are about the places where a name
does not say what the thing is, where a set does not cover its space, where two
sides of a symmetric pair have different shapes, and where a requirement has no
type to live in.

---

## 2. Subsystem fit and boundary correctness

**Dependency direction is correct.** Products depend on the engine package and
on the zero-dependency foundation for `Result` and `CliStructuredError`; the
engine depends on neither product; the shell depends on both and owns the tree.
Nothing in the file names stricli, commander, clipanion, clack, or colorette, so
R3 holds at the level of names.

**One stricli-shaped assumption does survive** — see finding A20 on
per-command-only flags. It is not a stricli *type* in the interface, so R3 is
not violated in the letter; but the "there are no global flags" rule that R5
states, and that the requirements doc's own closing section says was adopted
partly because it "neutralizes" stricli's per-command-flags limitation, has been
carried into the public interface as a shape: `flag.json()` exists and
`flag.quiet()` / `flag.verbose()` / `flag.color()` do not, with no statement of
what happens to the other six flags every shipping CLI has. That is a framework
limitation showing through the contract, which is what R3 is meant to prevent.

**The two-level split — `Runtime` (the environmental whole, injected once) and
`CommandContext` (the handler's narrow world) — is the right boundary.** The
test in favour of it: `Runtime` holds things a *process* has (streams, TTY-ness,
loaded config, cwd) and `CommandContext` holds things a *command* has (its
config section, its way of speaking, its abort signal). Products can only reach
the second, which is what makes R4's runtime-agnosticism and testability claims
true. Three things sit in the wrong layer or are absent from it; see A13–A16.

**Where the boundary is not yet drawn at all:** the config *section* is a
first-class concept in R10 (named section, never-throwing validator, per-section
diagnostics, "a command fails only if a section it needs is invalid") and has no
representation anywhere in the interface. This is the largest structural gap and
is finding A12.

---

## 3. Naming and typology findings

Each finding names the thing, states the problem, and proposes a concrete
alternative. Line numbers refer to the draft.

### Events

**A1 — `notice` vs `warning`: one axis spelled two ways, and a third time
elsewhere.** (lines 61–64.) `warning` and `notice` differ only in severity, and
severity is already modelled as a *field* in two other places in the same file:
`step-finished.outcome` (line 50) and `Block.summary.tone` (line 258). So the
file encodes "how serious is this" as a kind in one place and a field in two
others. Symmetry probe fires. Also `notice` reads cold as an official
announcement ("a notice of termination"); the thing meant is an informational
line.
*Alternative:* one member, `{ kind: 'message'; tone: 'info' | 'warning'; message: string }`,
reusing the same tone vocabulary as `Block.summary`. Three concepts collapse to
one axis used consistently.

**A2 — `output` is the most overloaded word available, and `stream` is a
mechanism.** (lines 69–75.) The concept is "one line that a child process or a
remote log stream produced". The word `output` in this same design also means
the presenter triple's job, the `--json` payload, and the survey's own title
("output modes"). A reader with no context will parse `kind: 'output'` as "the
command's output". Separately, `stream: 'stdout' | 'stderr'` names two OS pipes;
the survey's own evidence (§B6, `controllers/build.ts:34-150`) is a *remote*
build-log stream that has no pipes and routes by a `level` field instead — so
remote logs must pretend to have file descriptors.
*Alternative:* `kind: 'process-output'` (or `'log-line'`), with
`channel: 'out' | 'err'`, and document that a remote stream maps its severity
onto the channel.

**A3 — `status` is both the kind and the field, and it drops the transition.**
(lines 95–100.) `{ kind: 'status'; subject; status }` reads awkwardly cold, and
more importantly the survey's §C10 conclusion is explicit: "Any engine 'wait'
concept needs a **from→to** status-transition event (the platform already emits
exactly that, controllers/app.ts:2651-2662)." The draft records only the new
value, so a consumer that joins the stream late cannot tell a transition from a
re-assertion, and the human renderer cannot print "pending_dns → verifying".
*Alternative:* `{ kind: 'status-changed'; subject: string; from?: string; to: string }`.

**A4 — `step` is a display name doing duty as an identity, and nesting is
asserted in prose but absent from the type.** (lines 44–60.) The doc comment
says "steps may nest", and the ORM's shipped dialect models *all*
operation-specific progress as nested spans with `spanId` / `parentSpanId`
(survey §B3, `control-api/types.ts:91-111`). The draft has neither an id nor a
parent, so nesting cannot be expressed, concurrent steps cannot be paired
start-to-finish, and `progress.step?: string` (line 56) refers to a step by its
display string.
*Alternative:* either add `id: string` and `parentId?: string` and let `progress`
and `step-finished` reference `id`; or state in the type's doc that steps form a
strict stack (last-started is the one that finishes) and delete the nesting
claim if that is not true.

**A5 — `step-finished.outcome: 'ok' | 'failed' | 'skipped' | 'warning'` mixes
two vocabularies.** (line 50.) `'ok' | 'failed'` is an outcome; `'warning'` is a
severity; `Block.summary.tone` spells the same space `'ok' | 'error' |
'warning' | 'info'`; ADR 239's `severity` spells it `'error' | 'warn' | 'info'`.
Four spellings of one axis across the settled conventions and this file.
*Alternative:* pick one tone vocabulary — `'ok' | 'warning' | 'error' |
'skipped'` — and use exactly it in `step-finished`, `Block.summary`, and the
message event from A1. Reconcile against ADR 239's `severity` values in the same
change (`warn` vs `warning` is a live inconsistency in the settled surface).

**A6 — `remediation` is the third of three spellings of one concept inside one
file.** (lines 81–86.) The survey's §C2 identifies "remediation / next-step in
five competing encodings" as "the clearest case of one engine concept currently
spelled five ways." The draft reduces five to three — the error's `fix`, the
`remediation` event, and `Block.nextSteps` — and its own doc comment (lines
78–80) names a fourth, "the success envelope's nextActions", which does not
exist in the file at all (see M1). Worse, the shipping platform concept is
richer: `NextAction { kind, journey, label, command, commands, reason }`
(`shell/next-actions.ts`), and the draft's `{ label, command? }` is a silent
subset.
*Alternative:* lift one type — call it `NextAction`, matching the shipping name —
into the interface, and use that same type in the event, on the success
envelope, and as the payload of the `nextSteps` block. Then there is one concept
with one shape and three placements, instead of three concepts.

**A7 — the event vocabulary has no sensitivity marker, while `Block` does.**
(lines 43–100 vs line 259.) `Block.fields` rows carry `sensitive?: boolean`, and
the survey's §C5 records credential masking as real, shipped policy in two
families (`maskConnectionUrl` / `sanitizeErrorMessage` in the ORM;
`URL_CREDENTIALS_PATTERN` + `maskValue` in the platform, `ui.ts:10`). An
`endpoint.url` or an `output.line` can carry a connection string with a
password, and the product has no way to say so and the engine no way to know.
Asymmetry within one file for one policy.
*Alternative:* either give the engine a masking helper on `Ui` and a
`sensitive?: boolean` on `endpoint`, or state that the engine masks credential
patterns unconditionally in every rendered string (which is the stronger, more
R5-shaped answer) and delete `Block.fields.sensitive`.

**A8 — evidence-ranked structure #7 has no home: files written.** The survey
ranks "file paths / artifacts written" as a 3/3-family recurring structure
(§C7: ORM `files{json,dts}`, `filesWritten[]`/`filesDeleted[]`, `dir`,
`baselineDir`, all relativized to cwd; Composer `stackFilePath`). Under R14's own
promotion rule ("a structure recurring across commands or products is the signal
that the engine vocabulary is missing a concept"), this is a promotion
candidate that was not promoted, and the draft does not say why. It also has no
`Block` — a product would have to pre-format paths into `Block.list` strings,
which puts path relativization (an engine policy today) into product code.
*Alternative:* either add `{ kind: 'artifact'; path: string; action: 'written' |
'deleted' | 'unchanged' }` plus a `Ui.relativePath(p)` helper, or record in the
draft's own doc comment that artifacts are deliberately deferred and why.

**A9 — `endpoint.name` versus the shipped vocabulary.** (lines 88–93.) Composer's
shipped type is `ServiceEndpoint { address, url }` (`operations/shared.ts:19-22`)
where `address` is the service's coordinate, not a label. `name` is fine if it
means the human label, but a reader coming from Composer will populate it with
an address. One clarifying word in the doc comment resolves it. Low priority.

### The presenter triple, `Block`, and `Ui`

**A10 — `present.stdout` names a file descriptor in an interface whose entire
point is that products cannot write to file descriptors.** (lines 228–232.)
`human` is named for its audience, `json` for its format, `stdout` for a stream —
and R5 says "they cannot print… the interface offers no way to express it," yet
the key is the name of a stream. It is also not even distinguishing: under
`--json` the machine payload goes to stdout as well. The essence of the three is:
prose for a person, the machine-usable payload lines that survive `--quiet`, and
the structured projection.
*Alternative:* `{ human, payload, json }` (or `{ prose, data, json }`). The
platform's own `renderHuman` / `renderStdout` / `renderJson`
(`shell/command-runner.ts:25-37`) has the same flaw; generalizing it is the
moment to fix it, not to enshrine it.

**A11 — `Block` is missing the single most-cited human structure in the survey:
the tree.** (lines 257–262.) The survey records tree rendering across all three
families and many commands: the ORM's migration graph visualization with
cross-space column alignment (`commands/migrate.ts:435-470`), introspection trees
(`db schema`), migration list/status trees, ADR 227's "migration read commands
share one graphical renderer", ADR 229's line-plane-occlusion renderer; and
Composer's deployment topology tree (`render-deployment.ts:77-116`). With no
tree block, every one of those commands must either pre-format ASCII into
`Block.list` strings — which is product-side rendering by another name and
exactly the hole through which the drift R5 exists to kill returns — or the
engine grows a custom escape hatch per command.
Separately, `Block.list` (line 261) is the one member with no cited evidence: it
is `fields` without labels, or a one-column `table`. And `Block.nextSteps` (line
262) is data, not layout — see A6.
*Alternative:* add a `tree` block (recursive `{ label, children? }` nodes, engine
owns the glyphs and alignment); drop `list` unless evidence appears, or keep it
and delete `nextSteps` in favour of the shared `NextAction` type.

**A12 (naming) — `Ui` reads cold as "the user interface"; it is a text-styling
helper with three verbs, one of which is a rendering decision.** (lines 265–269.)
`emphasize` and `code` are semantic (this matters; this is a literal token).
`dim` is the ANSI concept itself — a product choosing "dim" is a product making a
presentation decision, which R5 assigns to the engine. And two policies the
engine visibly owns today are absent: value masking (§C5) and path
relativization to cwd (§C7, "nearly everywhere").
*Alternative:* rename the type `TextStyle`; replace `dim` with `deemphasize`;
add `mask(value)` and `relativePath(path)`.

### The context / runtime split

**A13 — `CommandContext<ConfigSection>` is an unbound type parameter: nothing
declares which section a command needs, and nothing registers a validator.**
(lines 106–110, 194–199, 313–316.) R10 requires each product to contribute "a
named section and a never-throwing validator", and requires that "a command
fails only if a section it needs is invalid." The interface has `LoadedConfig`
with `sections: Record<string, unknown>` and per-section `diagnostics`, and it
has a `TConfig` generic that the product simply *asserts*. There is no key, no
validator, and therefore no way for the engine to know which section to hand
over or which diagnostic should fail this command. The doc comment on line 107
promises behavior the type cannot support.
*Alternative:* make the config section a first-class concept —
`defineConfigSection({ name, validate })` returning a token carrying the
validated type; `CommandDefinition.configSection?: ConfigSectionToken<T>` binding
`TConfig`; `createCli({ sections: [...] })` registering them. Then
`CommandContext<T>` is derived rather than asserted, and R10's failure rule
becomes mechanical.

**A14 — `Runtime` has no `env`, so the engine must read `process.env` itself.**
(lines 300–311.) The engine owns interactivity policy and colour policy (R5).
Both are environment-driven in every shipping implementation: `canPrompt` reads
`runtime.env.CI` (`shell/runtime.ts:113`), colour reads `NO_COLOR`/`FORCE_COLOR`.
`Runtime` is described as "everything environmental, injected once by the bin (or
by a test)" and omits the environment. The consequence is that the two behaviors
most worth testing are the two a test cannot control.
*Alternative:* `readonly env: Readonly<Record<string, string | undefined>>` on
`Runtime` (and only on `Runtime` — R4 keeps it out of `CommandContext`).

**A15 — `Runtime.isTty` covers `stdin` and `stderr` but not `stdout`.** (line
305.) The whole stdout-is-data discipline keys on stdout, and the ORM's shipped
behavior is to auto-select JSON when *stdout* is not a TTY (survey §D,
`utils/global-flags.ts:67-69`). The set is incomplete for its own space.
*Alternative:* `isTty: { stdin, stdout, stderr }`.

**A16 — `signal` appears on both `Runtime` (line 306) and `CommandContext`
(line 126) under the same name.** If they are the same object, one is redundant;
if the context's is a per-command child that also fires on command-level timeout,
the type should say so. Symmetry probe fires either way. Also `Runtime.credentials`
and `CommandContext.credentials` are the *same* type, whereas config narrows from
`LoadedConfig` to one section — the two cross-cutting values are handled
asymmetrically with no stated reason.

**A17 — `Credentials` is declared in the engine but documented as owned
elsewhere, and its name is too broad.** (lines 132–136.) The comment says
"opaque to the engine; shape owned by the Cloud product's auth library" while the
engine declares two concrete fields. Either it is opaque (then type it as an
opaque carried value and let the Cloud product's library define the shape) or the
engine reads it (then the fields are the engine's and the comment is wrong). A
concept cannot live in one bounded context and be owned by another. Separately,
`Credentials` reads cold as "any credentials" — database URLs, git tokens, bucket
keys are all credentials in this product family.
*Alternative:* `ManagementApiSession` (or `PlatformSession`), with the ownership
question resolved one way or the other.

**A18 — `PromptSurface` is engine-internal jargon, and the set is short of what
the evidence needs.** (lines 138–148.) "Surface" is a word this design team uses;
a contributor reads `ctx.prompt` and wants a type called `Prompts`. More
substantively: there is no representation of `-y/--yes` (shipped in both the ORM
and the platform), so every product will re-add it as a per-command flag and
re-implement pre-acceptance — the precise divergence R5 exists to prevent. And
the survey's §C11 records typed destructive confirmation (`--confirm <project-id>`)
as a 2/3-family pattern with no home here.
*Alternative:* rename to `Prompts`; add `confirmDestructive(question, { expect })`;
and make `--yes` an engine-owned concept that `confirm` consults, not a flag each
product declares.

**A19 — no interactivity capability fact on the context.** The survey's §F6
conclusion is that the prompt check is "an engine-level capability check, not
per-command logic", and the shipped code branches on it *before* prompting:
`git connect` polls only when `canPrompt` and errors immediately otherwise
(`controllers/project.ts:1708-1717`). With the draft's design a handler learns
its environment only by attempting a prompt and inspecting the failure.
*Alternative:* `readonly interactive: boolean` on `CommandContext`. This is a
fact about the environment, not a rendering decision, so it does not weaken R5.

### Flags and positionals

**A20 — `flag.json()` is a real concept wearing the wrong clothes, and it is the
only member of a family of seven.** (lines 167–168.) Two problems.

*Shape.* `--json` is not an argument the handler consumes; it is a declaration
that the command has a machine-readable mode. The evidence that it is different
in kind: it switches stream discipline, suppresses prompts (`canPrompt` returns
false under json, `shell/runtime.ts:106-108`), disables progress rendering
(`progress-adapter.ts:36-38`), and changes envelope behavior on crash. Typing it
as `FlagSpec<boolean>` puts `args.json` in the handler's arguments and invites
the handler to branch on it — which is presentational logic re-entering product
code through the front door. It also has no `brief`, unlike every sibling
builder: a tell that it is not the same kind of thing.
*Alternative:* delete `flag.json()` and derive the capability — a command
supports `--json` exactly when it declares `present.json` (or unconditionally,
since `present.json` already defaults to the raw value). The flag then never
appears in `ArgsOf` and the handler cannot see it.

*Completeness.* The shipping CLIs have `--json`, `-q/--quiet`, `-v/--verbose`,
`--trace`, `-y/--yes`, `--interactive`/`--no-interactive`, `--color`/`--no-color`
(`shell/global-flags.ts:23-45`; ORM `utils/command-helpers.ts:368-388`). The
draft names `--quiet`, `--no-interactive`, and `--json` in doc comments and
declares exactly one of them. Whatever the answer is — engine-injected on every
command, or a `flag.*` entry each — it must be the same answer for all seven.
Engine-injected is the right one: `--trace` changes error rendering and
`--verbose` changes diagnostics, both squarely engine concerns under R5. If they
are engine-injected, then so should `--json` be, which is the same conclusion as
above by a second route.

**A21 — required-ness is spelled with opposite defaults and opposite naming on
the two sides of one axis.** (lines 158–177.) `flag.string()` is optional and
`flag.requiredString()` is required; `positional.string()` is *required* and
`positional.optionalString()` is optional. A reader who learns one side will read
the other wrong. This is the clearest reads-cold failure in the file.
*Alternative:* one convention. Either mark both non-defaults explicitly
(`flag.string` / `flag.requiredString`; `positional.requiredString` /
`positional.string` — no, that just moves the problem), or make required-ness a
spec field on both: `flag.string({ brief, required: true })`,
`positional.string({ brief, placeholder, required: false })`. The field form
reads correctly cold on both sides and removes four builder names.

**A22 — the builder set is incomplete for its own space.** (lines 158–177.) No
`flag.number()` / `flag.integer()`, though the survey's one poll verb takes
`--timeout <minutes>` with `--timeout 0` meaning "probe once"
(`commands/app/index.ts:592-633`). No required variant of `enum` or `repeated`;
no enum-typed `repeated`; no optional/required distinction on `repeated` at all
(it returns `readonly string[]`, so "not passed" and "passed empty" are the same
value). Discriminator-completeness applied to a builder set rather than a union.

**A23 — `FlagSpec<T>` carries only a phantom type; the flag's *name* is the
record key, and the transliteration rule is unstated.** (lines 171–172, 207.) A
flag called `--dry-run` must be the key `dryRun` (or `'dry-run'`, quoted) and the
engine must transliterate. That rule is the single most likely thing a
contributor gets wrong and it appears nowhere. Also absent from the spec, though
all present in today's CLIs: short aliases (`-q`, `-v`, `-y`), `default`,
`hidden`, `deprecated`.
*Alternative:* state the key→flag-name rule in the `flags` doc comment, and add
`alias?`, `default?`, `hidden?`, `deprecated?` to the specs.

### The command definition

**A24 — `raw` names the mechanism, has three spellings for two states, and
contradicts `present` being required.** (lines 234–239.) The concept is the
survey's mode 7: "the process becomes a protocol endpoint" (`lsp`). `raw` names
the byte-level consequence, not the thing. The type `false | { reason: string }`
gives "no" two spellings (`undefined` and `false`) and "yes" one, so the reader
must learn that a boolean-looking field is really a presence check. And because
`present` is a *required* member of `CommandDefinition` (line 228), a raw command
must supply a presenter that can never run — the impossible state is
representable, while the doc comment says the engine will reject it at runtime.
*Alternative:* make `CommandDefinition` a union of a standard command (with
`present`, no protocol field) and a stdio-server command
(`stdioServer: { reason: string }`, no `present`, no `flags` beyond transport).
Then the engine's runtime check disappears into the type. Keep the required
`reason` — a mandatory written waiver on an escape hatch is a good idea; add one
line saying it exists for review pressure, since it is displayed nowhere.

**A25 — `handler` is named for the thing it returns, not for what it is.** (lines
214–219.) The value is a module loader; the handler is its default export. Two
concepts, one name.
*Alternative:* `load: () => Promise<{ default: Handler }>`, with an exported
`Handler<TArgs, TConfig, TResult>` type so products can name their handler's
type without spelling the whole signature.

**A26 — groups get a strictly poorer declaration than commands, and groups are
the more-visited help pages.** (lines 200–205 vs 286.) A command declares
`brief`, `description`, `examples`; a group declares only `brief`. Today's
platform descriptors carry `description`, `longDescription`, `examples`, and
`docsPath` for every node including groups, and `help.ts` renders all four
(`shell/command-meta.ts`, `shell/help.ts:13-42`). `prisma db --help` will be a
one-line heading and a list.
*Alternative:* groups take `{ brief, description?, examples? }` — the same shape
as a command minus arguments. And add `docsPath?` (or `docsUrl?`) to both:
ADR 239 makes docs URLs part of the settled error surface and the platform
already renders a "Read more" row (`ui.ts` docs-path rendering).

**A27 — `present` is required even for commands with nothing to present.** (line
228.) `app run` hosts a dev server and rejects `--json` outright
(`controllers/app.ts:273-281`); `app logs` streams; a session command's terminal
value is `void`. Each must write `human: () => []`.
*Alternative:* make `present` optional when `TResult` is `void`, or model
session/streaming commands as their own declaration variant alongside A24's
union.

### Mounting

**A28 — space-separated paths are the right shape; the type should say so.**
(lines 283–288.) A path key that reads exactly like the invocation (`'db
migrate'`) makes the tree reviewable in one glance, makes collisions string
equality, and keeps the grammar checkable in one place — which is precisely R12's
argument. It beats nested objects for a tree this flat. Two refinements: give it
a named type (`export type CommandPath = string`) with the grammar in its doc
comment (lowercase words, single spaces, kebab-case within a word), and state how
help ordering is determined, since object key order is currently the de facto
answer and nobody has agreed to it.

**A29 — `CommandSet` is declared and then not used, and the two maps that share
its structure mean different things.** (lines 276, 287, 323.) `CommandSet =
Record<string, CommandDefinition>` where the key is a *command name* (product
side, R12: no paths). `createCli`'s `commands` is the identical structural type
where the key is a *path*. `createTestCli`'s is a third inline copy. Three
spellings, two meanings, one structure — a reader cannot tell them apart, and
neither can the compiler.
*Alternative:* use `CommandSet` for the product side and introduce
`CommandMounts = Readonly<Record<CommandPath, CommandDefinition>>` for the shell
side, with A28's branded path type making the distinction visible.

**A30 — the shell can place a command but cannot rename it.** (lines 283–288.)
R12's own evidence is six months of renames and regroupings across product lines
(`app` → `service`, `database` → `postgres`) that no product would have made
locally. Those renames change user-facing *words*, and `brief` — a user-facing
sentence written by a product before its final path was known — is not
overridable at the mount. The shell owns the tree but not the tree's prose.
*Alternative:* let a mount entry be either a `CommandDefinition` or
`{ command: CommandDefinition; brief?: string }`.

### Test harness

**A31 — `createTestCli` is not the same machinery at the seam R7 promises.**
(lines 322–339.) Production takes a whole `Runtime`; the harness takes four
loosely-typed fields and `run(argv, { stdin })`. Concretely, `config?:
Record<string, unknown>` is a bare section map while `Runtime.config` is
`LoadedConfig` with diagnostics — so the harness *cannot construct an invalid
section*, which is the R10 behavior most worth testing in a product repo. There
is also no way to set env (A14), no way to fire the abort signal (so exit code 3
and session teardown are untestable), and no clock (see referral R6).
*Alternative:* `createTestCli(spec)` plus `run(argv, overrides?: Partial<Runtime>
& { stdin?: string })`, with `config` typed as `LoadedConfig`.

**A32 — `TestCli.run().json: readonly unknown[]` models the transport, not the
value.** (line 335.) A non-streaming command emits one envelope; an array is the
NDJSON mechanism showing through the assertion surface, and every test must write
`result.json[0]`.
*Alternative:* `envelope?: unknown` for the terminal envelope and `jsonEvents:
readonly unknown[]` for the stream, so an assertion names what it is asserting.

---

## 4. Missing concepts

Things the requirements or the survey imply that the interface has no home for.
A13 (config sections), A19 (interactivity), A20 (the other six flags), A8
(artifacts), and A11 (trees) are already stated above and are not repeated.

**M1 — the success envelope. This is the biggest omission.** The platform's
shipped success envelope is `{ ok, command, result, warnings, nextSteps,
nextActions }` (`shell/output.ts:9-29`), warnings are rendered in human mode too
so degraded steps are never silent (`command-runner.ts:130-135`), and the survey
calls envelope-level `nextSteps`/`nextActions` on *every* success the platform's
distinguishing asset (§D, "Cross-family delta worth naming"; §C2(b)). The draft
has no envelope type at all. Consequences: (a) a command that succeeds with
caveats has nowhere to put them except a mid-run `warning` event, which is a
different thing — a warning attached to a result is part of the result; (b)
`Block.nextSteps` is a *human rendering* block, so under `--json` the next steps
disappear entirely — a regression against today's platform CLI, and precisely the
field agents consume; (c) the draft's own doc comment at lines 78–80 refers to
"the success envelope's nextActions" as an existing home for terminal
remediation, and it does not exist.
*Alternative:* declare the envelope in the interface —
`Success<T> = { result: T; warnings?: readonly string[]; nextActions?: readonly
NextAction[] }` — and let a handler return `Result<Success<T>, CliStructuredError>`,
or add `warnings`/`nextActions` as a second return channel. The `NextAction` type
is A6's shared type.

**M2 — the config version marker (R10).** R10 requires `defineConfig` to write a
structural version marker and requires an unmarked file (in particular a classic
Prisma 7 config sharing the filename) to fail early with a typed error, calling a
silent misparse "the worst launch bug available." Nothing in the interface
mentions the marker, `defineConfig`, or the failure; `LoadedConfig` arrives
already loaded. The sibling foundation design does address it
(`wip/designs/1a/design.md` A9), so this may be a deliberate delegation — but the
engine interface should at least name where the boundary is, because the engine
is what fails the run.

**M3 — exit codes beyond 0–3.** R6 and ADR 239 fix 0/1/2/3, and ADR 239 adds
"Commands may still return a command-specific code for finer classification."
`migration check` already ships exit **4** for integrity failure
(`migration-check/exit-codes.ts:1-3`), and `db verify` and `db sign` ship exit
**1** on drift / verify failure (survey §A1) — which under ADR 239 now means "a
bug in Prisma". The interface offers a handler no way to influence the exit code:
it returns `Result<T, CliStructuredError>`, and `CliStructuredError` carries no
`exitCode` (today's `CliError` does, `shell/errors.ts:57`). So either the shipped
ORM behavior becomes inexpressible, or the interface needs to say so and require
those commands to change. Both are defensible; neither is stated.
*Alternative:* if finer codes stay, put an optional `exitCode` on the structured
error and state the reserved ranges; if they go, say so here and record it as a
breaking change the migration must make.

**M4 — typed destructive confirmation.** §C11, 2/3 families:
`--confirm <project-id>` on the platform's `project remove` / `transfer` and the
database/bucket variants. `PromptSurface.confirm` is yes/no only. Covered in A18;
listed here because it is a requirement-level gap, not just a naming one.

**M5 — timeout and deadline semantics for poll commands.** The survey elevates
poll-until-terminal to its own execution mode precisely because it "carries
timeout/deadline semantics, an explicit remote status enum, and transition
events" (§F3). The draft's header decides "timeouts are the handler's business."
That is a legitimate decision, but its consequence is that every poll command
re-implements deadline parsing, elapsed-time rendering, and the timeout error
code — the divergence R5 exists to prevent, arriving through a different door.
At minimum the engine should own the timeout error code and the elapsed
rendering. Worth recording as an accepted risk with a reason.

**M6 — R13's optional-peer-dependency check.** R13 requires a structured error
naming the missing dependency and the user's own install command, produced by an
execution-time check. It is expressible as an ordinary `CliStructuredError`, so
this is not a hole so much as an unassigned owner: if the engine provides the
check and the error code, it belongs here; if each product hand-rolls it, R13's
"clearly say what is missing" becomes convention again. State which.

**M7 — telemetry and update-check side processes.** Both the ORM and the platform
spawn a detached child on every invocation (ADR 217; `shell/update-check.ts:225-237`).
They are presumably engine-internal, but they are cross-cutting behavior the
engine will own, and the interface gives the shell no way to configure or
suppress them. Out of scope for this artifact, but currently unhomed anywhere.

**M8 — durations.** §C9, 2/3 families: ORM `timings: {total}` under `-v`, span
elapsed-ms suffixes, platform `--verbose` timing diagnostics and domain-wait
`mm:ss`. The engine can measure step durations itself by pairing start/finish, so
this is mostly fine — but only if A4's identity problem is fixed, and only if
`--verbose` exists (A20).

---

## 5. Referrals to the principal-engineer pass

These are implementation-mechanics or failure-mode questions I noticed while
reading; they are not architecture findings and I have not judged them.

- **R1 — variance of `CommandDefinition` in the collection types.** `CommandSet`
  and `createCli.commands` use `CommandDefinition` with its defaults
  (`TResult = unknown`). `present.human: (value: TResult, ui: Ui) => Block[]` is
  contravariant in `TResult`, so a `CommandDefinition<F, P, MyResult, MyConfig>`
  is probably not assignable to `CommandDefinition`. If so, `createCli` cannot
  accept real commands without a cast — which would undercut R1's "directly
  executable" claim. Needs a compile test.
- **R2 — `ArgsOf` when `positionals` is absent.** `positionals?` is optional
  (line 208) but `ArgsOf` maps over `keyof D['positionals']` (line 185).
  Behavior over `undefined` needs checking.
- **R3 — whether `defineCommand`'s inference actually lands.** The phantom-symbol
  `FlagSpec<T>` / `PositionalSpec<T>` design is the whole basis of R1's
  "typed by inference"; it needs a worked example compiled, including an enum
  flag and a `const` values array.
- **R4 — `report` is synchronous and returns `void`** (line 117) while writing to
  a stream is asynchronous and can apply backpressure. Behavior of a session
  command emitting thousands of `output` events into a slow pipe is a failure
  mode worth a look.
- **R5 — events emitted after the signal fires.** Line 117 promises they "render
  normally"; whether the stream is still writable during teardown is an
  operability question.
- **R6 — determinism of the test harness.** The `--json` frame carries a
  `timestamp` (doc comment, lines 33–35), so `TestCli.run().json` is not
  snapshot-stable without an injected clock.
- **R7 — `LoadedConfig.diagnostics[].section: string | null`** — what `null`
  means (a whole-file failure?) is not stated and affects which commands fail.

---

## 6. Verdict

The overall shape is sound and the boundaries are drawn in the right places. The
product/engine/shell layering satisfies R3, R4, R9, and R12 as stated; the
handler protocol (args and context in, events along the way, a `Result` out) is
one mechanism covering six of the survey's seven execution modes with a declared
escape hatch for the seventh; and the derivation discipline is real — most
members of `EngineEvent` and `Block` trace back to a numbered, occurrence-ranked
structure in the survey, which is exactly the evidence standard R14 asks for.
The two-level `Runtime` / `CommandContext` split is the right boundary and is the
part I would change least.

What the draft is not yet is *conceptually minimal or symmetric*. One axis —
severity — is spelled four ways across `step-finished.outcome`, the
`warning`/`notice` split, `Block.summary.tone`, and ADR 239's `severity`. One
concept — remediation — is spelled three ways inside the file and a fourth time in
a doc comment referring to a type that does not exist. One axis —
required-ness — has opposite defaults on the flag and positional sides. Three
structurally identical maps mean two different things with no way to tell them
apart. Two names take their meaning from a mechanism rather than from the thing
(`present.stdout`, `raw`), and one takes it from a file descriptor inside an
interface whose purpose is that products cannot touch file descriptors.

Two gaps are more than naming and should be closed before this interface is
implemented against. First, **the config section has no representation at all**:
R10's named section, never-throwing validator, and "fails only if a section it
needs is invalid" rule are all promised in a doc comment that the types cannot
support (A13). Second, **there is no success envelope** (M1): warnings and next
actions attached to a successful result — shipped today on every platform
command, and the one thing the survey singles out as the platform's advantage —
have nowhere to live, and `Block.nextSteps` silently drops them from `--json`.
Behind those, the unresolved status of the other six cross-cutting flags (A20)
determines whether `flag.json()` is a concept or an accident, and the missing
tree block (A11) determines whether the most-rendered human structure in the
corpus can be expressed at all or leaks back into product code.

None of this is a reason to restart. The draft is a good second-order artifact
being asked a first-order question, and the fixes are mostly subtractive: one
tone vocabulary instead of four, one remediation type instead of three, one
required-ness convention instead of two, `--json` derived instead of declared.
Add the config-section token and the success envelope, and the interface would
express its requirements rather than describe them.
