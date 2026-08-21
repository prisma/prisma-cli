# Design notes — agent-skills-npm-packages

Authoritative design: operator brief v2 below ("agreed design, ready to
implement"), delivered 2026-08-21. It supersedes brief v1 ("draft for
review"), which differed in three ways v2 explicitly resolves: v1's
AGENTS.md self-heal line (rejected by the team → postinstall + CLI
check), v1's @prisma/orm-toolchain anchor (→ the direct-dependency
target packages), and v1's per-product sync commands (→ one
product-agnostic command in prisma-cli).

---

# Design: deliver agent skills inside our npm packages

Status: agreed design, ready to implement. No code changes yet. This document is written to be handed to an agent in a fresh session; it assumes no prior context.

## Summary

We ship our agent skills inside the npm packages they describe, and we replace the current GitHub-fetching install with:

1. `prisma skills sync` — a CLI subcommand that copies the skills from the installed packages into the agent harnesses' skill directories at the project root.
2. A `postinstall` script in the user's root `package.json` (`prisma skills sync || exit 0`), written by `prisma orm init`, so sync runs on every install and upgrade.
3. A cheap check on every `prisma` CLI command that prints one line to stderr when the synced skills don't match the installed packages, telling the reader (usually an agent) to run `prisma skills sync`.

Skill content keeps living in prisma/prisma and prisma/composer, shipped inside their tarballs. The sync command and the check live once, in the unified CLI in prisma/prisma-cli.

## Background: what agent skills are and how agents find them

