# S3 close-out handover — Composer adoption

Written 2026-08-12 for an agent with NO prior context. The operator
is Will Madden. Slice S3 (Composer adoption) is **substantially
done and merged**; what remains is one open PR, a short list of
follow-ups, and the slice's formal close-out.

## 1. What S3 was, and its state

Repo `prisma/prisma-cli` is the v8 Prisma CLI, built on
`@prisma/cli-engine` (`packages/cli-engine`). S3 made **Composer**
(repo `prisma/composer`) the engine's first cross-repo consumer:
composer's four commands — `deploy`, `destroy`, `dev`, `log` — are
now engine commands, composer's own CLI is a thin composition of
them, and the `prisma` binary mounts the same family.

**Merged (all of it):**

| PR | What |
| --- | --- |
| prisma-cli #136 | `ctx.spawn` — terminal handoff with credential injection |
| prisma-cli #145 | the engine settles signal-terminated runs (Ctrl-C → 130) |
| prisma-cli #150 | the engine records the child; `ctx.lastChild()`; `exitWithChildStatus()` loses its argument |
| prisma-cli #151 | a handler can fail with more than one finding |
| prisma-cli #155 | the engine detects CI itself; hosts stop answering |
| prisma-cli #152 | **the mount** — composer's family in the v8 bin (`42ee7891`) |
| composer #220 | composer's CLI becomes four commands on the engine |
| composer #224 | engine pin 0.0.9; Node floor 24 → 22.18 |

**Open, approved, needs merging: composer #226** — a CI check that
imports all 16 published entrypoints on the Node floor. It was
`BEHIND` main; I merged main into it and pushed (`32c85f27`).
Confirm its checks go green, then merge it. Nothing else blocks it.

## 2. Read these before touching anything

- `.drive/projects/prisma-cli-v8/specs/s3-composer.md` — the slice
  contract, rev 2 final. Normative. Its §10 records every amendment
  made during the slice.
- `.drive/projects/prisma-cli-v8/deferred.md` — **the live list of
  everything carried out of this slice**, grouped by owner. Read it
  in full; most of §3 below is a pointer into it.
- `.drive/projects/prisma-cli-v8/plan.md` — the project plan and
  coverage ledger (corrected during S3; see §3).
- `.drive/projects/prisma-cli-v8/assets/s2/parity-divergences-s3.md`
  — the nine user-visible changes from composer's own CLI.
- `.drive/projects/prisma-cli-v8/assets/s3/composer-inventory.md` —
  what composer's CLI did before the port. Still the reference for
  any behavioural question.

## 3. What is left

### Immediate
1. **Merge composer #226** (above).
2. **Composer should drop its `isCI` answer.** prisma-cli #155 made
   `Runtime.isCI` the optional `isCIOverride` — the engine detects
   CI itself now. Composer still passes `isCI` (via `ci-info`) in
   `packages/0-framework/3-tooling/cli/src/family/runtime.ts`
   because it pins engine `0.0.9`, which predates #155. Harmless
   today. Drop the parameter and the `ci-info` dependency when
   composer next bumps its engine pin.

### The engine-copy problem — needs the lockstep release
An install of `@prisma/cli` resolves **two** copies of the engine:
this repo ships its own at `8.0.0-rc.1` while composer pins the
published `0.0.9`. Two exact pins on two release lines cannot
dedupe. It works only because values crossing the boundary are
matched by `Symbol.for` rather than by identity, and **only the
structured-error crossing is tested**. It collapses when both sides
name the same engine version — i.e. when composer pins the lockstep
version `publish.yml` ships. Do not attempt to fix it by pinning a
different `0.0.x`; that changes nothing.

### Everything else
`deferred.md` is the record. Notable entries, so you know they
exist without reading it cold:
- **Composer's help examples are wrong under the prisma bin.** They
  read `{bin} deploy src/service.ts`, so `prisma composer deploy
  --help` shows `prisma deploy src/service.ts`, which exits 2. Eight
  examples, two per command. Needs a mount-aware placeholder in the
  engine plus composer rewriting its strings.
