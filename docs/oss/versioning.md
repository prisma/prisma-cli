# Versioning

This page covers the **version contract** the unified Prisma CLI offers to its users, and the **mechanism** that delivers it. The first half is the policy you can rely on; the second half is the procedure maintainers follow to honour it. The model (scripts, workflow, and this document) is ported from [prisma/prisma](https://github.com/prisma/prisma) by operator ruling (2026-08-10): this repo adopts that versioning machinery *and* its version number — the unified CLI takes over the `8.0.0-rc.N` line.

## The Prisma 8 RC line

Prisma 8 ships as a release-candidate line ahead of `8.0.0` final: releases are versioned `8.0.0-rc.1`, `8.0.0-rc.2`, … with the counter advancing on every release publish. "The Prisma 8 RC" is the product name; the version number underneath iterates freely, and there is no promise that the final RC is literally numbered `rc.1`. Versions are immutable on npm — a botched publish burns a counter value, which is fine; skip it and never reuse a number.

RC respins may include breaking changes until `8.0.0` final ships. There are no patch releases on the RC line — a fix ships as the next `rc.N`.

For the packages this repository's publish workflow ships (`@prisma/cli`, `@prisma/cli-engine`), **each release publishes under its line's canonical dist-tag**: RC-line versions under `next`, stable versions under `latest` (operator ruling 2026-08-12; supersedes the earlier "`latest` tracks the newest release, RC or stable"). A dist-tag moves only through a deliberately merged version-bump PR (or a manual `workflow_dispatch`); creating and merging the bump PR is the operator's explicit act. `latest` stays on the pre-8 CLI until the operator moves it deliberately. Existing installs are unaffected — lockfiles pin resolved versions, and nobody lands on the RC line without asking for `@next`.

The transition onto the RC line is a one-time bump from the pre-8 base to `8.0.0-rc.1`; `pnpm bump-version` encodes it (a pre-8 stable base advances to `8.0.0-rc.1`, an RC base advances its counter).

## Lockstep across the workspace

Every lockstep workspace package — publishable, private, and the workspace root — carries the same `version`. One read of root [`package.json`](../../package.json) answers "what version is this code?" for the repository.

**Exceptions:** `@prisma/compute` versions independently, pending extraction to another repository (operator ruling 2026-08-10), and keeps its own publish workflow ([`publish-compute.yml`](../../.github/workflows/publish-compute.yml)). `@prisma/cli-engine` also versions independently ([ADR 0004](../architecture/adrs/0004-engine-version-pinning.md), operator ruling 2026-08-13): an engine version means "the engine changed", not "the CLI released", which is what keeps the exact peer pins the product CLI packages hold on it cheap — they repin only when the engine actually moves. The engine follows honest pre-1.0 semver (a breaking change bumps the minor); bumping it is a deliberate edit to `packages/cli-engine/package.json` plus the shell's `workspace:<engine version>` pin, landed as a reviewed commit like any other version change. Both packages are hard-excluded in [`scripts/set-version.ts`](../../scripts/set-version.ts), which still sweeps their `workspace:` pins on lockstep siblings so those never go stale. At publish time the engine ships at its own manifest version; an already-published engine version is a no-op. The engine's own line continues from `0.1.0` (after the published `0.0.x` series); the `8.0.0-rc.N` engine versions that shipped while it was still in lockstep are burned values — they exist on the registry, nothing pins them, and version numbers are never reused.

The lockstep set is: the workspace root, `packages/cli`, `packages/cli-telemetry`, `packages/cli-conformance`, and `packages/tsconfig`. Private packages are never published (`pnpm publish` skips them), but they still version in lockstep so a contributor cloning the repo at any commit sees one consistent answer to "what version is this code?". Workspace-internal dependencies are pinned as `workspace:<version>` (e.g. `workspace:8.0.0-rc.1`); pnpm resolves them locally during development and rewrites them to the exact version at publish time, so every published package carries an exact-version pin on its siblings.

How the packages published by *other* repositories relate to the engine's version — the product CLI packages the shell mounts, and the product libraries applications install — is governed by [ADR 0004](../architecture/adrs/0004-engine-version-pinning.md): product CLI packages declare `@prisma/cli-engine` as an exact peer dependency the shell satisfies, and product libraries carry no engine relationship at all.

## Dist-tag convention

The npm registry exposes the CLI packages under these dist-tags:

- **`latest`** — what a bare `npm install` gets. It stays on the pre-8 CLI while the Prisma 8 RC line matures; moving it to 8.x is a deliberate operator act (dispatching the publish workflow with `dist-tag: latest`, or widening `releaseDistTag` when the RC line is ready), not a side effect of any routine release (operator ruling 2026-08-12). Once the line is stable, stable release bumps publish here.
- **`next`** — the Prisma 8 RC line (`8.0.0-rc.N`). A merged release PR on the RC line publishes here automatically.
- **`beta`** — reserved for hand-cut previews ahead of significant changes, published by dispatching the workflow with that dist-tag. Routine releases do not use this tag.

There is no `dev` channel. A push to `main` that does not change the version publishes nothing, because the version at that commit is already on the registry and there is nothing else this repository could honestly call the build. To hand someone an unreleased build, use the per-PR preview below.

PR previews go through [`pkg.pr.new`](https://pkg.pr.new) ([`preview-cli-package.yml`](../../.github/workflows/preview-cli-package.yml)); they carry the committed base version and install via per-commit URLs, not dist-tags.

## Who can publish

Publishing requires:

- **Push access to `main`** — pushing to `main` or merging a release PR is restricted to maintainers.
- **A green run of the [`Publish to npm`](../../.github/workflows/publish.yml) workflow.** The workflow uses npm OIDC trusted publishing — no long-lived `NPM_TOKEN` exists in repository secrets, so a leaked secret cannot be used to publish out-of-band. Each published tarball carries an [npm provenance attestation](https://docs.npmjs.com/generating-provenance-statements) tying it to this repository and the workflow run that produced it.
- The workflow only publishes from `main`. Dry-runs are permitted from any branch (see "validate publish changes" below); every step that would mutate external state is independently guarded.

## Mechanism: how we deliver the contract

The version this repository ships is the **`version` field of the root [`package.json`](../../package.json)**. The publish workflow ([`publish.yml`](../../.github/workflows/publish.yml)) reads this value at the workflow's git ref and refuses to publish anything else. There is no `workflow_dispatch` input to override the version, no per-package `version` drift, and no separate "release manifest" file.

This is by design. The alternatives cause silent problems:

- **Querying the npm registry for the latest tag** makes the next version implicit. A yanked release, a manually-rewritten dist-tag, or registry latency all silently shift what the next CI build calls itself.
- **A separate `versions.json`** would diverge from the per-package `version` in tooling that only inspects `package.json` (npm, dependency analyzers, supply-chain scanners, downstream consumers). Keeping the source in `package.json` means there is nothing to keep in sync.

[`scripts/set-version.ts`](../../scripts/set-version.ts) is what enforces lockstep: a single invocation walks every lockstep workspace `package.json` and writes the requested version (rewriting `workspace:` dependency pins to match). It is a maintainer's tool, invoked through `pnpm bump-version`; the publish workflow does not run it.

The publish workflow is **triggered by a change to the root `version`**: a push to `main` whose root `package.json` carries a different `version` than the previous tip is recognised as a release bump and ships that version under its canonical dist-tag — `next` on the RC line (the accompanying GitHub Release is marked pre-release), `latest` for stable. This is what makes "merge the release PR" the publish trigger; there is no separate dispatch step. A push that leaves the version alone publishes nothing. Within a publish, `@prisma/cli-engine` goes first, then `@prisma/cli` (which depends on it).

**Nothing rewrites a `version` field outside a commit.** `set-version.ts` is run by `pnpm bump-version`, whose output a maintainer reviews and commits; the publish workflow never invokes it. That is what makes "the version is whatever `package.json` says" true rather than aspirational — CI has no way to ship a version no commit describes. It also keeps `pnpm-lock.yaml` honest: the lockfile records the `workspace:` specifiers that `set-version.ts` rewrites, so `bump-version` refreshes it in the same breath and the bump lands as one internally consistent commit.

Before anything reaches the registry, the workflow verifies the artifact it is about to ship: the grammar-completeness check (`pnpm check:grammar`) proves the assembled command tree lost nothing, and the conformance checks (`pnpm check:conformance`, [`packages/cli/scripts/conformance.ts`](../../packages/cli/scripts/conformance.ts)) prove the built output imports only declared dependencies, every mounted config-section validator survives hostile input, and the packed tarballs survive a registry consumer's install — a clean sandbox, npm with `--ignore-scripts`, unpublished workspace siblings resolved through computed `file:` overrides, every declared bin started on plain Node, and the `@prisma/cli-engine` pins agreeing between the shell and every mounted family. The verified tarballs upload as workflow artifacts on every publishing run and attach to the GitHub Release on releases, so the artifact a maintainer can retrieve is the one the checks verified. The dry-run dispatch runs all of this without registry writes.

[`scripts/determine-version.ts`](../../scripts/determine-version.ts) decides whether this run publishes at all, and under which dist-tag. It refuses non-canonical bases (anything other than `X.Y.Z` or `8.0.0-rc.N`), so a malformed root `version` fails the publish before anything reaches the registry. It reads; it never writes.

## Procedure: cut the next release

The release cadence is one PR per release (on the RC line: one PR per `rc.N`). A maintainer:

1. **Runs the [`publish-npm-version` skill](../../skills-contrib/publish-npm-version/SKILL.md)**, which drives `pnpm bump-version` in a fresh worktree off `origin/main` and opens the release PR under real maintainer credentials (so CI runs on it normally). The script reads the root version committed at HEAD, computes the next release version (`8.0.0-rc.N` → `8.0.0-rc.N+1`), and writes it to every lockstep `package.json`. `bump-version` refreshes `pnpm-lock.yaml` itself, because the lockfile records the `workspace:` pins it rewrites and a stale one fails every later frozen install. Commit both and open a `chore(release): 8.0.0-rc.N+1` PR.
2. **Reviews and merges the PR.** This is the point where a human verifies the release is intended — merging the bump PR is the deliberate act that publishes. The resulting push to `main` carries the bumped root `version`, the publish workflow detects the change, publishes under the line's canonical dist-tag (`next` on the RC line, `latest` for stable), and creates a matching GitHub Release (marked pre-release on the RC line).

If the publish needs to be re-run (transient registry failure, etc.), a maintainer can dispatch the [`Publish to npm`](../../.github/workflows/publish.yml) workflow from `main` with the version's canonical dist-tag (`next` on the RC line, `latest` for stable) and `dry-run=false`; the workflow re-publishes the version currently committed at HEAD, and because the chosen tag matches the canonical one it also re-creates the GitHub Release if it is missing. This is the same path used to cut a hand-rolled `beta` (`dist-tag=beta`, no Release).

## Procedure: validate publish changes

The publish workflow's `dry-run` mode (the input default) can be invoked from any branch to validate that the publish pipeline still works after touching `publish.yml`, `set-version.ts`, `determine-version.ts`, or the build scripts. A dry-run exercises `pnpm publish --dry-run` against both CLI packages and skips the registry publish + GitHub Release.

The pure version-computation helpers are covered by `pnpm test:scripts` (run in CI by the PR Quality workflow), including RC-line advancement and dev-counter idempotence.

## Non-goals

- **Independent per-package versioning** (beyond the ruled `@prisma/compute` exclusion). Lockstep is the invariant the rest of the contract is built on.
- **A scripted `beta` cadence.** The `beta` dist-tag exists but cutting beta builds is a manual `workflow_dispatch`. (The RC cadence, by contrast, *is* the routine scripted path.)
- **Patch releases on the RC line.** A fix ships as the next `rc.N`.