An agent skill is a directory containing a `SKILL.md` file — instructions that teach an AI coding agent how to use a tool — optionally with `references/*.md` files beside it. The format is the open [Agent Skills spec](https://agentskills.io). The `SKILL.md` starts with YAML frontmatter carrying a `name` and a `description`. The description is what makes a skill work: agent harnesses (Claude Code, Cursor, Codex, Windsurf) each scan a known project directory — `.claude/skills/`, `.cursor/skills/`, `.agents/skills/`, `.windsurf/skills/` — index every skill's description into the model's context, and the model loads a skill's full content on its own when a task matches. A skill in those directories triggers automatically. A skill anywhere else is invisible to the harness; the harness never indexes `references/*.md` either — the agent reads those because the `SKILL.md` points at them.

We ship skills for two product lines in scope here: Prisma 8 (the ORM, repo prisma/prisma) and Composer (repo prisma/composer). A larger set of skills for the v6/v7 ORM line lives in other repos and is out of scope (inventory below).

## The problem with today's delivery

Today `prisma orm init` shells out to Vercel's `skills` CLI: `npx skills add prisma/prisma/skills#v<cliVersion> …`, which clones that git ref and copies the skills into the agent directories. Four weaknesses:

1. The skill version is matched to the package version by a string convention (the `#v<cliVersion>` ref), not by construction. Only the `prisma-8` skill is pinned; the two upgrade skills track `main`. Composer's README asks users to pick the matching ref by hand.
2. The installed copies are unmanaged: nothing detects that they're stale and nothing re-runs. `pnpm up` updates the code but not the skills.
3. Init needs network access to GitHub, separate from the npm install that already happened.
4. An unpinned third-party CLI (`npx skills@latest`) runs in our init path to install our own content.

## Requirements

1. The skill a user has must always describe the package version they actually installed. Shipping the skill inside that package makes this automatic.
2. Skills arrive and update the same way our tools do: through the user's package manager. No second distribution channel.
3. Skills must end up in the directories agent harnesses already read, so the agent finds and uses them on its own. This is the guiding principle: work with the harnesses, not around them.
4. Must work under npm, pnpm, Yarn PnP (no `node_modules` — packages stay inside zip archives), bun, and Deno's npm interop.
5. We deliver our own small, fixed list of skills from our own packages. We never search `node_modules` to discover skills.
6. Nothing we build may cause an agent to load instructions from a package we don't control.
7. Agents must not be asked to run a maintenance command at the start of every session. (An earlier draft used a line in `AGENTS.md` for this; the team rejected it.)

## Where we host skills today

Ten locations across eight repos — none of them npm. skills.sh/prisma indexes the user-facing ones:

| Repo | Path | Skills | Product line | skills.sh installs |
| --- | --- | --- | --- | --- |
| prisma/skills | repo root | 9 (`prisma-client-api`, `prisma-database-setup`, `prisma-cli`, …) | v6/v7 ORM | ~1.8M |
| prisma/prisma-next | historical `skills/` | legacy Prisma Next usage skills | superseded by prisma/prisma | ~14.5K |
| prisma/prisma | `skills/` | 3 (`prisma-8`, `prisma-next-upgrade`, `prisma-8-extension-upgrade`) | Prisma 8 | ~1.7K |
| prisma/cursor-plugin | `skills/` | 40 per-command skills | v6/v7 ORM (Cursor plugin) | ~700 |
| prisma/prisma-plugin | `skills/` | 8 | v6/v7 ORM (plugin form) | ~60 |
| prisma/composer | `skills/prisma-composer/` | 1 | Composer | ~60 |
| prisma/prisma-cli | — (skills.sh entry is stale; HEAD has no user-facing skills) | — | — | ~30 |

Contributor-facing trees also exist (`skills-contrib/` in prisma/prisma, prisma/composer, prisma/prisma-cli; `skills/.pilot/` in prisma/ignite). They never ship to users and are out of scope.

Two things this table shows that the design does not solve: the v6/v7-line skills are a separate, currently-GA product line (not stale); and the legacy prisma/prisma-next source still gets roughly 8× the installs of the current prisma/prisma source. Retiring or redirecting the legacy sources is a separate follow-up.

## What the industry does

We take the packaging that TanStack and Mastra both arrived at independently — a version-stamped router skill plus references inside the tarball — and reject every consumption model we found, because each one fails a requirement. Verified against the shipped packages, not announcements:

- **TanStack** (`@tanstack/db@0.8.0`, `@tanstack/intent@0.3.6`) ships `skills/<name>/SKILL.md` trees in each tarball. Consumers never copy them; a CLI (`intent list` / `intent load`) reads them from `node_modules` at task time, prompted by a block in `AGENTS.md`. The skills never enter the harness directories, so nothing triggers automatically (fails requirement 3).
- **Mastra** (`@mastra/core@1.60.0`) ships `dist/docs/SKILL.md` — frontmatter with a trigger description and `metadata.version: "1.60.0"` — routing to 433 generated reference files in the tarball. What `mastra init` installs into the harness directory, via `npx skills add mastra-ai/skills`, is a small version-independent pointer skill that tells the agent to read the embedded docs from `node_modules` first. The harness only ever indexes the pointer, so trigger phrases can't ship with new package versions, and Yarn PnP has nothing to point into (fails 4; weak on 3).
- **Next.js** (`next@16.3`) ships version-matched docs in the package and has `next dev` write a managed block into `AGENTS.md` pointing at them. Docs have no trigger description, so the agent must be told to read them every time (fails 3 and 7). We borrow their idea that a command the user already runs should keep the agent wiring healthy — that became the CLI check.
- **Vercel's `skills` CLI** has an experimental `node_modules` scanner (`skills experimental_sync`) that symlinks any `skills/*/SKILL.md` from any package into the harness directories. A scanner surfaces instructions from any transitive dependency (fails 5 and 6).

### Why we don't follow Next.js and ship docs instead

Next.js ships its documentation rather than skills and argues that's better for framework knowledge. We have a large docs corpus too (prisma/web's docs app, ~674 MDX pages including 61 under `orm/v8/`, already emitting `llms.txt`), so we had to decide whether to copy them. We don't: a docs directory has no trigger, so the agent must be told to read it every time, while a skill's description is indexed and acted on by the harness by itself. And two of our three skills are workflows (perform this upgrade), not reference. Skills stay thin and link into the docs site for depth.

## Design

### Where the pieces live

Three repos are involved. An implementer must understand this before starting.

