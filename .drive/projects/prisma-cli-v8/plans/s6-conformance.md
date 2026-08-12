# S6 dispatch plan — Conformance checker (revision 1)

Contract: `specs/s6-conformance.md`. Read it first; this plan decides nothing the contract leaves open.

**Scope split against the open questions.** Dispatches D1–D4 build the three checks and wire them into prisma-cli's own publish path. That work is correct under every option of every open question: prisma-cli is in scope under all readings of "both products", it has no conformance checks today, and the checks' implementations do not change with who else consumes them. D5 is the cross-repo wiring and is **blocked** on the rulings for questions 1, 2 and 4 — it is specified here so the shape is visible, but it is not dispatched until the operator rules.

## Shape

One private workspace package holding the checks as injected functions, plus a thin entry that supplies prisma-cli's own subjects. The split is what makes the same checks reusable from another repo later without moving code: a second repo needs a new entry, not a new checker.

```text
packages/cli-conformance/          @repo/cli-conformance, private
  src/
    findings.ts                    Finding, Report, human + --json rendering
    module-graph.ts                bare import roots of a built directory, via es-module-lexer
    checks/import-purity.ts        check 1
    checks/validator-no-throw.ts   check 2 + the hostile corpus
    checks/tarball.ts              checks 3a, 3b, 3c
    run.ts                         runs supplied subjects, returns an exit code
    bin.ts                         prisma-cli's subjects: its two published packages, the shell's families
  tests/                           vitest, per check
  fixtures/                        in-repo fake package trees
```

Root script `check:conformance` → `tsx packages/cli-conformance/src/bin.ts`. `tsx` rather than a built entry so the checker has no build-ordering relationship with the packages it inspects; it reads their `dist/`, which `pnpm build` has already produced by the time any publish path reaches it.

**Where the real pack-and-install runs.** The unit tests inject the pack, install and bin-start seams, so `pnpm test` stays fast. The real packing and the real out-of-workspace `npm install` happen when `check:conformance` itself runs — in CI, and locally when verifying the slice. That keeps one slow operation in the place whose job is to be slow, instead of in the suite everyone runs.

## D1 — findings, the module graph, and check 1 (import purity)

Tests first, in this order:

1. `module-graph.test.ts` — over `fixtures/graph/`: a static `import … from`, an `export … from`, a dynamic `import()`, a deep subpath (`pkg/sub/thing` reports root `pkg`), a scoped name, a relative and an absolute specifier (both ignored), `node:fs` and bare `fs` (both ignored), a nested chunk in a subdirectory (found), and — the case that decides the whole approach — a file containing `import.meta.resolve("@repo/private")` and the same name inside a template literal, neither of which is an import.
2. `import-purity.test.ts` — a fixture whose built output imports a package the manifest does not declare reports exactly one finding naming the file and the specifier; a fixture that declares it in `peerDependencies` reports none; a private name reports a finding unless it is in the caller's allowed list; a declared runtime dependency that nothing imports reports a finding of its own kind.

Then implement. `checkImportPurity({ label, distDir, manifest, allowedPrivate })` returns findings; it reads nothing ambient and resolves no paths of its own beyond `distDir`.

**Acceptance:** the two suites pass, and `checkImportPurity` run against the real `packages/cli/dist` and `packages/cli-engine/dist` returns no findings — which the contract records as already true, measured with the same lexer.

## D2 — check 2 (validator no-throw)

Tests first:

1. `validator-no-throw.test.ts` — a section whose validator throws unconditionally reports a finding naming the section and the input that provoked it; a section that throws only on the `Proxy` trap case reports one finding, which proves the corpus reaches that path; a section returning a malformed value (neither `ok: true` with a `value` nor `ok: false`) reports a finding of its own kind; composer's real `composerSection` reports none.
2. The corpus itself is asserted to contain each documented case, so a future edit cannot quietly shrink it.

Then implement `checkValidatorNoThrow({ sections })` over the corpus the contract fixes: `undefined`, `null`, each primitive type, empty and populated arrays, a function, a `Symbol`, `NaN`, a frozen object, a null-prototype object, a deeply nested object, a self-referencing object, an object carrying the section's own field names with wrong-typed values, a `Proxy` whose `get` and `ownKeys` traps throw, and an object with a throwing getter.

