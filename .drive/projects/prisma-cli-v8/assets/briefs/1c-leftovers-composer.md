# Brief: composer config-contract compliance and control-API test double

> **CLOSED at S3 closure (D4, 2026-08-11).** This brief was paused, and
> S3 has now settled all three deliverables — two of them by doing the
> work under a different contract, one by handing the remainder back.
> The dispositions are recorded at the end of this file. The brief is
> kept, not deleted: it is the statement of the problem each disposition
> answers, and the paused-work record in
> `../s3/composer-inventory.md` §6 points here.

Repo: prisma/composer (main). Three deliverables. Operator: Will Madden. Process: verify every claim against current code first; stop and report numbered questions with options and a recommendation on anything this brief doesn't settle.

## Context

Composer's error/result rules are recorded in its ADR-0043 and ADR-0044 (`docs/design/90-decisions/`): structured errors at origin with dotted codes from the closed registry, one `ok` discriminator, exit 1 = bug only. The registry in ADR-0044 is closed — a new subcode is an edit to that list in the same change. Constraint that must not move: the effect constellation stays pinned at `4.0.0-beta.103` via the consumer overrides block (alchemy is broken on effect >= beta.104; see `skills-contrib/upgrade-alchemy-effect/SKILL.md`).

## Deliverable 1: config validation returns diagnostics instead of throwing

Today `load-config.ts` / `validate-coverage.ts` throw on the first invalid field. Target semantics (the config contract all products will share):

- Loading a config returns the evaluated value **plus a diagnostics list** (structured errors, each tagged with the config section/field it concerns via `meta`), instead of throwing per field.
- Commands fail (exit 2, rendering the diagnostic) only when a section they need is invalid.
- A config module that cannot be evaluated at all yields one evaluation diagnostic (`CONFIG.EVALUATION_FAILED` already exists) and every command fails early with it.
- No import-time side effects and no throwing from `defineConfig`-equivalent factories: constructing a config value never throws; problems surface as diagnostics at load time.
- Pin representative rendered/`--json` output before and after — user-visible behavior for currently-failing configs may only change in framing.

## Deliverable 2: effect-resolution preflight becomes a diagnostic

`check-effect-resolution.ts` currently detects a mismatched `effect` in the consumer's tree by throwing during import, which takes out every command — including ones that never touch the deploy executor. Target:

- The preflight runs at config-load/command-dispatch time, not import time, and surfaces as a structured diagnostic (`DEPS.EFFECT_VERSION_CONFLICT`, already registered) carried in the diagnostics list from Deliverable 1.
- Commands that need the executor fail early rendering it; commands that don't (e.g. help, config inspection) still work.
- The lazy executor-load failure path (`DEPS.EXECUTOR_UNLOADABLE`) is unchanged — it remains the backstop when the preflight didn't fire.
- The effect-CI probe and the `npm install effect dedupe` check must still pass; do not weaken either.

## Deliverable 3: published test double for the control API

Hosts driving `@prisma/composer/control` (deploy/destroy/dev/log) need a double that never spawns alchemy or containers. Export a fixture-backed double from a published entrypoint (placement judged against the existing `./control` shim in `packages/9-public/composer`): same operation signatures, same `Result<…, CliStructuredError>` shapes, per-operation fixtures overridable per test, including a `DevSession` double whose lifecycle methods behave. Add a compile-time conformance check that the double's surface matches the real operations.

## Verification (all must pass before pushing)

`pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:casts` (delta 0), `pnpm lint:deps` (all sub-checks), `@internal/cli` and integration test suites, `pnpm run check:npm-effect-resolution`. Known pre-existing failures that are not yours to fix: the `@internal/local-target` timeout pair.

## Commit discipline

Explicit staging only. `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, body ends with `Co-Authored-By: <your model attribution>`. Composer's `origin` in the operator's clones is the bot SSH alias; verify the target PR is open before pushing to an existing PR branch.

## Dispositions (S3 closure, D4)

**Deliverable 1 — config validation returns diagnostics: SUPERSEDED, and
done.** S3's contract rule R-S3-2 asked for the same semantics from a
different starting point — the engine's `ConfigSection.validate` must
return `SectionValidation<T>` and must never throw — so composer's
throwing loader was rewritten to value-plus-diagnostics under that rule
in D2 rather than under this brief. What the brief asked for is what
shipped: a loaded config carries structured diagnostics tagged with the
section they concern, commands fail only on a section they need, an
unevaluable module yields one evaluation diagnostic, and nothing throws
from construction. The rendering is the engine's rather than composer's
own. One thing the brief listed is not S3's to claim: the
before/after pinning of rendered output for currently-failing configs.
The rendering surface changed wholesale with the engine port, so the
guarantee "user-visible behaviour may only change in framing" was
overtaken; the change is enumerated in
`../s2/parity-divergences-s3.md` instead.

**Deliverable 2 — effect-resolution preflight becomes a diagnostic:
SPLIT.** The part S3 had to own is the part with nowhere else to live:
the prisma bin has no composer `bin.ts` to run an import-time check in,
so the check moved INTO the shared config-load machinery (R-S3-2),
where it surfaces as the already-registered
`DEPS.EFFECT_VERSION_CONFLICT` diagnostic. The user-visible consequence
— commands that need no config, `--help` included, now survive a
mismatched `effect` in the consumer's tree — is recorded in the
divergence file. **The rest stays with the composer team**: the
`DEPS.EXECUTOR_UNLOADABLE` backstop is untouched by S3 and was never
verified against the new path, and the two checks the brief names
(`check:npm-effect-resolution`, the effect CI probe) were updated in D3
but not run, because they perform real npm installs and need network —
tracked in `../../deferred.md`. Whoever runs them owns any fallout.

**Deliverable 3 — published control-API test double: DELIVERED**, as
S3's R-S3-5 test surface (2). It is exported from composer's `./testing`
entrypoint, fixture-backed with the same operation signatures and a
working `DevSession` double, with the compile-time conformance check the
brief asked for, plus one requirement the brief did not state and S3
does: its built chunk must contain no import path to the real
implementation, verified by building the tarball and grepping the chunk
for alchemy and effect. The family export takes an optional operations
argument (`createComposerFamily({ operations })`) so a host can mount
the real grammar against the double, which is how prisma-cli's family
tests stay free of alchemy and containers.
