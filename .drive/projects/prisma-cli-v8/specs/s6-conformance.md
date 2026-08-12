# S6 — Conformance checker (slice contract, revision 1 — STOPs open)

Status: DRAFT, awaiting operator rulings on STOP-1 … STOP-7. Nothing is implemented until those are ruled.
Precedence: this contract > `specs/s2-overview.md` standing rulings > source. Unpinned facts are STOP-and-surface.

Repo: prisma-cli. Branch: `claude/s6-conformance-checker-ebd3dd`, base `main`.

Mandate (project plan §S6, spec.md FR9, design-notes "Conformance"): the small three-check tool — import purity, validator no-throw on hostile input, published-tarball verification — wired into both products' publish CI. Project DoD line: "Conformance checker runs in CI for both products' publish paths."

## 1. The grounding example

`@prisma/cli@8.0.0-rc.1` declares `@prisma/cli-engine` at the workspace version, which `pnpm pack` rewrites to `8.0.0-rc.1` in the published manifest. It also pins `@prisma/composer@0.6.0-dev.16`, and that package declares `@prisma/cli-engine: "0.0.9"`. Installing the shell therefore resolves two different copies of the engine. Verified in this worktree:

```text
$ pnpm --filter @prisma/cli pack        # published manifest
"@prisma/cli-engine": "8.0.0-rc.1"
"@prisma/composer": "0.6.0-dev.16"

$ node -p 'require("@prisma/composer/package.json").dependencies["@prisma/cli-engine"]'
0.0.9

$ ls -d node_modules/.pnpm/@prisma+cli-engine*
node_modules/.pnpm/@prisma+cli-engine@0.0.9_magicast@0.5.3     # composer's copy
                                                                # the shell's is the workspace link
```

This is already a recorded project decision, and the decision is what makes it S6's business. `deferred.md:37-51` states that the engine pin "must be the SAME version prisma-cli depends on", records the current disagreement, and rules that **matching pins is a release requirement for the tandem release** — the two-copy install is "a preview-only state to end rather than a configuration to support". `packages/cli/src/v8/cli.ts:9-15` says the same and names the fix as composer's under the tandem order (R-S3-6).

Note what is *not* the argument here, because the difference decides how the check is written. The engine deliberately survives two copies for structured errors: its cross-copy markers are `Symbol.for`, and two tests prove an error raised by one copy is recognised by the other (`packages/cli-engine/tests/execution.test.ts`, "a structured error built by another copy of the engine", and `tests/protocol.test.ts`). So the check is not defending type identity, which is defended already. What is untested across two copies is execution and signal behaviour, and `deferred.md` rules that not worth testing precisely *because* matching pins is a release requirement.

That leaves the requirement with no enforcement anywhere. Composer's own `check-cli-engine-pin.mjs` compares composer's two manifests against each other and never against the shell's; no repo compares across the boundary. A check in the publish path is the enforcement the existing ruling implies, and it is the one thing in this slice that nobody has built.

## 2. What already exists (the non-duplication boundary)

This is the decisive finding of the shaping work. Two of the three checks are substantially built already, in the two other repos, and prisma-cli — the repo that owns both the engine and the shell — has none of them.

**composer** (all from S3, all in `ci.yml` on pull requests, none in `publish.yml`):

| Script | What it asserts |
| --- | --- |
| `check-cli-engine-pin.mjs` | The engine pin is exact, identical across composer's two manifests, and survives into the packed manifest; packed `dist/**/*.mjs` retains a bare `@prisma/cli-engine` import, proving the engine was not inlined; `dist/bin.mjs` exists. |
| `check-family-static-graph.mjs` | Packed output's static import graph names no `alchemy`, `effect` or `@effect/*`, anchored at three entrypoints with anti-vacuity markers. |
| `check-floor-imports.mjs` | Each published entrypoint imports in a fresh `node` process, one process per entry. Added after `dev.16`. |
| `check-npm-effect-resolution.mjs` | Packs both public packages, installs the tarballs with real npm against the real registry, fails if more than one `effect` resolves. |
| `check-publish-deps.mjs` | `workspace:`/`catalog:` leaks, internal-sibling exact pins, dependencies on private workspace packages. The only validation step in `publish.yml`. |

**prisma/prisma**: `check-publish-deps.mjs` (leaks, `@internal/*` exact pins within one manifest, `.d.ts`-declared-dependency resolvability), `lint-publishability.mjs`, `lint-consumer-internal-imports.mjs`, `lint-single-import-root.mjs`, `validate-package-manifests.mjs`, `validate-typescript-peer.mjs`. Its publish path runs three check steps.