**Acceptance:** the suite passes, and the check run against the sections the shell's families declare returns no findings.

## D3 — check 3 (tarball verification)

Add `export const commandFamilies: readonly CommandFamily[] = [platformCommandFamily, composerCommandFamily]` to `packages/cli/src/v8/cli.ts` and have `buildCli()` use it, so the checker consumes the shell's own mount list instead of a second list that can drift from it. The two consts are already exported there; this only names the array.

Tests first, all with injected seams:

1. `tarball.test.ts` — 3a: a packed manifest whose declared dependencies do not cover the packed output's imports reports a finding. 3b: a packed manifest with two `bin` entries starts both, and a non-zero exit from either reports a finding naming that bin; a failing install reports a finding carrying the installer's output rather than throwing. 3c: a shell manifest pinning the engine at one version and a family manifest pinning another reports a finding naming both versions and both packages; equal versions report none; a family that does not depend on the engine at all reports none; **and the exception list suppresses a named package's finding while leaving every other mismatch reported.**
2. One test asserts the check reports the live shell-versus-composer mismatch when the exception list is empty. That is the test whose failure, once composer republishes and the exception is deleted, means the real defect is being caught.

Then implement `checkTarball({ packages, exceptions, io })` where `io` carries `pack`, `installSandbox`, `startBin` and `readPackedManifest`. The default `io` packs with `pnpm pack`, builds the sandbox manifest with absolute `file:` paths for workspace siblings under npm `overrides`, and installs with `npm install --no-audit --no-fund`.

**Acceptance:** the suite passes; `check:conformance` run locally packs both published packages, installs out of the workspace, starts every declared bin at exit 0, reports no 3a findings, and reports the composer engine mismatch as suppressed-by-exception with the exception's reason printed.

## D4 — wire prisma-cli's publish path, and the records

- `.github/workflows/publish.yml`: a `Run conformance checks` step calling `pnpm check:conformance`, placed after `Run script tests` and before both publish steps, so it guards the dry-run and the real publish alike.
- `.github/workflows/pr-quality.yml`: the same script in the existing Test job. The three checks are cheap except the install, and finding a broken tarball on the pull request rather than at publish time is the point. If the install proves too slow for pull requests, the fast checks run there and the full set only at publish — decided by measurement, not in advance.
- Root `package.json`: the `check:conformance` script.
- `specs/s6-conformance.md`: acceptance boxes ticked with evidence.
- The project `plan.md` §S6 and `spec.md`'s definition-of-done line updated to the wording the rulings settle, including what S5 must wire in prisma/prisma.
- `deferred.md`: the composer engine-pin exception, with the condition for deleting it.

**Acceptance:** `pnpm typecheck`, root `pnpm lint` and the touched suites green, each measured as pnpm's own exit code with `wip/` moved aside; `check:conformance` green locally.

## D5 — cross-repo wiring (BLOCKED on questions 1, 2 and 4)

Not dispatched. Under the contract's recommended answers this is: composer's `check-cli-engine-pin.mjs` gains a comparison against the shell's published engine pin, composer's existing packed-output checks move from pull-request CI into its publish path (they are absent there today, which is a real hole independent of S6), and prisma/prisma is wired as part of S5 rather than now. Under other answers it is a larger change in two repos this slice does not own. Either way it needs push access to those repos confirmed, which is a separate question from the three above.

## Verification per dispatch

The touched packages' suites, `pnpm typecheck`, and root `pnpm lint`, each measured as pnpm's own exit code with `wip/` moved aside in one shell:

```bash
mv wip /tmp/wip-stash && pnpm lint; s=$?; mv /tmp/wip-stash wip; echo "lint exit $s"
```

## Risks

- **The sandbox install needs the network.** It resolves ~438 packages. A registry outage fails the publish path for a reason that is not a defect. The install failure is reported as its own finding kind carrying the installer's output, so the cause is legible rather than looking like a broken tarball.
- **Cold install cost.** 37 s cold, 12 s warm in measurement. Acceptable in a publish path; measured before deciding whether it belongs on every pull request.
- **The exception list is a place for problems to be parked.** Each entry carries a reason and the condition for its removal, and D3's test proves an empty list catches the real defect, so deleting an entry is how the check starts working rather than a hoped-for future edit.
