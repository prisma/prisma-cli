# Handover: end-to-end coverage for every mounted command

## What this is

`prisma-cli` ships one binary that mounts commands from three places: this repo's own platform commands, the ORM family from `@prisma/orm-toolchain`, and composer's from `@prisma/composer`. The rule, enforced by `packages/cli/tests/e2e-coverage.test.ts`, is that every mounted command has at least one real-API happy path in `packages/cli/e2e/` — the command ran and did its job, not `--help` and not "it parsed its arguments".

The reason this repo owes that, rather than leaning on the repos that own the commands: the product repos test exhaustively, and none of them can reproduce the configuration this binary assembles. The mount paths, the engine version actually linked, several families' config sections in one file, the credential wiring and the published tarball's dependency tree exist only here. A command can pass its owner's entire suite and be broken the moment it is mounted. That is not hypothetical — see "How this went wrong once" below.

## State at handover (2026-08-17)

Merged: prisma-cli #158 (postgres stops inventing values), #171 (every presentation required), #178 (the deployment fixture and eight happy paths), and prisma/prisma #30004 (ORM commands declare all four presentations).

Open and green, waiting to merge: **prisma-cli #197** — removes the last two defensive `?.()` calls from `materializePresentation`. Nothing else depends on it.

Coverage went from 40 mounted commands to 48. Eight are still owed, listed in `AWAITING_COVERAGE` in `packages/cli/tests/e2e-coverage.test.ts`, each with the reason it is not written yet.

## The four open problems, in order of who they hurt

**1. `prisma orm init` produces a project the binary cannot read.** This is a live defect a user hits on their first two commands, not a test gap. `orm init` scaffolds `prisma-next.config.ts` — the standalone `prisma-next` bin's config file — and then fails its own last step with exit 5 and `Config is not a defineConfig result`. Nine files are already on disk. Any ORM command afterwards fails differently, because the mounted family reads an `orm` section of `prisma.config.ts`: `CLI.CONFIG_SECTION_INVALID` and `CONFIG.FILE_NOT_FOUND` — "The orm config section is absent, so prisma-next.config.ts was never evaluated." The two config surfaces have different shapes; the section nests the whole config under `orm`, the scaffolded file exports a `defineConfig` result. The fix is in prisma/prisma (`packages/1-framework/3-tooling/cli/src/orm/config-section.ts` defines the section; the scaffold is in the same tree). Until it is fixed, the 22 ORM commands cannot run through the binary at all, which is why they are excluded from coverage rather than merely owed.

**2. One unverified thing that would be serious if true.** Loading a hand-written `prisma.config.ts` failed with `Cannot find package 'pathe'`, imported by `c12` from `packages/cli-engine/node_modules/c12`. `c12` declares `pathe` and the package is in the workspace store, so this is probably a pnpm layout artifact of running the built binary from inside the monorepo. It is unverified. If it reproduces from a packed tarball then every command that reads a config file is broken on install. One run of the S6 tarball check with a config file present settles it.

**3. Eight commands owed a happy path.** `service deployment rollback` needs a second promoted deployment — the only one with no external dependency, and the next thing to write. `service logs` needs a deployment that has served traffic. The five `service domain *` commands need a hostname whose DNS the test account controls: with a promoted deployment in place they reach `SERVICE.DOMAIN_DNS_NOT_CONFIGURED` — "ensure the hostname CNAMEs to switchboard.ewr.prisma.build". `build logs` needs a build, which comes from a git push or a Console action.

**4. A smaller finding, recorded but unfixed.** Without `--branch`, `service domain add` answers `SERVICE.SELECTION_INVALID` — "Selected service does not exist in the resolved project" — for a service that plainly does exist and that `service show` finds without a branch flag. The domain path resolves the service through a branch and reports the failure as if the service were missing.

## Do this next: `service deployment rollback`

The fixture already does the hard part. `packages/cli/e2e/deployed-service.ts` exports `createDeployment(serviceId)`, which creates a deployment through the management API and uploads an artifact, and `deployService(cli, name)`, which does that plus `start` and `promote` through the CLI.

Rollback needs two promoted deployments: deploy one, then create/start/promote a second, then roll back and assert the first is live again. Add it to `packages/cli/e2e/service-deployment.e2e.ts`, remove `"service deployment rollback"` from `AWAITING_COVERAGE`, and delete the paragraph about it in the comment above that list.

Teardown matters and is easy to get wrong: `project remove` refuses while a deployment exists — "Cannot delete project: active deployments exist" — so every deployment the file creates must be deleted before the scratch project is torn down, including on a failure path. `deployService` already deletes its own deployment if `start` or `promote` throws; a second deployment needs the same care.

Deleting a deployment does **not** require stopping it first. That was checked against the API on `provisioning` and on `running`, both of which delete cleanly.

## Environment

The repo is `prisma/prisma-cli`. The ORM lives in the sibling repo `prisma/prisma` at `packages/9-public/@prisma/orm-toolchain` (the published wrapper) and `packages/1-framework/3-tooling/cli/src/orm/` (the actual commands).

Run the e2e suite from `packages/cli` with `npx vitest run --config vitest.e2e.config.ts`. It needs `PRISMA_E2E_SERVICE_TOKEN`, which is deliberately not `PRISMA_SERVICE_TOKEN` so it cannot pick up a developer's own credential. The operator's token is in `~/.config/prisma-compose/deploy.env` as `PRISMA_SERVICE_TOKEN`; source that file and export it under the e2e name. Never print the value. It points at a dev workspace the operator has authorised for this work; the suite creates and removes real projects, services and deployments.

`npm test` fails at random on this repo and it is not your change. Both package `test` scripts begin with `pnpm run build`, so turbo runs the engine's build while the CLI's vitest imports the `dist` it is rewriting; the failure is `Cannot find package '@prisma/cli-engine/testing'` at file level and the count varies run to run. Use `npx turbo run test --concurrency=1`, which passes every time. Recorded in `deferred.md` under "Found during S6".

Commit signing goes through 1Password, which is unreachable in an agent shell. Use `git -c gpg.ssh.program=ssh-keygen commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. Push to the `bot` remote, never `origin`.

## How this went wrong once, and what it teaches

While making all four presentations required, I reported that requiring `stdout` at runtime was safe, and cited `tests/orm-mount.test.ts` passing as the evidence. That test ran in json mode. **Json mode never calls `stdout` at all** — it calls `json` and `next`; human mode calls `human`, `stdout` and `next`. So the test could not have detected the failure it was cited to rule out, and human mode, the default for anyone at a terminal, would have exited 2 across eighteen ORM commands.

Three habits come out of that, and they are worth more than any of the tests above.

A run in one format proves nothing about the other. `orm-mount.test.ts` now runs the same command in both, with a comment saying why.

A test that cannot fail proves nothing. When you add a regression test, break the thing on purpose and watch it go red. And rebuild first: both packages resolve `@prisma/cli-engine` through `dist`, so editing engine source and re-running a test proves nothing until `npm run build` has run. That trap caught me while I was verifying a fix for a review comment about test coverage.

Check a claim against the API rather than reasoning about it. The backlog said the five `service domain` commands needed no deployed service; one call showed they do. It also said only Composer could produce a deployment; the management API produces one in three steps. Both claims were plausible, written by someone competent, and wrong.
