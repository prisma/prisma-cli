# S6 dispatch plan — Conformance checker (revision 3)

Contract: `specs/s6-conformance.md` revision 3. Read it first; this plan decides nothing the contract leaves open.

**State: D1 and D2 are DONE.** `packages/cli-conformance` holds the module graph, check 1 and check 2; the two checked packages call them on themselves. 35 tests, written before the code: 31 in the checker's own suite, 3 in the shell's, 1 in the engine's. Both checks pass against what this repo ships — composer's real validator survives the 21-case hostile corpus, and both published packages' built output imports only what they declare. `pnpm lint`, `pnpm typecheck` and `turbo run test --concurrency=1` are green; plain `pnpm test` fails on a pre-existing race recorded in `deferred.md`, which the base commit fails too. D3, D4 and D5 remain blocked as marked below.

**Scope split against the open questions.** Revision 1 claimed D1–D4 were correct under every ruling. That was wrong, and the architect review said so: D3 builds the exception list that STOP-3 might discard, its bin-start input shape depends on STOP-6, the package's name and privacy depend on STOP-4, and D4 edits records that STOP-1 and STOP-2 settle. The honest split:

- **D1 and D2 are ruling-independent.** The module graph, check 1 and check 2 are the same code under every answer to every question.
- **D3 and D4 need STOP-3, STOP-4 and STOP-6 first.** They are specified here so the shape is visible and reviewable, and dispatched once ruled.
- **D5, the cross-repo wiring, needs STOP-1, STOP-2 and STOP-4.**

## Shape

One workspace package holding the checks as injected functions, and each checked package calling them on itself. That split is what makes the same checks reusable from another repo later: a second repo needs its own call site, not its own checker.

Note the limit the architect review identified: under STOP-4(a) there is exactly one repo consuming this, so the shape buys testability rather than reuse today. And check 1 cannot express the assertion composer actually needs — "this specifier must *survive* in the built output", because composer bundles its internal scope and an inlined engine leaves no specifier at all. That is composer's existing `check-cli-engine-pin.mjs`, and it stays composer's.

```text
packages/cli-conformance/          @repo/cli-conformance, private — name per STOP-4
  src/                             depends on es-module-lexer and nothing it checks
    findings.ts                    Finding, Report, exitCodeFor, human + json rendering   DONE
    module-graph.ts                bare import roots of built output, via es-module-lexer  DONE
    subjects.ts                    CheckableSection + the engine's own section union       DONE
    checks/import-purity.ts        check 1                                                 DONE
    checks/validator-no-throw.ts   check 2 + the 21-case hostile corpus                    DONE
    checks/tarball.ts              checks 3a, 3b, 3c                                       D3
  tests/                           31 tests over injected values and source strings
  tests/fixtures/built-output/     the one on-disk fixture: the directory walk

packages/cli-engine/tests/conformance.test.ts   check 1 on its own built output    DONE
packages/cli/tests/v8-conformance.test.ts       check 1 + check 2 on the shell      DONE
```

**Each subject is checked by the package that owns it.** Revisions 1 and 2 put the real-subject runs inside the conformance package, which meant it had to depend on `@prisma/cli` — and that inverted arrangement made its `tsc --noEmit` traverse the shell's whole command tree and depend on the engine's built declarations. It failed in practice. The checker now depends on nothing it checks, declares the one shape it needs structurally, and the two consumers call it on themselves from suites that already typecheck those trees.

Reached through a **turbo task**, not a bare root script: `"conformance": { "dependsOn": ["^build"], "cache": false }` in `turbo.json`, owned by `@repo/cli-conformance`, with root script `"check:conformance": "turbo run conformance"`. The checks read `packages/cli/dist` and `packages/cli-engine/dist`, and neither workflow guarantees them — `pr-quality.yml`'s Test job never runs `pnpm build`, and turbo's `test` task depends on `^build`, which excludes `@prisma/cli`'s own build. The task makes that the graph's problem rather than a step-ordering convention nobody can see, and removes the need for a step condition in `publish.yml`.

