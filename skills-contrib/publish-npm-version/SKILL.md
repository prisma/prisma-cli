---
name: publish-npm-version
description: >-
  Cuts the next release of the unified Prisma CLI: bumps the root
  package.json version (on the v8 RC line: 8.0.0-rc.N → rc.N+1),
  propagates it to every lockstep workspace package, and opens a PR
  titled "chore(release): bump to <next-version>". When the maintainer
  merges the PR, the `Publish to npm` workflow ships @prisma/cli-engine
  and @prisma/cli under dist-tag `latest` (RC versions get a
  pre-release GitHub Release). Use when a maintainer asks to "cut the
  next RC", "cut the next release", "bump to the next version", "open
  a release PR", or "prepare a publish PR".
---

# Publish next npm version

## Audience

Maintainers of the unified Prisma CLI with permission to push branches
and open PRs in prisma/prisma-cli. The skill runs locally, never as a
GitHub Action — a locally opened PR triggers CI normally, which is the
point of a reviewable release PR.

## Background reading

Read [`docs/oss/versioning.md`](../../docs/oss/versioning.md) first. It
covers the source-of-truth model (root `package.json` `version`), the
lockstep guarantee (`@prisma/compute` excluded by ruling), the v8 RC
line, the dist-tag convention, and the release procedure this skill is
one step of. One note specific to this
repo: the lockstep excludes `@prisma/compute` by operator ruling.

## Pre-flight

No requirement to be on `main` or have a clean tree — all work happens
in a fresh worktree off `origin/main`. Confirm `git fetch origin main`
succeeds; if not, stop and surface the issue.

## Procedure

1. **Fetch and determine the target version.**

   ```bash
   git fetch origin main
   CURRENT=$(git show origin/main:package.json | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).version)')
   NEXT=$(node -e "import('./scripts/determine-version-utils.ts').then(m => process.stdout.write(m.computeNextReleaseVersion(process.argv[1])))" "$CURRENT")
   echo "$CURRENT → $NEXT"
   ```

   `$NEXT` names the branch and PR; step 3 recomputes the authoritative
   value inside the fresh worktree and the two must agree.

2. **Create a fresh worktree off `origin/main`.**

   ```bash
   git worktree add -b "release/$NEXT" "../release-$NEXT" origin/main
   cd "../release-$NEXT"
   ```

3. **Bump.** `pnpm install --frozen-lockfile --ignore-scripts` if the
   worktree has no `node_modules`, then `pnpm bump-version`. Confirm the
   version it wrote matches `$NEXT`; on mismatch the worktree's value is
   authoritative — remove worktree and branch, restart from step 1.

4. **Check the lockfile moved.** `pnpm bump-version` refreshes
   `pnpm-lock.yaml` itself, because internal deps are pinned
   `workspace:<version>` and a stale lockfile fails every later frozen
   install with `ERR_PNPM_OUTDATED_LOCKFILE`. If it is missing from the
   diff, stop — the bump did not finish.

5. **Sanity-check the diff.** Only `package.json` files and
   `pnpm-lock.yaml`; manifests change exactly `version` +
   `workspace:<old> → workspace:<new>`; the excluded
   `packages/compute/package.json` is untouched.

6. **Commit** everything in one commit:

   ```text
   chore(release): bump to <version>
   ```

7. **Push the branch** to `origin`.

8. **Open the PR** with `gh pr create`. Use the title:

   ```text
   Bump to version <version>
   ```

   Body: previous → new version; link
   [`docs/oss/versioning.md`](../../docs/oss/versioning.md); note that
   **merging this PR ships the release** — the squashed push to `main`
   changes the root version with the release marker, the `Publish to
   npm` workflow publishes `@prisma/cli-engine` then `@prisma/cli`
   under `latest`, and a GitHub Release (pre-release on the RC line) is
   created with generated notes. This repo has no committed
   release-notes file gate; review the generated notes on the Release
   after merge.

9. **Stop and report** the PR URL and the worktree path. Do not merge —
   the merge is the human gate that triggers the publish. The
   maintainer removes the worktree after merge
   (`git worktree remove ../release-<version>`).

## Idempotency

`pnpm bump-version` reads the root version from `git show
HEAD:package.json`, so re-running in the same worktree cannot
double-bump. The skill as a whole is not idempotent: step 2 fails if
the branch/worktree already exist — remove them
(`git worktree remove ../release-$NEXT`; `git branch -D
release/$NEXT`) or continue inside the existing worktree from step 3.
Do not stack bumps.

## Out of scope

- **Merging the PR** (human gate; merging is the publish trigger).
- **Patch releases.** On the RC line a fix is just the next `rc.N`.
- **Beta tags** — hand-cut via `workflow_dispatch` of `Publish to npm`
  with the `beta` dist-tag; this skill always advances the release
  version.
- **`@prisma/compute`** — excluded from the lockstep by operator ruling
  (2026-08-10); it versions and publishes independently
  (`publish-compute.yml`) pending extraction to another repo.
