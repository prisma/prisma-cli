# S2b handover brief — execute slice s2b-resources

Written 2026-08-10 for an independent orchestrating agent. The
operator (Will) hands this slice over while the S2a auth rework
completes in parallel on `s2a-foundations` (PR #130).

## What this is

Drive project `prisma-cli-v8`, slice S2b: port the resource command
groups (`project`, `postgres` (renamed from `database`), `bucket`,
`branch list`, `git`) — 30 commands — onto `@prisma/cli-engine`.
Read, in order:
1. `../../spec.md` (project) and `../../plan.md` (slices).
2. `../../specs/s2-overview.md` — the S2 standing rulings (all ten
   bind you) and the operator question ledger (Q1/Q5 defaults are
   ruled; build to them).
3. `../../specs/s2b-resources.md` — YOUR CONTRACT. Its mapping rules
   R-S2b-1..10 leave no design freedom; where a fact is unpinned,
   STOP and surface to the operator. The command inventory
   `../s2/command-inventory.md` is the normative record of current
   behavior; the v8 draft `../engine/engine-interface-draft.ts` is
   the normative interface.
4. `../../plans/s2b-resources.md` — four dispatches. D1 (project
   group) establishes the template (file layout, presentation
   helpers, test matrix, family-map/mount-map build-time test);
   D2 postgres; D3 bucket/branch/git; D4 closure (divergence list,
   fixture-test deletion, review loop, PR).
5. `../s2/parity-divergences.md` for the S2a precedent entries.

## State at handover

- Branch `s2b-resources` exists off `s2a-foundations` @ 93e4190,
  pushed to the bot remote; worktree prepared at
  `.claude/worktrees/s2b-resources` (deps installed). The PR (when
  opened) targets `main` as a stacked PR; retarget/rebase after
  #130 merges.
- S2a (#130) contains everything you build on: `ctx.api` (the mock
  seam — fake the management API here, per standing testing ruling),
  `needs.credentials`, the clack prompt path (scripted answers in
  tests), telemetry (observes your commands automatically), the
  auth module, turbo/tsconfig/versioning machinery.
- IN FLIGHT on `s2a-foundations` (NOT yours): the credential-manager
  rework of the auth family (design:
  `../engine/credential-manager-design.md` rev 3; engine-surface
  implementation and design re-reviews running). Consumer-facing
  semantics of `ctx.api`/`needs.credentials` are stable; the
  harness's credential seeding surface may shift once (currently
  `createTestCli({ credentials })`). Expect to merge
  `s2a-foundations` down periodically; conflicts should be confined
  to `packages/cli/src/v8/cli.ts` (mount map) and lockfiles.

## Coordination rules (hard)

- Never touch: `packages/cli/src/v8/auth/**`, `packages/cli/src/auth/**`,
  `packages/cli-engine/**` (engine changes → STOP, surface to the
  operator), `.github/workflows/publish.yml`, versioning scripts.
- Divergence entries go in a NEW file
  `../s2/parity-divergences-s2b.md` (S2d consolidates) — do not edit
  the shared file, it is being rewritten by the auth stream.
- Commands consume auth ONLY via `needs.credentials` + `ctx.api`.
  Unauthenticated = the engine's sign-in error (ledger Q1 default:
  the legacy TTY auto-login does NOT port).
- One command per file named for the command; shared presentation
  helpers in named modules (the v8 auth family pre-rework is the
  layout precedent; the operator's naming standards apply — no
  mechanism names, no bucket names, no dropped qualifiers, no
  transient project IDs in shipped code).

## Process (non-negotiable)

- Follow /drive-process. Implementer subagents on Fable; reviewer
  subagents on Opus. Slice review loop (architect +
  principal-engineer) before the PR leaves draft; findings fixed.
- Commit as the bot: stage explicitly (never `git add -A`),
  `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`,
  body ends `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
  Push to the bot remote (`git@github-wmadden-electric:prisma/prisma-cli.git`).
- Verification per dispatch: `pnpm --filter @prisma/cli-engine test`,
  `pnpm --filter @prisma/cli test`, `pnpm --filter @repo/cli-telemetry test`,
  `pnpm typecheck`, `pnpm lint` measured as pnpm's own exit code.
- Tests are semantic-first (envelope/presented/events/exit codes)
  with `ctx.api` faked; byte-pins only in the existing golden suite.
  Delete legacy fixture tests only for commands you port.
- PR ≥1k LOC; description per the operator's ruled structure
  (grounding example first, the decision, narrative, alternatives
  last; no internal process codes).
- Plain English reports. Banned words: "load-bearing", "smoking
  gun", "belt and suspenders", "gate". Bring the operator questions
  to decide, not decisions to ratify. STOP items go to the operator,
  never improvised.

## Open items that may touch you

- Ledger Q5 (exit-code unification) is the ruled default — apply
  R-S2b-3 and enumerate every changed code as a divergence.
- The `rm` alias drop (R-S2b-8 / ledger Q3): ratified by default;
  divergence entry.
- If the credential-manager work changes the harness seeding surface
  before your D4, adopt the new surface during a merge-down rather
  than pinning the old one into 30 new test files late.