**Where the real pack-and-install runs:** the unit tests inject the pack, install and bin-start seams, so `pnpm test` stays fast. The real packing and installing happen when `check:conformance` runs — in CI, and locally when verifying the slice.

**Why the checks are ordered, which is not a speed argument.** Both published packages declare `"prepack": "pnpm run build"`, and `packages/cli/tsdown.config.ts` sets `clean: true`, so packing destroys and rebuilds the directory check 1 reads. Verified with a sentinel appended to `packages/cli/dist/cli.js`: gone after `pnpm --filter @prisma/cli pack`. So check 1 completes before check 3 starts, they never run concurrently, and 3a reads only the extracted tarball.

## D1 — findings, the module graph, and check 1 (import purity) — DONE

Tests first, in this order:

1. `module-graph.test.ts` — a static `import … from`, an `export … from`, a dynamic `import()`, a deep subpath (`pkg/sub/thing` reports root `pkg`), a scoped name, a relative and an absolute specifier (both ignored), `node:fs` and bare `fs` (both ignored), and — the case that decides the whole approach — a file containing `import.meta.resolve("@repo/private")`, the same name in a template literal, and the same name as a plain string, none of which is an import. These pass **source strings**, not files: `parse` takes a string, and an on-disk fixture of deliberately odd JavaScript would have to satisfy biome, which lints `**` minus `.drive`. The directory walk gets the only on-disk fixture — `tests/fixtures/built-output/`, two small valid files, one nested — proving a chunk in a subdirectory is found and that a missing directory sweeps nothing.
2. `import-purity.test.ts` — an undeclared import reports one finding naming the specifier and carrying the file in `where.path`; peers and optionals count as declared; a devDependency does not; a private name reports a finding unless in the caller's allowed list; a declared runtime dependency nothing imports reports a finding of its own kind; **only `dependencies` are held to that reverse half**; a dependency the caller marks as reached without a static import reports nothing; **empty output reports a finding rather than passing**; **a missing required specifier reports a finding**.

Then implement `checkImportPurity({ label, output, manifest, allowedPrivate, allowedUnimported, requiredSpecifiers })`. The swept output is **injected** rather than read from a path inside the check, which is what lets 3a reuse the same function against an extracted tarball, and lets every case above be a plain value with nothing mocked.

**Acceptance:** both suites pass; run against the real `packages/cli/dist` and `packages/cli-engine/dist` it returns no findings. **Met:** 22 tests in the checker's own suite, plus one test in each consumer package running the real built output with `requiredSpecifiers` set, so a run that swept the wrong directory fails instead of reporting a clean sweep.

## D2 — check 2 (validator no-throw) — DONE

Tests first:

1. `validator-no-throw.test.ts` — a validator that throws unconditionally reports a finding naming the section and the provoking input; one that throws only on the `Proxy` trap case reports one finding, proving the corpus reaches that path; a malformed return reports a finding of its own kind; an empty section list reports a finding; composer's real `composerSection` reports none.
2. The corpus is asserted to contain each documented case, so a later edit cannot quietly shrink it.

Then implement `checkValidatorNoThrow({ sections })` over the corpus the contract fixes.

**Subject derivation.** `sectionsFrom({ families, commands })` builds the union the engine uses, per contract §3: family `configSection`s plus every mounted command's `needs.config`, matching `packages/cli-engine/src/execution/engine.ts:740-751`. Both inputs are already exported from `packages/cli/src/v8/cli.ts` — `mountedCommands` at 170, the families at 74 and 136 — and are reached from the shell's OWN test suite by relative import of `../src/v8/cli`, the convention that suite already uses. `sectionsFrom`'s parameter type is structural, so the checker needs no dependency on the engine and a test can pass toy families and commands without building one. Under STOP-8(a) the checker re-derives the union and the drift risk is recorded.

**Acceptance:** the suite passes; run against the shell's sections it returns no findings. **Met:** 9 tests in the checker's suite, plus `packages/cli/tests/v8-conformance.test.ts`, which pins that the shell mounts exactly `["composer"]` — so the day the ORM slice adds a second section that test fails and the new validator gets checked rather than silently skipped — and that composer's shipped validator survives all 21 hostile inputs.

