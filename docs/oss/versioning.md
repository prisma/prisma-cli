# Versioning

This page covers the **version contract** the unified Prisma CLI offers to its users, and the **mechanism** that delivers it. The first half is the policy you can rely on; the second half is the procedure maintainers follow to honour it. The model (scripts, workflow, and this document) is ported from [prisma/prisma](https://github.com/prisma/prisma) by operator ruling (2026-08-10): this repo adopts that versioning machinery *and* its version number — the unified CLI takes over the `8.0.0-rc.N` line.

## The v8 RC line

Prisma 8 ships as a release-candidate line ahead of `8.0.0` final: releases are versioned `8.0.0-rc.1`, `8.0.0-rc.2`, … with the counter advancing on every release publish. "The v8 RC" is the product name; the version number underneath iterates freely, and there is no promise that the final RC is literally numbered `rc.1`. Versions are immutable on npm — a botched publish burns a counter value, which is fine; skip it and never reuse a number.

RC respins may include breaking changes until `8.0.0` final ships. There are no patch releases on the RC line — a fix ships as the next `rc.N`.

For the packages this repository's publish workflow ships (`@prisma/cli`, `@prisma/cli-engine`), **`latest` tracks the newest release — RC or stable**. `latest` moves only through a deliberately merged version-bump PR (or a manual `workflow_dispatch`); creating and merging the bump PR is the operator's explicit act that alters `latest`. Existing installs are unaffected — lockfiles pin resolved versions, and stable ranges like `^3.x` can never resolve to an RC (pre-releases don't match stable ranges), so nobody is moved onto the RC line by `npm update`; new installs get the newest RC.

The transition onto the RC line is a one-time bump from the pre-8 base to `8.0.0-rc.1`; `pnpm bump-version` encodes it (a pre-8 stable base advances to `8.0.0-rc.1`, an RC base advances its counter).

## Lockstep across the workspace

Every lockstep workspace package — publishable, private, and the workspace root — carries the same `version`. One read of root [`package.json`](../../package.json) answers "what version is this code?" for the repository.

**Exception:** `@prisma/compute` versions independently, pending extraction to another repository (operator ruling 2026-08-10). It is hard-excluded in [`scripts/set-version.ts`](../../scripts/set-version.ts) and keeps its own publish workflow ([`publish-compute.yml`](../../.github/workflows/publish-compute.yml)).

The lockstep set is: the workspace root, `packages/cli`, `packages/cli-engine`, `packages/cli-telemetry`, and `packages/tsconfig`. Private packages are never published (`pnpm publish` skips them), but they still version in lockstep so a contributor cloning the repo at any commit sees one consistent answer to "what version is this code?". Workspace-internal dependencies are pinned as `workspace:<version>` (e.g. `workspace:8.0.0-rc.1`); pnpm resolves them locally during development and rewrites them to the exact version at publish time, so every published package carries an exact-version pin on its siblings.

## Dist-tag convention

The npm registry exposes the CLI packages under these dist-tags:

- **`latest`** — the most recent release, RC or stable (`8.0.0-rc.N` on the RC line). Default for any bare `npm install`. New `latest` releases happen only when a release PR merges (see procedure below) or a maintainer dispatches the publish workflow.
- **`dev`** — every push to `main` that doesn't change the root `version` produces a `<base>-dev.N` tarball under this tag (on the RC line: `8.0.0-rc.X-dev.N`). Use these to pin reproductions or hand someone a "try `@dev` to get the bleeding edge" link. **No stability promise** — they may be yanked freely.
- **`beta`** — reserved for hand-cut previews ahead of significant changes. Routine releases do not use this tag.

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

[`scripts/set-version.ts`](../../scripts/set-version.ts) is what enforces lockstep: a single invocation walks every lockstep workspace `package.json` and writes the requested version (rewriting `workspace:` dependency pins to match). The publish workflow uses the same script, so per-package and root values cannot diverge through the publish path.

The publish workflow is **triggered by a change to the root `version`**: a push to `main` whose root `package.json` carries a different `version` than the previous tip arriving via a merged `chore(release): ...` bump PR (the commit-subject marker is checked alongside the version change; a version change without it publishes a dev build only) is recognised as a release bump and ships the new version under dist-tag `latest` — on the RC line that means `latest` moves to the new `8.0.0-rc.N`, and the accompanying GitHub Release is marked pre-release. Pushes that don't change the root `version` produce `<base>-dev.N` tarballs under dist-tag `dev` instead. This is what makes "merge the release PR" the publish trigger — there is no separate dispatch step. Within a publish, `@prisma/cli-engine` goes first, then `@prisma/cli` (which depends on it).

[`scripts/determine-version.ts`](../../scripts/determine-version.ts) composes the version + dist-tag for the run and refuses non-canonical bases (anything other than `X.Y.Z` or `8.0.0-rc.N`), so a malformed root `version` fails the publish before anything reaches the registry.

## Procedure: cut the next release

The release cadence is one PR per release (on the RC line: one PR per `rc.N`). A maintainer:

1. **Runs the [`publish-npm-version` skill](../../skills-contrib/publish-npm-version/SKILL.md)**, which drives `pnpm bump-version` in a fresh worktree off `origin/main` and opens the release PR under real maintainer credentials (so CI runs on it normally). The script reads the root version committed at HEAD, computes the next release version (`8.0.0-rc.N` → `8.0.0-rc.N+1`), and writes it to every lockstep `package.json`. Run `pnpm install` afterwards so the lockfile picks up the rewritten `workspace:` pins, then commit and open a `chore(release): 8.0.0-rc.N+1` PR.
2. **Reviews and merges the PR.** This is the point where a human verifies the release is intended — merging the bump PR is the deliberate act that moves `latest`. The resulting push to `main` carries the bumped root `version`, the publish workflow detects the change, publishes under `latest`, and creates a matching GitHub Release (marked pre-release on the RC line).

If the publish needs to be re-run (transient registry failure, etc.), a maintainer can dispatch the [`Publish to npm`](../../.github/workflows/publish.yml) workflow from `main` with `dist-tag=latest` and `dry-run=false`; the workflow re-publishes the version currently committed at HEAD. This is the same path used to cut a hand-rolled `beta` (`dist-tag=beta`).

## Procedure: validate publish changes

The publish workflow's `dry-run` mode (the input default) can be invoked from any branch to validate that the publish pipeline still works after touching `publish.yml`, `set-version.ts`, `determine-version.ts`, or the build scripts. A dry-run exercises `pnpm publish --dry-run` against both CLI packages and skips the registry publish + GitHub Release.

The pure version-computation helpers are covered by `pnpm test:scripts` (run in CI by the PR Quality workflow), including RC-line advancement and dev-counter idempotence.

## Non-goals

- **Independent per-package versioning** (beyond the ruled `@prisma/compute` exclusion). Lockstep is the invariant the rest of the contract is built on.
- **A scripted `beta` cadence.** The `beta` dist-tag exists but cutting beta builds is a manual `workflow_dispatch`. (The RC cadence, by contrast, *is* the routine scripted path.)
- **Patch releases on the RC line.** A fix ships as the next `rc.N`.
