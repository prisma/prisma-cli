# S1 handover brief — continue slice s1-engine-vertical

Written 2026-08-09 for the next orchestrating agent. The prior session halted after dispatch D5 due to rate limits.

## What this is

Drive project `prisma-cli-v8`, slice S1: build `@prisma/cli-engine` and prove it with one ported command (`auth whoami`). Read, in order: `../../spec.md` (project), `../../plan.md` (slices), `../../specs/s1-engine-vertical.md` (slice contract), `../../plans/s1-engine-vertical.md` (dispatch plan — six dispatches D1–D6). The v8 interface draft at `../engine/engine-interface-draft.ts` is NORMATIVE: where implementation would contradict it, stop and ask the operator (Will); never improvise. Review artifacts (compile-verified typing claims) are in `../engine/reviews/`.

## State at handover

Branch `s1-engine-vertical` (off `cli-engine-requirements`, the living decision-record branch of PR #128). All work committed and pushed. Slice PR is open as a DRAFT targeting `cli-engine-requirements`.

- D1 done (4cc3e14): package scaffold + `./protocol` subpath (Diagnostic, CliStructuredError, Result, NextAction).
- Orchestrator fix (6241d78): `.drive/**` excluded from biome — the committed design drafts broke root lint.
- D2 done (0df7a10): full v8 type surface in `src/index.ts` + permanent type-test suite from the review record; stale-`@ts-expect-error` fails the package test run.
- D3 done (78383c6): execution engine on exact-pinned `@stricli/core@1.3.0` (fully internal, fake process injected); parse → needs → context → handler → `ctx.present` (active-format-only materialization) → envelope → exit code; formats/log-levels; StreamEvent framing; real `createTestCli` harness.
- D4 done (a6b0a0b): prompts (defaults + `--yes`, consent undefaultable), needs.interaction, full event vocabulary + rendering, requireDependency, session/server settlement, signal exit codes 130/143/3.
- D5: config loader (defineConfig marker, Prisma 7 fail-early diagnostic, needs.config → ctx.config). Check `git log` — if a commit like `feat(cli-engine): config loader…` exists, D5 landed; read the commit message and the loader tests for its hand-off details. If absent, re-dispatch D5 per the dispatch plan.
- D6 NOT started: `prisma-v8` bin + `auth whoami` port + slice e2e + parity-divergence list. Full dispatch spec is in `../../plans/s1-engine-vertical.md` § D6. Grounding: the whoami vertical is `runAuthWhoAmI` (packages/cli/src/controllers/auth.ts:114) over `createAuthUseCases().whoami` (packages/cli/src/use-cases/auth.ts), presenters in packages/cli/src/presenters/auth.ts, token storage in packages/cli/src/adapters/token-storage.ts.

Verify state with: `pnpm --filter @prisma/cli-engine test` (all green at handover: 93 tests after D4), root `pnpm lint` (exit 0), `pnpm --recursive exec tsc --noEmit` (exit 0).

## Open items for the operator (do not resolve unilaterally)

1. D3 interpretation: in human non-quiet mode the engine renders human Blocks only; the materialized `stdout` presentation lines are written only under `--quiet` (they would duplicate the blocks). The draft honors materialization exactly; the rendering-rule reading is unruled. Revisit during D6 whoami parity.
2. D4 interpretation: remediation events render as nextActions at settlement in human mode (not live in the transcript); json streams them live as frames.
3. Diagnostic severity stays `error|warn|info`; the trim to two awaits the ADR 239 amendment (project slice S4).

Put all three on the slice PR's parity-divergence list for Will's review.

## Process rules (non-negotiable)

- Implementer subagents run on Fable; reviewer subagents run on Opus.
- After D6: run the slice review loop (architect + principal-engineer reviews per the drive process), fix findings, then mark the PR ready. Any operator-ruled draft amendments during the slice must be reflected in `../engine/engine-interface-draft.ts` before the PR leaves draft (slice acceptance box).
- Commit as the bot: `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, body ends `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Stage explicitly, never `git add -A`. Push to `origin` of this clone (it IS the bot remote: `github-wmadden-electric:prisma/prisma-cli.git`).
- Plain English reports (ISO 24495-1). No invented jargon. Don't hand Will decisions to ratify — surface questions and facilitate.

## Working copy

The prior session's clone: `wip/repos/prisma-cli` inside the prisma/prisma worktree `.claude/worktrees/dependabot-prs-triage-13c8f8`. Any fresh clone via the bot SSH alias works equally; the branch state on origin is complete.
