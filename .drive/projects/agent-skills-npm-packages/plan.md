# Project Plan — agent-skills-npm-packages

## Summary

Four slices, one per brief phase, across three repos. Slices 1, 2, and 4
are parallel; slice 3 stacks on slice 1 (same repo, consumes the folded
skill layout) and on slice 2's settled command surface (textual
dependency only — init writes the string `prisma skills sync`).

**Spec:** `.drive/projects/agent-skills-npm-packages/spec.md`
**Design:** `design-notes.md` (brief v2, authoritative)
**Tracker:** none — this repo's drive convention runs without Linear.

## Cross-slice contract (fixed now so slices can parallelize)

- Skill tree ships at `<package>/skills/<skill-name>/` with `SKILL.md` +
  `references/`; skill names: `prisma-8`, `prisma-composer`.
- Frontmatter stamp lives under the spec's `metadata` map (amended
  2026-08-21 after checking the Agent Skills spec: custom top-level keys
  are not defined by the spec; extensions belong under `metadata`, a
  string→string map validated by `skills-ref`):
  `metadata.library` (npm package name), `metadata.library_version`
  (stamped to the lockstep version by each repo's version pipeline).
- Anchor packages / allowlist: `@prisma/orm-postgres`,
  `@prisma/orm-sqlite`, `@prisma/orm-mongo`, `@prisma/composer`.
- Command surface: top-level `prisma skills sync` / `prisma skills list`
  (brief recommendation adopted; slice 2 verifies grammar fit and flags
  a deviation before slice 3 consumes the string).
- Harness dirs: `.claude/skills/`, `.cursor/skills/`, `.agents/skills/`,
  `.windsurf/skills/`.

## Slices

### Slice 1 — prisma/prisma: skill fold, stamp, packaging (phase 1)

Repo: prisma/prisma (clone `.refs/prisma`). Brief items 1–4.
Fold the two upgrade skills into the `prisma-8` router (upgrading branch,
`upgrades/<from>-to-<to>/` layout kept; trigger phrases into the router
description; Mastra-style preamble); add `library`/`library_version`
frontmatter stamped by `scripts/set-version.ts` (+ utils) with a
stamp-matches-root-version test; copy `skills/prisma-8/` into
orm-postgres/orm-sqlite/orm-mongo at build or pack time with `"skills"`
in `files` and a publish-surface tarball test; repoint
`USER_SKILL_PKG`/`EXT_SKILL_PKG` in `check-upgrade-coverage.mjs`; update
`skills/README.md`, `docs/oss/versioning.md`,
`docs/reference/error-reference.md`.

- **Builds on:** nothing.
- **Hands to:** slices 2–3 — tarballs whose `skills/prisma-8/SKILL.md`
  carries the stamp; the folded on-disk layout init syncs.

### Slice 2 — prisma-cli: `skills sync`/`list` + staleness check (phase 2)

Repo: prisma/prisma-cli (this worktree). Brief items 5–7.
`packages/cli/src/commands/skills/{sync,list}.ts` mounted in `cli.ts`;
allowlist constant with the security invariant stated at the
declaration; project-root walk; resolution from root + workspace member
dirs (PnP-aware); compare/copy/prune semantics per brief §2; exit 0 when
nothing to do; highest-version + warning on member conflicts; `list`
with `--json`. The check beside `maybeWriteCachedUpdateNotification` in
`main.ts` (or an engine hook — implementer decides per the brief's open
detail) with all off switches incl. `prisma skills sync --disable`
persisted in local state. Tests per brief item 7 (npm/pnpm/PnP fixtures,
all states, prune, monorepo, off switches, exit code).
Until slice 1 publishes, tests run against local fixture packages that
mimic the contract (stamped `skills/prisma-8/` trees).

- **Builds on:** cross-slice contract only.
- **Hands to:** slice 3 — the settled command name and flag surface.

### Slice 3 — prisma/prisma: init wiring (phase 3)

Repo: prisma/prisma. Brief item 8.
Replace `DEFAULT_SKILL_SOURCES` `skills add` invocations with one direct
sync run + `"postinstall": "prisma skills sync || exit 0"` via
`hygiene-package-scripts.ts`; gitignore entries via
`hygiene-gitignore.ts`; keep `RETIRED_SKILL_NAMES` cleanup; retire the
`skillInstall` failure path (exit-6 finding); `--skip-skills` = no sync,
no script. Update
`test/integration/test/cli.init-skill-distribution.integration.test.ts`.

- **Builds on:** slice 1 (same repo, folded layout, error-reference
  state), slice 2 (command surface, textual).
- **Hands to:** close-out.

### Slice 4 — prisma/composer: mirror packaging (phase 4)

Repo: prisma/composer (clone `.refs/composer`). Brief item 9.
`skills/prisma-composer/` into the `@prisma/composer` tarball (`files` +
`library`/`library_version` stamp via composer's version pipeline);
repoint README and `docs/guides/getting-started.md` from
`npx skills add prisma/composer` to `prisma skills sync`.

- **Builds on:** cross-slice contract only.
- **Hands to:** close-out.

## Sequencing

- **Parallel group A:** slice 1, slice 2, slice 4.
- **Stack:** slice 3 after slice 1 merges (and slice 2's command surface
  is settled — PR open is sufficient; merge not required).

Release-order note (from the brief): the published sequence matters —
prisma-cli pins `@prisma/orm-toolchain` exactly and its sync command
needs published skill-bearing packages for end-to-end verification. PR
order need not wait on publishes; local fixtures cover slice 2 testing.

## Close-out (required)

- [ ] Verify all acceptance criteria in `spec.md`.
- [ ] Migrate long-lived docs into each repo's `docs/` (done in-slice:
      versioning.md, error-reference.md, skills/README.md, composer
      guides).
- [ ] Strip repo-wide references to `.drive/projects/agent-skills-npm-packages/**`.
- [ ] Delete `.drive/projects/agent-skills-npm-packages/`.
