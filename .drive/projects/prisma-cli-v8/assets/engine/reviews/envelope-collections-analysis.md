# Are `diagnostics`, `warnings`, and `nextActions` three real things?

Adversarial analysis of the draft envelope's three collection fields
(`engine-interface-draft.ts` §1, §2, §9), against the shipped emission sites
in the output-modes survey, ADR 239, and the platform CLI source.

**Verdict up front: the operator is right about `warnings` and wrong about
`nextActions`. Fold to two collections: `diagnostics` + `nextActions`.
Delete `warnings` from both envelopes, and stop aggregating warn-severity
message events into the result contract. `nextSteps` should go too — it is
derived data a JSON consumer can compute from `nextActions`.**

---

## 1. What the shipped "warnings" actually are

I enumerated every warning-emission site with content across the three
families. They fall into three populations, and none of them justifies an
uncoded string channel in the envelope.

### Population A: structured findings that lose their structure at the boundary

These are the majority, and they are the damning ones. Each site *has*
structure — a kind, a wrapped error, a why, a fix — and crushes it into
prose because the envelope's `warnings: string[]` accepts nothing else.

| Site | What it flattens | Natural code |
|---|---|---|
| ORM planner conflicts — `MigrationPlannerConflict { kind, summary, why? }`, kinds like `'typeMismatch'`, `'nullabilityConflict'` (framework-components/control/control-migration-types.ts:262-269; rendered as a dim string list, cli/utils/formatters/migrations.ts:97-107) | A discriminated union with `kind` + `summary` + `why` — CliStructuredError minus the registry entry | `MIGRATION.PLANNER_TYPE_MISMATCH`, `MIGRATION.PLANNER_NULLABILITY_CONFLICT`, … |
| ORM `db verify` schema warnings — doc comment says it outright: "**Warn-graded finding messages** (observed-policy drift)" (cli/utils/formatters/verify.ts:50-55) | Drift findings from the same verification machinery whose error-graded findings the draft calls diagnostics | `CONTRACT.DRIFT_*` — same family as the error-graded findings |
| Platform init "Project link failed: `${error.summary}`. Link later with …" (prisma-cli controllers/init.ts:1053-1055) | A caught `CliError` — a full structured error — demoted to its `.summary` interpolated into a string | The error's own code, re-emitted at severity warn |
| Platform init "Installing X failed: `${detail}`. Install it later with `${installCommandText}`." (controllers/init.ts:365-372; same pattern :290) | summary + why (wrapped error's first line) + fix (install command) serialized into one sentence | `CLI.INIT_SKILL_INSTALL_FAILED` **already exists in ADR 239's crosswalk as an error code** (PN-CLI-5013). The same condition is an error in one flow and a warning in another — severity is an attribute of the occurrence, which is exactly what `CliStructuredError.severity` models |
| Platform local-state cleanup failures — "The app was removed remotely, but the local `${target}` state could not be cleared: `${cause}`" (controllers/app.ts:4999-5002, used :3086, :3092; same pattern in project remove/transfer, controllers/project.ts:629-632, 710-715) | A caught error swallowed into prose; a wrapper script that wanted to retry the cleanup cannot detect it | `PLATFORM.LOCAL_STATE_CLEANUP_FAILED` |
| Platform `agent status` "Could not read installed skills with `${cmd}`: `${msg}`. Falling back to `${path}`." (controllers/agent.ts:134-141) | Degraded read: failing command, cause, fallback source — three fields in one string | `PLATFORM.SKILLS_READ_DEGRADED` |
| Composer's warn-severity events — `watch-error {message}`, `rebuild-failed {message}`, `stop-error {message}`, `stream-failed {message}`, `lines-dropped {count}` (operations/dev.ts:19-30, operations/log.ts:20-25) | Already a discriminated union on `kind` — coded warnings in all but registry membership | one code per event kind |

### Population B: advisory no-op notices a machine consumer genuinely wants to branch on

| Site | Why a code is *more* deserved, not less |
|---|---|
| Platform promote/rollback "The selected deployment is already live for this app." (controllers/app.ts:1914-1916, 2027-2029) | An agent driving `app promote` needs to know the operation was a no-op. String-matching "already live" is the only machine handle today. `PLATFORM.DEPLOYMENT_ALREADY_LIVE` is about the clearest branch-worthy code in this whole inventory |
| Platform branch-database "prompt suppressed" warning under `--yes`/non-interactive (lib/app/branch-database-deploy.ts:135-141) | An agent needs to know a decision was skipped and why. Branch-worthy |
| Platform missing-preview-default env warnings (controllers/app-env-file.ts:64, app-env.ts:155) | Policy advisory with an exact key list — already carries `meta`-shaped content |

### Population C: pure FYI that is really result data

| Site | Where it belongs after the fold |
|---|---|
| ORM init ".env already exists; leaving it untouched." / "README.md already exists…" (commands/init/init.ts:223-225, 376) | The init JSON already has `filesWritten[]`/`filesDeleted[]` (init/output.ts:23-31); a `filesSkipped[]` in the **result data** says this better than any warning channel |
| ORM init "No package.json found…; created a minimal one." (init.ts:354-356) | Result data (`packageJsonSynthesized: true`) or a coded advisory — author's call |
| ORM init DB probe soft-failures in non-strict mode (init.ts:686-697) | Coded advisory: the probe outcomes are already a discriminated union (`'below-minimum' | 'no-database-url' | 'connection-failed' | 'driver-missing'`) — kinds again, flattened to `outcome.message` |

**Answer to Q1.** Roughly 20 distinct warning texts ship across the corpus.
The large majority either already carry a discriminant (`kind`, a wrapped
error, an enum outcome) or wrap a structured error whose code exists.
Forcing registry codes onto them is not bloat: it is ~15–20 additive codes,
each declared in its owning module's union per ADR 239 (no central registry
edit), and several reuse codes that already exist (`CLI.INIT_SKILL_INSTALL_FAILED`).
The uncoded warning is a discipline failure of exactly the shape ADR 239
killed for errors: "consumers cannot match errors by code because there is
no one code space to match against" — substitute "warnings" and every word
holds. The shipped sites prove the failure mode is not hypothetical: a
`CliError` is being demoted to its `.summary` in a string today
(init.ts:1053), and fix commands are trapped inside prose where no agent can
extract them.

