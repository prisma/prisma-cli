# Deferred and follow-up items — prisma-cli-v8

Work identified during a slice that is not part of that slice's
contract. Each entry: what, why it was deferred, where it lands.
Nothing here is tracked outside this file.

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
- **The prisma bin's mount makes composer's help examples wrong.**
  Composer writes them as `{bin} deploy src/service.ts`; mounted under
  the `composer` root the invocation is `prisma composer deploy`, and
  the engine's `resolveExample` substitutes only `{bin}`. Fix needs both
  repos: a mount-aware placeholder in the engine (`{command}` → the
  command's mounted path) and composer's eight example strings — two on
  each of the four commands — rewritten to use it. Recorded in
  `assets/s2/parity-divergences-s3.md`.

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
- **Transient-read retry on `build logs` streaming** (#104): joins the
  existing streaming follow-ups below.

## Ratified-as-shipped at the S2 sign-off (2026-08-12) — the gaps stay real

- **Streaming service logs is unavailable in any form.** `app logs` died
  with the commander shell and `service logs` waits on an engine
  streaming transport. The one capability loss of S2d; the S2c record
  has the design notes.
- **`build logs` cannot exit 1 on a failed build** until the engine
  grows a way for a stream to settle with a documented non-zero code.
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
  `credentials: "child"` command hands the child a snapshot of the
  access token and never the refresh token
  (`packages/cli-engine/src/execution/spawn.ts`), and the only check is
  the near-expiry refusal in `execution/needs.ts`:
  `CREDENTIAL_NEAR_EXPIRY_MS` is 5 minutes, so the guarantee at spawn is
  "more than five minutes left", not "enough for this run". A converge
  that outlives the snapshot fails on an expired token, after the child
  has already created resources. Two ways out, both unbuilt: hand the
  child something that can refresh, or bound the child's run and refuse
  when the remaining lifetime cannot cover it. Recorded as a release
  limitation in `plan.md`'s coverage ledger.
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

- **alchemy-run/node-utils#6** (scope exit hooks to owned locks) is
  open. Vendored as a pnpm patch in composer
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
- **`service logs` is a follow-up slice, and its transport question is
  ANSWERED (R-S8-5).** API owners, via operator, 2026-08-12: **HTTP
  instead of WebSocket is acceptable, provided live streaming can be
  added at a later date.** So no engine socket transport was built. The
  command lands as a copy of `build logs` — plain HTTP,
  `parseAs: "stream"` — in a follow-up slice, once the platform endpoint
  serves HTTP. The engine WebSocket design
  (`assets/engine/websocket-transport-design.md`) is **shelved as the
  later live-streaming path, not deleted.** The ownership question the
  plan raised dissolved on investigation: `composer log` attaches to the
  local dev daemon's streams, a `service deployment logs` would read the
  platform endpoint — different data, no shared subgroup.
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