**prisma-cli**: nothing. `publish.yml` runs `pnpm build`, `pnpm test:scripts`, then publishes. The closest existing thing is `packages/cli-engine/tests/no-child-process-in-dist.test.ts`, a single built-output substring assertion.

What exists nowhere, in any repo:

1. **Cross-repo pin agreement** — no check compares the shell's engine pin against the pin of any family it mounts. This is §1's defect.
2. **Any conformance check at all in prisma-cli.**
3. **Built-JavaScript imports measured against the declared dependency set.** prisma/prisma reads `.d.ts` only; composer checks a forbidden list, not the declared set.
4. **Validator no-throw as a check any section must pass.** composer tests its own validator inline; the engine tests that *the engine* survives a throwing validator (`config.test.ts:818`), which is the opposite direction.

## 3. The three checks

Each check is a function taking explicit inputs and returning findings. No check reads ambient state, and none is wired to a repo layout at the point of definition — the repo supplies its own subject list. This is what makes one tool usable from three repos and testable without mocking.

### Check 1 — import purity

**Asserts.** For a built package directory and a declared contract, every bare module specifier reachable in the built output belongs to a package the manifest declares in `dependencies`, `peerDependencies` or `optionalDependencies`, or to the allowed-private list the caller passes. Node builtins, relative and absolute specifiers are out of scope.

**Measured over** static `import`/`export … from` specifiers and dynamic `import()` in every `.js`/`.mjs` file of the built output, parsed with `es-module-lexer` — not by substring search. This distinction is not cosmetic. `packages/cli/dist/v8/cli.js:13965` contains the string `@repo/cli-telemetry/sender` inside an `import.meta.resolve()` call wrapped in `try`/`catch`, with a documented fallback for exactly the published case (`packages/cli/src/v8/runtime.ts:45-58`). It is deliberate and correct. A substring check fails it on day one; a lexer does not see it, because it is not an import.

