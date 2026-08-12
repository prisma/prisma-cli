# S7 — Release pipeline + rc1 (slice contract, revision 1 — STOPs open)

Status: contract drafted, all implementation awaiting operator rulings on
STOP-1 … STOP-9. Nothing is built.
Precedence: this contract > `specs/s2-overview.md` standing rulings > source.
Unpinned facts are STOP-and-surface.

Repo: prisma-cli. Branch: `claude/s7-release-pipeline-rc1-92c89d`, base `main`.

Mandate (project plan §S7, spec.md FR10, project DoD): the `prisma` binary
package assembled — full grammar tree mounted behind a build-time
completeness check, committed-versions release automation (R11), and a
pipeline that emits a publishable `prisma@8.0.0-rc1` artifact which the
operator publishes with one action.

## 1. The grounding example

Today, a user who wants the unified CLI cannot get it:

```text
$ npm install -g prisma@8.0.0-rc.1
npm error notarget No matching version found for prisma@8.0.0-rc.1
# `prisma` on npm is the v7 train, published by prisma/prisma.

$ npm install -g @prisma/cli@latest && prisma-cli migrate
# latest is 3.0.0-beta.30 — the pre-v8 platform CLI. No ORM commands.
# Nothing 8.x has ever published from this repo: the workspace says
# 8.0.0-rc.1, npm's newest @prisma/cli-engine is 0.0.9.
```

And even at HEAD, the assembled tree is not assembled: `@prisma/cli`'s one
declared bin is `prisma-cli` → `dist/cli.js`, the legacy commander shell.
The v8 tree builds to `dist/v8/cli.js`, undeclared in `bin`, and mounts
platform + composer only. The ORM family — 21 commands, published today in
`@prisma/orm-toolchain@8.0.0-rc.1-dev.40` under the `./cli` subpath — is
mounted nowhere. `prisma migrate`, `prisma db verify`, `prisma init` do not
exist in any binary this repo ships.

After this slice: a tagged release commit produces, in CI, a verified
`prisma-8.0.0-rc.1.tgz` whose bin is `prisma`, whose tree answers every
platform, composer, and ORM command, whose product pins agree on one
engine, and which installs and starts on plain Node outside the workspace.
The operator performs one deliberate action to release it.

## 2. What exists today (the facts the deliverables build on)

- **The mount and its check.** `packages/cli/src/v8/cli.ts` exports
  `platformCommandFamily`, `composerCommandFamily`, `cliGroups`,
  `mountedCommands`, and `buildCli()`. `packages/cli/tests/
  v8-mount-coverage.test.ts` already asserts both completeness directions —
  every family command mounted, every mounted command family-owned — with a
  deliberate `FAMILYLESS` exception set (the engine's three `telemetry`
  commands, `agent install|update|status`, `feedback`) and an explicit
  expected-paths list. It runs in the test suite only; the publish path
  runs `pnpm build` + `pnpm test:scripts` and would ship a tree this test
  has never seen.
- **The ORM family is importable now.** `@prisma/orm-toolchain@
  8.0.0-rc.1-dev.40` (dist-tag `dev`, published 2026-08-12) exports
  `ormCommandFamily` and `ormConfigSection` from `./cli`. The family
  carries `configSection`, `docsBaseUrl`, and the verb/flag `redirects`
  (R-S5-23), and keys its 21 commands by full mount path (`"contract
  emit"`, `"db update"`, `"migration status"`, `init`, `format`, `migrate`,
  `lsp`, `ref set|list|delete`, …). Its `dependencies` pin
  `@prisma/cli-engine: "0.0.9"`. Note the tag: nothing on the rc line of
  orm-toolchain is published as `latest` yet.