## D3 — check 3 (tarball verification) — BLOCKED on STOP-3, STOP-6

Add `export const commandFamilies: readonly CommandFamily[] = [platformCommandFamily, composerCommandFamily]` to `packages/cli/src/v8/cli.ts`, used by `buildCli()`. This serves **check 2**, whose subjects are section objects the families carry. It does **not** serve 3c: `CommandFamily` carries `configSection`, `commands`, `docsBaseUrl` and `redirects` and no package identity at all (`packages/cli-engine/src/command-family.ts:49-59`), so 3c cannot learn a family's package name from it. 3c's family-package list is therefore hand-written in `bin.ts` alongside the shell's own imports, and a test asserts every name in it appears in the shell's packed manifest `dependencies` — which is what keeps it in step, since a family the shell mounts must be a package the shell depends on.

Tests first, all with injected seams:

1. `tarball.test.ts` — 3a: a packed manifest not covering the packed output's imports reports a finding. 3b: two `bin` entries are both started, a non-zero exit from either reports a finding naming that bin, and a failing install reports a finding carrying the installer's output rather than throwing. 3c: differing pins report a finding naming both versions and both packages; equal pins report none; a family not depending on the engine reports none; an installed family version differing from the shell's declared pin reports a finding; more than one engine copy in the install tree reports a finding; a non-exact packed engine pin reports a finding.
2. The exception list: keyed on the observed triple (family package, its engine pin, the shell's engine pin), it suppresses that exact combination and nothing else. A test proves the same family arriving at a *third* version is still reported.
3. One test asserts 3c reports the live shell-versus-composer mismatch when the exception list is empty. That is the test whose failure, once composer republishes and the exception is deleted, means the real defect is being caught.

Then implement `checkTarball({ packages, familyPackages, exceptions, io })` against this seam, spelled out so no implementation improvises it:

```ts
export interface TarballIo {
  pack(pkgDir: string, destDir: string): Promise<{ tarball: string } | { failed: string }>;
  readPackedManifest(tarball: string): Promise<PackageManifest>;
  /** Path → source, .js/.mjs only, so 3a can reuse check 1 unchanged. */
  readPackedFiles(tarball: string): Promise<ReadonlyMap<string, string>>;
  installSandbox(input: {
    sandboxDir: string;
    rootTarball: string;
    overrides: Readonly<Record<string, string>>; // version-qualified name → "file:<abs>"
  }): Promise<{ ok: true } | { ok: false; output: string }>;
  readInstalledManifest(sandboxDir: string, name: string): Promise<PackageManifest | undefined>;
  startBin(input: {
    sandboxDir: string;
    binName: string;
    relPath: string;
    argv: readonly string[]; // ["--version"] — not a bare start, which prints help and may exit non-zero
    timeoutMs: number;
  }): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>;
}
```

The default `io` packs with `pnpm pack`, computes the override map (each packed dependency matching a workspace package → that package's tarball, recursing into its own workspace dependencies), and installs with `npm install --no-audit --no-fund --ignore-scripts`. `--ignore-scripts` is required, not tidiness: without it the install runs `esbuild`, `workerd` and `msgpackr-extract` postinstalls, two of which `pnpm-workspace.yaml:5-11` deliberately disables, on a runner holding `id-token: write`. Verdicts key on exit codes only, never on stderr content — the install emits real `EBADENGINE` warnings.

The sandbox lives at a gitignored in-repo path carrying the package name, and is deleted at the **start** of a run rather than the end, so a failure leaves it for inspection instead of leaking a temp directory. Per STOP-5 that path needs `COREPACK_ENABLE_STRICT=0` for the install, because corepack's npm shim walks up to the repo root, sees `"packageManager": "pnpm"`, and refuses.

**Acceptance:** the suite passes; `check:conformance` locally packs both published packages, installs out of the workspace, starts every declared bin plus `dist/v8/cli.js` at exit 0 (per STOP-6(b)), reports no 3a findings, and reports the composer mismatch as suppressed by a named exception with its reason printed.

## D4 — wire prisma-cli's publish path, and the records — BLOCKED on STOP-1, STOP-2, STOP-4

- `.github/workflows/publish.yml`: a `Run conformance checks` step calling `pnpm check:conformance`, after `Run script tests` and before both publish steps so it guards the dry-run and the real publish alike. It still carries `if: ${{ steps.version.outputs.publish == 'true' }}`, matching both its neighbours at lines 103-109 — the turbo task removes the *build-ordering* need for a condition, not the reason to skip the work on a push that publishes nothing.
- `.github/workflows/pr-quality.yml`: the same script in the Test job. No explicit `pnpm build` step is needed once `conformance` is a turbo task with `dependsOn: ["^build"]`; that is the whole reason for making it one. If the install proves too slow for pull requests, the fast checks run there and the full set only at publish, decided by measurement.
- Root `package.json`: `"check:conformance": "turbo run conformance"`; `turbo.json`: the `conformance` task.
- `specs/s6-conformance.md`: acceptance boxes ticked with evidence.
- `plan.md` §S6: what shipped, and what S5 must wire in prisma/prisma.
- `spec.md`'s DoD line: **left as written and unchecked**, with the S5 and composer dependencies recorded against it. Revision 1 planned to reword it to match what shipped; that turns an unmet requirement into a met one by editing the requirement.
- `deferred.md`: the composer engine-pin exception, keyed on the observed triple, with the condition for deleting it.

**Acceptance:** `pnpm typecheck`, root `pnpm lint` and the touched suites green, each measured as pnpm's own exit code; `check:conformance` green locally.

## D5 — cross-repo wiring — BLOCKED on STOP-1, STOP-2, STOP-4

Not dispatched. Under the recommended answers: composer's `check-cli-engine-pin.mjs` gains a comparison against the shell's published engine pin, and composer's existing packed-output checks move from pull-request CI into its publish path — they are absent there today, which is a real hole independent of S6. prisma/prisma is wired as part of S5. Push access is not a blocker: the bot has push on `prisma/composer`, `prisma/prisma` and `prisma/prisma-cli` (checked 2026-08-12).

## Verification per dispatch

The touched packages' suites, `pnpm typecheck`, and root `pnpm lint`, each measured as pnpm's own exit code. **No stashing of `wip/` is needed.** Revision 1 carried a `mv wip /tmp/...` dance inherited from the S5 brief; biome already honours `.gitignore` (`biome.jsonc` sets `vcs.useIgnoreFile: true`, and `.gitignore:38` lists `wip/`), so it reports those paths as ignored and the dance does nothing — while writing to a temp directory, which the operator's standing rule forbids. Run the commands directly.

Four lint rules will bite and are worth expecting rather than discovering: `performance/noAwaitInLoops` (an error here, with 37 existing suppressions in the repo — the tarball check is inherently a sequential loop of awaits, and the repo's convention is a `biome-ignore` with a reason), `performance/useTopLevelRegex` (11 existing suppressions; hoist any regex to module scope), `complexity/useLiteralKeys` (use property access, not `manifest["dependencies"]`), and `complexity/noExcessiveCognitiveComplexity` (split the pack/install/start orchestration rather than fight it). Do not add a barrel `src/index.ts`: `performance/noBarrelFile` is on and the only sanctioned exceptions are tsdown entrypoints.

## Risks

- **The sandbox install needs the network**, resolving ~440 packages. A registry outage fails the publish path for a reason that is not a defect, so the install failure is its own finding kind carrying the installer's output — legible rather than looking like a broken tarball.
- **Cold install cost**: 37 s cold, 12–13 s warm. Acceptable in a publish path; measured before deciding whether it belongs on every pull request.
- **The exception list is a place for problems to be parked.** Each entry carries a reason and its removal condition, it is keyed tightly enough that any change on either side reopens the finding, and D3's test proves an empty list catches the real defect.
- **Check 1's flat sweep cannot see a missing subpath export.** `@prisma/composer/family` must exist for the shell to work and no check here would notice it vanishing. Recorded in the contract, not solved by this slice.
