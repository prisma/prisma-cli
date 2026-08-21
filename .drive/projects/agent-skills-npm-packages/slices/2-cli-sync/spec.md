# Slice 2 — prisma-cli: `prisma skills sync` / `list` + staleness check

Repo: this worktree
(`/Users/will/Projects/prisma/prisma-cli/.claude/worktrees/agent-skills-npm-packages-770857`),
branch `claude/agent-skills-npm-packages-770857`, PR against `main`.

Authoritative design: `.drive/projects/agent-skills-npm-packages/design-notes.md`
(brief v2) — this slice implements Phase 2 (items 5–7, and design §2, §4).
Cross-slice contract in `../../plan.md`.

## Outcome

The unified CLI owns skill delivery: `prisma skills sync` copies stamped
skill trees from installed allowlisted packages into the harness skill
directories; `prisma skills list` reports status; every other `prisma`
command prints one stderr line when skills are stale.

## Tasks

1. **Commands.** `packages/cli/src/commands/skills/sync.ts` + `list.ts`,
   mounted top-level as `skills` in `packages/cli/src/cli.ts` (verify
   the grammar/style fit against docs/product/command-principles.md and
   cli-style-guide.md; if top-level `skills` genuinely conflicts, stop
   and surface rather than silently choosing `orm skills`).
   Allowlist constant `["@prisma/orm-postgres", "@prisma/orm-sqlite",
   "@prisma/orm-mongo", "@prisma/composer"]` with the security invariant
   stated at the declaration: content only ever comes from this list;
   never scan node_modules; no discovery mode, permanent.
2. **Sync semantics** (design §2): project root = walk up from cwd to
   `pnpm-workspace.yaml` / `package.json` with `workspaces` / git root.
   Resolve `<pkg>/package.json` from the root and from each workspace
   member dir (enumerated from workspace config — never a node_modules
   walk); Yarn PnP works via normal resolution + PnP fs layer. Compare
   installed version to the `library_version` frontmatter stamp of
   existing copies. On mismatch copy the whole `skills/<name>/` tree
   into `.claude/skills/`, `.cursor/skills/`, `.agents/skills/`,
   `.windsurf/skills/` at the root (all four, present or not). Prune
   managed skill names whose source package is gone; touch nothing
   else. Members pinning different versions → highest wins + warning.
   Exit 0 whenever there is nothing to do, including no allowlisted
   package installed. `sync --disable` / `--enable` persists an opt-out
   in project local state (`.prisma/skills.json` suggested; align with
   how `.prisma/local.json` is handled).
3. **List.** Read-only: per allowlisted package — installed version,
   synced version per harness dir, stale/absent; whether the check is
   disabled. Honors the engine's structured output (`--json`).
4. **Check** (design §4): beside `maybeWriteCachedUpdateNotification` in
   `packages/cli/src/main.ts`, or as a `@prisma/cli-engine` hook if the
   mounted families would otherwise need copies — decide from the code
   and record the choice. Silent when in sync or opted out; one stderr
   line when stale or never-synced (same treatment):
   `Prisma agent skills are out of date (installed @prisma/orm-postgres 8.1.0, synced 8.0.0). Run: prisma skills sync`.
   Stderr only, after command output, never changes exit code, not
   TTY-gated. Off switches: `--quiet`, `--json`/`--format json`,
   `PRISMA_SKILLS_CHECK=0`, a `prisma.config.ts` setting (pick the key,
   record it), `CI`/`GITHUB_ACTIONS` (mirror the update check), the
   persisted `--disable` state. `skills` commands never run the check.
5. **Tests** (in-process CLI tests under `packages/cli/tests`): fixture
   projects for npm and pnpm layouts and a Yarn PnP fixture (fixture
   packages that mimic the contract: stamped `skills/prisma-8/` trees);
   stale / never-synced / in-sync / opted-out; prune on removal;
   monorepo with two members (incl. version-conflict warning); every
   off switch; check exit code unchanged; sync exit 0 paths.

## Out of scope

Skill content (slice 1), init wiring (slice 3), composer packaging
(slice 4). No AGENTS.md writes, no postinstall writes (init owns that),
no node_modules scanning, no symlinks.

## Completed when (validation gate)

- `pnpm build`, `pnpm typecheck` (or repo equivalent), full
  `packages/cli` test suite green, plus repo lint.
- New tests cover the matrix in task 5.
- Command help/output follows docs/product conventions.

## Commit / push rules

Commit as you go with
`git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`.
Do not push or open a PR — the orchestrator does that at slice DoD.