- **Import weight.** orm-toolchain's `dist/cli.mjs` statically imports
  `esbuild`, `arktype`, and eight `@prisma/orm-framework` subpaths.
  Mounting the family pays that import on every shell invocation,
  including `prisma --version`. Composer's family was built to keep its
  heavy graph behind dynamic executor imports; the ORM family was not.
  Recorded here as a known cost and a candidate upstream fix, not a
  blocker (STOP-9 lists it for the operator's awareness).
- **The versioning model is settled and tagless.** `docs/oss/versioning.md`
  (ported from prisma/prisma by ruling 2026-08-10): the root
  `package.json` `version` is the single source of truth; `pnpm
  bump-version` writes lockstep; a push to `main` that changes the root
  version publishes `latest`; **merging the bump PR is the deliberate act
  that moves `latest`**; `workflow_dispatch` re-publishes or dry-runs. The
  GitHub Release (and its `v8.0.0-rc.N` tag) is created BY the publish
  run, after npm. `publish.yml` even excludes tag pushes (`tags:
  ["!**"]`). There is no tag-triggered path anywhere, by design.
- **The engine pins disagree, knowably.** The shell ships the workspace
  engine at `8.0.0-rc.1` (unpublished); `@prisma/composer@0.6.0-dev.16`
  and `@prisma/orm-toolchain@…dev.40` both pin `0.0.9`. `deferred.md`
  rules matching pins "a release requirement for the tandem release" and
  the two-copy install "a preview-only state to end". rc1 is precisely the
  release that requirement was written for.
- **S6 is specified, partially built, unmerged.** PR #161 carries
  `specs/s6-conformance.md` (rev 3): checks 1–2 built on that branch;
  check 3 (tarball verification: 3a declared-deps-vs-built-output, 3b
  out-of-workspace npm install with computed `file:` overrides and
  `--ignore-scripts`, bins start on plain Node, 3c cross-repo engine-pin
  agreement + single-engine-copy resolution) is fully designed but awaits
  the operator's STOP-1…STOP-9 rulings there. Its 3b IS the "S5-era
  smoke" this slice's mandate names; its 3c IS the pin verification R11
  needs. S6's own STOP-4 and STOP-6 explicitly defer to S7 for publish-
  list changes and for the `prisma` bin appearing in the packed bin map.
- **The `prisma` npm name is not ours yet.** Rollout plan step 4: the name
  frees only when the ORM team ships `prisma7`; then this repo configures
  OIDC trusted publishing for `prisma` and publishes `8.0.0-rc1` under a
  pre-release dist-tag. That timing is an open item the operator owns.
  `prisma-next` handoff (step 3) is likewise an operator-owned cross-repo
  cutover.
- **S8 is changing the tree this slice checks.** PR #162
  (`s8-service-primitives`) adds `service create|list|delete`, the
  `service deployment` subgroup, and the lifecycle verbs — all inside the
  platform family, so the completeness check keeps passing across that
  merge in either order; only the expected-paths list and `cliGroups`
  entries collide textually. Coordination is STOP-6.

## 3. Deliverables

**D1 — Mount the ORM family.** `packages/cli` gains a `dependencies` entry
on `@prisma/orm-toolchain` at an exact version (R-S5-28 direction; interim
version per STOP-7). `cli.ts` imports `ormCommandFamily` from
`@prisma/orm-toolchain/cli`, adds it to `commandFamilies`, spreads its 21
commands into `mountedCommands` at the family's own paths, and adds the
`contract`, `db`, `migration`, `ref` group briefs to `cliGroups`. The
family's config section and redirects ride in via the family object; no
per-command wiring. Semantic tests through `createTestCli`: one ORM
command end to end in the shell (`prisma migration list` against a
fixture project is the candidate), redirect resolution (`prisma migration
apply` → typed redirect), section validation reachable, and `--help`
naming all four new groups. No `vi.mock`.

**D2 — The completeness check fails the build.** Extend
`v8-mount-coverage.test.ts` with the ORM family in `MOUNTED_FAMILIES` and
the 21 new expected paths. Promote the check out of "just a test the
publish never runs": a `check:grammar` invocation (the same test file run
via vitest, not a parallel implementation) wired as a turbo task with
`dependsOn: ["^build"]`, run by `pr-quality.yml` AND by `publish.yml`
before any publish step, under the same `publish == 'true'` condition its
neighbours carry. The exception set is ratified, not grown: STOP-4 puts
the current `FAMILYLESS` list in front of the operator; adding to it after
this slice requires a ruling recorded in the file.

