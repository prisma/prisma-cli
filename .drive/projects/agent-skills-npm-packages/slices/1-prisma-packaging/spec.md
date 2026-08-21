# Slice 1 — prisma/prisma: skill fold, stamp, packaging

Repo: `.refs/prisma` (clone of prisma/prisma; origin uses the
`github-wmadden-electric` host alias). Branch off `main`:
`skills-in-tarball-packaging`. One PR against prisma/prisma `main`.

Authoritative design: `.drive/projects/agent-skills-npm-packages/design-notes.md`
(brief v2) — this slice implements Phase 1 (items 1–4). Cross-slice
contract in `../../plan.md`.

## Outcome

The `prisma-8` skill is a single registered skill (upgrade skills folded
in), version-stamped, and ships inside the `@prisma/orm-postgres`,
`@prisma/orm-sqlite`, `@prisma/orm-mongo` tarballs.

## Tasks

1. **Fold.** Move `skills/prisma-next-upgrade/` and
   `skills/prisma-8-extension-upgrade/` content into `skills/prisma-8/`
   as an "upgrading" branch: their instructions become references under
   the router; keep the per-transition `upgrades/<from>-to-<to>/` layout
   so `scripts/check-upgrade-coverage.mjs` logic survives; update its
   `USER_SKILL_PKG` / `EXT_SKILL_PKG` constants to the new paths. Merge
   the upgrade skills' trigger phrases into the router `description`.
   Add the preamble: the agent's training data about Prisma is likely
   outdated; the installed version's skill is the source of truth.
   Delete the two standalone skill directories; router routing table
   gains the upgrading entries.
2. **Stamp.** Add `library` (anchor package name — use
   `@prisma/orm-postgres` as the canonical value in the source tree, or
   decide a better convention and note it) and `library_version`
   frontmatter to `skills/prisma-8/SKILL.md`. Make
   `scripts/set-version.ts` / `set-version-utils.ts` rewrite
   `library_version` in lockstep. Test: after a version set, the stamp
   equals the root version.
3. **Package.** Copy `skills/prisma-8/` into
   `packages/9-public/@prisma/orm-postgres`, `orm-sqlite`, `orm-mongo`
   at build or pack time (implementer picks build vs prepack — whichever
   the publish-surface tests in `@internal/publish-surface` can verify);
   add `"skills"` to each package's `files`. Tarball test: each tarball
   contains `skills/prisma-8/SKILL.md` with the right stamp.
4. **Docs.** Update `skills/README.md` (new delivery story; GitHub
   `npx skills add prisma/prisma/skills#v<version>` stays as manual
   fallback), `docs/oss/versioning.md` (tarball makes lockstep physical),
   `docs/reference/error-reference.md` `skillInstall` entry (~line 146):
   note the flow it describes is being replaced; final retirement
   happens in the init-wiring slice — keep the entry consistent with
   whatever this slice ships.

## Out of scope

Init wiring (slice 3), the CLI sync command (slice 2), composer
(slice 4), skills-contrib, v6/v7 skills, any AGENTS.md mechanism.

## Completed when (validation gate)

- `pnpm check:upgrade-coverage` passes (or its test suite if it has one).
- The new stamp test and tarball/publish-surface tests pass.
- Skill lint (`pnpm lint:skills` if present), typecheck/tests scoped to
  touched packages and scripts pass.
- Repo conventions honored (CLAUDE.md: tests-first, no bare casts,
  arktype, no comments where code can speak).

## Commit / push rules

Commit as you go with
`git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`.
Do not push or open a PR — the orchestrator does that at slice DoD.
