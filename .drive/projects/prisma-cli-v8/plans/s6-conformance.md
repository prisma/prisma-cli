# S6 dispatch plan — Conformance checker (revision 2)

Contract: `specs/s6-conformance.md` revision 2. Read it first; this plan decides nothing the contract leaves open.

**Scope split against the open questions.** Revision 1 claimed D1–D4 were correct under every ruling. That was wrong, and the architect review said so: D3 builds the exception list that STOP-3 might discard, its bin-start input shape depends on STOP-6, the package's name and privacy depend on STOP-4, and D4 edits records that STOP-1 and STOP-2 settle. The honest split:

- **D1 and D2 are ruling-independent.** The module graph, check 1 and check 2 are the same code under every answer to every question.
- **D3 and D4 need STOP-3, STOP-4 and STOP-6 first.** They are specified here so the shape is visible and reviewable, and dispatched once ruled.
- **D5, the cross-repo wiring, needs STOP-1, STOP-2 and STOP-4.**

## Shape

One workspace package holding the checks as injected functions, plus a thin entry supplying prisma-cli's own subjects. The split is what makes the same checks reusable from another repo later: a second repo needs a new entry, not a new checker. Note the limit the architect review identified — under STOP-4(a) there is exactly one consumer, so this shape buys testability rather than reuse, and check 1 cannot express the assertion composer actually needs ("this specifier must *survive* in the built output", because composer bundles its internal scope and an inlined engine leaves no specifier at all). That is composer's existing `check-cli-engine-pin.mjs`, and it stays composer's.

```text
packages/cli-conformance/          name and privacy per STOP-4
  src/
    findings.ts                    Finding, Report, human + --json rendering
    module-graph.ts                bare import roots of a built directory, via es-module-lexer
    checks/import-purity.ts        check 1
    checks/validator-no-throw.ts   check 2 + the hostile corpus
    checks/tarball.ts              checks 3a, 3b, 3c
    run.ts                         runs supplied subjects, returns an exit code
    bin.ts                         prisma-cli's subjects
  tests/                           vitest, per check
  fixtures/                        in-repo fake package trees
```

Root script `check:conformance`. **Where the real pack-and-install runs:** the unit tests inject the pack, install and bin-start seams, so `pnpm test` stays fast. The real packing and the real out-of-workspace install happen when `check:conformance` runs — in CI, and locally when verifying the slice. One slow operation, in the place whose job is to be slow.

## D1 — findings, the module graph, and check 1 (import purity) — READY

Tests first, in this order:

1. `module-graph.test.ts` — over `fixtures/graph/`: a static `import … from`, an `export … from`, a dynamic `import()`, a deep subpath (`pkg/sub/thing` reports root `pkg`), a scoped name, a relative and an absolute specifier (both ignored), `node:fs` and bare `fs` (both ignored), a nested chunk in a subdirectory (found), and — the case that decides the whole approach — a file containing `import.meta.resolve("@repo/private")` and the same name inside a template literal, neither of which is an import.
2. `import-purity.test.ts` — an undeclared import reports one finding naming file and specifier; the same name in `peerDependencies` reports none; a private name reports a finding unless in the caller's allowed list; a declared runtime dependency nothing imports reports a finding of its own kind; **an empty directory reports a finding rather than passing**; **a directory whose output lacks the caller's required specifier reports a finding** (the anti-vacuity requirement).

Then implement. `checkImportPurity({ label, distDir, manifest, allowedPrivate, requiredSpecifiers })` returns findings; reads nothing ambient, resolves no paths beyond `distDir`.

**Acceptance:** both suites pass; run against the real `packages/cli/dist` and `packages/cli-engine/dist` it returns no findings, which the contract records as already measured with the same lexer.

## D2 — check 2 (validator no-throw) — READY

Tests first:

1. `validator-no-throw.test.ts` — a validator that throws unconditionally reports a finding naming the section and the provoking input; one that throws only on the `Proxy` trap case reports one finding, proving the corpus reaches that path; a malformed return reports a finding of its own kind; an empty section list reports a finding; composer's real `composerSection` reports none.
2. The corpus is asserted to contain each documented case, so a later edit cannot quietly shrink it.

Then implement `checkValidatorNoThrow({ sections })` over the corpus the contract fixes.

**Subject derivation.** The union the engine uses, per contract §3: family `configSection`s plus every mounted command's `needs.config`, matching `packages/cli-engine/src/execution/engine.ts:740-751`. Both inputs are already exported from `packages/cli/src/v8/cli.ts` — `mountedCommands` at 170, the families at 74 and 136. Under STOP-8(a) the checker re-derives this and the drift risk is recorded; a test asserts the derived name set is what the shell mounts.

**Acceptance:** the suite passes; run against the shell's sections it returns no findings.

## D3 — check 3 (tarball verification) — BLOCKED on STOP-3, STOP-6

Add `export const commandFamilies: readonly CommandFamily[] = [platformCommandFamily, composerCommandFamily]` to `packages/cli/src/v8/cli.ts`, used by `buildCli()`. This serves **check 2**, whose subjects are section objects the families carry. It does **not** serve 3c: `CommandFamily` carries `configSection`, `commands`, `docsBaseUrl` and `redirects` and no package identity at all (`packages/cli-engine/src/command-family.ts:49-59`), so 3c cannot learn a family's package name from it. 3c's family-package list is therefore hand-written in `bin.ts` alongside the shell's own imports, and a test asserts every name in it appears in the shell's packed manifest `dependencies` — which is what keeps it in step, since a family the shell mounts must be a package the shell depends on.

