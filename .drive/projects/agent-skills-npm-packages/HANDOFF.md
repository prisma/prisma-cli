# Handoff brief — agent-skills-npm-packages (2026-08-21, session halt)

You are picking up a drive-process project mid-delivery. Read, in order:
`design-notes.md` (brief v2 — the authoritative design; its "Decisions
already made" section is binding), `plan.md` (slices + cross-slice
contract, amended: the version stamp lives under the Agent Skills spec's
`metadata` map as `metadata.library` / `metadata.library_version`,
string values), `reviews/code-review.md` (full findings log),
`deferred.md`, `learnings.md`. Slice contracts are under `slices/*/spec.md`.

## State by slice

**Slice 4 — prisma/composer: DONE.** PR
https://github.com/prisma/composer/pull/251, approved, squash auto-merge
armed pending its Test job + CodeRabbit. Reviewer SATISFIED. Constraint:
its npm RELEASE (not the merge) must follow the prisma-cli CLI shipping,
and the website hero repoint was deliberately reverted (deferred.md).

**Slice 2 — prisma-cli (this repo, this branch): 95% done.** Draft PR
https://github.com/prisma/prisma-cli/pull/219. Three review rounds done;
the last commit (2c976bf) contains the round-4 fixes for S2-R3-1
(dead branch + wrong comment in `packages/cli/src/commands/project/errors.ts`)
and S2-R3-2 (e2e test name in `packages/cli/e2e/declared-bin.e2e.ts`).
The commit message says "suites not re-run" — that turned out to be
wrong: the implementer HAD run them before the halt-commit landed (full
packages/cli 1040/1041, the e2e vs a fresh build 2/2, tsc clean,
isolated biome clean), so the branch is gate-green. The commit also
mixes drive artifacts with the two source fixes (halt-time sweep) — a
picky reviewer may want it split. Next: reviewer verification round
(round 4), mark PR ready. Reviewer's residuals are already in the PR
body.

**Slice 1 — prisma/prisma packaging: rework done, awaiting reviewer
verification.** Branch `skills-in-tarball-packaging` on origin, head
900db17 ("Prove the skill ships by reading it out of the tarball") —
fixes S1-R1-1 with a real `pnpm pack` per target package, reading the
stamped SKILL.md back out of the tarball, byte-comparing against the
tracked tree, mutation-checked (dropping `files` entry or `prepack`
fails). Gate green (publish-surface 66/66, typecheck, lint,
clean-tree). Next: reviewer verification round, then open its PR
(base main).

**Slice 3 — prisma/prisma init wiring: rework done, awaiting reviewer
verification.** Branch `init-skills-wiring` on origin, head 26df6a2
("Install the package that carries the prisma binary"), stacked on the
amended slice 1. Fixes S3-R1-1: init's CLI dev dep is now `prisma@next`
(the same shell under the `prisma` bin — verified `packages/prisma` just
re-exports `@prisma/cli`'s bin), and every string init writes or runs
followed: engine-version probe, emit spawn, `contract:emit` script,
next-actions, scaffold quick-reference, sync invocation
(`dlx prisma@next skills sync`), sync advice (`pnpm exec prisma skills
sync` per manager), postinstall unchanged. Integration test asserts one
binary end to end. Gate green (1443 CLI tests, integration 6/6, all
checks). Two implementer judgement calls awaiting orchestrator/operator
confirmation: (1) no migration entry for existing projects (they keep
`@prisma/cli` + `prisma-cli` scripts, which still work) — product call;
(2) the repo-wide `prisma-cli`→`prisma` string rename in prisma/prisma
(~10 `fix:` strings, root README) was deliberately NOT done — needs its
own owner. Next: reviewer verification round, then PR (base = slice-1
branch).

**No PRs exist yet for slices 1 and 3.** Open them when SATISFIED:
slice 1 → prisma/prisma base `main`; slice 3 → base
`skills-in-tarball-packaging` (retarget to main after slice 1 merges).

## Merge order (binding)

prisma-cli #219 first, then prisma/prisma slice 1, then slice 3;
composer #251 may merge anytime but its release follows the CLI.

## Environment / conventions

- Worktree: this directory. Reference clones live in `.refs/prisma` and
  `.refs/composer` (git-excluded via `.git/info/exclude`; do NOT move or
  delete them — an agent parking them in /tmp cost us an afternoon; root
  `pnpm lint` aborts on their nested biome configs, so lint
  `packages/cli/{src,tests}` from an isolated copy instead).
- Commits: small, intent-driven,
  `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`
  (bot author identity comes from the shell env). Push via the repos'
  origin remotes (github-wmadden-electric alias in the clones); `gh`
  acts as the wmadden-electric bot.
- Drive process: orchestrator delegates implementation to Opus
  subagents, one persistent implementer per repo, one persistent
  reviewer (read-only, appends to `reviews/code-review.md`), findings
  must be fixable in-PR, verdict per round. Operator = Will; he has
  ruled: CLI_NAME → `prisma` repo-wide (done, slice 2), pushes are
  allowed, composer #251 merge delegated.
- The security invariant is permanent: sync installs skills only from
  the hardcoded allowlist; never scan node_modules; no discovery mode.

## Open operator-facing items (deferred.md has details)

Retire/re-scope the `prisma agent` group (overlaps `skills`); composer
website hero copy; turbo `dependsOn` race; `check-skill-packaging.mjs`
hardcodes one package; `isLikelyGlobalNpmEntrypoint` matches only
`prisma-cli` paths; feedback user-agent now `prisma/<version>` — flag to
that dashboard's owner.

## Close-out (after all four slices merge)

Per drive process: closing health check, final retro with the operator,
migrate long-lived docs, strip references, delete
`.drive/projects/agent-skills-npm-packages/`.
