# Slice 4 — prisma/composer: skill in the tarball

Repo: `.refs/composer` (clone of prisma/composer; origin uses the
`github-wmadden-electric` host alias). Branch off `main`:
`skill-in-tarball`. One PR against prisma/composer `main`.

Authoritative design: `.drive/projects/agent-skills-npm-packages/design-notes.md`
(brief v2) — this slice implements Phase 4 (item 9), mirroring Phase 1.
Cross-slice contract in `../../plan.md`.

## Outcome

The `prisma-composer` skill ships inside the `@prisma/composer` tarball,
version-stamped, and composer's docs point users at `prisma skills sync`
instead of `npx skills add`.

## Tasks

1. **Package.** Ship `skills/prisma-composer/` in the `@prisma/composer`
   tarball at `skills/prisma-composer/SKILL.md` (copy at build or pack
   time from the repo's `skills/` tree, or move the source — follow the
   repo's packaging conventions in `packages/9-public/composer`; add
   `"skills"` to `files`). Add a tarball-content test if the repo has a
   publish-surface check pattern; otherwise a test that the packed
   tarball contains the stamped SKILL.md.
2. **Stamp.** (Amended: keys live under the spec's `metadata` map, string values.) Frontmatter `library: "@prisma/composer"` and
   `library_version`, stamped by composer's version pipeline (find its
   equivalent of set-version; wire the stamp there, with a test).
3. **Docs.** Repoint `skills/README.md`, the repo README, and
   `docs/guides/getting-started.md` from `npx skills add prisma/composer`
   to `prisma skills sync` (keep the GitHub route documented as manual
   fallback, mirroring prisma/prisma's README stance).

## Out of scope

Composer CLI changes (sync lives in prisma-cli, slice 2 — composer does
NOT get its own `skills` command under brief v2), skill content rewrites,
skills-contrib.

## Completed when (validation gate)

- Tarball/stamp tests pass; typecheck/tests scoped to touched packages
  pass; repo lint green.
- Docs updated per task 3.

## Commit / push rules

Commit as you go with
`git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`.
Do not push or open a PR — the orchestrator does that at slice DoD.
