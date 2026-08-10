# S2c continuation brief — pick up slice s2c-services mid-flight

Written 2026-08-10 by the outgoing S2c orchestrating agent, halted by a
rate limit. Reader: a fresh orchestrating agent with NO prior context.
The original handover brief is
`assets/briefs/s2c-handover.md` (on `s2a-foundations`, commit 00b4207 —
NOT in this branch's tree; read it via
`git show 00b4207:.drive/projects/prisma-cli-v8/assets/briefs/s2c-handover.md`).
Read it FIRST; this brief only records what changed since, what is
done, and what remains. Where they disagree, this brief wins (it is
newer and carries operator rulings the original predates).

## 1. Where the work stands

Branch `s2c-services`, 13 commits, based on `bot/s2a-foundations` @
`9ffbb01` (NOT `s2b-resources` — see §3). Pushed to the bot remote.
Working state at handoff: dispatches D1, D2 (with an
engine-affordances migration), and D3 are implemented and verified
green; D1 and D2 are reviewer-SATISFIED; **D3 is implemented but
UNREVIEWED** (the reviewer was killed before writing anything — the
review artifact `.drive/projects/prisma-cli-v8/reviews/code-review-s2c.md`
has no D3 section). D4 has not started.

Verification, all green at handoff (judge by pnpm's own exit codes):
`pnpm --filter @prisma/cli test` (72 files, 977 tests) ·
`pnpm --filter @prisma/cli-engine test` (234, package untouched by us) ·
`pnpm typecheck` · `pnpm lint`.

Commands ported (16 of 24): D1 `service
build|show|open|list-deploys|show-deploy`, `service domain
add|show|remove|retry|wait`; D2 `service deploy|promote|rollback|remove`;
D3 `service logs`, `build logs`. All under `packages/cli/src/v8/service/`
(plus `v8/build/logs.ts`), mounted in `packages/cli/src/v8/cli.ts`.
Tests in `packages/cli/tests/v8-service-*.test.ts` +
`v8-build-logs.test.ts`, shared harness `v8-service-testkit.ts`
(`makeServiceCli`: seeds the credential manager by default, `openUrl`
spy, `rawTokenSeed` for the log-stream tests only).

Remaining scope: D4 = `agent install|update|status`, `feedback`,
divergence-file completion, the fixture-test decision, the pre-PR
review loop, PR open. See §5.

## 2. Operator rulings received since the original brief (BINDING)

1. **Consent is engine-owned.** No per-command consent-skip flags,
   anywhere. `prompt.consent(question, {token})` — token is the natural
   noun of the action; interactive rendering is type-to-confirm; the
   global repeatable `--confirm <value>` grants non-interactively on
   exact match (each value consumed once per run). `--yes` remains
   "accept defaults" and NEVER grants consent. NOTE the semantics the
   engine actually implements (tests pin this): `--confirm` grants only
   on the non-interactive branch (including under `--yes`); an
   interactive session type-to-confirms even when `--confirm` is
   passed. Landed as engine commit `6bb8452`. Our tokens: `service
   remove` → service name, deploy's production consent → target
   service name, `service domain remove` → hostname.
2. **Q2 is ruled: `app run` is DROPPED**, superseded by Composer's
   commands. No v8 port, no exit-code passthrough mechanism, no legacy
   carve-out in S2d (the shell deletion takes it). D4 records the drop
   as a divergence entry. Do not port `service run`.
3. **Base change:** the branch was rebased onto `s2a-foundations`
   (operator instruction — S2b landed nothing we depend on). The PR
   opens with base `s2a-foundations` (stacks on PR #130), retargeting
   to `main` when that merges. The original brief's `s2b-resources`
   geometry is obsolete.
4. **Implementer model is Opus** (operator instruction, rate-limit
   headroom), not Fable as the original brief says. Reviewers: Opus.

## 3. Branch geometry and git mechanics

- Base: `bot/s2a-foundations` @ `9ffbb01` (credential-manager rework)
  on `6bb8452` (consent/openUrl/browserWait affordances).
- Remote: push ONLY to `bot`
  (`git@github-wmadden-electric:prisma/prisma-cli.git`). Identity is
  the `wmadden-electric` bot (env comes from `~/.zshenv` in agent
  shells). Commits: stage files EXPLICITLY by path (never `-A`/`-u`);
  `git commit -s --trailer "Signed-off-by: Will Madden
  <madden@prisma.io>"` with body's last line
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Merge down from `bot/s2a-foundations` when it moves (the S2a stream
  is active). If the test-harness credential-seeding surface changes
  again, adopt the new shape during the merge.
- `wip/**` is never staged. The worktree may be a shallow clone —
  if history looks parentless, `git fetch bot --unshallow`.

## 4. Escalated engine gaps (with the operator; do not work around)

Interims are shipped, recorded as divergences, and safe to leave until
the operator lands engine changes; on the merge-down that brings a
fix, adopt it and delete the interim + its divergence entry.

1. **`service logs` has no sanctioned raw token under the shipping
   (manager-wired) runtime.** Interim: `ctx.getCredentials()` else
   settle `SERVICE.LOG_STREAM_CREDENTIALS_UNAVAILABLE`. The command
   works only under the manager-less fallback runtime until the engine
   exposes a token accessor or (recommended to operator) a
   pre-authenticated log-stream client alongside `ctx.api`. NEVER read
   the token file or env var from command code.
2. **Streams cannot settle exit 1.** `build logs` on a terminal
   `error` record streams everything then settles `BUILD.FAILED`
   (exit 2, carries message/code/retryable/cursor + a `--cursor`
   resume action); legacy exited 1. Waiting on: stream termination
   status, a documented exit 1, or a ruling that it becomes a result
   command.
3. **`--db`/`--no-db` tri-state is not expressible** (stricli
   auto-negates booleans). Interim: `--db` requests; absent and
   `--no-db` both take the signal-driven prompt (default No). Legacy's
   "both flags → USAGE_ERROR" and "--db needs --yes non-interactively"
   checks are gone.
4. **`prompt.text` has no validator**, so deploy's first-run Project
   name typo fails the run instead of re-asking (legacy re-asked via
   clack validate). Recorded beside the --db gap.
5. **No handler-facing injectable clock.** `service domain wait`
   polls `setTimeout` + `ctx.signal`, interval from
   `PRISMA_CLI_DOMAIN_WAIT_POLL_MS`. Accepted for now.

## 5. What D4 must do (next dispatch)

1. **Re-run the D3 review first** (fresh reviewer round, before or
   alongside D4 implementation): diff `a0b0ea6..55efe06`, dimensions
   per the round briefs recorded in `reviews/code-review-s2c.md`
   round notes. D3's specifics: channel routing per record,
   `skipSelection` on `resolveServiceReadState` (added so `service
   logs --deployment <id>` never prompts — verify no regression on
   the other read commands), json framing, the two interims above
   implemented exactly as described.
2. Port `agent install|update|status` (local child-process commands,
   spawn skills-cli via pnpm dlx/bunx/npx; no auth, no API; `--dry-run`
   → `{status:"would-install", command}`) and `feedback` (no auth;
   POST to the feedback URL, env-overridable, 3s timeout; legacy had
   no JSON serializer — engine envelope is a divergence; the
   crash-recovery flow pre-fills this command, keep an equivalent
   hook). Inventory §4 entries are normative.
3. Decide (operator default: dies with the shell) the deploy
   agent-setup prompt dropped in D2 — currently a recorded divergence.
   The operator was told and did not object; record it as final unless
   overruled.
4. Divergence file completion: add the `app run` drop entry (ruling
   §2.2). File: `assets/s2/parity-divergences-s2c.md` (D1/D2/D3
   sections exist; keep the format).
5. Fixture-test deletion: the standing recommendation (accepted by
   the reviewer across D1–D3) is to DELETE NOTHING in S2c — the
   legacy `app` shell still ships until S2d and deleting its tests
   would leave live code uncovered. The slice contract says otherwise;
   this is flagged for the operator at PR time. Restate it in the PR
   description rather than silently deviating.
6. Slice review loop before the PR leaves draft: architect +
   principal-engineer personas, model Opus, per the drive process.
   Fix findings, then push and open the PR: base `s2a-foundations`,
   ≥1k LOC (already cleared: ~7k added), description structure per
   the original brief §8 (grounding example first — a real command
   run before/after — then decision, narrative, alternatives last; no
   internal dispatch labels; plain English).

## 6. Process notes for the incoming orchestrator

- Drive process, build-slice loop: one persistent implementer + one
  persistent reviewer (both Opus), resumed across rounds; findings
  live in `reviews/code-review-s2c.md` (scoreboard + findings log +
  round notes; orchestrator-owned sections marked). All finding
  severities block SATISFIED. Reviewer is read-only on code.
- Operator communication: plain English, full sentences, no invented
  shorthand or ledger codes without explanation (he will call it out);
  banned words: "load-bearing", "smoking gun", "belt and suspenders",
  "gate". Bring questions with recommendations, not decisions. Never
  use the question UI.
- Hard boundaries unchanged from the original brief: never modify
  `packages/cli-engine/**`, `packages/cli/src/auth/**`,
  `packages/cli/src/v8/auth/**`, publish machinery, specs; engine
  gaps are STOPs surfaced to the operator with a recommendation.
- Verification before every commit, judged by pnpm's own exit codes;
  the engine package must stay untouched and green.
- Implementation conventions established in the code (follow them):
  one command per file; shared resolution in `v8/service/target.ts`
  (`resolveServiceReadState`, `resolveServiceDomainTarget`,
  `openServiceStateStore`, `rememberSelectedService`); errors in
  `v8/service/errors.ts` (`SERVICE.*` codes, `renameAppCopy`,
  `fromLegacyCliError`, `adviceAction`); handlers call the existing
  legacy operation layer, never rewrite it (additive taps only:
  `executeAppBuild` `io`, `removeApp` `progress`); tests semantic-only
  through `createTestCli`; fake API bodies are `{data: {…}}`-shaped;
  no `app` noun in any v8 user-visible surface except the SDK-owned
  `app:`/`apps:` compute-config keys (recorded decision).
