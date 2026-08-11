# S2c handover brief — execute slice s2c-services

Written 2026-08-10 for an independent orchestrating agent with NO
prior context on this project. Everything you need to start is in
this file or in the named documents; where this brief summarizes a
document, the document wins. The operator is Will Madden ("the
operator" below). All paths are repo-relative unless absolute.

## 1. What this project is

Repo `prisma/prisma-cli` is the v8 rewrite of Prisma's platform CLI.
The legacy CLI (still in this repo, `packages/cli/src/` outside the
`v8/` directory — a commander-based shell) is being ported command by
command onto `@prisma/cli-engine` (`packages/cli-engine/`), a
declarative command engine built in slice S1. The engine owns
argument parsing, help, output envelopes, JSON mode, prompts,
telemetry, error presentation, and exit codes; commands are
definitions plus handlers that receive a `CommandContext` and return
data. When the port completes (slice S2d) the commander shell is
deleted.

Slice map (S1 merged as PR #129; S2a is PR #130, open):

| Slice | Scope | State |
| --- | --- | --- |
| S2a | Engine production-readiness: `ctx.api`, auth module, prompts (clack), telemetry, versioning/publish machinery, `version`, auth command family | PR #130 open; an auth rework is landing on it (see §6) |
| S2b | `project *`, `postgres *` (renamed from `database`), `bucket *`, `branch list`, `git *` — 30 commands | Handed to another independent agent; branch `s2b-resources` exists, work not yet pushed |
| S2c | **THIS SLICE**: `service *` (renamed from `app`), `build logs`, `agent *`, `feedback` — 24 commands + 1 parked | Yours |
| S2d | `init` wizard, commander-shell deletion, fixture-machinery deletion, final parity review | Not started |

## 2. Your normative documents, in reading order

All under `.drive/projects/prisma-cli-v8/`. Precedence when they
disagree: contract > overview rulings > inventory > this brief. A
contradiction between any of them, or a fact none of them pins, is a
STOP: surface it to the operator; never improvise a resolution.

1. `specs/s2-overview.md` — the S2 PR split, ten standing rulings
   (all bind you; summarized in §5 below), and the operator question
   ledger Q1–Q8. Ledger items are ruled defaults unless marked open.
2. `specs/s2c-services.md` — YOUR CONTRACT: mapping rules
   R-S2c-1..7, the exact command list, acceptance checklist. It
   inherits S2b's mapping rules R-S2b-2/3/4/5/6/9/10 verbatim, so
   read `specs/s2b-resources.md` for those (they cover error-code
   namespacing, consent/exit-code unification, prompt porting, the
   test matrix R-S2b-9, and divergence-entry duty).
3. `plans/s2c-services.md` — your four dispatches D1–D4 (group
   core → progress operations → streams → agent/feedback/closure).
4. `assets/s2/command-inventory.md` — the normative record of what
   every legacy command does today: flags, API calls, prompts,
   errors, exit codes, side effects, test coverage. §4 of it has a
   per-command entry for each of your 25 commands (`prisma app *`,
   `build logs`, `agent *`, `feedback`). Port from THIS, not from
   your own reading of the legacy code; if the inventory and the
   code disagree, that too is a STOP (the inventory has a
   spec-discrepancies section — check it first).
5. `assets/engine/engine-interface-draft.ts` — the normative engine
   interface with commentary. The engine implementation matches it.
6. `assets/s2/parity-divergences.md` — the S2a divergence entries;
   your entries follow their format but go in a NEW file (§7).

## 3. How a command is built on this engine (primer)

Read the real code in this order; it is the fastest orientation:

- `packages/cli-engine/src/commands.ts` + `command-family.ts` — how
  commands and groups are defined (`CommandFamily` is the ownership
  entity; never abbreviate it in identifiers).
- `packages/cli-engine/src/context.ts` — what handlers receive:
  `ctx.api` (the authenticated management API client — your ONLY
  path to the platform API), `ctx.session()` (read-only auth state),
  prompts, logger, injectable clock, `ctx.env`/`ctx.cwd`.
- `packages/cli-engine/src/events.ts` + `presentation.ts` +
  `protocol.ts` — the output model. Human output and machine output
  are both derived from what the handler returns/emits; you never
  write to stdout/stderr yourself. Channel discipline: explanatory
  blocks go to stderr, payload to stdout; `--json` frames events.
- `packages/cli-engine/src/execution/` — command kinds. Sync work is
  a RESULT command (return a value + serializer). Long-running work
  with progress is a SESSION command (emit `step-started/finished`,
  `progress`, `status` events). Line-by-line output over time is a
  STREAM command (records map to `output` events with a
  `data`-vs-`diagnostic` channel per record).
- `packages/cli-engine/src/testing.ts` (exported as
  `@prisma/cli-engine/testing`) — `createTestCli`: runs a command
  in-process with `ctx.api` faked, prompts scripted, clock
  controlled; assertions target the envelope, presented data, events,
  and exit codes. This is how ALL your tests work (standing ruling:
  semantic-first; never byte-pin output outside the one small golden
  suite per output mode).
- `packages/cli/src/v8/` — the ported CLI: `cli.ts` mounts command
  groups (the "mount map"); each command lives in one file named for
  the command; shared presentation helpers live in named modules.
  The `auth/` subtree there is the existing (pre-rework) porting
  precedent for file layout. By the time you read this, S2b's
  `project/` group may exist on `s2b-resources` — if so, it is the
  layout template for your groups.
- Errors: structured, with a stable code (yours are namespaced
  `SERVICE.*`, `BUILD.*`, `AGENT.*`, `FEEDBACK.*`), a `why`, and
  typed `nextActions` (never free-text "fix" hints). Exit codes:
  0 success, 1 runtime failure, 2 structural/usage/consent-required,
  3 user-canceled, 130 SIGINT.
- Prompts return their input value directly (or throw on cancel);
  consent prompts are `prompt.consent`; `--yes` satisfies
  consent-grade prompts; non-interactive without `--yes` is the
  structured consent-required error (exit 2). These unifications
  CHANGE some legacy exit codes — ledger Q5 rules this; every
  changed code gets a divergence entry.

Telemetry: automatic. The engine reports command runs the way the
ORM CLI does, via `@repo/cli-telemetry`. You wire nothing per
command. Tests must NEVER contact the production telemetry endpoint
(the cli package's vitest config already sets
`PRISMA_NEXT_DISABLE_TELEMETRY=1`; telemetry-behavior tests use the
mock endpoint fixture only).

## 4. What you are porting (the substance)

Contract scope: 24 commands + 1 parked. The rename is ruled
(R-S2c-1): the deployable unit's noun is **Service** — `app` ports
as `service` in all paths, ids, help, and presenters, with NO alias;
one divergence entry per command. Scope note from the contract: env
vars live under `project env` (S2b); the app group has a `domain`
subgroup and NO env subgroup — follow the inventory.

Highlights per group (full detail: inventory §4):

- **`service deploy`** — the flagship and the hardest command in the
  CLI. Multi-step session command (upload/build/deploy/promote with
  progress callbacks), first-deploy interactive customization,
  `--db` branch-database wiring with its own consent, production
  protection (second-and-later production deploys require `--prod`
  plus `--yes`/interactive confirm; cancel exits per Q5's unified
  codes), deploy-all mode for multi-target configs (rejects
  per-app inputs), a dozen error codes with build-phase-aware hints.
  Budget the most time here; its legacy test files (app.test.ts,
  deploy-plan.test.ts, production-deploy-gate.test.ts, and five
  more) enumerate the behavior matrix.
- **`service remove`** — destructive; the CLI's only TYPE-THE-NAME
  confirmation. Ports to `prompt.consent` + its current flag per
  R-S2b-3.
- **`service promote` / `rollback`** — remote operations with
  progress (session commands). NOTE the inventory flag: legacy
  `rollback` has NO confirmation today despite being
  production-affecting. Port as-is (parity) and record it in your
  divergence file as a flagged follow-up for the operator — do not
  add a prompt unilaterally.
- **`service logs`** (stream) and **`build logs`** (stream) —
  R-S2c-2: per-record `source`/`level` routing maps to the engine's
  `data` vs `diagnostic` channels; the legacy JSON wrapper-event
  opt-out for `build logs` does not port (divergence). `build logs`
  has ZERO legacy tests — you write its first ever; full R-S2b-9
  matrix applies. Its terminal-record protocol (a `terminal error`
  record sets exit 1 without throwing) must map onto engine stream
  termination status.
- **`service domain wait`** — canonical poll→status-events case:
  emits a status event per change on the injectable clock,
  `--timeout` default 15m, terminal states active/failed/timeout.
- **`service build`** — R-S2c-5: fully local result command (no
  `ctx.api`), framework build via child processes, progress events
  from the SDK build reporter.
- **`service open`** — R-S2c-6: URL as an `endpoint` event + the
  operation layer's existing browser opener; never open without a
  TTY (report url + `opened: false`).
- **`agent install|update|status`** — local child-process commands
  (spawn `skills-cli` via pnpm dlx/bunx/npx); no auth, no API;
  `--dry-run` returns `{status:"would-install", command}`.
- **`feedback`** — no auth; POSTs to the feedback service URL
  (env-overridable, 3s timeout). Legacy has no JSON serializer for
  it; under the engine it gets the standard envelope (divergence).
  The crash-recovery flow pre-fills this command, so the v8 shell
  keeps an equivalent hook.
- **PARKED: `service run`** (ledger Q2, OPEN — operator decision).
  It passes the child dev-server's exit code through as the CLI's
  exit code; engine session commands have no exit-code channel.
  DO NOT port it until the operator rules whether the passthrough
  mechanism is built in S2c or deferred to Composer's S3. Raise Q2
  with the operator EARLY (your first report), because the answer
  shapes your D3.

Auth for your commands: the app group and `build logs` use
`needs.credentials` + `ctx.api` and never auto-login (the legacy
TTY auto-login does not port — ledger Q1). `agent` and `feedback`
declare no credential needs. The compute-plane operations (deploy,
logs streaming) authenticate the compute SDK client with the
credential — that wiring lives in the auth/operations layer you
consume, not in your command files; if you find no sanctioned path
to an authenticated compute client when you get there, STOP and
surface it (do not read token storage yourself).

## 5. Standing rulings that bind every line you write

Full text: `specs/s2-overview.md`. The ones violated most easily:

1. `CommandFamily` is the contribution entity — never "product",
   never "manifest", never shortened.
2. No conditional properties on stored/normalized types: absent =
   `T | undefined` with the key required.
3. Tests semantic-first through `createTestCli`; management API
   faked at `ctx.api`; auth stubbed at the auth-module seam; no
   byte-matching outside the golden suite; delete legacy fixture
   tests ONLY for commands you port.
4. No dynamic imports of handlers. No lazy handler loading.
5. Naming: no invented jargon, no mechanism names as domain names,
   no dropped meaning-carrying qualifiers, no transient project IDs
   in shipped code. Command examples never include the binary name.
6. Comments are a last resort; public-facing doc comments terse.
7. `--json` sets format only; `--quiet`/`--verbose` set log level
   only and are not otherwise retained; `--interactive` re-enables
   prompts under `--json`.
8. Every user-visible behavior change from legacy gets a divergence
   entry (see §7) — renames, exit-code changes, dropped flags,
   envelope shape changes, all of it.

## 6. State of the world and coordination (read carefully)

Three streams are active in this repo:

- `s2a-foundations` (PR #130, the base of everything): a
  credential-manager rework of the auth family is landing on it
  RIGHT NOW (design: `assets/engine/credential-manager-design.md`,
  rev 4 final). Consumer-facing surfaces you depend on — `ctx.api`,
  `needs.credentials`, `ctx.session()` — are semantically stable;
  the test-harness credential-seeding options may change shape once.
  If a merge-down changes the seeding surface, adopt the new one
  during the merge rather than pinning the old one into new files.
- `s2b-resources`: another independent agent, in progress. You do
  not coordinate with it directly; you consume its branch.
- Yours: branch `s2c-services` **off the current tip of
  `s2b-resources`** (the operator ruled parallel execution; the
  contract's "off main after S2b merges" describes the eventual
  merged geometry). Open your PR with base `s2b-resources` — NOT
  `main` — and retarget when S2b merges. Merge down from
  `s2b-resources` regularly; expected conflict surface is only
  `packages/cli/src/v8/cli.ts` (the mount map) and the lockfile.
  If S2b has not pushed command work yet when you start, D1
  proceeds anyway: the S2a auth family under `packages/cli/src/v8/`
  is a sufficient layout precedent, and you adopt S2b's template on
  your first merge-down if it differs.

Hard boundaries — never modify:
- `packages/cli-engine/**` (an engine gap → STOP, surface to the
  operator with the exact need; do not extend the engine yourself),
- `packages/cli/src/auth/**` and `packages/cli/src/v8/auth/**`
  (mid-rework by the S2a stream),
- `.github/workflows/publish.yml`, `scripts/determine-version*`,
  root/package version fields (publish machinery is settled),
- `assets/s2/parity-divergences.md` (being rewritten by the auth
  stream) and anything under `.drive/projects/prisma-cli-v8/specs/`
  other than reading it,
- `wip/**` anywhere, if present — never stage it.

## 7. Your divergence file

Create `.drive/projects/prisma-cli-v8/assets/s2/parity-divergences-s2c.md`,
same entry format as `parity-divergences.md` (S2d consolidates the
per-slice files). Every R-S2c-1 rename, the `build logs` wrapper
drop, every Q5 exit-code change, the `feedback` envelope addition,
the rollback-has-no-confirm flag, and anything else user-visible.

## 8. Process (non-negotiable)

- Orchestrate via the drive process: dispatch implementer subagents
  (model: Fable) per plan dispatch D1–D4; run the slice review loop
  (architect + principal-engineer reviewers, model: Opus) before
  the PR leaves draft; fix findings before reporting done.
- Git identity — you are the `wmadden-electric` bot:
  - stage files EXPLICITLY by path; never `git add -A`/`-u`;
  - commit: `git commit -s --trailer "Signed-off-by: Will Madden
    <madden@prisma.io>"`, body's last line
    `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`;
  - push ONLY to the bot remote
    `git@github-wmadden-electric:prisma/prisma-cli.git`.
- Verification per dispatch, all green before commit:
  `pnpm --filter @prisma/cli test`,
  `pnpm --filter @prisma/cli-engine test` (must stay untouched and
  green), `pnpm typecheck`, `pnpm lint` — judged by pnpm's OWN exit
  code, not a pipeline tail's.
- PR: ≥1k LOC, one PR for the slice. Description structure (ruled):
  a grounding example first (a real command run, before/after), then
  the decision, then the narrative, alternatives last; no internal
  process codes or dispatch labels in the description.
- Reporting to the operator: plain English, full sentences, no
  invented shorthand; spell out anything slice-internal. Banned
  words: "load-bearing", "smoking gun", "belt and suspenders",
  "gate". Bring QUESTIONS to decide, not decisions to ratify. STOP
  items (contradictions, unpinned facts, engine gaps) go to the
  operator immediately with your recommendation attached.
- Do not use the question UI; write questions in plain messages.

## 9. What done looks like

The contract's acceptance list, restated: all 24 commands mounted
and green on the R-S2b-9 test matrix (streams included, `build
logs` tested for the first time); no `app` path surviving anywhere
in v8; deploy/promote/rollback/remove event sequences pinned by
semantic tests; the divergence file complete; Q2 either ruled and
implemented or still parked with the legacy path intact and a note
for S2d; legacy fixture tests for your commands deleted; root
verification green; review loop run and findings fixed; PR open
against `s2b-resources` with the ruled description structure.

Your first report to the operator should contain: confirmation you
read the four normative docs, your Q2 question, the S2b template
status you found, and your D1 dispatch plan. Then execute.
