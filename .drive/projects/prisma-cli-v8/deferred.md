# Deferred and follow-up items — prisma-cli-v8

Work identified during a slice that is not part of that slice's
contract. Each entry: what, why it was deferred, where it lands.
Nothing here is tracked outside this file.

## Still open after S3/D4 — all of it in the composer repo

D4 landed the prisma-cli half (the mount, the node floor, the divergence
file, the ledger corrections, the 1c closure). What is left needs a
composer checkout.

- **`loadAppConfigDiagnostics()` is called by nothing.** D2 rewrote
  composer's config loading to return diagnostics instead of
  throwing (contract R-S3-2), but `pipeline.ts` still calls the
  throwing `loadAppConfig`, so the rewrite is currently dead code —
  and the effect-resolution check that moved into it never runs.
- **`check:npm-effect-resolution` fixes are unverified.** D3 updated
  three assertions (help proves the family mounted; the adversarial
  `deploy` gets a service token because the credential check now
  precedes the tree check; `--help` must survive a broken dependency
  tree because the family's static graph is alchemy-free). The check
  performs real npm installs, so it needs network to run.
- **The engine pin moves off `0.0.3`** to whatever the tandem release
  publishes, in both composer manifests — and it must be the SAME
  version prisma-cli depends on. They disagree today: prisma-cli builds
  against the workspace engine and the preview composer pins
  `@prisma/cli-engine@0.0.7`, so an install of `@prisma/cli` carries two
  copies of the engine. It works (the settlement markers are
  `Symbol.for`, so they cross copies), but the tandem release is where
  it should stop being true.
- **The prisma bin's mount makes composer's help examples wrong.**
  Composer writes them as `{bin} deploy src/service.ts`; mounted under
  the `composer` root the invocation is `prisma composer deploy`, and
  the engine substitutes only `{bin}`. Fix needs both repos: a
  mount-aware placeholder in the engine (`{command}` → the command's
  mounted path) and composer's four example strings rewritten to use it.
  Recorded in `assets/s2/parity-divergences-s3.md`.

## Owned by whoever lands the next engine change

- **S3's SPI amendment vs credential-manager rev 6.** #136 recorded
  the spawn path's credential read against rev 5's surface and then
  adapted to rev 6's `activeCredentialStorage()` during the rebase.
  If rev 6's storage surface reshapes again, the single named
  consumer (`packages/cli-engine/src/execution/spawn.ts`) moves with
  it. Recorded in `assets/engine/credential-manager-design.md`.
- **A validated number flag**, if `--tail`'s old constraint is wanted
  back. `flag.number` accepts negatives and fractions, so "non-negative
  integer" is enforced nowhere. D4 took the other branch this item
  offered and widened the divergence entry instead
  (`assets/s2/parity-divergences-s3.md`), which also corrects this
  item's claim that legacy rejected non-integers — legacy truncated
  them silently, and rejected only negatives and `NaN`.

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
  imports one composer executor in a fresh prisma bin process and finds
  one SIGINT and one SIGTERM listener registered by the import alone —
  the exact condition the contract's design consequence 4 says nothing
  ships with. It does not fire on a normal run: the same process running
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

## Composer's public surface — ruled, closed

- **`ExtensionDescriptor.preflight` moved to method syntax** so an
  extension can type its input against its own client (the injected
  management client arrives there under S3's in-process credential
  leg). Consistent with `ContainerDescriptor` in the same file;
  loosens parameter checking for extension authors. RULED KEPT
  (operator, 2026-08-11). No further action; the change ships with
  S3 and needs a divergence entry only if it breaks a published
  extension, which it does not.
