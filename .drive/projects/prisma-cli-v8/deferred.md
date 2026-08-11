# Deferred and follow-up items — prisma-cli-v8

Work identified during a slice that is not part of that slice's
contract. Each entry: what, why it was deferred, where it lands.
Nothing here is tracked outside this file.

## Owned by S3/D4 (the slice's closing dispatch)

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
  publishes, in both composer manifests.
- **Contract corrections at closure**: ledger Q2 (main's #135 dropped
  `service run` outright, so S3 no longer "closes" it by building the
  mechanism — the mechanism exists, the command does not), and the
  coverage-ledger rows for "refresh under long runs" and "config
  sections" (see contract §10).

## Owned by whoever lands the next engine change

- **S3's SPI amendment vs credential-manager rev 6.** #136 recorded
  the spawn path's credential read against rev 5's surface and then
  adapted to rev 6's `activeCredentialStorage()` during the rebase.
  If rev 6's storage surface reshapes again, the single named
  consumer (`packages/cli-engine/src/execution/spawn.ts`) moves with
  it. Recorded in `assets/engine/credential-manager-design.md`.
- **`--tail` validation is wider than the recorded divergence.** The
  engine's `flag.number` accepts negatives and non-integers; legacy
  `composer log --tail` rejected both. Either the flag gains
  validation or the divergence entry widens.
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
  glyph-mode.ts`). The engine emits `✔ ✖ ⚠ ℹ` unconditionally today and
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
