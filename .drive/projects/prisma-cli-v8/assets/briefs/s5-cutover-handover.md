# S5 cutover handover — retire prisma/prisma's own CLI shell

Written 2026-08-12 for an agent with NO prior context. The operator is Will Madden. All disk paths are absolute paths on the operator's machine. The drive project directory lives in the prisma-cli repo; clone or use the checkout at `/Users/wmadden/Projects/prisma/prisma-cli`.

## 1. Context

The prisma-cli-v8 project builds one unified `prisma` CLI on `@prisma/cli-engine`, replacing three CLIs (`@prisma/cli` 3.x platform, `prisma-composer`, `prisma-next` ORM). State as of 2026-08-12: the unified binary shipped (prisma-cli PR #164) and `@prisma/cli@8.0.0-rc.1` is published on npm under the `next` dist-tag — it mounts the platform, composer, and ORM command families, the ORM family arriving via `@prisma/orm-toolchain@8.0.0-rc.1-dev.40`, which is built from prisma/prisma's `packages/1-framework/3-tooling/cli` sources.

What never landed is the S5 slice's tail in **prisma/prisma**: its own CLI package (`@internal/cli`, bin `prisma-next`) still runs the OLD shell. `packages/1-framework/3-tooling/cli/src/cli.ts` is the commander shell, `src/migration-cli.ts` is the clipanion migration CLI, and `package.json` still depends on `commander ^15` and `clipanion 4.0.0-rc.4` — while the ported engine-based commands sit finished next to them in `src/orm/`. The rollout plan rules "prisma/prisma retires its own CLI at S5". That retirement is your job.

## 2. The mandate

1. **Land the two open port PRs first** — both are `CONFLICTING` against main and block the cutover:
   - https://github.com/prisma/prisma/pull/29984 — "db verify, db sign and migration check exit 4 on findings, 2 on errors". Approved; rebase, keep it green, merge.
   - https://github.com/prisma/prisma/pull/29985 — "Port lsp onto the engine by giving the language server an injectable transport". Needs review; rebase, get it reviewed, merge.
2. **The cutover PR**: rewire `@internal/cli`'s `prisma-next` bin from the commander shell to the engine tree (the `src/orm/` family mounted on `@prisma/cli-engine`), delete `src/cli.ts`'s commander shell and `src/migration-cli.ts`'s clipanion CLI, and remove the `commander` and `clipanion` dependencies. Whatever the old shells provided that the engine tree does not is a parity divergence to enumerate, not silently drop.
3. **Do not break the publish surface.** `@prisma/orm-toolchain` publishes from these sources and the unified CLI pins it exactly. Find the publish mechanism (search prisma/prisma for how `@internal/cli` becomes `@prisma/orm-toolchain` — likely `@internal/publish-surface`), and prove the family export (`./cli` subpath: `ormCommandFamily`, `ormConfigSection`) survives your deletion.
4. **Record divergences** in a new file `/Users/wmadden/Projects/prisma/prisma-cli/.drive/projects/prisma-cli-v8/assets/s2/parity-divergences-s5-cutover.md` (same entry format as the sibling files in that directory).

## 3. Explicitly NOT yours

- The `prisma-next` npm name handoff (trusted-publisher config moving to prisma-cli) — operator-owned, rollout plan step 3.
- Publishing anything to npm. Never.
- Engine changes (`packages/cli-engine` in prisma-cli). A gap in the engine is a STOP-and-surface with a recommendation, never an improvised change.
- Engine-pin convergence (orm-toolchain pins `@prisma/cli-engine@0.0.9`; the workspace ships `8.0.0-rc.1`). Deferred by operator ruling 2026-08-12 until the pins converge at release time — do not bump pins unless the operator says so.

## 4. Where the documents live

Drive project directory (canonical, in the prisma-cli repo): `/Users/wmadden/Projects/prisma/prisma-cli/.drive/projects/prisma-cli-v8/`

Read in this order:

1. `plan.md` in that directory — project frame, slice list, dependency graph, coverage ledger. §S5 and §S7.
2. `spec.md` — project requirements and DoD. FR6 (parity bar), FR7 (product integration), the non-goals.
3. `specs/s2-overview.md` — the standing rulings that bind every slice.
4. `assets/rollout-plan.md` — the npm rollout: names, dist-tags (RC line publishes under `next`, ruling 2026-08-12), the handoff steps.
5. `assets/briefs/s5-orm-handover.md` — the brief the original S5 agent worked from: scope, reading order, mechanics. Still the best statement of S5's intent.
6. `assets/briefs/1b-leftovers-prisma-prisma.md` — the older prisma/prisma leftovers brief S5 was meant to close out.
7. `deferred.md` — everything carried between slices, including the pin-convergence entry and the two flaky-test entries.
8. `specs/s7-release.md` — the S7 contract; its §2 records what the ORM family exports and how the unified CLI consumes it.
9. Engine design docs in `assets/engine/`: `engine-interface-draft.ts` (the normative interface with commentary) and `credential-manager-design.md` (the auth model). The ORM commands are mostly local; where one needs platform auth it declares `needs.credentials` and uses `ctx.api`, nothing else.

**A warning about the S5 contract:** no `specs/s5-orm.md` exists — not in this directory, not in prisma/prisma. The S5 requirement numbers you will meet in citations (R-S5-23 redirects, R-S5-28 pinning) survive only in other documents' references. The real record of what S5 built is the merged PR descriptions and the code. Verify claims against source; do not trust a requirement number you cannot ground.

prisma/prisma side: the repo has its own drive methodology docs under `drive/` at the repo root (process roles, DoD/DoR calibration) — read `drive/README.md` if you use the drive process there. ADRs live under `docs/architecture docs/adrs/`; ADR 239 (as amended by S4, 2026-08-11: findings as diagnostics in completed envelopes, typed nextActions) and ADR 245 govern the error/result conventions your cutover must preserve.

Merged S5-era PRs worth reading for shape (all prisma/prisma): #29970 (foundations + first command), #29973, #29980, #29981, #29982, #29983, #29986, #29987 (the ports), #29957/#29958 (the S4 ADR amendments).

## 5. Process rules (operator-enforced, non-negotiable)

- Git identity is the `wmadden-electric` bot. Stage explicitly by path (never `git add -A`; never anything under `wip/`). Commit: `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, body ending `Co-Authored-By:` line naming your model. Push only to `git@github-wmadden-electric:prisma/prisma.git` remotes. Never force-push a pushed branch — if a rebase would require it, rebuild the branch as remote tip + merge, or cut a fresh branch.
- The bot has push access to prisma/prisma (dozens of merged PRs prove it).
- Tests before implementation. No `vi.mock`/`vi.doMock`. pnpm only.
- Working files go under `wip/` inside the worktree, never `/tmp`.
- Verification per dispatch: the touched packages' suites, `pnpm typecheck`, repo lint — measured as the tool's own exit codes.
- PR descriptions: grounding example first (a real command run, before/after), then the decision, then the narrative, alternatives last. No internal process codes.
- Address every CodeRabbit thread — fix or decline with verified evidence — reply and resolve each before merging.
- Reports to the operator: plain English, short, full sentences. No invented jargon. Banned words: "load-bearing", "smoking gun", "belt and suspenders", "gate". Bring questions to decide, not decisions to ratify. Never use the question UI. Point at files with absolute disk paths and branch-qualified GitHub URLs.
- A merged PR is the deliverable. Do not end a dispatch with finished work sitting unpushed.

## 6. Your first report

Confirm you read the documents in §4; state the rebase status of #29984 and #29985 and what their conflicts touch; state where `@prisma/orm-toolchain`'s publish mechanism lives and what your cutover must preserve; name anything in the old shells (commander help output, migration-cli interactivity, exit codes) you believe has no equivalent on the engine tree — each is either a divergence entry or a STOP. Then your dispatch plan.
