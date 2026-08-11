# Dispatch plan — the package-manager capability

Slice contract: `engine-package-manager-capability.md` (amended 2026-08-11).
Branch: `spec/package-manager-capability` (PR #140). Five dispatches, sequential.

Verification for every dispatch (repo `AGENTS.md`): `pnpm --recursive exec tsc
--noEmit`, `pnpm lint`, and the changed package's tests. The engine's own
`pnpm --filter @prisma/cli-engine test` runs build + typecheck + vitest, so the
type tests are part of it.

## D1 — Detection and the spelling table

**Outcome.** One engine-internal module resolves a concrete `PackageManagerId`
from a directory and spells every command line the engine will ever run, for
all five managers and both forms. `Runtime.packageManager` stops being the
source of truth and survives only as an optional host override, which
`resolvePackageManager` takes as its `host` argument;
`missingDependencyError` reads the new table; `'unknown'` is out of the
codebase.

**Focus.** `package-manager-detector` exact-pinned at `1.8.0` as an engine
dependency (zero transitive dependencies — verify before adding). Precedence
per spec §3.1: explicit override, then optional `Runtime.packageManager`, then
`detect({ cwd })`, then the library's `getUserAgent()`, then `'npm'`. Spelling
matches the ORM's table exactly, including npm's `add` alias and deno's `npm:`
prefixes.

Demoting `Runtime.packageManager` to an override touches its two former call
sites (`execution/needs.ts`, `execution/command-context.ts`), which read the
detected manager instead; the harness seed in `src/testing.ts`, which becomes
that override unchanged; the `Runtime` literal in `tests/engine.type-test.ts`;
and the bin's `assembleRuntime` in `packages/cli/src/v8/runtime.ts`, which
stops populating the field — its `detectPackageManager` helper dies with it.

**Builds on.** Nothing.
**Hands to.** D2: a detection function and a spelling table, unit-tested per
manager and per precedence step, with no remaining reference to `'unknown'`.

## D2 — The Runtime seam and the bin's implementation

**Outcome.** `Runtime.runPackageManager` exists with the `onOutput` callback,
the bin implements it over execa, and a real `prisma` process can run a
package manager. The engine still imports no `child_process`.

**Focus.** Seam shape per spec §2.3. The bin adapter streams stdout and stderr
to `onOutput` as they arrive AND accumulates stderr bounded to the last 64 KiB.
Cancellation wires `signal` through to the child. `createTestCli` gains the
`packageManagerRunner` seed; absent seed must still resolve the
runner-unavailable path rather than throwing.

**Builds on.** D1's `PackageManagerId`.
**Hands to.** D3: an execution seam that can be driven from tests by a scripted
fake and from the bin by a real child process.

## D3 — `ctx.packages`, the capability flag, and the structured failure

**Outcome.** `installsPackages: true` puts a typed `ctx.packages` on the
context; both operations run end to end through the seam; failures are
`CLI.PACKAGE_MANAGER_FAILED` with the documented meta; redaction, step events,
and `output` events are in place.

**Focus.** Mirror `managesCredentials` exactly — the fifth generic, the
intersection in `Handler`, the two `defineCommand` overloads, the
`Object.defineProperty` attachment in `execution/command-context.ts`, the flag
read in `execution/engine.ts`. One exported error constructor for the code, per
the engine's one-constructor-per-code discipline. Redaction is its own
unit-tested helper. New public types go through `src/exports/index.ts`.

Three behaviors that are easy to miss: cancellation THROWS the abort reason
(§3.6) rather than resolving `notOk`; a second concurrent call is a caller bug
raising `CLI.INTERNAL_ERROR` (§3.7); no message interpolates a hardcoded
manager name (§3.5).

**Builds on.** D2's seam.
**Hands to.** D4: a working capability with unit coverage.

## D4 — The proof: a sample command's install matrix, offline

**Outcome.** A command declaring `installsPackages` exercises success, failure,
the pnpm→npm retry shape, cancellation, and the absent runner — all through
`createTestCli` with no network and no real package manager — plus type tests
asserting `ctx.packages` exists if and only if the capability is declared.

**Focus.** The retry case must prove the ORM's real fallback is expressible:
script the fake to fail with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` in stderr,
assert the handler can match it off `meta.stderrTail` after redaction, and
assert the second call goes out with `manager: 'npm'`. Assert human and json
output per the repo's testing bar (`docs/onboarding/testing.md`).

**Builds on.** D3.
**Hands to.** D5: green evidence the surface works as specified.

## D5 — The R13 amendment

**Outcome.** R13 in `docs/architecture/cli-engine-requirements.md` names the
exception in its own words, per spec §7, and the prohibition on hidden package
state stands unchanged.

**Focus.** Documentation only, no code. Keep R13's existing voice — the
requirement states a rule and then a **Why:** paragraph grounded in the history
that motivated it.

**Builds on.** D3 (the amendment describes what actually shipped).
**Hands to.** Slice done.

## Follow-up dispatches (added after the five planned ones)

**D6 — success returns nothing.** `install` and `run` resolve `okVoid()`;
the sample command presents warnings instead of the command lines it ran.

**D7 — merge `main`.** `ctx.spawn`, the c12 config loader and the
`app` → `service` rename all landed while this branch was built.

**D8 — the review's findings.** Two confirmed secret leaks in redaction,
an unpaired step event on cancellation, an announce-and-spawn on an
already-aborted run, substring matching on secret names, a quadratic
stderr tail, two untrue claims in prose, the failure constructor made
private, and the terminal-ownership interlock against `ctx.spawn`.

## Settled during review

The `deno` widening of `PackageManagerId` (spec §2.2, amendment 3) was
approved by the operator on 2026-08-11.