- **R-S3-2's diagnostics list still has no consumer.** Composer
  builds a list of every config problem but commands still fail on
  the first. Engine #151 supplied the missing surface (a failure can
  now carry findings); wiring composer to it is the remaining work.
- **Two flaky tests under load**, both the same shape (a child
  writes its ready marker before installing its signal handler):
  `packages/cli/tests/v8-spawn-adapter.test.ts` and
  `packages/cli-engine/tests/spawn-real-child.test.ts`.
- **`pnpm --filter @prisma/cli test` can pass against a stale engine
  build** — it does not build first. Run the engine suite before it,
  or use `turbo run test`.
- **The alchemy exit-hook patch** in composer
  (`patches/@alchemy.run__node-utils@0.0.5.patch`) is vendored from
  the open alchemy-run/node-utils#6. Delete it when that ships
  through the chain.

## 4. Closing the slice

S3 is not formally closed. Per the drive process, close-out means:
verify the contract's acceptance list against what actually shipped
(the contract's §10 already records the amendments), fold anything
still true into `deferred.md`, and update `plan.md`'s slice table.
**Do not claim acceptance items that were amended away** — read §10
first; several were, deliberately.

The next slice by the plan's dependency graph is **S8** (service
primitives), whose design questions S3 answered — the answers are
in `deferred.md` and the inventory's §4a. **S5** (ORM adoption) has
its own brief at `assets/briefs/s5-orm-handover.md` and is
independent.

## 5. Process rules (operator-enforced)

- **Git identity is the `wmadden-electric` bot**: stage explicitly
  by path (NEVER `git add -A`; NEVER anything under
  `.drive/projects/prisma-cli-v8/specs/reviews/` or `wip/`); commit
  `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`
  with body ending `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`;
  push only to the bot remote (`bot` in prisma-cli, `origin` in the
  composer clone — both are the `github-wmadden-electric` SSH alias).
- **Verification**: `pnpm --filter @prisma/cli test`,
  `pnpm --filter @prisma/cli-engine test`,
  `pnpm --filter @repo/cli-telemetry test`, `pnpm typecheck`,
  `pnpm lint` — all must exit 0. **Lint fails on warnings.** Run
  suites sequentially; parallel runs race the engine build.
- **Composer clone** lives at
  `.claude/worktrees/s3-composer/wip/work/composer`. Its checks:
  `pnpm build`, typecheck, `lint`, `lint:casts` (no ratchet delta),
  `lint:deps`, `@internal/cli` suite, `check:cli-engine-pin`,
  `check:family-static-graph`, `check:npm-effect-resolution`,
  `check:publish-deps`, `check:floor-imports`. Known pre-existing
  failures NOT yours: `@internal/dev-emulators` /
  `@internal/local-target` when a leftover Prisma Dev daemon holds
  ports 51316–51325.
- **Every PR**: address every CodeRabbit thread — fix it, or decline
  it with verified evidence — then reply and resolve each thread
  before merging. Several of its findings this slice were correct
  where our own records were wrong.
- **PR descriptions** (ruled): a grounding example first (a real
  command run), then the decision, then the narrative, alternatives
  last. No internal process codes.
- **Reports to the operator**: plain English, short. Report outcomes,
  decisions he must make, and changes to his world — nothing else.
  Banned words: "load-bearing", "smoking gun", "belt and suspenders",
  "gate". Bring questions to decide, not decisions to ratify. Never
  use the question UI. Give absolute paths and branch-qualified
  GitHub URLs, never relative links. **Never use spawn_task chips** —
  follow-ups go in `deferred.md`.
- **Verify claims against source before asserting them.** This slice
  produced several confident statements that were wrong (composer
  "fails on Node 22" — it does not; the effect check "never runs" —
  it does). Read the code or the published package.