ADR 239 itself anticipated the fold. Its Consequences section keeps
`severity` while admitting "nearly every error is `error` today; the
`warn`/`info` values earn their place only for advisory … surfaces."
A separate uncoded `warnings` channel is what keeps `severity: 'warn'` dead
weight. The fold is what makes it earn its place.

## 2. Is there consumer-visible behavior distinguishing the two channels?

The draft gives the two channels four behavioral differences. None survives
inspection as a *consumer contract*; all four are artifacts of provenance.

1. **Shape** (string vs envelope). Strictly less information. A
   severity-`warn` envelope can carry everything the string carries
   (`summary`) plus code, why, fix, meta. No consumer capability depends on
   warnings being strings — the platform's human renderer just prefixes a
   glyph (command-runner.ts:130-135), which an envelope renders equally well.
2. **Provenance** (aggregated from mid-run `message` events vs declared at
   `ctx.present`). This is an authoring-side plumbing difference, not a
   consumer distinction — and it is a *defect*: the same finding discovered
   mid-run either gets buffered by the product until the return site (and
   arrives structured) or gets emitted as a warn event (and arrives as a
   string). Two paths, two shapes, one concept, diverging by accident of
   when the code learned the fact.
3. **`--quiet` visibility** (draft: diagnostics render even under `--quiet`;
   warnings, as commentary, do not). This rule can be kept per-severity
   after the fold if wanted — but note the platform deliberately renders
   warnings "so partial failures … are never silent"
   (command-runner.ts:130-135). Either way it is a rendering policy keyed
   off a field, not a reason for two collections.
4. **Log-level interaction.** The draft has warn `message` events both
   filtered by `--log-level` *and* aggregated into the envelope — so does
   `--log-level error` remove a warning from the result contract, or only
   from the transcript? The draft doesn't say. The fold dissolves the
   ambiguity: commentary is filterable and ephemeral; the envelope's
   diagnostics are the contract and are never level-filtered.

**The fold is free.** Folded shape:

```ts
export interface CompletedEnvelope<T = unknown> {
  readonly ok: true
  readonly command: string
  readonly result: T
  readonly outcomeCode: number
  /** ALL structured findings of this run, serialized error envelopes.
   *  severity: 'error' entries require a non-zero outcomeCode;
   *  'warn'/'info' entries are advisory. */
  readonly diagnostics: readonly unknown[]
  readonly nextActions: readonly NextAction[]
  // `warnings` deleted. `nextSteps` deleted (derivable — see §3).
}
```

`ErroredEnvelope` gets the same deletion: `error` (the primary abort) +
`diagnostics` (accompanying findings) + `nextActions`. Warn commentary
emitted before the abort is transcript, not contract; anything
contract-worthy is a diagnostic.

Event change: `message` events keep `severity: 'warn'` for live human
rendering, but the clause "additionally aggregated into the envelope's
`warnings`" (draft §1, message event doc) is deleted. Commentary and
contract stop sharing a pipe.

**What emitting a warning costs an author after the fold.** Three honest
options, matching the three populations:

- *Contract-worthy finding* → one factory call at the return site:
  `ctx.present(data, p, { diagnostics: [structuredError('MIGRATION.PLANNER_TYPE_MISMATCH', summary, { severity: 'warn', why, meta })] })`.
  Cost over `warnings.push(string)`: one line in the owning module's code
  union, and naming the thing. That naming cost is the point — it is the
  same cost ADR 239 imposes on errors, for the same payoff.
- *Pure FYI* → put it in the result data, where it was always cheaper and
  more queryable (`filesSkipped[]` beats a prose warning).
