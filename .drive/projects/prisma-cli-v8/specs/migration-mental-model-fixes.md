# Brief: teach the migration mental model, and refuse the silent greenfield plan

Status: rulings settled with Will Madden 2026-08-25; execution deferred. Repo: prisma/prisma. Written to be executable by an agent with no prior context.

## Background

A field report against `orm-toolchain@8.0.0-rc.4` found that in a project with migrations on disk but no `db` ref, `migration plan` silently produces a from-scratch plan (a full-create migration) instead of an incremental one, and the mistake only surfaces when the plan is applied. Investigation against current main (rc.6) established the system is working as designed and the defect is in *use*, not design. The settled model, from `docs/architecture docs/subsystems/7. Migration System.md`, ADR 218, and `docs/design/10-domains/migration/README.md`:

- The migration graph is a static artifact: each migration is an edge recording `from`/`to` contract storage hashes; the graph may have multiple branch tips and may be cyclic; no node is privileged.
- Refs are version-controlled pointer files (`migrations/<space>/refs/<name>.json`). The `db` ref records which contract hash the project's dev database has been brought to; environment refs are "the contract CD will migrate to". `db` is a default name, not a magic one (ADR 218).
- `migration plan` resolves its origin as: explicit `--from`, else the `db` ref, else greenfield (from null). It is deliberately offline (never consults a database). On an empty graph with a ref origin, it auto-emits a baseline bundle.
- `db init`/`db update` implicitly advance the `db` ref on the default URL; `migrate` advances a ref only with explicit `--advance-ref` (ADR-recorded: deploy/CI applies must not infer dev intent). Composer deploys write the database marker but structurally cannot and do not touch repo refs.
- The trap arises in one workflow: a project that never runs `db init`/`db update` (the Composer-first path, where the emulator/platform database is managed by the deploy pipeline) never acquires a `db` ref, so every default plan resolves to greenfield. The first time that is correct (the baseline); every later time it is the trap. The repo's own `gotchas.md` (~line 57) documents this exact case.

The primary failing party in the field was an AI agent with a wrong mental model (linear chains, privileged tips). The fix is education through the channels built for it — the auto-installed agent skill, and structured errors — plus a refusal backstop.

## Ruled work (execute later)

### 1. Primary: rewrite the `prisma-8` skill's migration teaching

In prisma/prisma's `skills/prisma-8/` (shipped in the ORM facade tarballs, auto-installed into projects by `prisma init`, stamped by the repo's set-version tooling). The migration section must teach:

- The graph as a static artifact — edges with from/to hashes, no privileged tip, branch tips and cycles legal.
- Refs: what they are, where they live, that they are committed; `db`'s meaning (dev-database checkpoint) versus environment refs (CD promises); `migration ref set|list|delete`; implicit advancement by `db init`/`db update`, explicit `migrate --advance-ref`.
- `migration plan`'s origin resolution (`--from` → `db` ref → greenfield), its offline nature, and the auto-baseline behavior on an empty graph.
- Both authoring loops: the dev loop (`db init`/`db update` keep `db` current, plan chains from it), and the Composer-first loop (`contract emit` → `migration plan` for the baseline → `migration ref set db <baseline hash>` or `--from` chaining for every later plan → deploy; deploys replay the marker to the emitted contract and never touch refs).
- The adoption recipe for pre-existing databases: `contract infer` → `db sign`.
- The trap, named explicitly: a plan whose origin resolved to greenfield while migrations exist on disk is almost always a mistake; how to recognize it (`from: (baseline)` in the output) and the three exits (set a ref, pass `--from`, or genuinely intend from-scratch).

Follow the skill's existing authoring conventions and reference-file structure; the version stamp is handled by the repo's tooling, do not hand-edit it.

### 2. Backstop: `migration plan` refuses silent greenfield over a non-empty graph

Ruled: refuse, not warn. In `packages/1-framework/3-tooling/cli/src/control-api/operations/plan-resolution.ts` (~lines 195-199), when origin resolution falls through to greenfield AND the target space's graph is non-empty, refuse with a structured error (new `MIGRATION.*` code following the family's conventions) whose next-actions name the three exits: set the `db` ref (or another ref) to the intended origin, pass `--from <contract>`, or pass an explicit from-scratch flag (spelling per repo flag conventions) to proceed deliberately. The empty-graph case is untouched — first-plan greenfield remains legitimate and silent. Tests: the currently-unpinned case (no ref + non-empty graph) refuses; the explicit flag proceeds; empty-graph greenfield still silent; existing `plan-resolution.test.ts` and e2e journeys stay green. Update `gotchas.md`'s entry (~57-78) to record the resolution, and check `ROADMAP.md` (~259, TML-3097-adjacent) for whether the refusal closes or narrows the tracked data-loss item.

### 3. Docs: fix the stale ref-advancement description and sweep for others

`docs/design/10-domains/migration/README.md` (~line 80) says `db update` "does not advance a ref" — contradicts ADR 218 §3, the subsystem doc (~716-720), and `ref-advancement.ts`. Fix it, then sweep the design docs (`docs/design/10-domains/migration/`, `user-journeys.md`) for other descriptions that contradict ADR 218 + code, treating ADR + code as current. Do not touch the `migration plan --help` text — reviewed with the operator and ruled correct as written ("the latest on-disk migration state" means the ref, which is on-disk state).

## Explicitly out of scope (assigned elsewhere)

- `migration plan --advance <ref>` (TML-2560) and any help-text wording tweaks: parallel ergonomics, handed to another agent by the operator. Do not implement here.

## Execution notes

- Working clones exist in the prisma-cli worktree at `.refs/prisma-main` (prisma/prisma at rc.6 main), with two prepared git worktrees: `.refs/pp-wt-skill` (branch `skill-migration-mental-model`) and `.refs/pp-wt-backstop` (branch `plan-greenfield-backstop`), both off origin/main. Item 1 goes on the skill branch; items 2+3 on the backstop branch. Two PRs.
- Repo conventions: commits `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`; never the words "load-bearing", "smoking gun", "belt and suspenders", "gate", "repin" in anything authored; no hard-wrapped prose in docs.
