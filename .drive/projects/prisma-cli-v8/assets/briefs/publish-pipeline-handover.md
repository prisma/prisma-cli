# Handover brief — the CLI's publish pipeline and what is still open

You are picking up work on `prisma/prisma-cli`, the repository that assembles the unified Prisma CLI from three products. This brief covers what was just done, what is open, and the rules the operator holds you to. Read it fully before touching anything.

## Where the design lives

- Drive project: `.drive/projects/prisma-cli-v8/` — `specs/`, `plans/`, `deferred.md` (open items), `assets/briefs/` (handovers, including this one).
- `docs/oss/versioning.md` — the version contract and the release procedure.
- `docs/oss/release-automation.md` — how a product's new version reaches the CLI, the shared token, and a failure-mode table.
- `docs/architecture/adrs/0004-engine-version-pinning.md` — one engine per install; product CLI packages declare `@prisma/cli-engine` as an exact peer, product libraries carry no engine relationship.

## The three repositories

| Repository | Publishes | Release dist-tag |
| --- | --- | --- |
| `prisma/prisma-cli` (here) | `@prisma/cli-engine`, `@prisma/cli`, `prisma` | `next` for the v8 RC line |
| `prisma/composer` | `@prisma/composer-cli`, `@prisma/composer` | `latest` |
| `prisma/prisma` | `@prisma/orm-toolchain` | `latest` |

The products publish releases to `latest` because they are new packages with no pre-8 audience. The bare `prisma` name is the exception: its `latest` serves Prisma 7 (`7.9.1`) to everyone who types `npm install prisma`, so v8 lives on `next` until the operator's deliberate cutover, planned for the week of 2026-08-17. **Do not move `latest` on `prisma`.**

## State as of 2026-08-18

Published and correct:

- `prisma@8.0.0-rc.4` and `@prisma/cli@8.0.0-rc.4` on `next`, with provenance, depending on `@prisma/composer-cli@0.7.0`, `@prisma/orm-toolchain@8.0.0-rc.2` and `@prisma/cli-engine@0.1.1`.
- Both products declare the engine as an exact peer at `0.1.1`, so an install resolves **one** engine. That is ADR 0004's invariant holding for the first time.
- `packages/cli/scripts/conformance.ts` carries an empty exception list. Keep it empty; adding an entry is a decision to argue for, not a way to get green.

The rule the pipeline enforces: **a release depends only on released product versions; a dev build depends on their dev builds.** Conformance check 4 (`packages/cli-conformance/src/checks/release-pins.ts`) fails a release whose dependencies contain any `-dev.` version, and it has no suppression mechanism on purpose — a suppressed finding exits 0, which is how `prisma@8.0.0-rc.3` shipped two dev builds.

## Open pull requests

- **#195 — "Three defects the 8.0.0-rc.4 release exposed"**. The one that matters. Restructures `publish.yml` so the dev publish is unconditional and the release publish is the conditional half; fixes the Release step racing its own draft lookup; adds `scripts/verify-published.mjs`, which polls the registry so a run cannot claim success for a version nobody can install. Needs review.
- **#194 — the `dev` dist-tag brief** for the two product agents. Docs only. CodeRabbit's comments are addressed; it needs a human review to clear its `CHANGES_REQUESTED`.

**Before merging #195, run the publish workflow's `workflow_dispatch` dry-run** from that branch. It exercises everything except the registry writes and the Release step, and the publish path cannot otherwise be tested from a pull request.

## What is still open

`deferred.md` is authoritative; the live ones:

1. **Neither product repository notifies this one when it publishes.** Until they do, a daily scheduled run of `update-product-versions.yml` is what notices a product release, so a new product version reaches the CLI within a day rather than minutes. `docs/oss/release-automation.md` carries the exact step to add. `DEPLOY_GITHUB_TOKEN` is already provisioned in all three repositories.
2. **Both product repositories need the dev-tag fix** in #194's brief: publish a dev build for every `main` build, including the release commit. Composer is in the broken state now — `latest: 0.7.0`, `dev: 0.6.0-dev.23` — so every dev build of the CLI currently tests older composer code than the release carries.
3. **Neither product repository installs its own tarball before publishing.** That is why an uninstallable `@prisma/composer-cli@0.6.0` sat on `latest` unnoticed. This repo's conformance check 3 does exactly that — pack, install into a clean sandbox with `npm --ignore-scripts`, start every declared bin — and is worth porting.
4. **`packages/cli/src/auth/credential-manager.ts` has a private `#repin` method.** The operator banned that word; it is a mechanical rename of a private method, kept out of the publish work to keep that diff to one subject.

## Traps that cost time here

- **OIDC trusted publishing authorises `npm publish` and nothing else.** `npm dist-tag add` needs traditional auth, and this repo deliberately has no long-lived `NPM_TOKEN`. Any plan that moves a dist-tag is dead on arrival; publish a version instead.
- **`npm publish` does not rewrite `workspace:` specifiers; `pnpm publish` does.** Publishing by hand with npm is how `@prisma/composer-cli@0.6.0` reached the registry with `"@prisma/composer": "workspace:0.6.0"` in its manifest, uninstallable with `EUNSUPPORTEDPROTOCOL`.
- **The registry is eventually consistent, and `prisma` is heavily cached.** `pnpm publish` reporting success does not mean the version resolves; `prisma@8.0.0-rc.4` took minutes. Use `npm view <spec> --prefer-online`, and do not conclude a publish failed from one 404.
- **turbo passes only declared environment variables to tasks.** `PUBLISH_CHANNEL` is declared on the `conformance` task in `turbo.json`; an undeclared variable is silently absent, which made the check read `release` in every run until it was found.
- **A stale CodeRabbit `CHANGES_REQUESTED` blocks merging** even after every comment is addressed, and you cannot dismiss a review on your own pull request. Reply on each thread, ask it to re-review, and if it does not clear, say so rather than routing around it.
- **Merging a pull request that publishes to npm is blocked by the permission classifier.** Ask the operator; do not retry the denied call.

## The operator's rules

Non-negotiable, learned the hard way:

- **Plain English.** No invented jargon, no coined labels, no process vocabulary ("surfaced", "ruled", "flagged"). The word "repin" is banned outright — say what actually happens.
- **Comments are a last resort.** Do not narrate incidents, cite rulings, or restate the line below. `publish.yml` went from 127 comment lines to 27 for exactly this reason. What survives is only what will bite someone editing the file.
- **Finish the job.** Commit, push, open the pull request — never leave work uncommitted, never ask permission for those three. Never open a draft unless the work is genuinely partial.
- **Never offer stale work as an option.** Update it instead.
- **Ask rarely.** The drive plan answers most questions; the operator's patience for them is short.
- **Sibling checkouts go stale.** Always `git fetch origin main` and read via `git show origin/main:<path>` before grounding a claim on another repo.
- **Tests before implementation.** No `vi.mock`. pnpm everywhere, except `npm` inside conformance sandboxes where a registry consumer's behaviour is the point.
- **Commits** need the bot identity and both sign-offs, and 1Password signing does not work in agent shells:
  ```bash
  git -c gpg.ssh.program=ssh-keygen commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"
  ```
- **Push only to the bot remote** (`git@github-wmadden-electric:...`), never through `origin`.

## Cutting the next release

1. `git fetch origin main`, branch off it, run `pnpm bump-version` (root `8.0.0-rc.N` → `rc.N+1`, swept across the lockstep, lockfile refreshed).
2. Verify on that tree: `PUBLISH_CHANNEL=release pnpm check:conformance` must report nothing, and `pnpm check:grammar` must pass.
3. Open `chore(release): bump to <version>`. Merging it is the publish trigger and is the operator's act.
