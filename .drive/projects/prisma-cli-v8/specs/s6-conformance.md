# S6 — Conformance checker (slice contract, revision 4 — all questions closed)

Status: COMPLETE pending merge. prisma-cli half on PR #161, prisma/prisma half on prisma/prisma#29998; both ready for review (operator go-ahead 2026-08-12). All nine questions were closed by the operator on 2026-08-12 (see §5). Checks 1 and 2 built and green; check 3 and CI wiring in progress. Rev 4 also corrects rev 1–3's central factual error: they were grounded on a stale prisma/prisma checkout and claimed S5 had not started there. It has landed on origin/main — the engine at 0.0.9 in three manifests including published @prisma/orm-toolchain, the orm config section, the ported commands. Every claim below about prisma/prisma lacking subjects is struck.
Precedence: this contract > `specs/s2-overview.md` standing rulings > source. Unpinned facts are STOP-and-surface.

Repo: prisma-cli. Branch: `claude/s6-conformance-checker-ebd3dd`, base `main`.

Mandate (project plan §S6, spec.md FR9, design-notes "Conformance"): the small three-check tool — import purity, validator no-throw on hostile input, published-tarball verification — wired into both products' publish CI. Project DoD line: "Conformance checker runs in CI for both products' publish paths."

## 1. The grounding example

`@prisma/cli@8.0.0-rc.1` declares `@prisma/cli-engine` at the workspace version, which `pnpm pack` rewrites to `8.0.0-rc.1` in the published manifest. It also pins `@prisma/composer@0.6.0-dev.16`, and that package declares `@prisma/cli-engine: "0.0.9"`. Installing the shell resolves two different copies of the engine. Verified in this worktree:

```text
$ npm ls @prisma/cli-engine --all          # in a sandbox install of the packed shell
`-- @prisma/cli@8.0.0-rc.1
  +-- @prisma/cli-engine@8.0.0-rc.1
  `-- @prisma/composer@0.6.0-dev.16
    `-- @prisma/cli-engine@0.0.9