Tests first, all with injected seams:

1. `tarball.test.ts` — 3a: a packed manifest not covering the packed output's imports reports a finding. 3b: two `bin` entries are both started, a non-zero exit from either reports a finding naming that bin, and a failing install reports a finding carrying the installer's output rather than throwing. 3c: differing pins report a finding naming both versions and both packages; equal pins report none; a family not depending on the engine reports none; an installed family version differing from the shell's declared pin reports a finding; more than one engine copy in the install tree reports a finding; a non-exact packed engine pin reports a finding.
2. The exception list: keyed on the observed triple (family package, its engine pin, the shell's engine pin), it suppresses that exact combination and nothing else. A test proves the same family arriving at a *third* version is still reported.
3. One test asserts 3c reports the live shell-versus-composer mismatch when the exception list is empty. That is the test whose failure, once composer republishes and the exception is deleted, means the real defect is being caught.

Then implement `checkTarball({ packages, familyPackages, exceptions, io })` where `io` carries `pack`, `installSandbox`, `startEntry`, `readPackedManifest` and `readInstalledManifest`. The default `io` packs with `pnpm pack`, builds the sandbox manifest with absolute `file:` paths under **version-qualified** npm `overrides` (the form the contract proves preserves the divergence), installs with `npm install --no-audit --no-fund`, and removes the sandbox in a `finally` so a failure does not leak it.

**Acceptance:** the suite passes; `check:conformance` locally packs both published packages, installs out of the workspace, starts every declared bin plus `dist/v8/cli.js` at exit 0 (per STOP-6(b)), reports no 3a findings, and reports the composer mismatch as suppressed by a named exception with its reason printed.

## D4 — wire prisma-cli's publish path, and the records — BLOCKED on STOP-1, STOP-2, STOP-4

- `.github/workflows/publish.yml`: a `Run conformance checks` step calling `pnpm check:conformance`, after `Run script tests` and before both publish steps so it guards the dry-run and the real publish alike — carrying `if: ${{ steps.version.outputs.publish == 'true' }}`, the condition both its neighbours have at lines 103-109. Without it the step runs on pushes that publish nothing and fails on an unbuilt tree.
- `.github/workflows/pr-quality.yml`: the same script in the Test job, **preceded by an explicit `pnpm build`**. Nothing in the workspace depends on `@prisma/cli`, and turbo's `test` task depends only on `^build`, so `pnpm test` never builds the shell's own `dist` — the check would read a directory that is not there. If the install proves too slow for pull requests, the fast checks run there and the full set only at publish, decided by measurement.
- Root `package.json`: the `check:conformance` script.
- `specs/s6-conformance.md`: acceptance boxes ticked with evidence.
- `plan.md` §S6: what shipped, and what S5 must wire in prisma/prisma.
- `spec.md`'s DoD line: **left as written and unchecked**, with the S5 and composer dependencies recorded against it. Revision 1 planned to reword it to match what shipped; that turns an unmet requirement into a met one by editing the requirement.
- `deferred.md`: the composer engine-pin exception, keyed on the observed triple, with the condition for deleting it.

**Acceptance:** `pnpm typecheck`, root `pnpm lint` and the touched suites green, each measured as pnpm's own exit code; `check:conformance` green locally.

## D5 — cross-repo wiring — BLOCKED on STOP-1, STOP-2, STOP-4

Not dispatched. Under the recommended answers: composer's `check-cli-engine-pin.mjs` gains a comparison against the shell's published engine pin, and composer's existing packed-output checks move from pull-request CI into its publish path — they are absent there today, which is a real hole independent of S6. prisma/prisma is wired as part of S5. Push access is not a blocker: the bot has push on `prisma/composer`, `prisma/prisma` and `prisma/prisma-cli` (checked 2026-08-12).

## Verification per dispatch

The touched packages' suites, `pnpm typecheck`, and root `pnpm lint`, each measured as pnpm's own exit code. The `wip/` stash stays **inside the worktree** — the operator's standing rule forbids temp directories for working files, and revision 1's command moved it to `/tmp`:

```bash
mv wip .wip-stash && pnpm lint; s=$?; mv .wip-stash wip; echo "lint exit $s"
```

## Risks

- **The sandbox install needs the network**, resolving ~440 packages. A registry outage fails the publish path for a reason that is not a defect, so the install failure is its own finding kind carrying the installer's output — legible rather than looking like a broken tarball.
- **Cold install cost**: 37 s cold, 12–13 s warm. Acceptable in a publish path; measured before deciding whether it belongs on every pull request.
- **The exception list is a place for problems to be parked.** Each entry carries a reason and its removal condition, it is keyed tightly enough that any change on either side reopens the finding, and D3's test proves an empty list catches the real defect.
- **Check 1's flat sweep cannot see a missing subpath export.** `@prisma/composer/family` must exist for the shell to work and no check here would notice it vanishing. Recorded in the contract, not solved by this slice.
