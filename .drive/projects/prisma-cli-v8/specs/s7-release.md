# S7 — Release pipeline + rc1 (slice contract, revision 2 — STOPs open)

Status: revision 2 applies the operator's ruling (2026-08-12): **rc1
publishes under the existing names** — `@prisma/cli` with its existing
`prisma-cli` bin — and the cutover to the bare `prisma` npm name is a
follow-up piece of work, recorded in `deferred.md`, not this slice.
Former STOP-2 (what rc1's one action is, given the name), STOP-3 (the
`prisma` package's shape) and STOP-8 (`prisma` publish credentials) are
closed by that ruling and their sections record the disposition.
Second ruling (operator, 2026-08-12): **the slice's goal is combining
all available commands into one binary**; the bare-`prisma` cutover is a
following step, and so is reconciling the missing/discrepancy commands
behind the grammar exception list — STOP-4 closes with the current
exception set standing as-is. D1 and D2 are unblocked and in
implementation. STOP-1 and STOP-5…7 remain open for the release-side
deliverables; D1/D2 proceed on the recorded working defaults.
Precedence: this contract > `specs/s2-overview.md` standing rulings > source.
Unpinned facts are STOP-and-surface.

Repo: prisma-cli. Branch: `claude/s7-release-pipeline-rc1-92c89d`, base `main`.

Mandate (project plan §S7, spec.md FR10, project DoD): the unified binary
package assembled — full grammar tree mounted behind a build-time
completeness check, committed-versions release automation (R11), and a
pipeline that emits a publishable rc1 artifact which the operator
publishes with one action. Under the 2026-08-12 ruling the rc1 artifact
is `@prisma/cli@8.0.0-rc.N` (bin `prisma-cli`, the v8 tree); the bare
`prisma` name follows later.

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

After this slice: a release commit produces, in CI, a verified
`prisma-cli-8.0.0-rc.N.tgz` whose `prisma-cli` bin is the v8 tree, which
answers every platform, composer, and ORM command, whose product pins
agree on one engine, and which installs and starts on plain Node outside
the workspace. The operator performs one deliberate action to release it.
The bare `prisma` name is follow-up work once `prisma7` frees it.

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

**D3 — The shipped bin becomes the v8 tree.** Ruled 2026-08-12: no
`prisma` package this slice. Instead, `@prisma/cli`'s declared bin
(`prisma-cli`) moves from `dist/cli.js` (the legacy commander shell) to
`dist/v8/cli.js` (the engine tree) — an 8.x version whose bin is the
retiring commander would misdescribe itself. The legacy entry keeps
building and shipping inside the tarball (its deletion is S2d, out of
scope); only the bin map changes. The packaging test proves the declared
bin prints the lockstep version on plain Node at exit 0. The bare-name
cutover (a `prisma` package or bin rename, OIDC trusted publishing for
the name, dist-tag choice) is recorded in `deferred.md` as follow-up
work blocked on `prisma7`.

**D4 — Committed-versions release automation (R11).** All product pins in
committed manifests, bumped only in PRs: `@prisma/orm-toolchain` and
`@prisma/composer` exact-pinned in `packages/cli/package.json`;
`@prisma/cli-engine` stays `workspace:<version>` (pnpm rewrites to exact
at pack). No publish-time resolution anywhere — `determine-version.ts`
already refuses to invent versions; this deliverable adds nothing dynamic.
Pin agreement (shell engine version == every mounted family's engine pin)
is verified by S6's 3c, wired per STOP-5 — S7 does not write a second pin
checker.

**D5 — The pipeline: release commit → verified artifact → one action.**
Per STOP-1's ruling on trigger shape. Written against the recommendation
(STOP-1a): `publish.yml` gains an artifact-emission stage — after `pnpm
build` and the grammar check, it packs the engine and cli tarballs with
`pnpm pack`, runs the tarball smoke (S6 check 3b mechanics:
out-of-workspace install with computed absolute `file:` overrides,
`--ignore-scripts`, every declared bin starts on plain Node, exit 0,
under a timeout — which after D3 means the smoke exercises the v8 tree
and the composer/ORM family boundary), uploads the tarballs as workflow
artifacts, and attaches them to the GitHub Release it already creates.
The operator's one action for rc1 stays what versioning.md already
rules: merge the `chore(release)` bump PR. Everything after that push —
build, grammar check, smoke, npm publishes, Release + tag, artifact
upload — is the pipeline. Dry-run dispatch exercises all of it minus
registry writes.

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

**STOP-1 — CLOSED (operator, 2026-08-12).** Option (a): the repo's existing publishing mechanisms stand. The mandate's "tagged commit" wording is set aside; the release commit is the merged bump PR, the pipeline tags it after publishing, and no tag-triggered path exists. D5 is built inside `publish.yml`.

**STOP-2 — CLOSED (operator, 2026-08-12).** rc1 publishes under the
current names; the one action is merging the bump PR, exactly as
versioning.md rules. The bare-`prisma` cutover is follow-up work blocked
on `prisma7`, recorded in `deferred.md`. The project DoD's
"prisma@8.0.0-rc1" reads as "the unified CLI's rc1", which under this
ruling is `@prisma/cli@8.0.0-rc.N`.

**STOP-3 — CLOSED (operator, 2026-08-12).** No `prisma` package this
slice. D3 is now the bin flip: `prisma-cli` → the v8 entry. The legacy
commander stays in the tarball until S2d. The follow-up cutover work
owns the package/bin naming question when the name frees.

**STOP-4 — CLOSED (operator, 2026-08-12).** The current exception set
stands: the engine's three `telemetry` commands, `agent
install|update|status`, `feedback`. Reconciling missing/discrepancy
commands behind the exception list is a following step, recorded in
`deferred.md`, not this slice. Additions to the set still require an
operator ruling recorded in the test file.

**STOP-5 — CLOSED (operator, 2026-08-12).** Option (b): S6 proceeds in parallel and S7 carries the install smoke itself (`scripts/tarball-smoke.mjs` + `tarball-smoke-utils.mjs`), written to S6's check-3b design — same override computation, same `--ignore-scripts` stance, sandbox outside the workspace — so S6 absorbs it as a move, not a rewrite.

**STOP-6 — CLOSED by events (2026-08-12).** #162 merged first; this branch carries main's S8 merge, and the mount-path collision resolved as the predicted textual union. The original question, for the record:

#162 adds platform-family commands, so
the completeness check is order-independent with S7 — but
`EXPECTED_MOUNT_PATHS`, `cliGroups`, and `v8/cli.ts` imports collide
textually in both orders. Preference? (a) S7 lands first, #162 rebases
(its adds are mechanical); (b) #162 first, S7 rebases (same cost,
S7 is the one branch currently unmerged everywhere). Either is fine;
the mandate tells me not to decide interactions with S8's tree alone.

**Working defaults while STOP-5…7 stay open** (recorded so D1/D2 can
proceed; override any of them): the interim `@prisma/orm-toolchain` pin
is `8.0.0-rc.1-dev.40`, exact and committed (STOP-7 ii); S8's #162 and
this branch rebase in whichever order you merge them, the collision is
textual only (STOP-6); no S6 mechanism is duplicated in D1/D2 — the
smoke question only arises at D5 (STOP-5).

**STOP-7 — DEFERRED (operator, 2026-08-12).** The convergence choreography below is set aside until `8.0.0-rc.1` actually publishes; the committed interim pins (orm-toolchain `8.0.0-rc.1-dev.40`, composer `0.6.0-dev.16`, both carrying engine `0.0.9` beside the workspace engine) stand, and the two-copy install remains the accepted preview state. The original question, kept for that day:

For rc1's
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

**STOP-8 — CLOSED (operator, 2026-08-12), by dissolution.** No `prisma`
name is published this slice, so no new publish credentials, trusted-
publisher config, or guarded steps exist. `@prisma/cli` and
`@prisma/cli-engine` keep their existing OIDC configuration untouched.
The credentials question moves wholesale into the deferred cutover work.

**STOP-9 — acknowledged, not asked.** (i) `prisma-next` handoff (rollout
step 3) stays out of S7 unless you say otherwise. (ii) The ORM family's
static `esbuild`/`arktype` import cost on every shell start is real,
measured at the import graph, and belongs to prisma/prisma to fix
(dynamic handler imports like composer's); recorded in deferred.md by
this slice. (iii) rc1 ships with the legacy commander tree still in
`@prisma/cli`'s tarball; its deletion is S2d, which remains open on the
plan.

## 5. Acceptance

Written against STOP-1(a), the STOP-2/3/8 ruling as applied, STOP-4 as
listed, STOP-5(a), STOP-7 confirmed. Rewritten if you rule otherwise.

- [ ] `prisma migration list`, `prisma db verify --help`, `prisma init
      --help`, `prisma migrate --help` answer from the assembled tree;
      one ORM command proven end to end through `createTestCli`; the
      family's redirects and config section reachable through the shell.
- [ ] The completeness check covers platform + composer + ORM families
      both directions, fails the build on a seeded omission in either
      direction (test proves it), runs in `pr-quality.yml` and in
      `publish.yml` before any publish step, and its exception list is
      exactly the ratified one.
- [ ] `@prisma/cli`'s declared `prisma-cli` bin is the v8 tree; the
      packed tarball's bin prints the lockstep version on plain Node at
      exit 0.
- [ ] All product pins exact and committed; no publish-time version
      resolution; S6-3c green (modulo the dated interim exception) in
      the publish path.
- [ ] A release run (dry-run dispatch proves it end to end without
      registry writes) produces: build → grammar check → conformance →
      pack (engine + cli tarballs) → out-of-workspace install smoke
      (every bin starts on plain Node, exit 0) → publish steps →
      GitHub Release with tarballs attached.
- [ ] The operator's release action is exactly one: merging the
      `chore(release): 8.0.0-rc.N` PR. Nothing between that merge and
      the published artifacts requires a human.
- [ ] `pnpm typecheck`, root `pnpm lint`, touched suites green, measured
      as pnpm's own exit codes.

## 6. Out of scope

The bare-`prisma` cutover (package, bin name, OIDC config, dist-tag —
follow-up work, ruled 2026-08-12, blocked on `prisma7`); S2d (commander
retirement in this repo); the `prisma-next` npm handoff; flipping any
`latest` at cutover (rollout step 5); S8's service tree (#162); fixing
the ORM family's static import weight (prisma/prisma); S6's checks 1–3
themselves (consumed, not built, under STOP-5a).