```

This is already a recorded project decision, and the decision is what makes it S6's business. `deferred.md:37-51` states that the engine pin "must be the SAME version prisma-cli depends on", records the current disagreement, and rules that **matching pins is a release requirement for the tandem release** — the two-copy install is "a preview-only state to end rather than a configuration to support". `packages/cli/src/v8/cli.ts:9-15` says the same.

Note what is *not* the argument, because the difference decides how the check is written. The engine deliberately survives two copies for structured errors: its cross-copy markers are `Symbol.for`, and two tests prove an error raised by one copy is recognised by the other (`packages/cli-engine/tests/execution.test.ts`, "a structured error built by another copy of the engine", and `tests/protocol.test.ts`). The check is not defending type identity, which is defended already. What is untested across two copies is execution and signal behaviour, and `deferred.md` rules that not worth testing precisely *because* matching pins is a release requirement.

That leaves the requirement with no enforcement anywhere. Composer's `check-cli-engine-pin.mjs` compares composer's two manifests against each other and never against the shell's; no repo compares across the boundary. A check in the publish path is the enforcement the existing ruling implies, and it is the one thing in this slice nobody has built.

## 2. What already exists (the non-duplication boundary)

Two of the three checks are substantially built already, in the two other repos, and prisma-cli — which owns both the engine and the shell — has none of them.

**composer** (all from S3, all in `ci.yml` on pull requests, none in `publish.yml`):

| Script | What it asserts |
| --- | --- |
| `check-cli-engine-pin.mjs` | The engine pin is exact, identical across composer's two manifests, and survives into the packed manifest; packed `dist/**/*.mjs` retains a bare `@prisma/cli-engine` import, proving the engine was not inlined; `dist/bin.mjs` exists. |
| `check-family-static-graph.mjs` | Packed output's static import graph names no `alchemy`, `effect` or `@effect/*`, anchored at three entrypoints with anti-vacuity markers. |
| `check-floor-imports.mjs` | Each published entrypoint imports in a fresh `node` process, one process per entry. Added after `dev.16`. |
| `check-npm-effect-resolution.mjs` | **The whole of check 3b's mechanism already exists here**: packs both public packages with `pnpm pack`, writes a manifest into a `mkdtemp` outside the workspace, installs the tarballs with real npm against the real registry, starts the built `prisma-composer` bin inside that sandbox, and fails if more than one `effect` resolves. |
| `check-publish-deps.mjs` | `workspace:`/`catalog:` leaks, internal-sibling exact pins, dependencies on private workspace packages. The only validation step in `publish.yml`. |

**prisma/prisma**: `check-publish-deps.mjs` (leaks, `@internal/*` exact pins within one manifest, `.d.ts`-declared-dependency resolvability), `lint-publishability.mjs`, `lint-consumer-internal-imports.mjs`, `lint-single-import-root.mjs`, `validate-package-manifests.mjs`, `validate-typescript-peer.mjs`. Three check steps in its publish path.

**prisma-cli**: nothing. `publish.yml` runs `pnpm build`, `pnpm test:scripts`, then publishes. The closest existing thing is `packages/cli-engine/tests/no-child-process-in-dist.test.ts`, a single built-output substring assertion.

What exists nowhere, in any repo:

1. **Cross-repo pin agreement** — no check compares the shell's engine pin against the pin of any family it mounts. This is §1's defect.
2. **Any conformance check at all in prisma-cli.**
3. **Built-JavaScript imports measured against the declared dependency set.** prisma/prisma reads `.d.ts` only; composer checks a forbidden list, not the declared set.
4. **Validator no-throw as a check any section must pass.** composer tests its own validator inline; the engine tests that *the engine* survives a throwing validator (`config.test.ts:818`), which is the opposite direction.

Because composer already owns the mechanism for 3b and most of 1, the honest reading of this slice is that its new capability is item 1, its new *coverage* is item 2, and items 3 and 4 are refinements. STOP-2 turns on that.

## 3. The three checks

Each check is a function over explicit inputs returning findings. No check reads ambient state; the caller supplies the subjects. That is what makes them testable without mocking.

**Every check reports a finding when its subject set is empty.** An empty `dist/`, zero config sections, or a tarball containing no JavaScript is a broken invocation, not a pass. Every comparable script in the sibling repos carries this protection — composer's `MUST_COVER`, its "at least one chunk keeps the specifier" requirement, and this repo's own `expect(files.length).toBeGreaterThan(0)` in `no-child-process-in-dist.test.ts:24`. Check 1 additionally asserts that a known specifier is present in the output it swept, so a check that silently swept the wrong directory fails rather than passes.

### Check 1 — import purity

**Asserts.** For a built package directory and its manifest, every bare module specifier appearing in the built output belongs to a package declared in `dependencies`, `peerDependencies` or `optionalDependencies`, or to the allowed-private list the caller passes. It also reports a declared runtime dependency that the output never imports. Node builtins, relative and absolute specifiers are out of scope.

**Measured over** static `import`/`export … from` specifiers and dynamic `import()` in every `.js`/`.mjs` file of the built output, parsed with `es-module-lexer` — not by substring search. This distinction is not cosmetic. `packages/cli/dist/v8/cli.js:13965` contains the string `@repo/cli-telemetry/sender` inside an `import.meta.resolve()` call wrapped in `try`/`catch`, with a documented fallback for exactly the published case (`packages/cli/src/v8/runtime.ts:45-58`). It is deliberate and correct. A substring check fails it on day one; a lexer does not see it, because it is not an import.

**A flat sweep, not a reachability walk.** Every JavaScript file in the output is measured, whether or not `exports` or `bin` names it — `packages/cli/dist` holds 109 files and the manifest names two. The flat sweep is the stricter choice and is deliberate. Its consequence: check 1 cannot detect a subpath the manifest fails to expose. `@prisma/composer/family` is the live example of a subpath that must exist for the shell to work and that no check here would miss if it vanished.

**Does not assert** anything about `.d.ts` files (prisma/prisma's `check-publish-deps` owns that), about which subpath a specifier names, or about the directory a package lives in.

**Measured today.** Run against both published packages with the real lexer: `@prisma/cli` imports 16 bare roots, `@prisma/cli-engine` 8; every one declared, no declared runtime dependency unimported. Both directions clean, so this lands as a regression guard rather than a cleanup job.

### Check 2 — validator no-throw

**Asserts.** Given a list of `ConfigSection` values, each `validate` returns a well-formed `SectionValidation` for every input in a fixed hostile corpus, and throws for none. A malformed return — neither `ok: true` with a `value` nor `ok: false` — is its own finding.

**The subject set is the union the engine itself uses.** Not "the families the shell mounts". The engine derives its recognised sections from command families *and* from standalone mounted commands' `needs.config` (`packages/cli-engine/src/execution/engine.ts:740-751`, whose comment says "whether it reaches the tree through a command family or on its own — the shell mounts its own commands with no family"). A check over families alone states a narrower rule than the engine enforces. Both inputs are already exported from `packages/cli/src/v8/cli.ts`: `mountedCommands` at line 170, and the families at 74 and 136. The set of standalone-command sections is empty today, which is exactly why the narrower rule would have looked correct. See STOP-8 on who should own this derivation.

**The semantic** is R10, "Each product contributes a named section and a never-throwing validator". The engine treats a throwing validator as an internal bug: exit code 1, `CLI.INTERNAL_ERROR`, summary "'<name>' config section validator threw" (`packages/cli-engine/tests/config.test.ts:818-840`). A validator that throws turns a user's config mistake into a CLI crash.

**The corpus** is fixed and lives with the check: `undefined`, `null`, primitives of each type, empty and populated arrays, functions, `Symbol`, `NaN`, a frozen object, a null-prototype object, a deeply nested object, a self-referencing object, an object whose keys are the section's own field names with wrong-typed values, a `Proxy` whose `get` and `ownKeys` traps throw, and an object with a throwing getter. The throwing `Proxy` matters most: composer's validator spreads `raw` inside a `try`/`catch` specifically because of it (`section.ts:68-88`).

**Does not assert** that a validator returns `ok: false` for bad input, or anything about diagnostic content. Whether garbage is refused or defaulted is the product's decision; not crashing is not.

**Subjects available today:** one shipped validator, composer's `composer` section.

### Check 3 — published-tarball verification

Three assertions sharing a packing step.

**3a — the tarball's declared dependencies match the built output.** Check 1's comparison run against the *packed* tarball rather than the working `dist/`, so `files`, `.npmignore` and the `workspace:` rewrite are in the measured path.

**3b — the tarball installs outside the workspace and its bins start on plain Node.** Pack with `pnpm pack`, not `npm pack`: only pnpm rewrites `workspace:8.0.0-rc.1` to `8.0.0-rc.1`, and `npm pack` would ship a specifier no registry consumer can resolve, failing the check for a reason that is an artifact of the tool. Install into a sandbox with `npm install --no-audit --no-fund --ignore-scripts`, then run each bin with plain `node --version`-style invocation under a timeout, requiring a zero exit.

`--ignore-scripts` is not optional. Without it the install executes third-party postinstall scripts — measured: `esbuild`, `workerd`, and `msgpackr-extract`'s `node-gyp-build-optional-packages`. This repo deliberately disables two of those three in `pnpm-workspace.yaml:5-11`, and the publish runner holds `id-token: write` and `contents: write`. Running vendor postinstalls and compiling native code there inverts the repo's own policy at its most privileged moment. Verified: with `--ignore-scripts`, both `dist/cli.js` and `dist/v8/cli.js` still start at exit 0.

Unpublished workspace siblings must be supplied locally. `@prisma/cli-engine@8.0.0-rc.1` is not on the registry — `latest` is `0.0.9` — so an unaided install of the shell's tarball fails on a missing version, the normal state of a lockstep release before its publish step. The sandbox maps each such sibling to its own packed tarball through npm `overrides`, with absolute `file:` paths (a relative path in a nested override resolves against `node_modules`, not the sandbox root) and **version-qualified keys** (`"@prisma/cli-engine@8.0.0-rc.1"`), for the reason 3c gives. **The override list is computed, not written**: for each packed dependency whose name matches a workspace package, map it to that package's tarball, recursing into its own workspace dependencies. Exactly one override is needed today, and hand-writing it would break silently the first time another private sibling becomes a runtime dependency.

**Packing rebuilds the directory check 1 reads, so the checks are strictly ordered.** Both published packages declare `"prepack": "pnpm run build"`, and `packages/cli/tsdown.config.ts` sets `clean: true`. Verified: a sentinel appended to `packages/cli/dist/cli.js` is gone after `pnpm --filter @prisma/cli pack`. Neither `pnpm pack --ignore-scripts` (not a valid flag) nor `npm_config_ignore_scripts=true pnpm pack` suppresses it. So check 1 runs to completion before check 3 begins, they never run concurrently, and 3a reads only from the extracted tarball — never from a file list gathered before packing.

**3c — the shell's engine pin agrees with every family it mounts.** Compared between manifests: the packed manifest's `@prisma/cli-engine` version against the same field in each family package's manifest. Three things it pins down, each of which an implementer would otherwise decide alone:

- **`dependencies` only.** The packed manifest's `devDependencies` name `@repo/cli-telemetry` and `@repo/tsconfig` at `8.0.0-rc.1` — private packages at versions no registry has. Reading any field but `dependencies` produces nonsense.
- **String equality, not semver satisfaction.** Both sides pin exactly today (`8.0.0-rc.1` and `0.0.9`). A family pinning a range is out of scope and reported as its own finding rather than silently resolved, because the release requirement is a matching pin, not a compatible one.
- **The family package list is an input.** `CommandFamily` carries `configSection`, `commands`, `docsBaseUrl` and `redirects` and no package identity (`packages/cli-engine/src/command-family.ts:49-59`), so the check cannot learn a family's package name from the family. It takes `familyPackages: readonly string[]`, and a test asserts every name in it appears in the shell's packed `dependencies` — which is what keeps it honest, since a family the shell mounts must be a package the shell depends on.

3c additionally asserts that the installed family version equals the version the shell's packed manifest declares, so a lockfile disagreeing with the declared pin is itself a finding.

**Revision 2 correction: 3c *can* also be measured in the install tree, and the earlier claim that it could not was wrong.** Revision 1 reported that npm's `overrides` erases the divergence, having tested a blanket override and one scoped to `@prisma/cli`. The architect review pointed out the third form. A version-qualified key replaces only the matching request, and it preserves the divergence — verified:

```text
overrides: { "@prisma/cli-engine@8.0.0-rc.1": "file:<abs>/prisma-cli-engine-8.0.0-rc.1.tgz" }

$ npm ls @prisma/cli-engine --all
`-- @prisma/cli@8.0.0-rc.1
  +-- @prisma/cli-engine@8.0.0-rc.1
  `-- @prisma/composer@0.6.0-dev.16
    `-- @prisma/cli-engine@0.0.9      # preserved
```

So "exactly one engine copy resolves in the installed tree" is available, and it is the stronger statement: it catches a mismatch introduced by a family's own transitive dependency, which a pairwise manifest comparison cannot see. It costs nothing extra because 3b already performs the install. The manifest comparison is still worth keeping — it works offline, it runs before any install, and it names both versions and both packages in the finding, which a copy count cannot. STOP-5 asks whether to take both.

**Two further assertions that are non-vacuous today**, and stay meaningful while §5's exception is in place: the packed shell manifest's engine pin is an exact version with no `workspace:` prefix or range operator left in it, and every mounted family package declares the engine at all.

**Does not assert** that the tarball's dependencies exist on the registry, anything about tarball size or `files` contents beyond what 3a and 3b touch, or that a bin does anything useful beyond starting.

**What 3b proves today is narrow, and STOP-6 is where that is decided.** `@prisma/cli`'s only declared bin is `prisma-cli` → `dist/cli.js`, the legacy commander shell, and `exports` contains only `./package.json`. Of the packed output only `dist/v8/cli.js` imports `@prisma/composer/family`; `dist/cli.js` imports it nowhere. So starting every entry in the packed `bin` map starts the shell S2d is retiring, never loads composer's family, never resolves the `/family` subpath, and never exercises the engine boundary this slice exists to protect.

**Feasibility proven.** In this worktree: `pnpm pack` of both packages, an out-of-workspace sandbox, `npm install` resolving 438 packages (440 with both engine copies) in 37 s cold and 12-13 s warm, and `node node_modules/@prisma/cli/dist/cli.js --version` printing `prisma-cli 8.0.0-rc.1` at exit 0.

## 4. Shape and mechanics

- The checker is a package in prisma-cli. Name and publication status depend on STOP-4.
- Checks are pure functions over injected inputs; the repo-facing entry supplies the subject list. No `vi.mock`/`vi.doMock` — satisfied by construction, not discipline.
- Tests before implementation. Each check gets a failing-input test proving it reports the defect it exists for, and a passing-input test, before the check is written.
- Fixtures live inside the repo. 3b's sandbox is the exception, and **revision 2's stated reason for it was wrong**: the principal-engineer review ran the install inside the worktree and resolution defeated nothing — 438 packages, the override applied, the bin starting at exit 0. The real blocker is corepack. `corepack enable` runs in `.github/workflows/test.yml:36-41`, and the corepack `npm` shim walks up past the sandbox's own manifest to the repo root, finds `"packageManager": "pnpm"`, and refuses. So an in-repo sandbox breaks wherever corepack is enabled — CI, and any developer who has run `corepack enable`. `COREPACK_ENABLE_STRICT=0` also lifts it. STOP-5 asks which way to go.
- The checker's entry is reached through a turbo task, not a bare script: `"conformance": { "dependsOn": ["^build"], "cache": false }`. The checks read two built directories, and neither existing workflow guarantees them — `pr-quality.yml`'s Test job never runs `pnpm build`, and turbo's `test` task depends on `^build`, which excludes `@prisma/cli`'s own build. A turbo task makes the dependency the graph's problem instead of a step-ordering convention nobody can see.
- **The checker depends on nothing it checks, and the consumers run it on themselves.** This is a correction to revisions 1 and 2, which had `@repo/cli-conformance` depend on `@prisma/cli` so it could reach the shell's families. Built that way, its own `tsc --noEmit` followed the import into the shell's whole command tree, duplicating the shell's typecheck and making it depend on the engine's built declarations being present and settled — which failed in practice. So: the checker declares the one shape it needs structurally (a section with a `name` and a `validate`, which the engine's `ConfigSection` satisfies) and depends only on `es-module-lexer`. `@prisma/cli-engine`'s own suite checks its built output; `@prisma/cli`'s suite checks its built output and its mounted sections, reaching the families by relative import of `../src/v8/cli` — the convention that package's tests already use. Each subject is checked by the package that owns it, in a tree it already typechecks.
- The checker exports subpaths rather than a root barrel, because `performance/noBarrelFile` is on and the only sanctioned exceptions are tsdown entrypoints.
- `@prisma/cli` cannot be imported by name from anywhere: its `exports` map carries `./package.json` and nothing else, and its built v8 entry runs the CLI at top level rather than exporting anything. That is why the shell's own tests, not an external runner, are where its subjects are reached.
- `es-module-lexer` is the parser, matching prisma/prisma's precedent (`packages/0-config/tsdown/shell-build.ts` uses it for the same job). Already in this repo's graph via tsdown; the checker declares it directly.
- pnpm only, except `npm install` and the bins started inside 3b's sandbox.

## 5. Questions — CLOSED (operator, 2026-08-12)

The nine questions revisions 1–3 carried are all closed. The record, in the operator's words where they were short enough to quote:

1. **"Both products" = prisma-cli and prisma/prisma, both in scope NOW.** Revisions 1–3 claimed prisma/prisma had no engine; that was a stale checkout. S5 has landed on its origin/main: engine `0.0.9` pinned in `packages/1-framework/3-tooling/cli`, `packages/9-public/@prisma/orm-toolchain` and `test/integration`; the `orm` config section at `packages/1-framework/3-tooling/cli/src/orm/config-section.ts`. Every check has real subjects there. The project plan had already answered this ("wired into both products' publish CI as S3/S5 land").
2. **No replace-or-duplicate dilemma exists.** The mandate is to add the three checks to both publish paths; other repos' existing checks were never in question.
3. **The composer pin mismatch: "Doesn't matter. Just ignore for now."** Implemented as one recorded exception (keyed on the observed triple) so the finding stays visible and any new mismatch fails.
4. **No second repo consumes the tool.** Per-repo check scripts are the standing precedent (`check-publish-deps.mjs` exists separately in composer and prisma/prisma). prisma/prisma gets the checks in its own repo; nothing is published.
5. **Sandbox and pin-check form: as recommended** (in-repo gitignored sandbox, both pin-check forms) — subsumed by the above; no ruling was needed.
6. **Bins: start what the tarball declares.** The v8-entry question was overthought and is withdrawn; the check starts the packed manifest's `bin` entries.
7. **The missing citation: "I don't care."** Closed; 3c is built to `deferred.md:37-51`.
8. **Validator-check ownership / engine export: withdrawn.** The checker derives the section union itself; no engine change.
9. **Registry outage: dead question.** If the registry is down the publish cannot proceed anyway; an install failure is a blocking finding.

## 6. Acceptance

Written against the §5 rulings.

- [x] Check 1 runs against `@prisma/cli` and `@prisma/cli-engine` built output and passes; tests prove it reports an undeclared bare import, reports a declared-but-unimported runtime dependency, does not report `import.meta.resolve("@repo/cli-telemetry/sender")`, and reports a finding on an empty subject set.
- [x] Check 2 runs over the union the engine uses — families plus standalone mounted commands' `needs.config` — for every section the shell mounts, over the full hostile corpus; tests prove it reports a validator that throws on a `Proxy` trap, reports a malformed return, and reports a finding on an empty section list.
- [x] Check 3a/3b/3c run against both published packages: declared dependencies match packed output; the tarball installs into the sandbox and every declared bin starts on plain Node at exit 0; pin agreement holds modulo §5's exception; exactly one engine copy resolves in the installed tree; the packed engine pin is an exact version; every mounted family package declares the engine.
- [x] A test proves 3c reports the live shell-versus-composer mismatch when the exception list is empty, and that the exception does not suppress the same family arriving at a third version.
- [x] prisma-cli's `publish.yml` runs the checker before both publish steps, under the same `publish == 'true'` condition its neighbours carry.
- [x] Both products' publish paths run the checks: prisma-cli's `publish.yml` (PR #161) and prisma/prisma's `publish.yml` (prisma/prisma#29998, `scripts/check-conformance.mjs` after `check:publish-deps`). The project DoD line becomes true when both merge.
- [x] `pnpm typecheck`, root `pnpm lint`, and the touched packages' suites green, each measured as pnpm's own exit code, with `wip/` stashed inside the worktree rather than in a temp directory.

## 7. Disposition record

Rev 1 (2026-08-12): shaping work, seven questions, contract + plan opened as draft PR #161.

Rev 2 (2026-08-12): architect review returned ACCEPT-WITH-CHANGES with 15 findings; all adopted.

- Findings 1, 2, 4, 5, 7, 8 changed what the checks assert: check 2's subject set widened to the engine's own union; the `commandFamilies` export justified for check 2 and *not* for 3c, which needs package identity `CommandFamily` does not carry; the exception keyed on the observed triple; STOP-6's recommendation reversed to (b) on the evidence that the declared bin never loads composer; anti-vacuity requirements added to every check; "reachable" struck from check 1 with the subpath limitation stated.
- Finding 3 corrected a factual error: the version-qualified override form preserves the pin divergence, so 3c *can* be measured in the install tree. Verified before adopting. STOP-5 rewritten from "confirm my proof" to "take the stronger form as well?".
- Finding 9 corrected a process error: revision 1's plan closed the DoD line by rewording it. Now left unchecked with dependencies recorded, and surfaced in STOP-2.
- Finding 6 moved the scope split: only D1 and D2 are ruling-independent. The plan states that instead of claiming D1-D4.
- Finding 10 fixed in code: `packages/cli/src/v8/cli.ts:9-15` said composer `dev.15` pins engine `0.0.7`; the real versions are `dev.16` and `0.0.9`.
- Findings 11, 12, 13, 14, 15 fold during implementation: an explicit build before the check in `pr-quality.yml`; the `publish == 'true'` condition on the new publish step; 3c's manifest source named and the installed-versus-declared assertion added; the `wip/` stash moved inside the worktree, per the operator's own standing rule; the two extra non-vacuous 3c assertions claimed.
- New question raised by the review and added: STOP-8, on who owns check 2 and whether the engine should export the section derivation.

Rev 3 (2026-08-12): principal-engineer review returned ACCEPT-WITH-CHANGES with 20 findings; all adopted. Checks 1 and 2 built to it.

- **Finding 16 changed the checks' ordering, and it is the one that would have broken the slice quietly.** Both published packages declare `"prepack": "pnpm run build"` and tsdown cleans, so `pnpm pack` destroys and recreates the very directory check 1 reads. Verified with a sentinel: appended to `packages/cli/dist/cli.js`, gone after packing. Neither `pnpm pack --ignore-scripts` nor `npm_config_ignore_scripts=true` suppresses it. The checks are now strictly ordered, 1 before 3, never concurrent, and 3a reads only the extracted tarball.
- **Finding 4 is a security correction.** The sandbox install was to run without `--ignore-scripts`, which executes `esbuild`, `workerd` and `msgpackr-extract` postinstalls — two of which this repo deliberately disables in `pnpm-workspace.yaml` — on a runner holding `id-token: write`. Now `--ignore-scripts`, verified not to break either bin.
- **Finding 3 corrected the second of my two wrong reasons.** The sandbox does not need to leave the repo because of pnpm resolution; the review ran it in-repo successfully. The blocker is corepack's npm shim refusing inside a tree whose root declares pnpm. STOP-5 gained that choice, and now recommends the in-repo path with `COREPACK_ENABLE_STRICT=0` so a failed run leaves evidence.
- **Finding 1 replaced the root script with a turbo task.** `tsx` removes the build-ordering requirement for the checker itself, not for the two `dist/` directories it reads — and neither workflow builds them (`pr-quality.yml`'s Test job never runs `pnpm build`; turbo's `test` task depends on `^build`, which excludes `@prisma/cli`'s own). A `conformance` task with `dependsOn: ["^build"]` makes that the graph's problem and removes the need for a step condition.
- Findings 2, 5, 11, 12 pinned down what an implementer would otherwise decide alone: the relative-source-import route to the shell's families and why it is the only one; the override list computed rather than written; 3c's field set, comparison rule and `familyPackages` input; and `allowedUnimported`, without which a dependency reached only through `import.meta.resolve` fails check 1's reverse half — the shipped telemetry pattern exactly.
- Findings 9, 10, 8a supplied the shapes the plan was missing: `Finding`, `Report`, `exitCodeFor` (zero only when every finding is suppressed, and suppressed findings still print), and the `TarballIo` seam that keeps check 3 testable without mocking `node:child_process`.
- Findings 6, 17 became STOP-9 and a specified bin invocation: a registry outage's verdict is the operator's call, and a bin start needs an argument and a timeout rather than "run it and require zero".
- Findings 7, 13, 14, 15, 18, 19 fold during implementation: sandbox deleted at the start of a run rather than the end; `await init` before `parse`, and computed dynamic imports silently invisible; the lockfile regenerated (done); a manifest type rather than `any`; exit codes never stderr content; and the four lint rules that will bite.
- **Finding 20 deleted a step I had copied from the S5 brief.** Biome already honours `.gitignore`, so moving `wip/` aside before linting does nothing — and it moved it to `/tmp`, which the operator's standing rule forbids. Verified: biome reports `wip/` paths as ignored. Gone from the plan.
- Recorded for `deferred.md`, not fixed here: the packed shell manifest's `devDependencies` name `@repo/cli-telemetry` and `@repo/tsconfig` at versions no registry has. Harmless for a tarball install, fatal for anyone installing the unpacked directory, and none of the three checks looks at that field. composer's `check-publish-deps.mjs` catches this class.