**Does not assert** anything about `.d.ts` files (prisma/prisma's `check-publish-deps` owns that), about which subpath a specifier names, or about the directory a package lives in.

**Verified reachable today.** Run against both published packages in this worktree with the real lexer: `@prisma/cli` imports 16 bare roots, `@prisma/cli-engine` 8; every one is declared, and no declared runtime dependency goes unimported. Both directions are clean, so this lands as a regression guard rather than a cleanup job.

### Check 2 — validator no-throw

**Asserts.** Given a list of `ConfigSection` values, each section's `validate` returns a well-formed `SectionValidation` for every input in a fixed hostile corpus, and throws for none of them. A section is supplied as the object the family declares (`CommandFamily.configSection`), so the check runs the shipped validator, not a copy.

**The semantic** is R10, "Each product contributes a named section and a never-throwing validator". The engine treats a throwing validator as an internal bug: exit code 1, `CLI.INTERNAL_ERROR`, summary "'<name>' config section validator threw" (`packages/cli-engine/tests/config.test.ts:818-840`). So a validator that throws turns a user's config mistake into a CLI crash.

**The corpus** is fixed and lives with the check: `undefined`, `null`, primitives of each type, empty and populated arrays, functions, `Symbol`, `NaN`, a frozen object, an object with a `null` prototype, a deeply nested object, an object with a self-reference, an object whose keys are the section's own field names with wrong-typed values, a `Proxy` whose `get` and `ownKeys` traps throw, and a getter that throws. The throwing `Proxy` is the case that matters most: composer's validator spreads `raw` inside a `try`/`catch` specifically because of it (`section.ts:68-88`).

**Does not assert** that a validator returns `ok: false` for bad input, or anything about diagnostic content. Whether garbage is refused or defaulted is the product's decision; not crashing is not.

**Subjects available today:** exactly one shipped validator, composer's `composer` section. There is no `orm` section — see STOP-1.

### Check 3 — published-tarball verification

Three assertions that share a packing step. They are deliberately not one check, for a reason proven below.

**3a — the tarball's declared dependencies match the built output.** Check 1's comparison run against the *packed* tarball rather than the working `dist/`, so `files`, `.npmignore` and the `workspace:` rewrite are all in the measured path.

**3b — the tarball installs outside the workspace and its bins start on plain Node.** Pack with `pnpm pack`, not `npm pack`: only pnpm rewrites `workspace:8.0.0-rc.1` to `8.0.0-rc.1`, and `npm pack` would ship a specifier no registry consumer can resolve, failing the check for a reason that is an artifact of the tool. Install into a sandbox with `npm install`, which is the operator-sanctioned exception and also proves more than pnpm would: real users install with npm. Then run every entry in the packed manifest's `bin` map with plain `node` and require a zero exit.

Unpublished workspace siblings must be supplied locally. `@prisma/cli-engine@8.0.0-rc.1` is not on the registry — `latest` is `0.0.9` — so an unaided install of the shell's tarball fails on a missing version, which is the normal state of a lockstep release before its publish step. The sandbox therefore maps each workspace sibling to its own packed tarball through npm `overrides`, with absolute `file:` paths (a relative path in a nested override resolves against `node_modules`, not the sandbox root).

**3c — the shell's engine pin agrees with every family it mounts.** Read from *manifests*, never from an install tree: the packed manifest's `@prisma/cli-engine` version, compared against the same field in the manifest of each pinned family. Disagreement is a finding naming both versions.

**Why 3c cannot be folded into 3b.** I tried. An install-tree check ("exactly one engine copy resolves") is the more direct statement of the invariant, so I probed it — and npm's `overrides`, which 3b needs to supply the unpublished engine, rewrites the whole subtree beneath the overridden dependency. Both a blanket override and one scoped to `@prisma/cli` collapsed composer's `0.0.9` onto the local `8.0.0-rc.1`:

```text
$ npm ls @prisma/cli-engine --all
`-- @prisma/cli@8.0.0-rc.1
  +-- @prisma/cli-engine@8.0.0-rc.1
  `-- @prisma/composer@0.6.0-dev.16
    `-- @prisma/cli-engine@8.0.0-rc.1 deduped     # composer's 0.0.9 pin, erased by the override
```

The mechanism 3b depends on destroys the evidence 3c looks for. Comparing declared manifests is unaffected by it and is also cheaper and offline. See STOP-5.

**Does not assert** that the tarball's dependencies exist on the registry, anything about tarball size or `files` contents beyond what 3a and 3b touch, or that the bin does anything useful beyond starting.

**Feasibility proven.** In this worktree: `pnpm pack` of both packages, an out-of-workspace sandbox, `npm install` resolving 438 packages in 37 s cold and 12 s warm, and `node node_modules/@prisma/cli/dist/cli.js --version` printing `prisma-cli 8.0.0-rc.1` at exit 0.

## 4. Shape and mechanics

- The checker is a package in prisma-cli. Name and publication status depend on STOP-4.
- Checks are pure functions over injected inputs; the repo-facing entry supplies the subject list. No `vi.mock`/`vi.doMock` anywhere — the constraint is satisfied by construction, not by discipline.
- Tests before implementation. Each check gets a failing-input test proving it reports the defect it exists for, and a passing-input test, before the check is written.
- Fixtures live inside the repo. The one exception is 3b's sandbox, which must be outside any pnpm workspace or the workspace's own `node_modules` resolution defeats the install — see STOP-5.
- `es-module-lexer` is the parser, matching prisma/prisma's precedent (`packages/0-config/tsdown/shell-build.ts` uses it for the same job). It is already in this repo's dependency graph via tsdown; the checker declares it directly.
- pnpm only, except `npm install` and the bins started inside 3b's sandbox.

## 5. Open questions (STOP)

**STOP-1 — which repos are "both products", given prisma/prisma has no engine at all?** prisma/prisma contains zero occurrences of `@prisma/cli-engine` or `cli-engine`, in any manifest, source file, doc or planning artifact, and zero occurrences of `defineConfigSection`, `ConfigSection` or `SectionValidation`. S5 has not started there. So all three checks would be no-ops in its publish path today: no engine pin to compare, no `orm` section to hammer, and its own `check-publish-deps` already covers the tarball-manifest ground. Wiring the checker there now produces a green step that checks nothing, and a DoD checkbox that reads as covered when it is not. The live consumer is composer. Options: **(a) wire prisma-cli + composer now, and prisma/prisma as part of S5, recording that dependency in the plan** — recommended, it is the only reading under which every wired check has a subject; (b) wire all three now and accept the no-op, with the plan saying so in writing; (c) prisma-cli only. Note the project spec's FR7 names "prisma/prisma and composer" as the products, while the slice brief named prisma-cli and prisma/prisma — the two readings disagree, which is why this is yours.

**STOP-2 — build once in prisma-cli, or replace the checks the other two repos already have?** §2 is the fact: composer has four of these checks and prisma/prisma five, all working, all tested, all wired. Options: **(a) build the tool in prisma-cli where nothing exists, add only the genuinely missing cross-repo pin check to the others, and leave their existing checks alone** — recommended; (b) replace their scripts with the shared tool, which is a large diff in two repos S6 does not own and risks losing behaviour their checks have and the three-check mandate does not (composer's anti-vacuity markers, its `effect` resolution check); (c) run the tool alongside, duplicating coverage. Whichever you pick, the honest reading of the DoD line changes: under (a) "the checker runs in both products' publish paths" means the missing check is added and the existing ones are moved into the publish path, not that one binary replaces them.

**STOP-3 — check 3c is red today and prisma-cli cannot make it green.** composer pins engine `0.0.9`; the shell ships `8.0.0-rc.1`. `cli.ts:9-15` records the fix as composer's under the tandem order engine → composer → prisma-cli, and the engine at `8.0.0-rc.1` is not published yet, so composer cannot pin it today either. Shipping 3c as written makes the publish path red on arrival. Options: **(a) ship 3c with one recorded, dated exception naming `@prisma/composer` and the `cli.ts` comment, so any *new* mismatch fails while the known one stays visible and must be deleted when composer republishes** — recommended; (b) ship it failing and let it block publishing until composer moves; (c) warn-only until aligned, which is the option that quietly becomes permanent.

**STOP-4 — how does a second repo consume the tool without touching S7's release automation?** For composer to run it, it must be installable, which means published, which means a line added to `publish.yml`'s publish list — and release automation is S7's. Options: **(a) if STOP-2 lands on (a), nothing needs publishing: prisma-cli runs the tool as a private workspace package, and composer gets a small addition to its own `check-cli-engine-pin.mjs` comparing against the shell's published pin** — recommended, it keeps S6 inside its mandate; (b) publish `@prisma/cli-conformance` in the existing lockstep, one line in the publish list, and accept that S6 touched the publish list; (c) build it private now and defer cross-repo publication to S7, leaving the DoD checkbox unchecked at S6's close.

**STOP-5 — the out-of-workspace install, and the 3b/3c split.** Two rulings requested. First: 3b's sandbox must live outside the pnpm workspace, so it cannot be an in-repo fixture directory; the plan will use a `mkdtemp` outside the repo, which is the exception the brief anticipated. Confirm, or name a path you prefer (an ignored sibling directory next to the worktree would also work and would survive for inspection after a failure). Second: confirm §3's proof that 3c must compare declared manifests rather than count copies in the install tree, since npm's `overrides` — which 3b requires — erases the divergence 3c looks for. If you would rather have the stronger install-tree assertion, it needs a second install without overrides, which can only run after the engine is published.

**STOP-6 — which bin does 3b start?** `@prisma/cli`'s only declared bin today is `prisma-cli` → `dist/cli.js`, the legacy commander shell. The v8 entry ships in the tarball at `dist/v8/cli.js` but is not a bin, so "the bin starts" currently tests the shell S2d is retiring. Options: **(a) start every entry in the packed `bin` map, which is self-maintaining and picks up the `prisma` bin when S7 adds it** — recommended; (b) additionally start `dist/v8/cli.js` by path, pinning the v8 entry now at the cost of naming a file the manifest does not.

**STOP-7 — a citation in the brief does not exist; confirm I substituted the right ruling.** The brief cites `specs/s5-orm.md` STOP-10 and requirement R-S5-28 as having ruled the engine-mismatch class to be S6's. Neither exists: there is no `specs/s5-orm.md`, and `R-S5-28` and `STOP-10` appear nowhere in the repo. S5 has not started. What *is* recorded is `deferred.md:37-51`, which requires the pins to match and calls it a release requirement for the tandem release — quoted in §1. I have built 3c to that ruling plus the brief's own description of the check. This is the smallest of the seven questions; confirm and it closes.

## 6. Acceptance

Written against STOP-1(a), STOP-2(a), STOP-3(a), STOP-4(a), STOP-5 as proposed, STOP-6(a). Rewritten if you rule otherwise.

- [ ] Check 1 runs against `@prisma/cli` and `@prisma/cli-engine` built output and passes; a test proves it reports an undeclared bare import, and a test proves it does not report `import.meta.resolve("@repo/cli-telemetry/sender")`.
- [ ] Check 2 runs against every `configSection` the shell's mounted families declare — composer's today — over the full hostile corpus; a test proves it reports a validator that throws on a `Proxy` trap.
- [ ] Check 3a/3b/3c run against both published packages: declared dependencies match packed output, the tarball installs out-of-workspace and every declared bin starts on plain Node at exit 0, and pin agreement holds modulo STOP-3's recorded exception.
- [ ] A test proves 3c reports the shell-versus-composer mismatch when the exception is removed, so the exception's deletion is what turns the real defect red.
- [ ] prisma-cli's `publish.yml` runs the checker before the publish step; composer's publish path runs its packed-output checks and the cross-repo pin comparison.
- [ ] The project spec's DoD line is checkable under the wording STOP-1 and STOP-2 settle, and the plan records what S5 must wire in prisma/prisma.
- [ ] `pnpm typecheck`, root `pnpm lint`, and the touched packages' suites green, measured as pnpm's own exit code.