- *Ephemeral color* ("retrying…", "this may take a while") → a warn/info
  `message` event, still one uncoded line — it just no longer leaks into
  the machine contract.

**The middle option — a shared generic `CLI.WARNING` code with structured
meta — should be rejected.** It is a fallback code: consumers cannot branch
on it, docs cannot index it, and it recreates the uncoded string with extra
ceremony. The same one-code-space argument that killed fallback error codes
kills it.

## 3. Do `nextActions` overlap diagnostics?

No — and the evidence is specific: **command-level follow-ups ship on fully
clean successes, where there is no finding to hang a `fix` on.** Platform
promote returns `nextSteps: ["prisma-cli app list-deploys", "app show-deploy <id>"]`
on the happy path (controllers/app.ts:1917-1921); deploy returns
promote/show-deploy continuations (app.ts:882-890); `agent status` returns
the install command when skills are absent (agent.ts:157-159). None of
these is remediation of a finding — they are journey continuation. A
consumer (the survey's R14 case; the platform's crash envelope with its
pre-filled `feedback` recover action, shell/output.ts:147-156) branches on
`nextActions.kind`/`journey` to *drive the next invocation*; a diagnostic's
`fix` is prose explaining how to clear *that finding*. Scope is a real
distinction, exercised on both sides by shipped code: platform errors carry
`fix` AND `nextSteps`/`nextActions` simultaneously (output.ts:170-183).

Two genuine overlaps to manage, neither fatal:

- A diagnostic whose remediation is runnable (the "Install it later with X"
  warnings) should emit **both**: the diagnostic (with `fix` prose) and a
  `remediation` event / `next` entry carrying the typed command. The draft
  already has the aggregation machinery; the survey's finding C2 (five
  competing remediation encodings) is the argument for keeping exactly this
  one typed action shape rather than re-deriving actions from fix strings.
- **`nextSteps` is redundant in the JSON envelope.** The draft defines it
  as "derived from nextActions — the human-string form." A JSON consumer is
  a machine; shipping the pre-derived human rendering alongside the source
  of derivation is duplication in the contract. Derive `nextSteps` at the
  human renderer, drop the field from both envelopes. (Lower stakes than
  the warnings fold; if platform-envelope compatibility matters more than
  minimality, keeping it costs only redundancy, not incoherence.)

## 4. Recommendation

**Fold to two: `diagnostics` + `nextActions`.** Concretely:

1. Delete `warnings` from `CompletedEnvelope` and `ErroredEnvelope` (§9).
2. Delete the aggregation clause on the `message` event (§1); warn messages
   are transcript only.
3. Keep `PresentedResult.diagnostics` / `ctx.present`'s `diagnostics` opt as
   the single carrier; entries use `CliStructuredError.severity` ('warn'
   for advisory, 'error' only with a non-zero outcomeCode — the existing
   guardrail, unchanged).
4. Optionally key the render-under-`--quiet` rule off severity (error-graded
   findings always; warn-graded findings follow the platform's
   never-silent precedent).
5. Delete `nextSteps` from both envelopes; derive it in the human renderer.
6. Keep `nextActions` exactly as drafted.

**Migration cost for the shipped sites** (all additive, all within existing
ADR 239 namespaces, each code declared in its owning module):

| Family | Sites | Work |
|---|---|---|
| ORM planner conflicts | 1 producer type, 1 renderer | Map `kind` → `MIGRATION.PLANNER_*` codes (~4 codes); the union already exists structurally |
| ORM verify schema warnings | 1 shape, 1 renderer | Grade as `CONTRACT.*` warn-severity diagnostics; upstream verification already produces findings |
| ORM init (~6 texts) | init.ts | 2 become result data (`filesSkipped`), ~4 become coded advisories; probe outcomes already enumerate their kinds |
| Platform init/agent/app/project (~8 texts) | controllers | ~6 new codes; the link-failed case re-emits the caught error's existing code at severity warn; skill-install reuses `CLI.INIT_SKILL_INSTALL_FAILED` |
| Platform already-live / prompt-suppressed / env advisories | 4 sites | 3 codes, all genuinely branch-worthy |
| Composer warn events | already typed | No envelope today (no `--json`); under the engine their event kinds map 1:1 to codes when they need contract presence |

Total: roughly 15–20 new codes, ~20 call-site edits, zero renames, zero
breaking changes to anything published.

**Where the operator is right and where not.** The `warnings`/`diagnostics`
split is manufactured — it is the platform envelope's `warnings: string[]`
grandfathered into a design that simultaneously adopted a structured-error
model making it obsolete. The shipped warnings are mostly structured
findings and demoted errors being flattened to strings at the boundary; the
one thing the string channel provides that diagnostics don't is the ability
to skip naming the finding, and that is the discipline failure, not a
feature. `nextActions`, by contrast, is real: command-scoped continuation
exists on clean successes, cannot be derived from findings, and is the one
survivor the survey's five remediation encodings should collapse into.
