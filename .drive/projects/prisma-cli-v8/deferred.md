# Deferred and follow-up items — prisma-cli-v8

Work identified during a slice that is not part of that slice's
contract. Each entry: what, why it was deferred, where it lands.
Nothing here is tracked outside this file.

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
  support.
- **The prisma bin's mount makes composer's help examples wrong.**
  Composer writes them as `{bin} deploy src/service.ts`; mounted under
  the `composer` root the invocation is `prisma composer deploy`, and
  the engine's `resolveExample` substitutes only `{bin}`. Fix needs both
  repos: a mount-aware placeholder in the engine (`{command}` → the
  command's mounted path) and composer's eight example strings — two on
  each of the four commands — rewritten to use it. Recorded in
  `assets/s2/parity-divergences-s3.md`.

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
- **`spawn-real-child.test.ts` also fails under load, and is a
  different test from the one below.** In
  `packages/cli-engine/tests/spawn-real-child.test.ts`, the case
  "native Ctrl-C reaches the child through the shared process group"
  failed twice during the engine-colour slice, both times on a machine
  running the engine and CLI suites concurrently — on the second
  sighting that run's import phase took 92s against a normal 3–7s. It
  passed on every isolated and sequential run either side. Nothing in
  that slice goes near spawn or signals, so this is not its doing.
  Two independent sightings under load make it worth diagnosing rather
  than watching: the likely shape is the same as the entry below, a
  test that waits on a marker the child writes before it is actually
  ready for the signal.
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

## Answered, feeding a later slice

- **S8's planner question is settled** (D2's read of alchemy
  `2.0.0-beta.67`): the deploy path plans on **props only** and never
  compares attributes, so Composer's domain-field mismatch causes no
  per-run redeploy. S8's promote/rollback/start/stop design does not
  have to defend against Alchemy reverting imperative changes on the
  next deploy. Full citations in `assets/s3/composer-inventory.md`
  §4a and D2's report.

## Left open by S8 — the service family

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