- **prisma/prisma** owns the Prisma 8 skill content (`skills/`) and the public ORM packages (`packages/9-public/*`). It also owns the `prisma orm` command family, implemented in `packages/1-framework/3-tooling/cli/` and published as the `./cli` export of `@prisma/orm-toolchain`.
- **prisma/prisma-cli** owns the `prisma` binary (`packages/prisma`, bin `prisma`; `packages/cli`, bin `prisma-cli`) and the command engine (`packages/cli-engine`, published as `@prisma/cli-engine`). `packages/cli/src/cli.ts` mounts the ORM family from `@prisma/orm-toolchain/cli` and the Composer family from `@prisma/composer-cli/family`. `packages/cli/src/main.ts` runs a cached update check before dispatching every command — the precedent for the skills check. The engine's shared flags include `--json`, `--quiet` (shorthand for `--log-level error`), and `--format`.
- **prisma/composer** owns the Composer skill content (`skills/prisma-composer/`) and `@prisma/composer` / `@prisma/composer-cli` under `packages/9-public/`.

A user project created by `prisma orm init` directly depends on `@prisma/orm-<target>` (for example `@prisma/orm-postgres`) as a runtime dependency and `@prisma/cli@next` as a dev dependency. It does **not** directly depend on `@prisma/orm-toolchain` or `@prisma/orm-framework`; those are dependencies of the CLI and the target package. This matters because under pnpm only direct dependencies are resolvable from the project root.

### 1. Packaging: skills travel in the tarball

