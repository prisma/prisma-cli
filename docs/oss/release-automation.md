# Release automation across the three repositories

The unified CLI is assembled from three repositories. This page explains how a new product version reaches a released CLI without anyone editing a file or approving a release, what the one shared secret is for, and how to repair the machinery when it stops.

| Repository | Publishes | Consumed by the CLI as |
| --- | --- | --- |
| `prisma/prisma-cli` (this one) | `@prisma/cli-engine`, `@prisma/cli`, `prisma` | — |
| `prisma/composer` | `@prisma/composer-cli` (and the `@prisma/composer` library) | a dependency of the shell |
| `prisma/prisma` | `@prisma/orm-toolchain` (and `@prisma/orm-framework`, listed so the shell does not rely on the toolchain bringing it; the toolchain names it as a peer from the ORM release after 8.0.0-rc.25) | dependencies of the shell, always at the same version |

One more repository depends on this CLI instead of feeding it: `prisma/cloud-deploy-action`, whose test this repository runs (see [Keeping `prisma/cloud-deploy-action` working](#keeping-prismacloud-deploy-action-working)).

## The rule

A **release** of the CLI depends only on **released** versions of the products. A **dev build** of the CLI depends on the products' **dev builds** (operator ruling 2026-08-17). Nothing in between, and nothing hand-maintained.

## What happens when a product publishes

1. The product repository's publish workflow finishes and sends a `repository_dispatch` event of type `product-published` to `prisma/prisma-cli`.
2. [`update-product-versions.yml`](../../.github/workflows/update-product-versions.yml) runs [`scripts/update-product-versions.mjs`](../../scripts/update-product-versions.mjs), which asks the registry for each watched package's version at its **release** dist-tag and rewrites `packages/cli/package.json` and `packages/prisma/package.json` where they differ. Every watched package publishes its releases under `latest`, pre-release versions included: they are all new packages with no pre-8 audience to protect. The bare `prisma` name, which this repository publishes, was the one exception: its `latest` served Prisma 7 until the 2026-08-25 cutover, and since then every release of it publishes under `latest` too (see [versioning.md](versioning.md)). `@prisma/orm-framework` reads no tag of its own: it takes the version found for `@prisma/orm-toolchain`, because the two must agree (from the ORM release after 8.0.0-rc.25 the toolchain names it as an exact peer) and a run during the ORM's publish must not pin the two apart. Each other package carries a list of candidate tags rather than one name, most-preferred first, so a product moving where it publishes does not silently freeze the CLI on an old version — and a package that publishes none of its candidates fails the run instead of looking like "nothing to update".
3. If any pin changed, or `main` holds pins the last release (its `v<version>` tag) did not ship, the workflow bumps the CLI to its next version with `pnpm bump-version` (which also refreshes `pnpm-lock.yaml`), opens a pull request titled `Release <version>: follow the products' released versions: ...`, and arms auto-merge. Every earlier open pull request from this workflow, and every open `Bump to version` release pull request, is closed first: each bumps the same version, so only one can merge.
4. The pull request runs the full quality and conformance checks. When they pass and CodeRabbit approves it (the `main` ruleset requires one approving review), it merges, and that push to `main` changes the root version, so [`publish.yml`](../../.github/workflows/publish.yml) publishes the release under `latest` with the committed product versions, plus the usual `dev` build.

A product release reaches a released CLI with no person in the loop, as long as CodeRabbit gives the approval the ruleset requires (see the troubleshooting table when it does not), because a CLI left on an older product version breaks every project on the newer one: `prisma@8.0.0-rc.29` pinned `@prisma/orm-toolchain` 8.0.0-rc.21 for four days after the ORM's rc.22 shipped, while its release pull request waited for a review. A release for a change in this repository alone is still cut by a maintainer (see [versioning.md](versioning.md)). Everything on `main` ships with either kind of release, so `main` must always be releasable. Any commit that changes a product pin on `main`, by hand or not, is released by the next run.

A **daily schedule** runs the same comparison, so a lost dispatch event delays an update by at most a day rather than indefinitely. `workflow_dispatch` runs it on demand.

## Keeping `prisma/cloud-deploy-action` working

[`prisma/cloud-deploy-action`](https://github.com/prisma/cloud-deploy-action) runs `prisma deploy` with arguments it builds itself. When `prisma@8.0.0-rc.30` renamed `--stage` to `--environment`, every user's preview deploy failed for a week, because nothing here ran the action's arguments. Two checks now run the action's own test against this CLI, both through [`scripts/check-cloud-deploy-action.mjs`](../../scripts/check-cloud-deploy-action.mjs):

- **The pull request check.** The required `Test` check in [`pr-quality.yml`](../../.github/workflows/pr-quality.yml) builds `prisma` from the pull request and runs the test against it. That CLI uses the products' released versions, which is what the next release ships. A CLI the released action cannot drive cannot merge, so it cannot be released.
- **The dev-build check.** [`check-dev-build-with-cloud-deploy-action.yml`](../../.github/workflows/check-dev-build-with-cloud-deploy-action.yml) runs after each publish from `main`, installs the dev build that run published, and runs the test against it. That CLI uses the products' dev builds, which is what a later release will ship. It runs at the next merge to this repository's `main` after a product publishes a dev build, not at the moment the product publishes. It never holds or fails the publish. On any failure it posts to Slack through the `SLACK_WEBHOOK_URL` secret. The message comes from the script's exit code: 1 means the action's test ran and the action cannot drive the dev build; 2, or a failure in an earlier step, means the check itself could not run. Every run checks the secret in its first step and fails if it is not set.

The pull request check is part of the `Test` job because that check is already required on `main`. It should move to its own required job the next time the `main` ruleset is changed.

### What this repository relies on in the action

- The test is `tests/prisma-cli.test.mjs`, and it needs no install: it imports only `../cli.mjs` and Node built-ins.
- The test reads the executable to test from the `PRISMA_CLI_BINS` environment variable.
- The test reads the CLI's version from the output of `prisma --version`, which must start with the version number.
- The script finds the two deploy cases by their titles (`... accepts the deploy arguments for production` and for a named environment) and exits 2 unless both ran. Without an executable the test runs no cases and passes, so a renamed variable or renamed titles would otherwise go unnoticed. Any failed case makes it exit 1. The destroy case may be skipped, because CLIs without a `destroy` command skip it.
- The test reads this CLI's error codes: `CLI.INVALID_ARGUMENTS`, `CLI.COMMAND_MOVED` or `CLI.UNKNOWN_COMMAND` for rejected arguments, and `CLI.CREDENTIALS_REQUIRED` or `CLI.CONFIG_SECTION_INVALID` as the first check after the arguments are parsed.

Both checks use the action at `v1`, its moving release tag, which is what users run. The repository variable `CLOUD_DEPLOY_ACTION_REF` replaces `v1` in both.

### Changing the `deploy` arguments on purpose

The action chooses the arguments from the CLI's version number. It does not ask the CLI. For example, `takesEnvironmentFlag` in its `cli.mjs` sends `--environment` to 8.0.0-rc.30 and later, and `--stage` to earlier versions. A dev build carries the version of the last release plus `-dev.N` (for example `8.0.0-rc.34-dev.812`), and the action's current rule treats it as that release. So the action cannot tell a dev build with changed arguments from the unchanged release with the same base version.

When a product changes the arguments:

1. The product publishes a dev build with the change. At the next merge to `main` here, the CLI's dev build picks it up, and the dev-build check fails and alerts Slack.
2. The dev-build check stays red, and alerts again on each merge to `main`, until an action release has a rule that covers those dev builds.
3. The product releases the change, and the release pull request bumps the CLI to a new version. It passes only once the action is released, and `v1` moved, with a rule that sends the new arguments to that version (for example "rc.35 and later"). Then re-run its `Test` check.

When the change is made in this repository itself, the pull request's CLI reports the last release's version, so the action sends it the old arguments and the check fails. Release the action first with a rule for the next version, and bump the version (`pnpm bump-version`) in the same pull request.

Making the action detect the arguments without relying on the version number is tracked in [prisma/cloud-deploy-action#27](https://github.com/prisma/cloud-deploy-action/issues/27).

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

Deliberately **not** granted: the Workflows permission. The pull request only ever touches the files `pnpm bump-version` and `update-product-versions.mjs` write, so a change under `.github/workflows/` would be rejected — a useful limit on an unattended token.

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
      -f 'client_payload[package]=@prisma/composer-cli' \
      -f "client_payload[version]=$VERSION"
```

The payload is informational — this repository always re-reads the registry rather than trusting the event, so a malformed or replayed event cannot pin a version that does not exist.

A workflow step that must run should fail when its secret or token is missing, not skip with exit 0. A step that skips silently when its secret is missing can stay broken indefinitely without anyone noticing: the ORM repository's notify step skipped on every release because it read a secret name that was never configured, and nothing reported it. Check that the secret is set before the step that uses it, and make that check fail the job.

## When it stops working

| Symptom | Cause | Fix |
| --- | --- | --- |
| No pull request after a product release | Dispatch event not sent, or the token is missing or expired | The daily run will catch it up; check the product repository's notify step and the secret |
| The workflow fails with "DEPLOY_GITHUB_TOKEN is not configured" | The secret is absent from this repository | Add it (see above) |
| A pull request opens but never merges | Required checks failing | Read the checks — this is the automation working; a product release broke something |
| Two open version-update pull requests | The close-the-previous step failed | Close the older one by hand; they race each other's version and lockfile |
| Checks pass but the pull request does not merge | The `main` ruleset requires one approving review, which CodeRabbit gives; it commented or was rate-limited instead | Approve the pull request by hand |
| `main` holds product pins no release shipped | A release took the version number before the follow pull request merged | The next run (the daily schedule at the latest) compares `main`'s pins with the last release's tag and opens a release for them; dispatch the workflow to do it now |
| A published version never appears on the registry | npm accepted the publish but the version is not resolvable | The publish run polls for it and fails if it never appears; if that fails, re-dispatch the workflow — an already-published version is treated as done, so only the missing one publishes |
| A pull request fails "prisma/cloud-deploy-action can drive this CLI" | The pull request changes the arguments `prisma deploy` accepts, and the released action does not send the new ones to this version | Release the action with a rule for this version and move its `v1` tag, then re-run the check (see [Changing the `deploy` arguments on purpose](#changing-the-deploy-arguments-on-purpose)) |
| Every pull request fails "prisma/cloud-deploy-action can drive this CLI" or "Check out prisma/cloud-deploy-action" | The action's `v1` is broken, or GitHub cannot fetch `prisma/cloud-deploy-action` | Set the repository variable `CLOUD_DEPLOY_ACTION_REF` to a known-good tag of the action and re-run; delete the variable once `v1` works again. If that does not help, an administrator can bypass the `main` ruleset to merge an urgent fix |
| The dev-build check fails at "Check that SLACK_WEBHOOK_URL is set" | The secret is absent from this repository | Add a Slack incoming-webhook URL as the `SLACK_WEBHOOK_URL` repository secret |
| A release publish fails on the dev-build check | The committed pins are dev builds — a dev stamp was committed by mistake, or a product has no usable release | Run `node scripts/update-product-versions.mjs --channel release`; if that changes nothing, the product must publish a real release |

## The state this replaced

`prisma@8.0.0-rc.3` shipped depending on `@prisma/composer@0.6.0-dev.16` and `@prisma/orm-toolchain@8.0.0-rc.1-dev.40`. Both were interim pins from earlier work that nothing moved off and no check refused.

When the dev-build check first ran it refused the release channel, because neither product had a usable released version: `@prisma/composer-cli@0.6.0` could not be installed at all (published with `npm publish` rather than `pnpm publish`, so its dependency on `@prisma/composer` was the literal string `workspace:0.6.0` and `npm install` answered `EUNSUPPORTEDPROTOCOL`), and `@prisma/orm-toolchain@8.0.0-rc.1` had no engine relationship and no command family in its `./cli` export.

Both were fixed the same day: composer published `0.7.0` and prisma/prisma published `8.0.0-rc.2`, each declaring `@prisma/cli-engine@0.1.1` as an exact peer. The release channel has reported nothing since, and the conformance checks carry no recorded exceptions.

Two lessons worth keeping:

- **Publish through the workflow.** The uninstallable `0.6.0` was published out-of-band with `npm publish`, which does not rewrite `workspace:` specifiers. The same batch's `@prisma/composer-prisma-cloud@0.6.0`, published by the workflow, was correct.
- **A repository should install its own tarball before trusting it.** Nothing in composer's repository did, which is why an uninstallable package sat on `latest`. Check 3 here does exactly that, in a clean sandbox with `npm --ignore-scripts`, and is worth porting to both product repositories.
