# Release automation across the three repositories

The unified CLI is assembled from three repositories. This page explains how a new product version reaches the CLI without anyone editing a file by hand, what the one shared secret is for, and how to repair the machinery when it stops.

| Repository | Publishes | Consumed by the CLI as |
| --- | --- | --- |
| `prisma/prisma-cli` (this one) | `@prisma/cli-engine`, `@prisma/cli`, `prisma` | — |
| `prisma/composer` | `@prisma/composer-cli` (and the `@prisma/composer` library) | a dependency of the shell |
| `prisma/prisma` | `@prisma/orm-toolchain` | a dependency of the shell |

## The rule

A **release** of the CLI depends only on **released** versions of the products. A **dev build** of the CLI depends on the products' **dev builds** (operator ruling 2026-08-17). Nothing in between, and nothing hand-maintained.

## What happens when a product publishes

1. The product repository's publish workflow finishes and sends a `repository_dispatch` event of type `product-published` to `prisma/prisma-cli`.
2. [`update-product-versions.yml`](../../.github/workflows/update-product-versions.yml) runs [`scripts/update-product-versions.mjs`](../../scripts/update-product-versions.mjs), which asks the registry for each watched package's version at its **release** dist-tag and rewrites `packages/cli/package.json` and `packages/prisma/package.json` where they differ. Every watched package publishes its releases under `latest`, pre-release versions included: they are all new packages with no pre-8 audience to protect. Holding `latest` back behind `next` matters only for the bare `prisma` name, which this repository publishes and which still serves Prisma 7 there until the deliberate cutover. Each package carries a list of candidate tags rather than one name, most-preferred first, so a product moving where it publishes does not silently freeze the CLI on an old version — and a package that publishes none of its candidates fails the run instead of looking like "nothing to update".
3. If anything changed, the workflow refreshes `pnpm-lock.yaml`, opens a pull request, and arms auto-merge. Any earlier open pull request from this workflow is closed first, so two of them cannot race each other onto a stale lockfile.
4. The pull request runs the full quality and conformance checks. When they pass, it merges, and that push to `main` publishes a `dev` build of the CLI carrying the products' **dev** versions (the dev stamp in [`publish.yml`](../../.github/workflows/publish.yml) rewrites them for that run only).
5. A real CLI release stays a human act: a maintainer cuts the `rc.N` bump, and that release ships the committed release versions.

A **daily schedule** runs the same comparison, so a lost dispatch event delays an update by at most a day rather than indefinitely. `workflow_dispatch` runs it on demand.

## The shared secret: `DEPLOY_GITHUB_TOKEN`

One fine-grained personal access token, stored under the same secret name in all three repositories.

**Why it exists.** A pull request created with the built-in `GITHUB_TOKEN` does not trigger workflows. Without CI, the required checks never report, so auto-merge would wait forever and the automation would silently do nothing. The token must therefore be a real account's, not the workflow's.

**Why it belongs to a service account, not a person.** It pushes branches and merges pull requests on a schedule, unattended. Tying that to an individual's account means the automation stops when they rotate a token or leave, and every automated commit is attributed to them.

**What it needs.** Scoped to `prisma/prisma-cli` only:

| Repository permission | Access |
| --- | --- |
| Contents | Read and write |
| Pull requests | Read and write |
| Metadata | Read-only (GitHub requires this alongside any other permission) |

Only `prisma/prisma-cli` needs to be listed even though the secret lives in three repositories. In this repository the token pushes the branch and opens the pull request. In composer and prisma/prisma it only sends the `repository_dispatch` event *to* this repository, and that endpoint needs Contents write **on the target repository** — the same permission on the same one repository.

Deliberately **not** granted: the Workflows permission. The pull request only ever touches the two manifests and the lockfile, so a change under `.github/workflows/` would be rejected — a useful limit on an unattended token.

**When it expires** the workflow fails: an absent secret is reported as an error before anything else runs, and an expired one fails the first `git push` or `gh` call. The catch is *where* it fails — a scheduled run nobody is watching — so the visible symptom is stale versions rather than a red pull request, and the daily backstop cannot recover on its own until the token is replaced. Record the renewal date somewhere you will see it. To replace it, generate a new token with the table above and update the secret in all three repositories; nothing in any repository names the account, so no code changes.

## What each product repository must add

A step in the publish workflow, immediately after its publish step and keyed on that step's outcome, so a failed publish never announces itself:

```yaml
- name: Notify prisma-cli
  if: ${{ steps.publish.outcome == 'success' }}
  env:
    GH_TOKEN: ${{ secrets.DEPLOY_GITHUB_TOKEN }}
  run: |
    gh api repos/prisma/prisma-cli/dispatches \
      -f event_type=product-published \
      -F 'client_payload[package]=@prisma/composer-cli' \
      -F "client_payload[version]=$VERSION"
```

The payload is informational — this repository always re-reads the registry rather than trusting the event, so a malformed or replayed event cannot pin a version that does not exist.

## When it stops working

| Symptom | Cause | Fix |
| --- | --- | --- |
| No pull request after a product release | Dispatch event not sent, or the token is missing or expired | The daily run will catch it up; check the product repository's notify step and the secret |
| The workflow fails with "DEPLOY_GITHUB_TOKEN is not configured" | The secret is absent from this repository | Add it (see above) |
| A pull request opens but never merges | Required checks failing | Read the checks — this is the automation working; a product release broke something |
| Two open version-update pull requests | The close-the-previous step failed | Close the older one by hand; they race each other's lockfile |
| A release publish fails on the dev-build check | The products have no usable released version yet | The products must publish real releases; see below |

## The state this replaced

`prisma@8.0.0-rc.3` shipped depending on `@prisma/composer@0.6.0-dev.16` and `@prisma/orm-toolchain@8.0.0-rc.1-dev.40`. Both were interim pins from earlier work that nothing moved off and no check refused. The dev-build check now refuses it, which means a release stays blocked until both products publish a version the CLI can use:

- **`@prisma/composer-cli`** — the only non-dev version, `0.6.0`, cannot be installed at all: it was published with `npm publish` rather than `pnpm publish`, so its dependency on `@prisma/composer` is the literal string `workspace:0.6.0` and `npm install` fails with `EUNSUPPORTEDPROTOCOL`. Composer needs to publish a release from a commit that peers `@prisma/cli-engine` at the version this repo ships, using `pnpm publish`.
- **`@prisma/orm-toolchain`** — its released `8.0.0-rc.1` has no engine relationship and its `./cli` export contains no command family; the engine-based family exists only in dev builds, and the newest of those (`8.0.0-rc.1-dev.46`, checked 2026-08-17) declares the engine at `0.0.9` rather than the version this repo ships. prisma/prisma needs to adapt to the current engine and publish that as a release. The `-dev.40` named above is a different fact: it is what `rc.3` shipped, not the newest build.