- **Anchor packages.** The Prisma 8 skill ships in each target package users depend on directly: `@prisma/orm-postgres`, `@prisma/orm-sqlite`, `@prisma/orm-mongo` (duplicated into each at pack time from the repo's `skills/` tree). All public packages version in lockstep, so the stamp is the same wherever it's read from. The Composer skill ships in `@prisma/composer`. Each gets `"skills"` added to its `files` array, with the tree at `<package>/skills/<skill-name>/SKILL.md`.
- **One harness-registered skill per product.** The harness indexes one entry per product: the `prisma-8` router (its `SKILL.md` is a table of contents into `references/*.md`) and `prisma-composer`. Sync copies the whole tree; only the router's description occupies the harness index.
- **The upgrade skills fold into the router.** `prisma-next-upgrade` and `prisma-8-extension-upgrade` become an "upgrading" branch of `prisma-8` with their per-transition instructions as references, and the router's `description` absorbs their trigger phrases. Three registered skills become one. The version you upgrade *to* carries the instructions for the transitions leading to it.
- **Version stamp.** Frontmatter gains `library` (the npm package name) and `library_version`. The publish pipeline stamps `library_version` (the version-setting scripts already rewrite every package version; see `scripts/set-version.ts`). Sync reads this stamp from the copied `SKILL.md` to decide whether a copy is current.
- **Preamble.** Borrowed from Mastra: the router opens by telling the agent its training data about Prisma is likely outdated and the installed version's skill is the source of truth.
- Extension guidance lives as references under the router, not as per-extension registered skills. Per-extension skills can come later; any such package is added to the allowlist deliberately.
- `skills-contrib/` is untouched and never ships.

### 2. `prisma skills sync`

Lives in prisma/prisma-cli (`packages/cli/src/commands/skills/`), once, product-agnostic. Behavior:

1. **Find the project root.** Walk up from cwd to the workspace root (`pnpm-workspace.yaml`, a `package.json` with `workspaces`, or the git root). Harness directories live there.
2. **Resolve, never scan.** For each package on a hardcoded allowlist — `@prisma/orm-postgres`, `@prisma/orm-sqlite`, `@prisma/orm-mongo`, `@prisma/composer` — run standard module resolution of `<package>/package.json` from the project root, and in a monorepo also from each workspace member directory (enumerated from the workspace config, which is not a `node_modules` scan). Not installed → skip. Under Yarn PnP, resolution goes through the PnP API and the package path is inside a zip; copying still works because the read goes through the PnP filesystem layer.
3. **Compare.** Read the installed package's version and the `library_version` stamp from any existing copy in each harness directory.
4. **Copy on mismatch.** Copy the skill tree into each harness directory present at the root — `.claude/skills/`, `.cursor/skills/`, `.agents/skills/`, `.windsurf/skills/` — and into the ones init targets even if absent. Copies, not symlinks (see "Why copies").
5. **Prune.** Remove copies sync created whose source package is no longer installed. Sync manages only the known skill names and touches nothing else.
6. **Exit 0 whenever there's nothing to do**, including when no allowlisted package is installed. The user's `postinstall` uses `|| exit 0` on top, to cover environments where the `prisma` binary itself is absent (production installs without dev dependencies).

If two workspace members pin different versions of an allowlisted package, sync installs the highest and prints a warning.

`prisma skills list` is the read-only companion: which allowlisted packages are installed, which skills are synced, which are stale, whether the check is disabled. Supports `--json`.

### 3. Trigger: the user's `postinstall`

`prisma orm init` adds `"postinstall": "prisma skills sync || exit 0"` to the user's root `package.json`, using the existing idempotent script merge in `packages/1-framework/3-tooling/cli/src/commands/init/hygiene-package-scripts.ts` (currently used for `contract:emit`). It also runs sync once directly. Root-project scripts run by default under npm, pnpm (including 10+), yarn, and bun, so this fires on every install and upgrade.

Why the user's `postinstall` and not one inside our package: dependency lifecycle scripts are blocked by default in pnpm 10+ (needs `pnpm.onlyBuiltDependencies`), bun (needs `trustedDependencies`), and Deno (needs `--allow-scripts`), and are commonly disabled by `ignore-scripts` policies. Prisma ORM's own `@prisma/client` postinstall was a long-running source of breakage for these reasons and was removed in Prisma 7. A dependency's postinstall writing into the user's project is also exactly what those policies exist to stop.

`--skip-skills` on init keeps its meaning: don't run sync, don't add the script. Removing the script from `package.json` is the user's opt-out from automatic syncing. Init also keeps its existing cleanup of retired skill directories (`RETIRED_SKILL_NAMES` in `skill-sources.ts`).

### 4. Guardrail: the CLI check

Every `prisma` command runs a check before or after dispatch (placed next to the update check in `packages/cli/src/main.ts`, or as an engine hook in `@prisma/cli-engine` so it covers all mounted families):

- **Cost:** resolve the allowlisted packages from the project root, read their versions, read the stamp from the copied `SKILL.md` in each harness directory. A few stat calls and small file reads; milliseconds.
- **States:** in sync → silent. Stale or never synced → one line on stderr: `Prisma agent skills are out of date (installed @prisma/orm-postgres 8.1.0, synced 8.0.0). Run: prisma skills sync`. Never-synced is treated the same as stale — no harness detection, no agent-environment heuristics. Opted out → silent.
- **Output rules:** stderr only, after the command's own output, never changes the exit code, not gated on TTY (agents run non-TTY and are the audience).
- **Off switches:** `--quiet`, `--json` / `--format json`; environment variable `PRISMA_SKILLS_CHECK=0`; a setting in `prisma.config.ts`; `CI` / `GITHUB_ACTIONS` set (the update check already suppresses on these); and a persistent opt-out written by `prisma skills sync --disable`, recorded in the project's local state so the check stays quiet without an env var on every machine. The `skills` commands themselves never run the check.

Together the postinstall and the check make the system eventually consistent: the postinstall handles the common path, and the check catches every way it can be bypassed (`ignore-scripts`, hand-edited skill directories, a harness adopted after init, monorepo oddities).

### 5. Why copies, not symlinks

Sync copies files; it does not symlink into `node_modules`, even though symlinks would track upgrades with zero re-runs. Rejected because:

- Yarn PnP has no `node_modules` — packages live inside zip archives you cannot symlink into — so a copy path must exist anyway. Symlinks would be a second code path, not a substitute.
- Windows symlink creation needs Developer Mode or elevation; copies never fail.
- Only Claude Code documents following symlinked skills; Cursor, Codex, and Windsurf don't. Copies work by construction everywhere.
- With sync on every install plus the CLI check, the window in which a copy is stale is small, and an agent that already loaded a skill mid-session has the old content in context regardless of what's on disk.

The objection to today's copies was never copies per se — it was unmanaged copies. Version-stamped, checked, automatically re-synced copies are a managed cache.

### 6. Security invariant

**Sync only ever installs skill content from packages on its hardcoded allowlist, and never scans `node_modules` for skills. This is permanent; a "discover skills from other packages" mode must never be added.**

Skills are instructions an agent will follow, so installing one grants influence over the agent. The generic scanners surface `SKILL.md` from any transitive dependency — a prompt-injection vector by construction. Under this design the only skills installed are ours, from packages the user deliberately installed from the registry, resolved by name. The trust boundary is identical to the code's: if you run `@prisma/orm-postgres`, you already trust its author. The design also removes the execution of an unpinned third-party CLI from init.

### 7. Compatibility and fallbacks

- The tarball layout (`skills/*/SKILL.md`) is what third-party scanners look for, so users who choose to run them will find our skills. Interoperability, not a dependency, not our recommended path.
- The GitHub source (`npx skills add prisma/prisma/skills#v<version>`) stays documented in `skills/README.md` as a manual fallback for people who want skills without installing the packages.
- The publish-time upgrade-coverage check (`pnpm check:upgrade-coverage`, `scripts/check-upgrade-coverage.mjs`) asserts that per-transition upgrade instructions exist; it keys on the paths `skills/prisma-next-upgrade` and `skills/prisma-8-extension-upgrade` (constants `USER_SKILL_PKG`, `EXT_SKILL_PKG`) and must be repointed at the folded location under the router.
- Synced copies are gitignored (init adds the entries via `hygiene-gitignore.ts`). They are derived from the lockfile, like `node_modules`; a teammate's first install recreates them, and committing them would invite drift-by-merge.

## What this strengthens

The versioning policy (`docs/oss/versioning.md`) already states that skills version in lockstep with the framework and "there is no separate skill-version axis to track." Today that is enforced by the `#v` ref convention; under this design it becomes a physical property of the tarball.

## Trade-offs accepted

- **No post-release skill fixes without a release.** Today the upgrade skills track `main`, so a bad instruction can be fixed and picked up immediately. In-package delivery means fixes ship in a patch release — the same trade every other file in the tarball makes. Mitigations: the upgrade-coverage check at publish, skill validation in CI.
- **Folding the upgrade skills loses their standalone trigger precision.** Their trigger phrases move into the router's description; if harness selection measurably suffers, splitting out a second registered skill (usage + upgrade) is cheap.
- **The check adds one stderr line to CLI output in stale projects.** Bounded by the off switches; silent when in sync.

## Rejected alternatives (so they aren't re-proposed)

- A line in `AGENTS.md` telling agents to run sync every session — rejected by the team; agents shouldn't carry maintenance duties (requirement 7).
- A `postinstall` in our own published package — blocked by default in pnpm 10+, bun, Deno, and by `ignore-scripts`; Prisma 7 removed exactly this pattern.
- A version-independent pointer skill (Mastra's model) — trigger metadata can't evolve with the package; nothing to point into under Yarn PnP.
- Symlinks into `node_modules` — see "Why copies".
- A `prisma skills load` command the agent calls instead of native skills (TanStack's model) — harness-invisible.
- Any `node_modules` scanning — security invariant.
- A second verb (`prisma skills fix`) — sync is idempotent and is the fix; one command to learn.

## Implementation plan

Sequence matters because the CLI repo pins `@prisma/orm-toolchain` to an exact version, and its sync command needs published packages that contain skills to test against.

**Phase 1 — prisma/prisma (content and packaging)**

1. Fold `skills/prisma-next-upgrade/` and `skills/prisma-8-extension-upgrade/` into `skills/prisma-8/` as an upgrading branch; move their trigger phrases into the router's `description`; add the "installed version is the source of truth" preamble. Keep the per-transition `upgrades/<from>-to-<to>/` layout so the coverage check's logic survives; update `USER_SKILL_PKG` / `EXT_SKILL_PKG` in `scripts/check-upgrade-coverage.mjs`.
2. Add `library` / `library_version` frontmatter; make `scripts/set-version.ts` (and `set-version-utils.ts`) stamp `library_version`. Add a test that the stamp matches the root version after a bump.
3. Copy `skills/prisma-8/` into `packages/9-public/orm-postgres`, `orm-sqlite`, `orm-mongo` at build or pack time; add `"skills"` to each `files`. Add a tarball-content test (the publish-surface checks in `@internal/publish-surface` are the place) asserting `skills/prisma-8/SKILL.md` is in each tarball with the right stamp.
4. Update `skills/README.md`, `docs/oss/versioning.md`, and `docs/reference/error-reference.md` (the `skillInstall` entry at line ~146 describes the old flow).

**Phase 2 — prisma/prisma-cli (sync, list, check)**

5. Add `packages/cli/src/commands/skills/sync.ts` and `list.ts`; mount under `skills` in `packages/cli/src/cli.ts`. Allowlist as a constant. Module resolution via `createRequire` / `import.meta.resolve` from the project root and workspace member dirs; PnP-aware reads.
6. Add the check next to `maybeWriteCachedUpdateNotification` in `packages/cli/src/main.ts` (or as an engine hook if the ORM/Composer families need it uniformly), with the off switches listed in §4 and the same `CI` suppression the update check uses.
7. Tests (the repo uses in-process CLI tests under `packages/cli/tests`): fixture projects for npm and pnpm layouts and a Yarn PnP fixture; stale / never-synced / in-sync / opted-out states; prune on package removal; monorepo with two members; every off switch; exit code always 0 for the check.

**Phase 3 — prisma/prisma (init wiring)**

8. In `packages/1-framework/3-tooling/cli/src/orm/init.ts` and `init-scaffold.ts`: replace the `skills add` invocations (defined in `commands/init/skill-sources.ts`, `DEFAULT_SKILL_SOURCES`) with running `prisma skills sync` and adding the `postinstall` script via `hygiene-package-scripts.ts`; add the gitignore entries via `hygiene-gitignore.ts`; keep `RETIRED_SKILL_NAMES` cleanup; retire the `skillInstall` failure path. Update `test/integration/test/cli.init-skill-distribution.integration.test.ts` (it currently sparse-clones the GitHub skills source to assert what a consumer sees).

**Phase 4 — prisma/composer**

9. Move `skills/prisma-composer/` into the `@prisma/composer` tarball (`files` + stamp), mirroring Phase 1. Its README and `docs/guides/getting-started.md` currently tell users to run `npx skills add prisma/composer`; repoint to `prisma skills sync`.

**Follow-ups, out of scope here**

- Retire or redirect the legacy skills.sh sources (prisma/prisma-next, the stale prisma-cli entry).
- Per-extension skills in `@prisma/orm-extension-*` packages, added to the allowlist deliberately.
- Have long-running commands (`prisma dev`) re-run sync rather than just check.

## Decisions already made (don't reopen)

- Copies, not symlinks.
- User's root `postinstall`, with `|| exit 0`; never a postinstall in our packages.
- Skills land in the harness directories at the workspace root, in monorepos too.
- Never-synced behaves like stale: print the line unless opted out. No harness or agent detection.
- One verb: `sync`. No `fix`.
- One registered skill per product; upgrade skills fold into the router.
- No `AGENTS.md` line.
- Hardcoded allowlist; no scanning, ever.

## Open details for the implementer

- Exact `prisma.config.ts` key for disabling the check, and where the `--disable` state is persisted (the CLI keeps local state in `.prisma/local.json`; a sibling `.prisma/skills.json` is the obvious home).
- Whether the check lives in `main.ts` or the engine. Prefer the engine if the ORM and Composer families would otherwise need their own copies.
- Build-time vs pack-time copying of `skills/` into the three target packages (`tsdown` build step vs a `prepack` script). Either is fine; pick whichever the publish-surface tests can verify.
- Command name: `prisma skills` (top-level, recommended — skills span products) vs `prisma orm skills`.
