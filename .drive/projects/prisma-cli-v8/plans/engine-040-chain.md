# Engine 0.4.0 release chain — plan

Engine 0.4.0 (`--format markdown`, prisma-cli#260) is on npm under the `dev` dist-tag. Both product families peer the engine exactly at 0.3.0, and prisma-cli carries two conformance exceptions until they republish. This plan finishes the transition. Order is forced: composer depends on `@prisma/orm-toolchain` in three packages (target extension, auth module, composer-prisma-cloud), so composer can only move to engine 0.4.0 once an orm-toolchain that peers 0.4.0 exists.

## Stage A — prisma/prisma: release 8.0.0-rc.11 peering engine 0.4.0

**DONE 2026-09-13:** prisma/orm#30272 merged as `ff47560c9f`; `@prisma/orm-toolchain@8.0.0-rc.11` is `latest` on npm with `@prisma/cli-engine: 0.4.0`. Release worktree `~/Projects/prisma/release-8.0.0-rc.11` can be removed.

Repo `~/Projects/prisma/prisma`, remote `bot`. Follow `skills-contrib/publish-npm-version/SKILL.md` and `skills-contrib/draft-release-notes/SKILL.md` on origin/main exactly: fresh worktree `release/8.0.0-rc.11` off origin/main, `pnpm bump-version`, lockfile refresh, `docs/releases/v8.0.0-rc.11.md` plus the CHANGELOG mirror, upgrade recipes if `check:upgrade-coverage` demands them. On top of the routine bump: move every `@prisma/cli-engine` pin from 0.3.0 to 0.4.0 (`packages/9-public/@prisma/orm-toolchain`, `packages/1-framework/3-tooling/cli` twice, `test/integration`), the way prisma#30137 did for 0.3.0. Gate: `check:release-notes --mode pr`, `check:upgrade-coverage`, `test:scripts`, the CLI tooling package's typecheck and tests against engine 0.4.0, `fixtures:check` if the bump changes emitted contracts. PR title `chore(release): bump to 8.0.0-rc.11`. Merging publishes rc.11 under `latest`.

**Done when:** `npm view @prisma/orm-toolchain@8.0.0-rc.11 peerDependencies` shows `@prisma/cli-engine: 0.4.0`.

## Stage B — composer: ORM family to rc.11 and engine to 0.4.0, then release 0.20.0

**DONE 2026-09-13:** composer#293 (pins, merged b415c61875) and composer#294 (`chore(release): v0.20.0`, merged 378320fc2a). No contract re-emit was needed; rc.11 changed nothing but the engine peer. The deploy-verify-destroy job on #294 failed once on a Prisma API transport error and passed on rerun.

Repo `~/Projects/prisma/composer`, remote `bot`. Two PRs, as composer#291 then #292 did: (1) `chore(deps)`: every `@prisma/orm-*` pin rc.10 → rc.11 and every `@prisma/cli-engine` declaration 0.3.0 → 0.4.0 (composer-cli peer and dev, `@internal/cli` dependency, target extension, examples, integration tests), contracts re-emitted with the rc.11 toolchain if their emitted shape changed, `check:cli-engine-pin`, `check:orm-pins`, `lint:deps` green; (2) `chore(release): v0.20.0` via `pnpm bump-minor`, version bump only. Merging (2) publishes composer-cli 0.20.0.

**Done when:** `npm view @prisma/composer-cli@0.20.0 peerDependencies` shows `@prisma/cli-engine: 0.4.0`.

## Stage C — prisma-cli: pins, then release

**Pins DONE 2026-09-13:** prisma-cli#265 (opened by the `Update product versions` workflow on dispatch, auto-merged as 2a2e7cd4bf): composer-cli 0.20.0, orm-toolchain rc.11, composer 0.20.0. **Release DONE 2026-09-14:** prisma-cli#266 merged as 43458ae33e; `prisma@8.0.0-rc.15` is `latest`, conformance exceptions back to `[]`, clean-cache install verified (one engine copy, 0.4.0; markdown help and commands work). Chain complete except the engine `latest` dist-tag hand move (#240 is the permanent fix, approved, unmerged).

Repo prisma-cli. (1) Product pins PR: `scripts/update-product-versions.mjs` or the documented equivalent moves composer-cli to 0.20.0 and orm-toolchain to 8.0.0-rc.11, `exceptions: []` restored in `packages/cli/scripts/conformance.ts`, `pnpm check:conformance` reporting 0 failing and 0 allowed. (2) Release PR `pnpm bump-version` to 8.0.0-rc.15, branched only after (1) merges.

**Done when:** a clean-cache `npx prisma@latest --version` runs and `prisma --format markdown --help` prints Markdown.

## Standing items

- `npm dist-tag add @prisma/cli-engine@0.4.0 latest` needs Will's npm login.
- Every PR opens from the bot; Will approves and merges. prisma/prisma merges through its merge queue (`gh pr merge --auto`).
