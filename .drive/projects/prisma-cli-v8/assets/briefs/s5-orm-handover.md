# S5 handover brief — port the Prisma ORM CLI onto @prisma/cli-engine

Written 2026-08-11 for an independent orchestrating agent with NO
prior context. The operator is Will Madden ("the operator"). Where
this brief summarizes a document, the document wins. All paths are
relative to your prisma-cli worktree unless absolute.

## 1. Project context

Repo `prisma/prisma-cli` is the v8 rewrite of Prisma's CLI. Its
core is `@prisma/cli-engine` (`packages/cli-engine`): a declarative
command engine owning argv parsing, help, output envelopes, JSON
mode, prompts, consent, telemetry, error presentation, and exit
codes. Commands are definitions + handlers receiving a
`CommandContext`. The engine's consumers land in ruled order —
platform CLI (S2, in flight), Composer (S3, in flight), ORM last
("hardest consumer, twice-hardened"). YOU are the ORM consumer:
slice **S5 — ORM adoption**.

State of the world (2026-08-11):
- S2a is MERGED to `main` (PR #130, commit 14f9c25): the engine
  production surface — `ctx.api` (authenticated management API
  client), the credential manager (per-workspace auth sessions),
  clack-backed prompts with consent tokens and the global
  `--confirm <value>` flag, `ctx.openUrl` + `prompt.browserWait`
  interactivity affordances, `needs.interaction`, telemetry, and
  the prisma/prisma-style versioning/publish machinery (lockstep
  `8.0.0-rc.1`; merged `chore(release)` bump PRs publish `latest`,
  main pushes publish `-dev.N`).
- `@prisma/cli-engine@0.0.2` is published (the current surface);
  the operator publishes new versions on demand — ask, don't
  engineer around it.
- Three sibling streams run in OTHER worktrees with independent
  agents: S2b (`s2b-resources`), S2c (`s2c-services`), S3
  (`s3-composer`). Never touch their branches. S2d (shell
  retirement) has not started.

## 2. What S5 is (plan §S5 — read `.drive/projects/prisma-cli-v8/plan.md` in full)

Repos: **prisma/prisma + prisma-cli**. Deliverables:
- The `orm` config-section token and the `orm` `CommandFamily`.
- Port `contract *`, `migration *` (retiring the clipanion-based
  migration-cli), `db *`, `init`, `telemetry`, and `lsp` (the
  server command) onto the engine.
- Prove the DIAGNOSTICS model: `migration check` / `db verify` as
  completed-with-findings envelopes with catalogued exit codes, and
  the exit-code-4 semantics defined by S4's ADR-239 amendment.
- Reconcile the ORM's three colliding exit-code schemes to the
  contract (a finding of the original survey — locate it in
  `.drive/projects/prisma-cli-v8/spec.md` / `design-notes.md`).
- Close out the paused 1b brief
  (`.drive/projects/prisma-cli-v8/assets/briefs/1b-leftovers-prisma-prisma.md`)
  against the section API — read it early; S5 supersedes it, and
  anything it promised that S5 does not deliver must be surfaced to
  the operator explicitly, not dropped silently (this exact silent
  drop happened with a Composer-side brief and was caught in
  review).
- Per the rollout plan (`.drive/projects/prisma-cli-v8/assets/rollout-plan.md`):
  prisma/prisma retires its own CLI at S5, and the
  `@repo/cli-telemetry` implementation ALREADY lives in this repo —
  the ORM's reporting must stay identical (shared installation id).

## 3. HARD ORDERING CONSTRAINT — check S4 first

Plan §S4: the ADR-239 amendment in prisma/prisma (dotted diagnostic
codes inside completed envelopes, documented exit codes, the
`fix` → typed `nextActions` rename) must land BEFORE S5 relies on
those semantics. Your literal first action: determine S4's status
(search prisma/prisma for the amendment; ask the operator). If S4
has not landed, raise it in your first report with a proposal —
options: you execute S4 first (it is small and independent), or S5
proceeds on non-diagnostic commands while S4 lands in parallel. Do
NOT build diagnostics semantics against an unamended ADR.

## 4. Reading order (before any planning)

1. `.drive/projects/prisma-cli-v8/plan.md` + `spec.md` — the
   project frame, consumer ordering, coverage ledger.
2. `.drive/projects/prisma-cli-v8/specs/s2-overview.md` — the ten
   standing rulings (they bind every slice) + the operator question
   ledger.
3. `.drive/projects/prisma-cli-v8/assets/engine/engine-interface-draft.ts`
   — the normative engine interface with commentary.
4. `.drive/projects/prisma-cli-v8/assets/engine/credential-manager-design.md`
   (rev 5) — the auth model. ORM commands are mostly local; where
   one needs platform auth it uses `needs.credentials` + `ctx.api`
   and NOTHING else.
5. `.drive/projects/prisma-cli-v8/assets/briefs/s2c-handover.md`
   §3 — the "how a command is built on this engine" primer with
   file pointers; it is accurate and saves you a day. Supplement
   with the real code: `packages/cli-engine/src/` and the ported
   families under `packages/cli/src/v8/`.
6. `assets/s2/command-inventory.md` and
   `assets/s3/composer-inventory.md` — the FORMAT PRECEDENT for
   your inventory (per-command entries: Summary/Flags/Positionals/
   Auth/API calls/Behavior/Output/Prompts/Side effects/Tests/
   Engine notes; shared-machinery; discrepancies).
7. The 1b brief (§2 above).

## 5. Your sequence (the drive process)

1. **Inventory** — an exhaustive ORM CLI inventory
   (`assets/s5/orm-cli-inventory.md`): every command in scope from
   the prisma/prisma CLI (contract/migration/db/init/telemetry/lsp
   and whatever else exists there today), flags, config, engines
   interaction, exit codes (document all THREE colliding schemes
   precisely), prompts, side effects, child processes, test census,
   spec discrepancies. Clone prisma/prisma READ-ONLY into your
   worktree's `wip/repos/` for analysis (never stage `wip/`).
2. **Contract + dispatch plan** (`specs/s5-orm.md`,
   `plans/s5-orm.md`) — written to ZERO creative freedom: every
   mapping decided, every divergence listed, unpinned facts marked
   STOP. Bring the operator the shaping questions BEFORE writing
   where a genuine choice exists (e.g. where the `orm` family's
   code lives — in prisma/prisma exported like Composer's, or in
   this repo — is a contract decision the operator makes; likewise
   the `lsp` long-running server command's engine mapping if the
   session/stream kinds don't fit — an engine gap is a STOP, never
   an improvised engine change).
3. **Architect + principal-engineer review** of the contract
   (subagents), findings folded, then execution rounds, slice
   review loop, PR.

## 6. Mechanics and boundaries

- prisma-cli side: branch off `main` (S2a is merged; you need
  nothing from the S2b/S2c/S3 branches). One PR for the slice,
  base `main`.
- prisma/prisma side: commits/pushes there also go through the bot
  identity. CONFIRM with the operator that `wmadden-electric` has
  push access to prisma/prisma before dispatching work against it.
- Engine changes: FORBIDDEN in this slice without an operator
  ruling. A gap in the engine (e.g. for `lsp`) is a STOP-and-
  surface with your recommendation attached. The S3 stream also
  makes engine changes — coordinate through the operator, never by
  editing the same files on a guess.
- Commands never read TTY/CI state: declare
  `needs: { interaction: true }` for interactivity requirements;
  use `prompt.*` (consent with tokens — the global
  `--confirm <value>` flag is engine-owned; NEVER hand-roll a
  consent-skip flag), `ctx.openUrl`, `prompt.browserWait`.
- Divergence entries: every user-visible change from the legacy ORM
  CLI goes in a NEW file `assets/s2/parity-divergences-s5.md`
  (same entry format as `parity-divergences.md`; a later slice
  consolidates).
- Tests: semantic-first through `createTestCli`
  (`@prisma/cli-engine/testing`); assert envelopes, presented
  data, events, exit codes — never output bytes outside a small
  golden suite. Telemetry tests NEVER contact the production
  endpoint (the cli package's vitest config sets
  `PRISMA_NEXT_DISABLE_TELEMETRY=1`; use the mock endpoint
  fixture).

## 7. Process rules (operator-enforced, non-negotiable)

- Git identity — the `wmadden-electric` bot: stage explicitly by
  path (NEVER `git add -A`; NEVER anything under `wip/` or
  `.drive/projects/prisma-cli-v8/specs/reviews/`); commit
  `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`,
  body ends `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`;
  push ONLY to `git@github-wmadden-electric:<owner>/<repo>.git`
  remotes.
- Verification per dispatch: the touched packages' test suites,
  `pnpm typecheck`, and root `pnpm lint` measured as pnpm's OWN
  exit code with `wip/` moved aside in one shell:
  `mv wip /tmp/wip-stash && pnpm lint; s=$?; mv /tmp/wip-stash wip`.
- Subagents: implementers AND reviewers on Opus (operator ruling).
- Reports to the operator: plain English, full sentences, no
  invented jargon or session-internal labels. Banned words:
  "load-bearing", "smoking gun", "belt and suspenders", "gate".
  Report only outcomes, decisions he must make, and changes to his
  world. Bring questions to decide, not decisions to ratify.
  Never use the question UI. When pointing him at a file, give the
  absolute disk path and a branch-qualified GitHub URL — relative
  links break.
- PR description structure (ruled): grounding example first (a
  real command run, before/after), then the decision, then the
  narrative, alternatives last; no internal process codes.

## 8. Your first report to the operator

Confirm you read plan/spec/overview/draft/rev-5 design and the 1b
brief; state S4's status and your proposal (§3); confirm bot access
to prisma/prisma; name anything in scope you believe is NOT
portable onto the current engine (candidates: `lsp`'s server
lifetime; migration-cli's clipanion interactivity); then your
inventory dispatch plan. Then execute.
