# Deferred and follow-up items — prisma-cli-v8

Work identified during a slice that is not part of that slice's
contract. Each entry: what, why it was deferred, where it lands.
Nothing here is tracked outside this file.

## After the latest cutover (2026-08-25, PR #230)

- **A stale product `dev` dist-tag can block a release publish.** The
  publish run checks the dev channel before the release leg, and the
  dev channel resolves each product's `dev` tag with no fallback — so
  when prisma/prisma released rc.7 without publishing a dev build
  (their workflow's two publish kinds were alternatives), our rc.10
  release run died in the dev conformance check with an
  engine-pin-mismatch nothing in this repo caused. Unblocked by a
  manual `npm dist-tag add @prisma/orm-toolchain@8.0.0-rc.7 dev`; a
  separate agent is porting composer's dual-publish (composer #241) to
  prisma/prisma, which removes the trigger. Open decision for THIS
  repo: whether a dev-channel failure should stop the release leg at
  all, or the release should publish and the run report the dev
  failure after — the current ordering makes another repo's stale tag
  this repo's release blocker.
- **The `@prisma/cli` deprecation call is open.** Rollout-plan step 5
  listed a deprecation notice pointing installers at `prisma`; the
  package is now the scoped twin the workflow actively publishes, so
  deprecating it may no longer make sense. Operator decision; needs npm auth either way
  (`npm deprecate @prisma/cli@"<8.0.0" "..."`).

## After S7's first real publish

- **The publish/Release shell in `publish.yml` should become a tested
  script.** The operator called the inline `gh` calls janky
  (2026-08-12); the agreed direction, not yet ruled go, is a
  `scripts/publish-release.mjs` beside `determine-version.ts` — the
  draft-create/attach/publish flow and the already-published tolerance
  unit-tested like every other script, the yml steps collapsing to
  one-liners. The alternative considered (pinning
  `softprops/action-gh-release` into the job that holds
  `id-token: write`) widens the trusted set of the repo's most
  privileged workflow and was recommended against.

- **The `v8.0.0-rc.1` GitHub Release has no tarballs attached, and
  none can be added.** The first real `next` publish (2026-08-12, run
  31618278670) published both packages to npm successfully, then the
  Release step published the Release before uploading assets — and this
  repo's releases are immutable, so the upload was refused (HTTP 422)
  and the Release froze empty. npm is unaffected; the smoked tarballs
  remain retrievable from that run's workflow artifacts (which expire
  on the repo's retention schedule) and from npm itself. PR #165 fixes
  the step for every future release (draft → attach assets → publish,
  the order GitHub's own docs recommend). Repairing rc.1's Release
  itself, if ever wanted: merge #165 first, try
  `gh release delete v8.0.0-rc.1` (docs are silent on whether a
  published immutable release can be deleted; the attempt is the test),
  and if deletion works, re-dispatch the publish workflow — the
  already-published npm versions are tolerated and the run recreates
  the Release complete. Operator ruling (2026-08-12): cosmetic, not
  immediate.

## Still open after S3/D4 — mostly the composer repo, two items need both

D4 landed the prisma-cli half (the mount, the node floor, the divergence
file, the ledger corrections, the 1c closure). The first two items below
need a composer checkout and nothing else. The last two need a change in
each repo: the engine pin has to match what prisma-cli depends on, and
the help-example fix needs a new placeholder in this repo's engine before
composer can use it.

- **`loadAppConfigDiagnostics()` is called by nothing.** D2 rewrote
  composer's config loading to return diagnostics instead of
  throwing (contract R-S3-2), but `pipeline.ts` still calls the
  throwing `loadAppConfig`, so the rewrite is currently dead code —
  the name does not appear outside comments in the published
  `0.6.0-dev.16` bundles. The effect-resolution check is unaffected and
  does run: it sits in `configSource`, the front both loader shapes
  share, so the throwing path the pipeline uses runs it first.
- **Composer should drop its `isCI` answer.** prisma-cli #155 made
  `Runtime.isCI` the optional `isCIOverride` — the engine detects CI
  itself now. Composer still passes `isCI` (via `ci-info`) in
  `packages/0-framework/3-tooling/cli/src/family/runtime.ts` because
  it pins engine `0.0.9`, which predates #155. Harmless today. Drop
  the parameter and the `ci-info` dependency when composer next bumps
  its engine pin.
- **`check:npm-effect-resolution` fixes are unverified.** D3 updated
  three assertions (help proves the family mounted; the adversarial
  `deploy` gets a service token because the credential check now
  precedes the tree check; `--help` must survive a broken dependency
  tree because the family's static graph is alchemy-free). The check
  performs real npm installs, so it needs network to run.
- **The engine pin moves to whatever the tandem release publishes**, in
  both composer manifests — and it must be the SAME version prisma-cli
  depends on. They disagree today: prisma-cli builds against the
  workspace engine (`8.0.0-rc.1`) and composer `0.6.0-dev.16` pins
  `@prisma/cli-engine@0.0.9` exactly, so an install of `@prisma/cli`
  carries two copies of the engine. It works for the one crossing that
  is tested: the engine's cross-copy markers are `Symbol.for`, and
  `packages/cli-engine/tests/execution.test.ts` ("a structured error
  built by another copy of the engine") and `tests/protocol.test.ts`
  prove a structured error raised by one copy is recognised by the
  other. Nothing tests execution or signal behaviour across two copies,
  and the honest reason is that it is not worth writing: matching pins
  is a **release requirement for the tandem release**, so the two-copy
  install is a preview-only state to end rather than a configuration to
  support. S7 update (operator ruling, 2026-08-12): the convergence
  choreography is deferred until `8.0.0-rc.1` publishes; the S7 branch
  adds a third pin in the same shape (`@prisma/orm-toolchain@
  8.0.0-rc.1-dev.40`, also carrying engine `0.0.9`). The sequence, when
  it runs: engine `8.0.0-rc.N` publishes from this repo → orm-toolchain
  and composer bump their engine pins and publish → the rc1 bump PR
  here pins those versions.
- **The prisma bin's mount makes composer's help examples wrong.** **Closed by the command grammar cleanup (2026-08-21):** `dev` and `deploy` moved to the root, so `{bin} deploy src/service.ts` renders correctly; `destroy` and `log` were dropped entirely. No engine placeholder needed. Recorded in `assets/s2/parity-divergences-s3.md`.

## The ORM family does not work through the assembled binary (found 2026-08-13, writing the e2e happy paths)

Running the shipped `prisma` binary against a scratch directory, rather than the ORM family through the test harness, turns up three things. The first is a defect a user hits on their first command.

- **`prisma orm init` scaffolds a project the `prisma` binary cannot read.** It writes `prisma-next.config.ts` — the standalone `prisma-next` bin's config file — and then fails its own last step, `Emit the contract`, with exit 5 and `Config is not a defineConfig result`. Nine files are already on disk at that point. Running any ORM command afterwards fails again, differently: the mounted family reads its configuration from an `orm` section of `prisma.config.ts` (`ormConfigSection`, `packages/1-framework/3-tooling/cli/src/orm/config-section.ts` in prisma/prisma), so it reports `CLI.CONFIG_SECTION_INVALID` and `CONFIG.FILE_NOT_FOUND` — "The orm config section is absent, so prisma-next.config.ts was never evaluated." So `prisma orm init && prisma contract emit` cannot work, and the two config surfaces have different shapes: the section nests the whole config under `orm`, while the scaffolded file exports a `defineConfig` result. Which side moves is the ORM's call; that it is broken today is not in question.
- **The e2e coverage convention excludes all 22 ORM commands on reasoning #171 disproved.** `tests/e2e-coverage.test.ts` excuses them with "Real e2e lives in prisma/prisma (R7); the shell proves composition in orm-mount.test.ts (R8)." prisma/prisma's suite passed throughout the presentations change while the assembled binary exited 2, and `orm-mount.test.ts` proves composition for exactly one command, `migration list`, not per family. The operator's ruling (2026-08-13) is that every mounted command needs a happy path in this repo, precisely because the product repos cannot reproduce the assembled CLI. The exclusion should become a backlog entry once the first item above is fixed and the commands can run at all.

## A live bug carried out of the port (found closing PR #92, 2026-08-12)

- **The production branch is still resolved by name, not role.**
  `packages/cli/src/commands/service/target.ts` derives branch kind from
  the literal name (`toBranchKind`, used where domain attachment decides
  production-ness), so a project whose production branch is named
  `master` cannot attach a custom domain. Closed PR #92 fixed exactly
  this in the old controller and died with it; the fix should land in
  `target.ts`, taking the role from the API's branch record.

## Orphaned by the stale-PR sweep (2026-08-12) — capabilities with no engine successor

Nine pre-port PRs were closed as unmergeable after the shell deletion
(#139). Most were superseded outright; these wanted things the engine
CLI does not do, and each restarts as engine work if wanted:

- **`branch remove` / branch CRUD** (#110, #73): the `branch` group is
  list-only. Returns with exact-id consent if wanted.
- **`env pull` into a dotenv file** (#79): `project env list` never
  returns values by design, so an engine `env pull` needs a ruling on
  secret handling before it is built.
- **A `github` group for workspace-level GitHub connections** (#113):
  the engine ships repo-level `git connect|disconnect` only.
- **Transient-read retry on `build logs` streaming** (#104): moot — the `build` group was removed by the command grammar cleanup (2026-08-21).

## Ratified-as-shipped at the S2 sign-off (2026-08-12) — the gaps stay real

- **Streaming service logs is unavailable in any form.** `app logs` died
  with the commander shell and `service logs` waits on an engine
  streaming transport. The one capability loss of S2d; the S2c record
  has the design notes.
  **Superseded by the `service-logs` slice (2026-08-13):** `service logs`
  ships, reading the platform's HTTP page endpoint, so the capability is
  no longer missing. What is still missing is the *streaming* half —
  `--follow` polls on a 2s interval rather than holding a socket open.
  The open remainder is the WebSocket live tail, in the closed
  `service logs` entry further down this file.
- **`build logs` cannot exit 1 on a failed build** — moot: the command was removed with the `build` group by the command grammar cleanup (2026-08-21). The engine gap (a stream settling with a documented non-zero code) remains real for future stream commands.
- **The crash-recovery feedback action does not port** (the legacy
  crash envelope pre-filled a `feedback` command; the engine's crash
  path has no hook for it).
- **A service token whose workspace only the server knows is refused**;
  accepting it needs an engine change to resolve the workspace online
  during the needs check.
- **Q6: the telemetry docs URL is the interim prisma.io CLI page**;
  the real page is still owed and ships as a one-line change.

## Owned by whoever lands the next engine change

- **S3's SPI amendment vs credential-manager rev 6.** #136 recorded
  the spawn path's credential read against rev 5's surface and then
  adapted to rev 6's `activeCredentialStorage()` during the rebase.
  If rev 6's storage surface reshapes again, the single named
  consumer (`packages/cli-engine/src/execution/spawn.ts`) moves with
  it. Recorded in `assets/engine/credential-manager-design.md`.
- **Nothing bounds a child run to the token it was given.** A
  `credentials: "child"` command still hands the child a snapshot of the
  access token and never the refresh token
  (`packages/cli-engine/src/execution/spawn.ts`). The parent now refreshes a
  stored OAuth pair before the handler when its access token is inside
  `CREDENTIAL_NEAR_EXPIRY_MS`, so a refreshable session receives a fresh
  snapshot instead of an unnecessary sign-in error. That does not bound the
  child's total runtime: a converge that outlives even the refreshed snapshot
  can still fail after creating resources. The remaining ways out are to hand
  the child something that can refresh or to bound the child's run.
- **A validated number flag**, if `--tail`'s old constraint is wanted
  back. `flag.number` accepts negatives and fractions, so "non-negative
  integer" is enforced nowhere. D4 took the other branch this item
  offered and widened the divergence entry instead
  (`assets/s2/parity-divergences-s3.md`), which also corrects this
  item's claim that legacy rejected non-integers — legacy truncated
  them silently, and rejected only negatives and `NaN`.
- **`pnpm --filter @prisma/cli test` can report green against a stale
  engine build.** Vitest resolves `@prisma/cli-engine` through the
  package's own `exports` map, which points at `./dist`; the `paths`
  entries in `tsconfig.json` are read by `tsc`, not vitest, and no
  path-resolving plugin is configured. `packages/cli`'s `test` script is
  a bare `vitest run` with no build step, so run on its own it exercises
  whatever engine `dist` happens to be on disk. The engine's own `test`
  script builds first, so a gate that runs the engine suite before the
  CLI suite — as every gate in this project does — is honest, and
  `turbo run test` is honest too because `turbo.json` declares `test` as
  `dependsOn: ["^build"]`. The trap is running one filter in isolation
  after editing engine source. Surfaced in the engine-colour slice when
  a deliberately introduced defect failed to fail. The mechanism to fix
  it already exists in `turbo.json`; the change is to `packages/cli`'s
  test script.
- **`spawn-real-child.test.ts` also fails under load, and is a different test from the one below.** In `packages/cli-engine/tests/spawn-real-child.test.ts`, the case "native Ctrl-C reaches the child through the shared process group" failed twice during the engine-colour slice, both times on a machine running the engine and CLI suites concurrently — on the second sighting that run's import phase took 92s against a normal 3–7s. It passed on every isolated and sequential run either side. Nothing in that slice goes near spawn or signals, so this is not its doing. Two independent sightings under load make it worth diagnosing rather than watching: the likely shape is the same as the entry below, a test that waits on a marker the child writes before it is actually ready for the signal. Third sighting, 2026-08-12: it failed on a GitHub runner during #158, a PR that changes no engine file, and passed on a re-run of the same commit and on the same machine in isolation. That moves it from a loaded-laptop annoyance to a test that reddens the shared `Test` check on unrelated work, which teaches people to re-run a red check rather than read it. Worth fixing before the next slice rather than after.
- **`v8-spawn-adapter.test.ts` has a race that fails under load.**
  In `packages/cli/tests/v8-spawn-adapter.test.ts`, the "kill
  delivers the signal to the live child" case runs an inline child
  that writes its `ready` marker BEFORE calling
  `process.on('SIGTERM', ...)`. The test waits on that marker and
  then kills, so a kill landing in the gap hits the default SIGTERM
  disposition: the child dies by signal instead of exiting 42, and
  the assertion fails. Reproduced on a loaded machine (2 of 4 runs)
  while verifying the child-record change, which does not touch
  `packages/cli`. Fix: have the child write `ready` only after the
  handler is installed — the same ordering the engine's own
  `tests/fixtures/child.mjs` `trap-term` fixture already uses.
- **`credential-manager.test.ts`'s crashed-lock contention test is
  flaky on Windows CI.** "lets only one of two waiting mutations
  clear the same crashed holder's lock" timed out at 5 s on
  `windows-latest` during #181 (2026-08-13, a PR touching nothing
  near the credential manager) and passed on the re-run of the same
  commit. One sighting so far — same reddens-shared-checks family as
  the two entries above. Likely shape: two waiters racing a lock
  file under Windows FS latency needs more than the 5 s budget, or
  the same write-marker-before-ready ordering. Diagnose on the
  second sighting.

## Owned by whoever converts a family's renderers

- **The rail is not restored on any card yet.** The engine-colour slice
  gives `fields` an opt-in `rail` and restores alignment and the accent
  colour to all 36 sites at once, but which cards want the dim `│` rail
  is a per-command judgement. The legacy shapes are
  `renderCommandHeader` (rail) and `renderFieldRows` (no rail) in
  `packages/cli/src/shell/ui.ts`.
- **No presenter binds `ui`.** All 54 platform presenters are
  `human: () => [...]`, so spans, `ui.tone`, `ui.width` and `drawing`
  have no callers until each family converts. The engine colours only
  what it draws itself until then.
- **Glyph mode is not adopted.** The ORM decides between unicode and
  ASCII box-drawing from TTY plus a UTF-8 locale
  (`prisma/prisma`, `packages/1-framework/3-tooling/cli/src/utils/
  glyph-mode.ts`). The engine emits `✔ ✘ ⚠ ℹ` unconditionally today and
  will emit `├─ └─ │` the same way. Adopting the ORM's detection is the
  established fix if a non-UTF-8 terminal ever reports mojibake.

## Upstream, not ours to land

- **alchemy-run/node-utils#6** (scope exit hooks to owned locks).
  **Closed by composer 0.13.0 (2026-08-25):** the release chain
  delivered — alchemy 2.0.0-beta.74 carries the node-utils fix and
  composer #254 retired the vendored patch, so a `prisma` install now
  resolves a node-utils that registers no import-time signal listener.
  The canary (`packages/cli/tests/composer-isolation.test.ts`) now
  asserts zero listeners, so a regression in that chain says so. The
  original entry follows for the record.
  Was: open. Vendored as a pnpm patch in composer
  (`patches/@alchemy.run__node-utils@0.0.5.patch`, applied to both
  `lib/lockfile.js` and `src/lockfile.ts` because the exports map
  sends bun to `src/`). **Delete the patch when the release chain
  delivers**: node-utils release → alchemy's exact-pin bump →
  composer's alchemy bump. Exit condition recorded in
  `skills-contrib/upgrade-alchemy-effect/SKILL.md` in the composer
  repo.
  **The patch does not reach the prisma bin, and D4 measured what that
  costs.** A pnpm patch applies in the repo that declares it, so a
  `prisma` install resolves the unpatched `@alchemy.run/node-utils`.
  D4's canary (`packages/cli/tests/v8-composer-isolation.test.ts`)
  imports one composer executor in a fresh prisma bin process and
  asserts what the import alone leaves behind: one SIGINT and one
  SIGTERM listener — the exact condition the contract's design
  consequence 4 says nothing ships with. Both counts are assertions, not
  observations, so the day the patch reaches us this test says so.
  What those listeners do is the reason it matters: `lib/exit-hook.js`
  calls `process.exit(128 + signal)` from inside them, which is a
  synchronous exit the engine's abort, child teardown and settlement do
  not get to finish behind. Whether they actually preempt the engine on
  a real Ctrl-C during a composer command is untested — the listeners
  are proven present, the race is not proven either way.
  It does not fire on a normal run: the same process running
  `--version` loads no alchemy at all and holds no listener, which is
  what the test asserts. It fires once a composer command evaluates its
  config. Until the release chain delivers, composer's own
  sole-listener detector passes on the patch and the prisma bin has no
  such protection.
- **Alchemy's `sync` reports permanent drift on Composer resources.**
  `Deployment.read` returns `previewDomain` while `reconcile`
  persists `appEndpointDomain`; `Sync.ts` deep-equals live against
  stored attributes, so every `alchemy sync` would report drift and
  "repair" forever. The deploy path is unaffected (it plans on props
  only — see the S8 note below), so this is a courtesy report to the
  maintainer, not a blocker.
- **The ORM family's entry module loads esbuild and arktype on every
  invocation.** `@prisma/orm-toolchain`'s `./cli` subpath statically
  imports `esbuild`, `arktype` and eight `@prisma/orm-framework`
  subpaths, so mounting the family (S7 D1) makes every run of this bin
  pay that import — `prisma --version` included, which touches no ORM
  code. Composer solved the same problem by keeping its heavy graph
  behind dynamic executor imports; orm-toolchain has not. It costs
  startup time only: no output and no exit code changes. The fix is
  prisma/prisma's to land (dynamic handler imports in orm-toolchain's
  CLI entry), and it closes when a published orm-toolchain's `cli.mjs`
  no longer imports those modules at the top level. Recorded also in
  `assets/s2/parity-divergences-s7.md`.

## Answered, feeding a later slice

- **S8's planner question is settled** (D2's read of alchemy
  `2.0.0-beta.67`): the deploy path plans on **props only** and never
  compares attributes, so Composer's domain-field mismatch causes no
  per-run redeploy. S8's promote/rollback/start/stop design does not
  have to defend against Alchemy reverting imperative changes on the
  next deploy. Full citations in `assets/s3/composer-inventory.md`
  §4a and D2's report.

## Left open by S8 — the service family

- **`resolvePinnedProject` can mask an API refusal as "generator body
  threw".** `v8/project/context.ts` passes a throwing `listProjects`
  into `resolveProjectTarget`, whose `Result.gen` body swallows the
  thrown error's message. S8 hit the same shape in the service tree
  (fixed in #162 by moving the fetch to the call site); the project
  path has the latent equivalent, unverified. Whoever next works the
  project family should reproduce and fix it the same way.
- **`auth`'s workspace-ref lookup rejects the `wksp_`-prefixed id the
  Console shows.** `src/v8/auth/session-ref.ts:24` compares a
  user-typed workspace ref against stored session ids with no prefix
  tolerance — the same bare-vs-`wksp_`-prefixed mismatch behind #144
  and S8's workspace-filter defect (`bd8aa78`). Unlike those, it
  fails loudly (falls back to name matching, then errors), so it is
  an annoyance, not silent data loss. Found by S8's review sweep of
  cross-origin id comparisons; the auth family is untouched by S8, so
  it lands with whoever next works that family.
- **The Composer-ownership note is deliberately not built (R-S8-4).**
  `promote`, `rollback`, `start` and `stop` print no "Composer will
  overwrite this on the next deploy" warning. Ruled NOT NOW (operator,
  2026-08-12), and the grounding fact is why the revisit is real rather
  than a shrug: **nothing in the app or deployment records identifies a
  service as Composer-managed.** The only fingerprint is the `COMPOSER_*`
  env-var namespace on the branch, which the CLI never fetches, so a
  warning today would either be unconditional (noise on every
  hand-managed service) or guesswork. Revisit when the API grows a
  `managedBy` marker — the same request deferred alongside it. Users own
  their resources, and Composer reconciling a manual change on the next
  deploy is accepted behavior until then.
- **`service logs` SHIPPED** (slice `service-logs`, 2026-08-13 —
  contract at `specs/service-logs.md`, divergences at
  `assets/s2/parity-divergences-service-logs.md`). It mounts as
  `service logs`, the legacy spelling (ruled, operator, 2026-08-13), and
  reads the platform's HTTP page endpoint (pdp-control-plane #4886): one
  page by default, `--follow` polling on the terminal record's cursor.
  Closing this entry corrects one thing it predicted: the pinned
  `@prisma/management-api-sdk` (1.55.0) did NOT need a bump. The
  `query: never` the risk note named is path-item boilerplate that every
  path in that file carries; the operation type
  (`getV1DeploymentsByDeploymentIdLogs`) already declared `tail`,
  `from_start` and `cursor`, so the wiring typechecked against the
  existing pin with no cast.
  **What stays open: the WebSocket live tail.** The platform serves the
  upgrade on the same path and the CLI does not use it, so following is
  polling on a 2s interval rather than push. The engine socket design
  (`assets/engine/websocket-transport-design.md`) remains **shelved for
  that later date, not deleted** — R-S8-5's "provided live streaming can
  be added at a later date" is still the standing commitment, and this
  slice is what it was traded against.
- **The e2e suite should assert the real service-id prefix.** D2 wrote
  `e2e/service.e2e.ts` without credentials to run it, so it asserts only
  that `service create` reports a non-empty id. The sibling suites assert
  real prefixes (`bkt_`, `db_`) because their authors could see one.
  Whoever first runs this suite green should read the id the API actually
  returns and tighten the assertion to match, as `bucket.e2e.ts` does.
- **`service show` can have a real e2e now, and should.** It sat on the
  `AWAITING_COVERAGE` backlog because the whole `service` family was
  assumed to need a deployed service. `service create` falsified that:
  `service show` works against a service that has never been promoted —
  D1's own unit test asserts that case. Adding it to `e2e/service.e2e.ts`
  alongside `create`/`list`/`remove` is a small job and removes the entry
  rather than re-explaining it. The `service domain *` entries look like
  the same case (they attach a domain to a service, not to a deployment)
  and are worth checking at the same time.

## Composer's public surface — ruled, closed

- **`ExtensionDescriptor.preflight` moved to method syntax** so an
  extension can type its input against its own client (the injected
  management client arrives there under S3's in-process credential
  leg). Consistent with `ContainerDescriptor` in the same file;
  loosens parameter checking for extension authors. RULED KEPT
  (operator, 2026-08-11). No further action; the change ships with
  S3 and needs a divergence entry only if it breaks a published
  extension, which it does not.

## Found during S6 — not S6's to fix

- **`pnpm test` fails on a pre-existing concurrency race between two
  packages' test tasks.** `@prisma/cli-engine`'s `test` script begins
  with `pnpm run build`, and tsdown builds with `clean: true`, so it
  empties and rewrites `packages/cli-engine/dist` while it runs.
  `@prisma/cli`'s tests resolve `@prisma/cli-engine` through that same
  `dist`, and turbo's `test` task depends only on `^build` — never on a
  dependency's `test` — so the two run at the same time and the shell's
  suite intermittently fails with "Failed to resolve entry for package
  @prisma/cli-engine" across roughly two dozen files. Confirmed
  pre-existing: the base commit `aa40790` fails three runs out of three,
  and `turbo run test --concurrency=1` passes on both that commit and
  the S6 branch. It is invisible in CI because `.github/workflows/
  test.yml` runs only `pnpm --filter @prisma/cli test`, and
  `pr-quality.yml`'s `pnpm test` has presumably been passing by timing
  luck. Two candidate fixes, neither S6's call: drop the `pnpm run
  build` from the engine's `test` script and let turbo's `^build`
  dependency do that work, or stop the engine's build cleaning a
  directory another package reads while it runs.
  Seen again on the presentations branch (2026-08-12) with a second
  message for the same cause — `Cannot find package
  '@prisma/cli-engine/testing'` — and a failure count that varied 13,
  34 and 43 files across three runs of one commit, while
  `--concurrency=1` and a direct `npx vitest run` in `packages/cli`
  both passed all 60 every time. The varying count is the tell: a
  change that touches many files shifts the timing and makes it fire
  more often, which reads as "this branch broke everything".
- **The packed shell manifest carries `devDependencies` on private
  packages at versions no registry has** — `@repo/cli-telemetry` and
  `@repo/tsconfig`, both at `8.0.0-rc.1`. Harmless when a consumer
  installs the tarball, because npm ignores a package's own
  devDependencies; fatal for anyone installing the unpacked directory.
  None of S6's three checks looks at that field, deliberately: check 3
  compares only the fields a consumer installs. composer's and
  prisma/prisma's `check-publish-deps.mjs` both catch this class, and
  prisma-cli has no equivalent. Worth one small check, in its own
  change.

## Found while fixing engine 0.1.1 (2026-08-17) — needs a decision from Will

- **A library depends on CLI tooling: `@prisma/composer-prisma-cloud`
  imports `@prisma/orm-toolchain/config-loader`.** ADR 0004 says
  libraries applications install must not depend on product CLI/dev
  packages, and this import breaks that rule today. It is also how an
  engine implementation detail reached composer's users: evaluating
  `prisma-composer.config.ts` loads `composer-prisma-cloud/control`,
  which loads `orm-toolchain/config-loader`, which imports `ci-info` —
  putting ORM tooling and its dependencies inside composer's config
  evaluation in every user's process. The engine defect that exposed
  this is fixed (prisma-cli#187), but the dependency remains. Options:
  move `config-loader` into a shared library package the ORM publishes
  for exactly this kind of consumer, or cut the cloud extension's use
  of it. Spans both product repos; Will decides which.

## The rc.4 engine mismatch (2026-08-18) — the repair chain

`prisma@8.0.0-rc.4` on `next` crashes on import: #183 and #184 changed the engine without bumping its version, so the registry's `@prisma/cli-engine@0.1.1` (published ten minutes before #183 merged) lacks exports the CLI imports. The registry is immutable and both products peer the engine exactly, so npm fails with ERESOLVE on any mismatch; the repair is a chain, in order:

1. **prisma-cli #200**: engine → 0.2.0, plus the CI job that fails any PR changing `packages/cli-engine/` while its version is already on the registry (the check whose absence let rc.4 ship). Merging it publishes engine 0.2.0.
2. **Both product repos**: re-declare the exact engine peer at 0.2.0 and release (`composer-cli` 0.7.1, `orm-toolchain` 8.0.0-rc.3). Their lockfiles cannot resolve 0.2.0 before step 1 publishes.
3. **prisma-cli**: pick up those product versions and cut `8.0.0-rc.5` — the first version on `next` that works again. rc.4 itself cannot be repaired.

The cost the incident exposes: every engine API change forces this three-repo, three-release sequence, because the exact peer is what guarantees one engine per install (ADR 0004). Making the chain cheaper — automation that opens the product peer-bump PRs when a new engine publishes, riding the same `DEPLOY_GITHUB_TOKEN` as the notification step below — is a design question for Will.

## Left open by the dev-build fix (2026-08-17)

The release channel is green as of 2026-08-17: `@prisma/composer-cli@0.7.0` and `@prisma/orm-toolchain@8.0.0-rc.2` are both released and both peer `@prisma/cli-engine@0.1.1`, so the conformance run reports nothing and `packages/cli/scripts/conformance.ts` carries no exceptions. What closed, for the record: composer's `0.6.0` was uninstallable (published out-of-band with `npm publish`, leaving `workspace:0.6.0` in its manifest) and the ORM had no released version carrying the command family.

Still open:

- **Both product repos need their publish-notification step** (the work in the closed composer#232 and prisma#30033): a `repository_dispatch` of type `product-published` to `prisma/prisma-cli`, placed immediately after the publish step and keyed on its outcome. Until then a daily scheduled run is what notices a product release, so a new product version reaches the CLI within a day rather than within minutes. `docs/oss/release-automation.md` carries the exact step, and `DEPLOY_GITHUB_TOKEN` is provisioned in all three repositories (2026-08-17).
- **Neither product repo installs its own tarball before publishing.** That is why an uninstallable `@prisma/composer-cli@0.6.0` sat on `latest` unnoticed. prisma-cli's check 3 does exactly this — pack, install into a clean sandbox with `npm --ignore-scripts`, start every declared bin — and is worth porting to both.
- **The engine-pin check compares for equality, not peer satisfaction.** Both families now declare an exact peer equal to the shell's pin, so equality is correct and stricter today. Widening to range satisfaction belongs with the post-GA move to engine ranges (ADR 0004), not before.
- **`credential-manager.ts` uses the banned word.** `packages/cli/src/auth/credential-manager.ts` has a private `#repin` method (about the active-workspace marker, a different concept from dependency versions). The operator banned the word outright; renaming it is a mechanical change to a private method, left out of the publish-channel work to keep that diff to one subject.

## Left open by the command grammar cleanup (2026-08-21)

The cleanup PR removed the compute config and `init`, made service commands parameter-only, renamed the six destructive `remove` commands to `delete`, moved `postgres restore`/`ref *`/`migrate`/`format`/`composer dev|deploy`, and dropped `composer destroy|log` and the `build` group. Deliberately left behind:

- **The wire layer still speaks App/Deployment.** The CLI surface says Service/Version (ADR-012), while the adapter (`packages/cli/src/lib/app/app-provider.ts`), compute-sdk names, `/v1/deployments` paths, and `appId` keep platform vocabulary. They rename in pdp-control-plane's coordinated all-surfaces pass, and the adapter is the one file where both vocabularies are allowed to meet until then.

- ~~**`project env` still infers scope from the current git branch.**~~ Closed on the PR branch (2026-08-21, operator ruling): `project env list` with no `--role`/`--branch` lists the overview instead of inferring from the checkout; `readLocalGitBranch` and `lib/git/local-branch.ts` are deleted.
- ~~**`knownLiveDeploymentByProject` has no writer.**~~ Closed on the PR branch (2026-08-21): the local-state shape, its store methods, and `service delete`'s cleanup pass were deleted.
- ~~**Upstream family cleanups.**~~ Closed (2026-08-22): composer#253 retired `destroy`/`log` and prisma#30102 rekeyed the ORM family to the mount paths and fixed its redirects; the shell now mounts both families as shipped and the wrapper arithmetic is deleted. Both pins are on released versions: composer-cli 0.12.0, orm-toolchain 8.0.0-rc.5.
- ~~**`PRISMA_PROJECT_ID` is honoured only by the domain commands**~~ Closed on the PR branch (2026-08-21, operator ruling): the env var served the deleted `app deploy` headless flow and survived only in the domain commands by accident; it is removed entirely. Project targeting is `--project` and the link file.
- ~~**orm-toolchain's shipped help examples name retired spellings.**~~ Closed (2026-08-22) by prisma#30102: the family keys are the mount paths and the examples follow; `tests/orm-mount.test.ts` now asserts upstream stays clean.
- ~~**The deployment-id targeting asymmetry is undocumented.**~~ Closed on the PR branch (2026-08-21): every deployment-id command (`promote|start|stop|delete|show`, `logs --deployment`) now resolves the id globally with no service parameter, per the "Subjects are positional" ruling.
- **`GET /v1/deployments/{id}` omits the parent `appId`.** Verified against `@prisma/management-api-sdk@1.55.0`: the response carries id/status/url/previewDomain/envVars/createdAt and no owning-app pointer, so `showDeployment` finds the owner via `findAppForDeployment` — a scan of every project's service list and each service's deployments — and every id-targeted command pays it per run. The fix is in pdp-control-plane: include `appId` in the deployment representation; the CLI then swaps the scan for one `GET /v1/apps/{appId}`.

## From the agent-skills delivery (project closed 2026-08-22)

- ~~**Config evaluation fails through unrealpath'd pnpm symlinks.**~~ Closed (2026-08-25): the one-line realpath fix shipped — `packages/cli-engine/src/config-loader.ts` imports c12 via `realpathSync(import.meta.resolve("c12"))` on main, released with engine 0.2.2 (#224). The init e2e's rerun workaround came out with the config-file-resolution slice (D4, 2026-08-25): the rerun no longer deletes the scaffold first and now covers the config-present path directly.


The agent-skills project (skills sync/list, `prisma init`, the staleness notice; PR #219) closed with these items still open; details were in its own ledger, summarized here as the surviving record.

- **When facade skill content diverges per database, split the skill by name — never add a carrier package** (operator concurred 2026-08-21). Today every facade ships an identical `prisma-8` skill and conflicts are arbitrated by highest version, safe only while content is identical and versions are lockstep. A transitive carrier package is unresolvable from the project root under pnpm; a direct-dependency skills package breaks the installed-version guarantee. The allowlist grows one deliberate line per facade either way.
- **The browser login success page still shows a static `npx skills add prisma/skills` copy button** (`packages/cli/src/auth/login.ts` ~571) — the last surface promoting the retired third-party installer after the `agent` group's deletion. Decided 2026-08-24: the operator is having the responsible team remove it; not part of PR #219.
- **Composer website hero copy** (prisma/composer `website/src/template.ts`): still says `npx skills add prisma/composer`; the replacement wording and its release timing belong to the site owner, and the new command only exists once the CLI ships.
- **`check-skill-packaging.mjs` hardcodes `@prisma/composer`** (prisma/composer) while `stage-skills.mjs` is generic; generalize when a second skill-bearing composer package appears.
- **Turbo race: `pnpm test` can rebuild `cli-engine` dist while `cli` tests import it** (intermittent `Failed to resolve entry for package "@prisma/cli-engine"`). Fix: `dependsOn` on the engine build in turbo.json.
- **Windows CI: the credential-manager suite needs an owner** — two distinct timing-sensitive tests flaked on 2026-08-21 (`credential-manager.test.ts` "holds no lock while the workspace name is fetched", run 32477175789; `credential-manager-processes.test.ts` "exchanges one refresh token once", run 32497093995), both on pushes touching nothing near credentials. A third hit on 2026-08-24 (run 32737503671, PR #225): the "holds no lock" test again, failing on an EPERM temp-file rename on the Windows runner. Three flakes across two tests; the suite needs an owner.
- **Windows CI: `skills-sync.test.ts` timed out once at the 5s default** (run 32474645762) with a teardown ENOTEMPTY from cleanup racing the timed-out test. If it recurs, raise the suite's per-test timeout on Windows rather than chasing the race.
- **`isLikelyGlobalNpmEntrypoint` (update-check.ts) matches only `prisma-cli` install paths**, so a globally-installed `prisma` gets the docs-link fallback instead of a concrete update command; `selectUpdateInstruction` still names `@prisma/cli`. Newly conspicuous after the CLI_NAME → prisma rename.
- **The feedback client's user-agent changed from `prisma-cli/<version>` to `prisma/<version>`** — wire-visible; whoever reads that dashboard should know.
## Left open by the rc.8 broken release (2026-08-24)

- **`prisma@8.0.0-rc.8` on npm is broken and immutable.** The `prisma` wrapper package carries its own copies of the product pins, and the grammar-cleanup branch bumped only `packages/cli/package.json` — so the published `prisma` bin resolved `@prisma/orm-toolchain@8.0.0-rc.4`, whose old family keys make the mount table's lookups undefined and every invocation crash ("Cannot read properties of undefined (reading 'needs')"). rc.9 fixes it. Consider `npm deprecate prisma@8.0.0-rc.8` (needs a maintainer's npm auth; CI publishes via OIDC and has no deprecate step).
- ~~**The release checks did not catch a `prisma` bin that crashes on install.**~~ Closed (2026-08-24, on the rc.9 PR): worse than hoisting — check 3b never installed or started the wrapper's bin at all, only the shell's. Three guards now exist: `packages/cli/tests/manifest-pins.test.ts` (every PR: the wrapper's dependencies must deep-equal the shell's), the tarball check's new `sibling-pin-mismatch` finding (pack time: shared dependency names across packed manifests must carry identical specifiers), and per-package sandboxes in check 3b (every bin-bearing package installs and starts from its own tree). Each guard was proven against the planted rc.8 defect.
- **Two manifests hand-carry the same pins.** `update-product-versions.mjs` rewrites both, and three checks now fail on divergence (see the closed entry above), so the class cannot ship again. Deriving one manifest from the other at pack time would remove the duplication itself — still a design call, no longer urgent.

## Config-file resolution rulings (2026-08-25)

The design in `specs/config-file-resolution.md` is decided (per-key merge with section-owned semantics, automatic ancestor discovery with a reserved `parent: false | "path"` key, repo-boundary stop, post-merge validation with provenance, declaring-file-relative paths, `--config` anchoring the chain at the named file, no shadowing notices); the dispatch plan is `plans/config-file-resolution.md`. Two rulings recorded here because they close or supersede standing observations:

- **`readProjectSkillsConfig`'s hand-rolled resolution must consolidate into the engine resolver** (ruled 2026-08-25) — lands as D3 of the slice; until then the staleness notice and the commands can disagree about which config governs when run from a subdirectory.
- **Subdirectory `prisma init` skips the skills sync, postinstall script, and devDependency by default** (ruled 2026-08-25) — those steps belong to the repository root; lands as D4 of the slice, which needs D1's ancestor discovery to detect "subdirectory" at all.

## Left open by the config-file-resolution slice (2026-08-25)

- **`--config` does not reach the post-login skills tip.** `packages/cli/src/commands/auth/agent-setup-tip.ts` calls `readProjectSkillsConfig` via `projectConfigLoader(ctx.cwd)` — the disk loader anchored at cwd — because `CommandContext` does not expose the parsed `--config` flag to that path. A login run with `--config` shows the tip against the cwd-anchored chain instead of the named file's. Recorded from D3 review; pre-existing shape, low impact.

## Config-chain review findings deferred out of the slice (2026-08-25)

Post-merge review of the config-chain slice confirmed two issues whose fixes do not live in this repo:

- **Root-declared family sections resolve their relative paths against cwd.** The chain now delivers a root config's `composer`/`orm` sections to subdirectory runs, but the pinned family dists resolve `configPath`, contract inputs/output, and `migrations.dir` against `ctx.cwd` — they predate `resolveSectionPath`. Until composer-cli and orm-toolchain adopt declaring-file resolution, a root-declared relative path mis-resolves from subdirectories (wrong-path missing-file error, or silently the wrong file). Briefs delivered: `wip/composer-declaring-file-paths-brief.md`, `wip/orm-declaring-file-paths-brief.md`. Companion engine work: expose section provenance to validators/handlers (today it stops inside `resolveSectionOverChain`'s result) — coordinate the seam when the first family adopts it.
- **A marker-less Prisma 7 `prisma.config.ts` at the repo root blocks every config-needing command — including `prisma init` — in every subdirectory.** Chain evaluation is deliberately no-skip (ratified: a broken file anywhere fails resolution), and the missing-marker error is chain-fatal, so a repo migrating from Prisma 7 cannot run the v8 migration entry point anywhere until the old root config is updated or removed. The error does name the file and the fix. Softening this (for example, treating a marker-less ANCESTOR file as a warning while keeping cwd's own file fatal) would change the ratified no-skipping rule, so it needs an operator ruling before anyone implements it.
