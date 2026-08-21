# Slice 3 — prisma/prisma: init wiring

Repo: `.refs/prisma`. Branch off slice 1's branch if it hasn't merged
(`skills-in-tarball-packaging`), else `main`; PR base accordingly.
Implements brief v2 Phase 3 (item 8, design §3).

## Outcome

`prisma orm init` no longer shells out to `npx skills add`; skill
delivery is sync-once + user's-postinstall.

## Tasks

1. In `packages/1-framework/3-tooling/cli/src/orm/init.ts` /
   `init-scaffold.ts`: replace the `skills add` invocations
   (`DEFAULT_SKILL_SOURCES` in `commands/init/skill-sources.ts`) with:
   run `prisma skills sync` once directly, and add
   `"postinstall": "prisma skills sync || exit 0"` to the project's
   root `package.json` via the idempotent merge in
   `hygiene-package-scripts.ts` (currently used for `contract:emit`).
2. Gitignore entries for the synced harness skill copies via
   `hygiene-gitignore.ts`.
3. Keep `RETIRED_SKILL_NAMES` cleanup. `--skip-skills`: no sync, no
   postinstall script.
4. Retire the `skillInstall` failure path (exit-6 finding) in
   `docs/reference/error-reference.md` and the code that produces it —
   replace with whatever failure surface the sync-run needs (sync exits
   0 on nothing-to-do; a sync failure should degrade the same way the
   old skillInstall finding did, or simpler — pin with the orchestrator
   if unclear).
5. Update
   `test/integration/test/cli.init-skill-distribution.integration.test.ts`
   (currently sparse-clones the GitHub source) to assert the new
   behavior: postinstall script written, gitignore entries, sync
   invoked, `--skip-skills` honored.

## Out of scope

The sync implementation itself (prisma-cli, slice 2), skill content
(slice 1), composer. No AGENTS.md writes.

## Completed when (validation gate)

- The updated integration test green; typecheck/tests scoped to the
  tooling CLI package green; repo lint green.
- No `skills add` / `npx skills` invocation remains in the init path.

## Commit / push rules

`git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`,
small commits, no push/PR — orchestrator opens the PR.
