# Handover brief — split @prisma/composer into library + CLI package, engine becomes a peer

Written 2026-08-13 for an independent agent with NO prior context. The operator is Will Madden ("the operator"). Where this brief summarizes a document, the document wins. Repo paths are absolute; "this project directory" means `.drive/projects/prisma-cli-v8/` in the prisma-cli repo.

## 1. Read first, in this order

1. This project directory in **prisma-cli** (`/Users/wmadden/Projects/prisma/prisma-cli`, branch `main` — always `git fetch origin main` first, local checkouts go stale): `spec.md` (project frame), `plan.md` (slices and dependency graph), `design-notes.md` (settled design decisions), `specs/s2-overview.md` (standing rulings that bind every slice).
2. `specs/s6-conformance.md` in the same directory — the conformance-checker contract. Its §5 records the operator rulings of 2026-08-12, and its §1 documents the defect class this whole strategy exists to kill: installing `@prisma/cli` today resolves multiple copies of `@prisma/cli-engine`.
3. `deferred.md` in the same directory, the entry "The engine pin moves to whatever the tandem release publishes" (~line 37) — the standing ruling that pins must match, as a release requirement.
4. `specs/s3-composer.md` — the contract under which composer's current shape was built (one process, the family export, `ctx.spawn`, the S3 acceptance list). You are changing its packaging, not its design.
5. The composer repo itself: `/Users/wmadden/Projects/prisma/composer`. **Its local `main` is routinely stale — `git fetch origin main` and read via `origin/main` before trusting anything on disk.** Do all work in a fresh worktree off `origin/main`.

## 2. The ruled strategy (operator, 2026-08-13)

The engine (`@prisma/cli-engine`) must exist exactly once in any installed tree that runs the CLI. The recorded strategy, agreed in discussion with the operator:

- Product CLI packages (composer's command family; the ORM's `@prisma/orm-toolchain`) declare the engine as an **exact `peerDependency`** (plus a `devDependency` for their own tests). The shell (`@prisma/cli`) carries the one real engine `dependency` and satisfies everyone's peer. Peers resolve against the ancestor, so one engine exists in any tree shape, and an unsatisfiable peer is an **install-time error** instead of a silent second copy.
- Widening exact peers to a **range** is the recorded destination, post-GA, once the engine has a written compatibility contract. Not now: during the rc line the engine breaks consumers deliberately, so a range would be fiction.
- Product **libraries carry no engine relationship at all**. Applications depend on libraries (`@prisma/composer`, `@prisma/orm-postgres`); only the consolidated CLI depends on product CLI packages; product CLI packages are reached only transitively through the CLI.
- The target dependency tree, in the operator's words: `app → @prisma/cli → { orm-cli → engine(peer), composer-cli → engine(peer), engine }` (the shell's published name is `@prisma/cli`), with `app → @prisma/composer` and `app → @prisma/orm-postgres` as ordinary library dependencies alongside.

The ORM side already conforms structurally: `@prisma/orm-toolchain` is the dev/CLI package (applications reach its vite plugin through `@prisma/orm-postgres/vite-plugin-contract-emit`, a forwarded export — verified 2026-08-13), so it needs only the dependency-field change, in its own repo, **not in this brief's scope**. Composer is the one package that mixes the application-facing runtime library with the CLI family in one manifest. That split is your job.

## 3. Verified current state of composer (2026-08-13, origin/main and the published 0.6.0-dev.16 tarball)

- One publishable package `@prisma/composer` (`packages/9-public/composer/`), version 0.6.0 on disk. Exports the **library** surface (`.`, `./config`, `./control`, `./deploy`, `./local-target`, `./report`, `./casts`, `./assertions`, `./arktype`, `./service-rpc`, `./node`, `./node/control`, `./nextjs`, `./nextjs/control`), the **CLI** surface (`./family`, `./testing`), and a bin (`prisma-composer` → `./dist/bin.mjs`).
- `@prisma/cli-engine: "0.0.9"` sits in `dependencies`. No engine peer exists.
- The import graphs are **already disjoint** in the published output: the only dist files whose static graph names the engine are `family.mjs`, `bin.mjs` and their declaration files; zero shared chunks import it; the library entrypoints load with no engine reachable. The split is a packaging operation, not an untangling.
- The family implementation lives in the private workspace package `@internal/cli` (`packages/0-framework/3-tooling/cli/`); the publishable package's `src/exports/family.ts` is a re-export barrel, bundled by tsdown with `noExternal: [/^@internal\//]` and `external: ['esbuild', '@prisma/cli-engine']` (`packages/9-public/composer/tsdown.config.ts`). The comment there explains why the engine is external: composer and the prisma bin must share one engine instance.
- A second publishable package `@prisma/composer-prisma-cloud` exists; it has no engine relationship and is out of scope.
- Composer's own conformance-ish checks: `scripts/check-cli-engine-pin.mjs` (pin exact + identical across composer's two manifests + surviving into the packed manifest + a packed chunk retaining a bare engine import + `dist/bin.mjs` present), `scripts/check-family-static-graph.mjs` (packed output free of `alchemy`/`effect` imports, anchored at `dist/family.mjs`, `dist/bin.mjs`, `dist/testing.mjs`), `scripts/check-floor-imports.mjs`, `scripts/check-npm-effect-resolution.mjs` — all on PR CI (`ci.yml`) only — and `scripts/check-publish-deps.mjs`, the sole check in `publish.yml`.
- The consumer today: prisma-cli's shell imports `createComposerFamily` from `@prisma/composer/family` (`packages/cli/src/cli.ts`) and pins `@prisma/composer` exactly. Its conformance check (`packages/cli/scripts/conformance.ts`) currently expects the composer family package to pin the engine in `dependencies` and carries a recorded exception for the 0.0.9-vs-8.0.0-rc.1 mismatch.

