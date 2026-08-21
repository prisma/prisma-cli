# Summary

Ship Prisma's agent skills inside the npm packages they describe and
replace the GitHub-fetching install with: (1) `prisma skills sync` in the
unified CLI (this repo, prisma-cli) that copies skills from installed
packages into the agent harness skill directories at the project root;
(2) a `postinstall` script (`prisma skills sync || exit 0`) written into
the user's root `package.json` by `prisma orm init`; (3) a cheap
staleness check on every `prisma` command printing one stderr line when
synced skills don't match installed packages. Skill content lives in
prisma/prisma and prisma/composer, shipped inside their tarballs.

Source design: operator brief v2 ("agreed design, ready to implement"),
transcribed in `design-notes.md`. Brief v1 (AGENTS.md-line mechanism,
orm-toolchain anchor, per-product sync commands) is superseded.

# Description

Today `prisma orm init` shells out to Vercel's `skills` CLI
(`npx skills add prisma/prisma/skills#v<cliVersion>`), which clones a git
ref. Weaknesses: version lockstep by string convention (only `prisma-8`
pinned; upgrade skills track `main`; Composer picks refs by hand);
unmanaged copies with no staleness detection; GitHub network access in
init; an unpinned third-party CLI in the critical path.

Under this design skills travel in the tarballs of the packages users
directly depend on, and prisma-cli owns one product-agnostic sync command
plus a guardrail check. Eventual consistency: postinstall handles the
common path; the check catches every bypass (`ignore-scripts`,
hand-edits, harness adopted after init, monorepo oddities).

# Requirements

(Numbered per brief v2 §Requirements; the brief is authoritative.)

1. Installed skill always describes the installed package version —
   automatic because the skill ships inside that package.
2. Skills arrive/update through the package manager; no second channel.
3. Skills end up in the harness directories (`.claude/skills/`,
   `.cursor/skills/`, `.agents/skills/`, `.windsurf/skills/`) so agents
   find them natively.
4. Works under npm, pnpm, Yarn PnP, bun, Deno npm interop.
5. Fixed allowlist of our own packages; never search `node_modules`.
6. Nothing may cause an agent to load instructions from a package we
   don't control.
7. Agents are never asked to run a maintenance command each session (the
   AGENTS.md line is rejected).

## Functional requirements by phase

**Phase 1 — prisma/prisma (content + packaging):**
- Fold `skills/prisma-next-upgrade/` and `skills/prisma-8-extension-upgrade/`
  into `skills/prisma-8/` as an upgrading branch (per-transition
  `upgrades/<from>-to-<to>/` layout kept); trigger phrases merge into the
  router description; add the Mastra-style "installed version is the
  source of truth" preamble.
- Frontmatter gains `library` + `library_version`; `scripts/set-version.ts`
  (+ `set-version-utils.ts`) stamps `library_version`; test that the
  stamp matches root version after a bump.
- Copy `skills/prisma-8/` into `packages/9-public/orm-postgres`,
  `orm-sqlite`, `orm-mongo` at build or pack time; `"skills"` in each
  `files`; publish-surface/tarball test asserts presence + stamp.
- Update `skills/README.md` (GitHub fallback stays documented),
  `docs/oss/versioning.md`, `docs/reference/error-reference.md`
  (`skillInstall` entry); repoint `USER_SKILL_PKG`/`EXT_SKILL_PKG` in
  `scripts/check-upgrade-coverage.mjs`.

**Phase 2 — prisma/prisma-cli (sync, list, check):**
- `packages/cli/src/commands/skills/sync.ts` + `list.ts`, mounted under
  `skills` in `cli.ts`. Allowlist constant: `@prisma/orm-postgres`,
  `@prisma/orm-sqlite`, `@prisma/orm-mongo`, `@prisma/composer`.
- Sync: find project root (walk up to `pnpm-workspace.yaml`, `package.json`
  `workspaces`, or git root); resolve each allowlisted package's
  `package.json` from the root and each workspace member dir (workspace
  config enumeration, not a scan); PnP-aware reads; compare installed
  version vs `library_version` stamp in existing copies; copy on
  mismatch into harness dirs present at root plus the ones init targets
  even if absent; prune copies sync created whose source package is
  gone; exit 0 when nothing to do. Two members pinning different
  versions → install highest + warn.