**D3 — The `prisma` package.** Shape per STOP-3 (recommendation: a new
thin workspace package `packages/prisma`, name `prisma`, lockstep
version, `bin: { prisma: "./dist/prisma.js" }`, whose bin is built from a
three-line entry importing the same `main()` the v8 bin runs;
`@prisma/cli` simultaneously declares the v8 entry as a second bin so the
facade and the real package cannot drift). It joins the lockstep set in
`scripts/set-version.ts`, `pnpm bump-version`, and the publish order
(engine → cli → prisma). Its README states what it is; `files` carries
`dist` only.

**D4 — Committed-versions release automation (R11).** All product pins in
committed manifests, bumped only in PRs: `@prisma/orm-toolchain` and
`@prisma/composer` exact-pinned in `packages/cli/package.json`;
`@prisma/cli-engine` stays `workspace:<version>` (pnpm rewrites to exact
at pack). No publish-time resolution anywhere — `determine-version.ts`
already refuses to invent versions; this deliverable adds nothing dynamic.
Pin agreement (shell engine version == every mounted family's engine pin)
is verified by S6's 3c, wired per STOP-5 — S7 does not write a second pin
checker.

**D5 — The pipeline: tag → verified artifact → one action.** Per STOP-1's
ruling on trigger shape. Written against the recommendation (STOP-1a):
`publish.yml` gains an artifact-emission stage — after `pnpm build` and
the grammar check, it packs engine, cli, and prisma tarballs with `pnpm
pack`, runs the tarball smoke (S6 check 3b mechanics: out-of-workspace
install with computed absolute `file:` overrides, `--ignore-scripts`,
every declared bin — now including `prisma` — starts on plain Node, exit
0, under a timeout), uploads the three tarballs as workflow artifacts,
and attaches them to the GitHub Release it already creates. The `prisma`
tarball is emitted and verified on every release run; its npm publish
step is guarded until the name is ours (STOP-8). The operator's one
action for rc1 stays what versioning.md already rules: merge the
`chore(release)` bump PR. Everything after that push — build, grammar
check, smoke, npm publishes, Release + tag, artifact upload — is the
pipeline. Dry-run dispatch exercises all of it minus registry writes.

**D6 — Docs and records.** `docs/oss/versioning.md` gains the `prisma`
package and the artifact stage; `rollout-plan.md` step 4 updated to point
at the built pipeline; `plan.md` §S7 marked with what shipped;
`deferred.md` updated where this slice closes or supersedes entries (the
two-copy engine install entry closes when STOP-7's convergence lands).
Divergence file: mounting previously-unreachable commands is not a
divergence from a shipping CLI, but `assets/s2/parity-divergences-s7.md`
records anything user-visible this slice changes in already-shipped
surfaces (expected: none; the file says so explicitly if so).

## 4. Open questions (STOP)

**STOP-1 — the release trigger's exact shape.** The mandate says "from a
tagged commit, CI emits a publishable prisma@8.0.0-rc1 artifact"; the
ruled versioning model is deliberately tagless-in, tag-out (the pipeline
CREATES `v8.0.0-rc.N` after publishing; nothing triggers ON tags).
Options: **(a) keep the ruled model** — the "tagged commit" is the release
commit the pipeline tags; the artifact is emitted by the same run that
tags it; the operator's one action remains merging the bump PR —
recommended, zero new trigger surface, no second way to publish;
(b) a literal tag-push trigger — overturns a 2026-08-10 ruling and
versioning.md's explicit rejection of tag triggers, creates a path where
a pushed tag ships code no bump PR reviewed; (c) dispatch-only artifact
emission from an existing tag. I will not build (b) or (c) without your
ruling; the mandate lists this escalation by name.

**STOP-2 — what exactly is rc1's "one action", given the name isn't
free?** The DoD says the operator publishes rc1 with one action, and the
`prisma` name is blocked on `prisma7` (rollout step 4, ORM team's
timing). Options: **(a)** the one action is merging the bump PR; the run
publishes `@prisma/cli`/`@prisma/cli-engine`/(`prisma` if unblocked) and
always emits + verifies the `prisma` tarball, so when the name frees, the
already-verified artifact publishes via one `workflow_dispatch`
(`dist-tag` input, existing path) — the DoD is met with "one action now,
one deferred action gated on an external team"; (b) hold rc1 entirely
until the name frees so one merge does everything; (c) publish the
unified CLI as `prisma-next` first (rollout step 3's handoff) and let
`prisma` follow. This is sequencing you own; the pipeline I build is the
same in all three.

**STOP-3 — the `prisma` package's shape.** Options: **(a) thin facade**:
`packages/prisma` depends on `@prisma/cli` (exact workspace pin), its bin
imports the v8 entry through a new `"./v8-bin"` export on `@prisma/cli`;
one real implementation, two names, tarball stays kilobytes, and
`@prisma/cli` keeps publishing the rc line unchanged until cutover —
recommended; (b) move the real package to `packages/prisma` and make
`@prisma/cli` the facade — end-state-pure but breaks today: the facade
would depend on an unpublishable name until `prisma7` ships, making
`@prisma/cli` uninstallable; (c) publish the identical content under two
names — two 5-MB tarballs to keep byte-identical, no. Also under this
STOP: (a) leaves the legacy commander `dist/cli.js` inside `@prisma/cli`'s
tarball (S2d unfinished business, not S7's), and the `prisma` bin exposes
only the v8 tree. Confirm that interim is acceptable.

**STOP-4 — ratify the grammar-tree exception list.** The check's
exceptions today: the engine's three `telemetry` commands (engine-owned
consent surface, mounted whole), `agent install|update|status` and
`feedback` (local utilities: no config section, no API, defined in
packages/cli). Everything else must be family-owned, both directions, or
the build fails. The mandate says any exception escalates: these four-
plus-telemetry ARE the list — ratify it, name additions you want, or
rule utilities into the platform family (they'd gain its docs base;
otherwise no behavior change either way).

**STOP-5 — S6 wiring without duplication.** The mandate says wire the
conformance checker in, not duplicate it — but #161's checks 1–2 live
unmerged on its branch and check 3 awaits your S6 rulings. Options:
**(a)** rule S6's STOPs, its implementation lands on main first, S7
consumes `pnpm conformance` in the publish path and adds only the
`prisma` tarball to its subject list — cleanest, serializes S7 behind
S6; (b) S7 lands first with D5's smoke implemented inline in publish.yml
(the one S6 mechanism rc1 cannot ship without), S6 later absorbs it into
check 3b — duplicates ~40 lines temporarily, keeps the slices parallel;
(c) S7 cherry-picks S6's built checks onto its branch — two open PRs
sharing unmerged code, no. If you rule (b), the inline smoke is written
to S6's spec (same override computation, same `--ignore-scripts` stance)
so absorption is a move, not a rewrite.

**STOP-6 — S8 tree interaction.** #162 adds platform-family commands, so
the completeness check is order-independent with S7 — but
`EXPECTED_MOUNT_PATHS`, `cliGroups`, and `v8/cli.ts` imports collide
textually in both orders. Preference? (a) S7 lands first, #162 rebases
(its adds are mechanical); (b) #162 first, S7 rebases (same cost,
S7 is the one branch currently unmerged everywhere). Either is fine;
the mandate tells me not to decide interactions with S8's tree alone.

**STOP-7 — engine-pin convergence choreography for rc1.** For rc1's
install to resolve ONE engine, before the rc1 bump PR merges:
prisma-cli publishes engine `8.0.0-rc.N` (the existing lockstep publish
does this — note it publishes `@prisma/cli` in the same run, which is
fine: rc respins are cheap and `latest` moving is your merge); then
orm-toolchain and composer bump their `@prisma/cli-engine` pins to that
exact version and publish; then prisma-cli's bump PR pins those exact
product versions and rc1 ships with agreeing pins, S6-3c green with an
empty exception list. Two of those three moves are in repos this slice
does not own. Confirm: (i) you own/sequence the orm-toolchain and
composer pin-bump publishes (same model as the S3 tandem glue), (ii)
until then, S7 development pins `@prisma/orm-toolchain@8.0.0-rc.1-dev.40`
(a `dev`-tag version — acceptable for a committed interim pin, or do you
want an rc-line orm-toolchain published first?), and (iii) the S6-3c
exception list carries the interim triple, dated, as S6's STOP-3a
designed.

**STOP-8 — publish credentials for the `prisma` name.** Configuring npm
OIDC trusted publishing for `prisma` is registry-side and yours alone; no
workflow change I make can or should grant CI the ability to publish that
name (the mandate lists this escalation). The pipeline therefore guards
the `prisma` publish step behind an explicit condition — proposal: a
`publish-prisma` workflow_dispatch input defaulting to false, flipped by
you once the trusted-publisher config exists — and until then every run
still packs and verifies the `prisma` tarball so the publishable artifact
exists from day one. Confirm the guard shape.

**STOP-9 — acknowledged, not asked.** (i) `prisma-next` handoff (rollout
step 3) stays out of S7 unless you say otherwise. (ii) The ORM family's
static `esbuild`/`arktype` import cost on every shell start is real,
measured at the import graph, and belongs to prisma/prisma to fix
(dynamic handler imports like composer's); recorded in deferred.md by
this slice. (iii) rc1 ships with the legacy commander tree still in
`@prisma/cli`'s tarball; its deletion is S2d, which remains open on the
plan.

## 5. Acceptance

Written against STOP-1(a), STOP-2(a), STOP-3(a), STOP-4 as listed,
STOP-5(a), STOP-7 confirmed. Rewritten if you rule otherwise.

- [ ] `prisma migration list`, `prisma db verify --help`, `prisma init
      --help`, `prisma migrate --help` answer from the assembled tree;
      one ORM command proven end to end through `createTestCli`; the
      family's redirects and config section reachable through the shell.
- [ ] The completeness check covers platform + composer + ORM families
      both directions, fails the build on a seeded omission in either
      direction (test proves it), runs in `pr-quality.yml` and in
      `publish.yml` before any publish step, and its exception list is
      exactly the ratified one.
- [ ] The `prisma` package exists, lockstep-versioned, bin `prisma` →
      the v8 tree; `pnpm bump-version` and `set-version.ts` cover it;
      publish order engine → cli → prisma.
- [ ] All product pins exact and committed; no publish-time version
      resolution; S6-3c green (modulo the dated interim exception) in
      the publish path.
- [ ] A release run (dry-run dispatch proves it end to end without
      registry writes) produces: build → grammar check → conformance →
      pack (3 tarballs) → out-of-workspace install smoke (every bin
      starts on plain Node, exit 0) → publish steps → GitHub Release
      with tarballs attached. The `prisma` publish step is guarded per
      STOP-8; the artifact is emitted and verified regardless.
- [ ] The operator's release action is exactly one: merging the
      `chore(release): 8.0.0-rc.N` PR. Nothing between that merge and
      the published artifacts requires a human.
- [ ] `pnpm typecheck`, root `pnpm lint`, touched suites green, measured
      as pnpm's own exit codes.

## 6. Out of scope

S2d (commander retirement in this repo); the `prisma-next` npm handoff;
`prisma7` (ORM team); flipping `prisma`'s `latest` (cutover, rollout step
5); S8's service tree (#162); fixing the ORM family's static import
weight (prisma/prisma); S6's checks 1–3 themselves (consumed, not built,
under STOP-5a).