## 4. The work

### D1 — the package split

Create a new publishable package `@prisma/composer-cli` (name is STOP-1) in `packages/9-public/`, following the existing package's conventions (tsdown config extending `@internal/tsdown-config`, same `files`, license, repository fields — copy the manifest discipline from `packages/9-public/composer/package.json`). It takes over from `@prisma/composer`:

- the `./family` export (the `CommandFamily`, `createComposerFamily`, `composerSection`, the operations seam),
- the `./testing` export (the family's test double belongs with the family),
- the `prisma-composer` bin (STOP-2 covers its fate; default: it moves here unchanged).

`@prisma/composer` keeps every library export and **loses** `./family`, `./testing`, the bin, and its `@prisma/cli-engine` dependency entirely. Breaking change to the package's export map: record it in composer's changelog/release notes machinery, and note that the only known consumer of the removed subpaths is the prisma-cli shell (§5).

Both packages bundle from the same `@internal/*` sources; nothing moves in `packages/0-framework/`. The split is manifests, tsdown entries, and export maps.

### D2 — the engine becomes an exact peer

In `@prisma/composer-cli`: `peerDependencies: { "@prisma/cli-engine": "0.0.9" }` (or whatever exact version composer builds against at the time), plus the same version in `devDependencies` so composer's own tests and the workspace resolve it. The version stays EXACT — the range destination is post-GA and is not yours to take.

### D3 — composer's checks follow the packages

- `check-cli-engine-pin.mjs`: the engine reference it asserts is now `@prisma/composer-cli`'s peer (exact, matching `@internal/cli`'s devDependency, surviving into the packed manifest); the packed-chunk bare-import assertion and the `dist/bin.mjs` presence assertion move to the new package's tarball.
- `check-family-static-graph.mjs`: its three anchored entrypoints now live in `@prisma/composer-cli`'s dist.
- `check-publish-deps.mjs` and `check-npm-effect-resolution.mjs`: three publishable packages now, not two.
- **New assertion, from the ruled strategy: `@prisma/composer`'s packed output must be engine-free** — no `@prisma/cli-engine` import anywhere in its tarball's JavaScript, and no engine entry in any consumer-installed dependency field. This is the library half of the invariant and nothing checks it today.

### D4 — the publish path runs the checks

Composer's `publish.yml` runs only `check:publish-deps` today; the pin, static-graph and effect-resolution checks run on PR CI only. Add them to `publish.yml` after `check:publish-deps` (an already-identified hole, in scope here because you are editing these checks anyway).

## 5. Explicit handshake: what you do NOT do

- **Do not touch prisma-cli.** After `@prisma/composer-cli` publishes, the shell repins (`@prisma/composer` → `@prisma/composer-cli` in `dependencies` and in `packages/cli/src/cli.ts`), and its conformance check's 3c evolves from pin-equality to peer-satisfaction with the exception list deleted. That is a follow-up in the prisma-cli repo — name it in your PR body as the required next step, with the file pointers above.
- **Do not touch prisma/prisma.** `@prisma/orm-toolchain`'s dependencies→peer change is the same strategy in another repo, separately dispatched.
- **Do not change the engine's versioning.** The engine now versions independently of the shell's lockstep (ruled 2026-08-13, recorded in ADR 0004) — but that ruling is implemented in prisma-cli, not here; composer only consumes whatever exact engine version it builds against.
- **Do not write the strategy ADR.** It is being recorded separately in prisma-cli; your PR implements composer's share of it.

## 6. STOP — surface before implementing

- **STOP-1: the package name.** `@prisma/composer-cli` is the operator's sketch; confirm it (npm scope availability, repo conventions) before creating anything.
- **STOP-2: the bin's fate.** The operator: composer "will not continue to publish its own standalone bin (probably)". Default for this slice: the bin moves to `@prisma/composer-cli` unchanged, retirement is a separate decision. If you find the bin materially complicates the split, surface that instead of working around it.
- **STOP-3: versioning of the new package.** Lockstep with `@prisma/composer` (shared `set-version` machinery) is the presumable default; confirm, because it decides how the tandem release names the pair.
- Anything in composer's release/tag automation that assumes exactly two publishable packages.

## 7. Process rules (operator-enforced, non-negotiable)

- Work in a fresh worktree off composer `origin/main`. Never trust a stale local `main` — fetch first, in every repo you read.
- Git identity: the `wmadden-electric` bot. Commit `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`; end commit bodies with a `Co-Authored-By:` line naming your model. Push ONLY to `git@github-wmadden-electric:prisma/composer.git`. Never force-push. Stage by path, never `git add -A` on directories you have not inspected.
- pnpm only, never npm/npx — except inside `check-npm-effect-resolution.mjs`'s sandbox, which is deliberately npm.
- Tests before implementation; dependency injection, never `vi.mock`/module mocking; composer's existing check scripts show the io-seam style.
- NEVER hard-wrap markdown prose. Plain-English reports; no invented jargon; banned words: "load-bearing", "smoking gun", "belt and suspenders", "gate".
- PR: one PR, base `main`, DRAFT first. Description structure: grounding example first (a real install/run, before/after), then the decision, then the narrative, alternatives last. Reference the strategy discussion date (2026-08-13) and prisma-cli PR #161 / prisma/prisma PR #29998 as the sibling conformance work.
- Verification, each measured as the command's own exit code: composer's full suite, its script tests, every check script run end to end (including your changed ones), and a `publish.yml` dry-run path if the repo offers one.

## 8. Your first report

Confirm you read the project docs and this brief; state the STOP-1..3 answers you need; list any fact in §3 that no longer holds on composer `origin/main` (the repo moves fast — re-verify, do not trust this brief's snapshot); then your dispatch plan.