- `list`: read-only status incl. whether the check is disabled; `--json`.
- Check on every `prisma` command (next to the update check in `main.ts`,
  or engine hook if that avoids per-family copies): milliseconds; silent
  in-sync; one stderr line when stale or never-synced (same treatment);
  stderr only, after command output, exit code unchanged, not TTY-gated.
  Off switches: `--quiet`, `--json`/`--format json`,
  `PRISMA_SKILLS_CHECK=0`, a `prisma.config.ts` setting, `CI`/
  `GITHUB_ACTIONS`, and persistent `prisma skills sync --disable`
  (project local state; `.prisma/skills.json` is the suggested home).
  The `skills` commands themselves never run the check.

**Phase 3 — prisma/prisma (init wiring):**
- In `packages/1-framework/3-tooling/cli/src/orm/init.ts` /
  `init-scaffold.ts`: replace the `skills add` invocations
  (`DEFAULT_SKILL_SOURCES` in `commands/init/skill-sources.ts`) with
  running `prisma skills sync` once and adding
  `"postinstall": "prisma skills sync || exit 0"` via
  `hygiene-package-scripts.ts`; gitignore entries via
  `hygiene-gitignore.ts`; keep `RETIRED_SKILL_NAMES` cleanup; retire the
  `skillInstall` failure path; `--skip-skills` = don't sync, don't add
  the script. Update
  `test/integration/test/cli.init-skill-distribution.integration.test.ts`.

**Phase 4 — prisma/composer:**
- `skills/prisma-composer/` into the `@prisma/composer` tarball
  (`files` + stamp), mirroring Phase 1; repoint README and
  `docs/guides/getting-started.md` from `npx skills add prisma/composer`
  to `prisma skills sync`.

## Non-Functional Requirements

- **Security invariant (permanent):** sync only installs skill content
  from the hardcoded allowlist; never scans `node_modules`; no discovery
  mode may ever be added.
- Copies, never symlinks. Check cost: a few stat calls + small reads.
- Tarball keeps `skills/*/SKILL.md` layout (third-party scanner interop).

## Non-goals

- v6/v7 skill line; retiring/redirecting legacy skills.sh sources.
- Contributor skill trees (`skills-contrib/`, `skills/.pilot/`).
- Per-extension registered skills; `prisma dev` re-running sync.
- Any postinstall in our own published packages; AGENTS.md lines;
  pointer skills; `skills load`/`fix` verbs; node_modules scanning.

## Decisions already made (don't reopen)

Copies not symlinks; user's root postinstall with `|| exit 0`; skills at
the workspace root (monorepos too); never-synced behaves like stale; one
verb `sync`; one registered skill per product; no AGENTS.md line;
hardcoded allowlist forever.

## Open details for the implementer

- Exact `prisma.config.ts` key for disabling the check; where `--disable`
  persists (`.prisma/skills.json` suggested).
- Check in `main.ts` vs engine hook (prefer engine if families would
  otherwise duplicate it).
- Build-time vs pack-time copying into the three target packages —
  whichever the publish-surface tests can verify.
- Command name: `prisma skills` (recommended) vs `prisma orm skills`.

# Acceptance Criteria

- [ ] Phase 1: prisma/prisma tarballs for orm-postgres/sqlite/mongo carry
      the folded, stamped `prisma-8` skill tree; coverage check
      repointed and green; docs updated.
- [ ] Phase 2: `prisma skills sync`/`list` + the check in prisma-cli,
      with tests covering npm/pnpm/Yarn-PnP fixtures, stale/never-synced/
      in-sync/opted-out, prune, monorepo two-member case, every off
      switch, check exit code always 0.
- [ ] Phase 3: init writes the postinstall + gitignore entries, runs sync
      once, no `npx skills` invocation remains; integration test updated
      and green; `--skip-skills` honored.
- [ ] Phase 4: composer tarball carries the stamped skill; docs
      repointed.
- [ ] Security invariant stated at the allowlist and in docs.

# References

- Brief v2 in `design-notes.md`. Clones: `.refs/prisma`, `.refs/composer`.
- prisma-cli: `packages/cli/src/cli.ts`, `main.ts`
  (`maybeWriteCachedUpdateNotification`), `packages/cli-engine`,
  `packages/cli/tests`.
- prisma/prisma: `skills/`, `packages/9-public/*`, `scripts/set-version.ts`,
  `scripts/check-upgrade-coverage.mjs`, init command tree.
- prisma/composer: `skills/prisma-composer/`, `packages/9-public/*`.

# Open Questions

None blocking; the four "open details" above are implementer-latitude
items to be settled during slice planning with codebase evidence.
