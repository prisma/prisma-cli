# S2b mid-slice handover — resume dispatch D2

> **SUPERSEDED 2026-08-11. Do not follow the resume sequence below.**
> The slice is finished: all 31 commands are built, mounted, tested and
> recorded, every dispatch review round and the closure architect and
> principal-engineer passes are closed, and the branch is merged up to
> `s2a-foundations` with CI green. The work is PR #133. This file is
> kept as the record of where the slice stood when it changed hands
> mid-D2, and of the rulings in force at that point — several of which
> were later amended. For the current state read, in this order: the
> divergence record `../s2/parity-divergences-s2b.md`, the review
> artifact `../../reviews/code-review.md`, and the amendment blocks in
> `../../specs/s2b-design/conventions.md` and `d3-bucket-branch-git.md`.

Written 2026-08-10 by the outgoing orchestrating agent, halted by the
operator (rate limit). Successor: you are the orchestrator for Drive
slice s2b-resources under /drive-process. The operator is Will.

## Where everything is

- Branch `s2b-resources-work`, pushed to the bot remote
  (`git@github-wmadden-electric:prisma/prisma-cli.git`), based on
  `origin/s2a-foundations` @ 7716e8b (PR #130's branch — rebase onto
  its tip whenever it moves; the eventual PR sets `s2a-foundations`
  as its BASE, not main; operator ruling).
- Normative stack, in precedence order: slice contract
  `specs/s2b-resources.md` (R-S2b-1..10) → `specs/s2b-design/
  conventions.md` → `specs/s2b-design/d{1,2,3}-*.md` → the verbatim
  fact sheets in `specs/s2b-design/facts/`. The design docs contain
  every post-ratification amendment; where a per-command section
  conflicts with a later ruling, the ruling note in the same file
  says so explicitly (e.g. d2 §3's CONSENT SUPERSESSION preamble).
- Review artifact: `reviews/code-review.md` (scoreboard, findings,
  round notes). Divergence record:
  `assets/s2/parity-divergences-s2b.md` (NEVER edit the shared
  `parity-divergences.md` — the auth stream owns it).

## State

- **D1 (project group, 11 commands): DONE.** Reviewer verdict
  SATISFIED (round 2). Includes the slice template: exported spec
  constants in `v8/cli.ts`, `tests/v8-mount-coverage.test.ts`,
  `v8/resources-shared/workspace.ts`.
- **D2 (postgres group, 11 commands): ~90% done, halted mid-tail.**
  Commit `b9c4b81` holds all 11 commands + `tests/v8-postgres.test.ts`
  (implementer's heartbeat says the gate was green there). Commit
  `bf6d434` is an honest WIP: legacy `database.test.ts` fixture cases
  and `database-plan-limit.test.ts` deleted, D2 divergence section
  PARTIAL, gate NOT verified on that state. Remaining D2 work:
  finish the D2 divergence section + 11 conformance rows, re-run the
  full gate, then the D2 review round, findings fixed.
- **D3 (bucket 6 + branch 1 + git 2): not started.** Design complete
  in `d3-bucket-branch-git.md`. No reordering needed; nothing blocked
  — consent tokens, `ctx.openUrl`, `prompt.browserWait`,
  `needs.interaction` all exist on the current base.
- **D4 (closure):** divergence consolidation check, review loop
  (architect + principal-engineer per the handover brief), PR opened
  non-draft, ≥1k LOC, description per the operator's ruled structure.

## Verification gate (every dispatch, pnpm exit codes)

engine test · cli test · cli-telemetry test · typecheck · lint. The
once-failing `packages/cli-engine` lint should be fixed on the
current base — if root lint still fails there, report to the
operator; that package is a hard no-touch boundary.

## Process rules in force (operator-ruled; violations were rejected hard)

1. Zero creative freedom for implementers: unpinned fact → STOP and
   surface to the operator; never improvise. Orchestrator pins
   design amendments in the docs BEFORE re-delegating.
2. Commands and helpers NEVER read TTY/CI/process state.
   Interactivity gating = `needs: { interaction: true }` (git
   connect declares it — divergence: all non-interactive runs fail
   early). Browser flows = `ctx.openUrl` / `prompt.browserWait`.
3. Consent: engine-owned tokens only. No per-command confirm flags.
   `ctx.prompt.consent(<pinned legacy why sentence>, { token:
   <exact resource id> })`; shared repeatable `--confirm` grants
   non-interactively; matrix per conventions §5.
4. Auth: `needs.credentials` + `ctx.api` + `ctx.session()` (via
   `resolveActiveWorkspace`) only. No auto-login (ledger Q1).
5. Persistent subagents: ONE implementer + ONE reviewer for the
   whole slice, resumed across dispatches, both currently Opus
   (operator override for rate-limit headroom; brief originally said
   Fable implementer). Spawn fresh only if the prior transcript is
   inaccessible — then have them re-read the design stack first.
6. Never touch: `packages/cli/src/v8/auth/**`, `packages/cli/src/
   auth/**` (importing its public index is fine), `packages/
   cli-engine/**`, publish workflow, versioning scripts. Engine gaps
   → STOP to operator (the auth stream on s2a-foundations lands
   engine changes).
7. Commits: explicit staging; `git commit -s --trailer
   "Signed-off-by: Will Madden <madden@prisma.io>"`; body ends
   `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; push to
   the bot remote only. Legacy source edits: `export` keywords at
   most, each listed in the PR description.
8. Reports to the operator in plain English, full sentences, no
   invented jargon, no compressed arrow-chains; banned words:
   "load-bearing", "smoking gun", "belt and suspenders", "gate"
   (say "check"/"requirement"). Bring questions to decide, not
   decisions to ratify.

## Open items

- D2 tail (above), then D3, then D4.
- Operator ratifies via the divergence list at PR review:
  `PROJECT.ENV_PREVIEW_DEFAULT_MISSING` (invented warn code),
  `PROJECT.LOCAL_STATE_WRITE_FAILED` reuse at warn severity for
  pin-cleanup warnings, the `workspaceName`→id fallback, the
  interaction-required divergence on git connect, the
  `PROJECT_AMBIGUOUS` hardcoded `app deploy` nextStep quirk (ported
  verbatim).
- Watch `origin/s2a-foundations`: rebase onto new tips at clean
  points (implementer does it mid-dispatch, orchestrator between
  dispatches). Conflicts concentrate in `v8/cli.ts` (keep both
  streams' entries; auth entries exactly as the incoming side) and
  lockfiles.
- S2a stream defect handed over verbally: `performLogin` still does
  internal TTY detection (contradicts ruling 2); belongs to the auth
  stream, not this slice.

## Resume sequence for the successor

1. Read the normative stack + `code-review.md` + the D2 fact sheet.
2. Resume (or respawn per rule 5) the implementer with: finish the
   D2 divergence section/conformance rows, run the full gate,
   report.
3. Reviewer round on D2 (scope shape: see the D1 round briefs echoed
   in `code-review.md` round notes).
4. D3 dispatch per `d3-bucket-branch-git.md`, then D4 closure per
   `plans/s2b-resources.md`.
