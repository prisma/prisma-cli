# Handoff brief — agent skills delivery + the new `prisma init` (2026-08-21, v2)

You are picking up a drive-process project plus one new command brief, both in flight across three repos. Operator: Will Madden. This document is self-contained; read it fully before acting. Supporting drive artifacts live beside this file (`design-notes.md` with its **Operator amendments** section, `plan.md`, `reviews/code-review.md`, `deferred.md`, `learnings.md`, `slices/*/spec.md`).

## Conventions (non-negotiable)

- Commits: small, intent-driven, plain-English subjects, always `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` (bot author identity comes from the shell env; `gh` acts as the `wmadden-electric` bot).
- Push every slice branch to origin after every commit; never leave work only in a local clone.
- NEVER use the words "load-bearing", "smoking gun", "belt and suspenders", "gate" (say "check"/"requirement"), or "repin" in any prose, commit, or PR body. Never hard-wrap markdown prose: one paragraph = one line, one list item = one line.
- Drive process: delegate implementation to subagents (Fable for implementers, Opus-4.8-mid for reviewers — fall back to Opus if unavailable), one persistent reviewer appending rounds to `reviews/code-review.md` with a verdict per round. Findings must be fixable in-PR.
- Design authority is Will's, absolutely. When a design question is open, implement only what he has explicitly ruled; bring gaps back as options. A rejected proposal reopens the discussion — it does not delegate the redesign to you.
- Reference clones live in `.refs/prisma` (git-excluded). Root `pnpm lint` aborts on their nested biome configs — lint `packages/cli/{src,tests}` from an isolated copy or per-file. Do not move or delete `.refs`.

## Binding operator rulings (2026-08-21, supersede all earlier design text)

1. **Skills are a product-family tool.** Skills delivery must not be wired through `prisma orm init`. The mechanism lives in prisma-cli's `skills` group.
2. **Nothing we ship ever edits the user's `package.json`.** The postinstall-script mechanism is dead; a script the user removed must never be re-added. (The new init brief below repeats this: "a postinstall/prepare hook was considered and rejected".)
3. **No legacy string mapping anywhere.** The CLI is pre-rc with no legacy obligations. Producers emit current command spellings directly; display-time rewriters are deleted, never extended. (Done: `renameAppCopy`/`COMMAND_PREFIXES` deleted in #219; `fromLegacyCliError` survives only as a structural converter.)
4. **`prisma init` returns, repurposed** — full brief embedded below. It initializes the local filesystem (config scaffold + skills install), purely local, no platform calls.

## State of the four delivery PRs (all green, all reviewer-satisfied as of this writing)

| PR | What | State |
| --- | --- | --- |
| [prisma-cli#219](https://github.com/prisma/prisma-cli/pull/219) | `prisma skills sync`/`list`, per-command staleness notice, CLI_NAME→`prisma` rename, legacy rewriter deletion | Ready for review, CI green, reviewer rounds 1-6 complete |
| [prisma/prisma#30096](https://github.com/prisma/prisma/pull/30096) | prisma-8 skill folded + stamped (`metadata.library`/`metadata.library_version`) + shipped in the `@prisma/orm-postgres|sqlite|mongo` tarballs, pack-and-read-back test | Open vs `main`, green, satisfied |
| [prisma/prisma#30097](https://github.com/prisma/prisma/pull/30097) | `prisma orm init` reduced to one scaffold-time `skills sync` run; no postinstall, no gitignore writing; GitHub fetch removed | Open vs the #30096 branch, green, satisfied; retarget to `main` after #30096 merges |
| [prisma/composer#251](https://github.com/prisma/composer/pull/251) | Composer skill in the `@prisma/composer` tarball | **Merged.** Its npm release must wait until the prisma-cli CLI ships |

Merge order (binding): **#219 → #30096 → #30097**. The composer release follows the CLI release. Merges are the operator's to perform or delegate.

**Interaction with [prisma-cli#218](https://github.com/prisma/prisma-cli/pull/218)** (command-surface reshape, open, separate ownership): #218 and #219 conflict in `packages/cli/src/cli.ts`, `commands/service/errors.ts`, `commands/project/errors.ts`, `output-conventions.md`, `AGENTS.md`, and #218's 86-command grammar pin (which lacks `skills sync|list`). Whichever merges second takes the rebase and amends the grammar count. #218 also deletes the compute-config error path, after which parts of `fromLegacyCliError`'s remaining structural conversion may lose their producer — simplify then. The operator has not ruled the #218/#219 order; ask, or default to #219 first (it is review-complete and first in the delivery chain).

## Open operator decisions — confirm with Will before or during the work

These were implemented by the previous orchestrator without ratification. They are on the branches, tested, and reviewer-verified, but Will has NOT signed off. Present them for a ruling; revert or reshape on his word:

1. **Sync's advisory next-step** (#219, `presentation.ts`): sync's output suggests the optional user-added `"postinstall": "prisma skills sync || exit 0"`. Keep, reword, or delete?
2. **Nested `.gitignore`** (#219, `sync.ts`): sync writes a `.gitignore` containing `*` inside each managed skill directory, instead of anyone touching the root `.gitignore`. The init brief's non-goal ("no `.gitignore` edits") covers init, not sync — but confirm the sync behavior too.
3. **Does `prisma orm init` keep its single scaffold-time sync call** (#30097's current state), or drop it now that family-level `prisma init` will exist (users/scaffolds could run `prisma init` instead)? Current state: orm init runs `dlx prisma@next skills sync` once, `--skip-skills` skips it.
4. **The durable trigger is the staleness notice alone** (no postinstall anywhere): consequence of ruling 2, but confirm Will considers the notice sufficient as the whole mechanism.

## Fixes owed on #219 before merge (from the /code-review run, verified findings)

Two correctness findings should be fixed in-PR; the rest are judgement:

1. **`skills sync` silently deletes a user-authored skill on a name collision** (`lib/skills/sync.ts:38`, `replaceTree` at :90). A hand-written or customized `.claude/skills/prisma-8/` with no stamp (or a stamp naming a non-allowlisted library) parses as "absent" (`status.ts:196-198`) and gets `rm -rf`'d and replaced, reported as a routine sync. The ownership check (stamp library vs allowlist) exists only in `findOrphanedSkills` (`status.ts:223-227`). Fix: before replacing, read the existing copy's stamp; if it names a non-allowlisted library or is unstamped, refuse (diagnostic naming the directory) instead of deleting. Test the collision case (`skills-sync.test.ts` covers foreign skills only under a different name).
2. **The staleness notice ignores `--config` and workspace-root config opt-outs** (`skills-check.ts:130`): `isDisabledInConfig` calls `loadConfig(cwd)` with no config path, while the engine honors `invocation.state.configPath` (`needs.ts:254`, `runtime.ts:136`); and staleness is detected at the walked-up workspace root while the opt-out is only read from cwd. NOTE: the init brief below adds an engine config walk-up (topmost / `root: true`) — fix this finding in terms of that mechanism if it lands first, rather than building a second walk.
3. Lower priority, fix or record: opt-out (`.prisma/skills.json`) is read only after the full scan (`status.ts:79` — read it first and short-circuit; skip the orphan scan on the notice path); `prisma.config.ts` evaluated a second time per command when stale (surface the run's loaded config instead); `isDisabledInConfig` bypasses `skillsConfigSection.validate` (call the validator); notice fires on `--version`/`--help`/bare `prisma` (update check exempts `--version` — align); the suppression argv scan reads past a bare `--` unlike the engine's `flagTokens` (stop at `--`); duplicated `unquote`/`QUOTED` in `project-root.ts` vs `frontmatter.ts`; hard-wrapped new prose in `docs/product/output-conventions.md` (~100-112) and `docs/architecture/overview.md` (25-27, 56-57) — unwrap per the no-hard-wrap rule.

After fixing: reviewer verification round, fresh CI, and update the PR body if behavior changed.

## Remaining deferred/operator items (details in `deferred.md`)

Retire or re-scope the `prisma agent` group — `prisma agent install|update|status` still installs v6/v7-line skills via `npx skills@latest` and its brief overlaps the new `skills` group; **this must be decided before the release that ships `prisma skills`, and it matters for the init brief's seam (below)**. Composer website hero copy (owner + timing). Turbo `dependsOn` race on `cli-engine` dist. `check-skill-packaging.mjs` hardcodes one composer package. `isLikelyGlobalNpmEntrypoint` matches only `prisma-cli` paths and `selectUpdateInstruction` still names `@prisma/cli` — a global `prisma` user gets wrong/fallback update advice. Feedback user-agent now `prisma/<version>` — flag to that dashboard's owner. Two Windows CI flakes noted (skills-sync timeout; credential-manager timing). When facade skill content diverges per database, split by skill name — never a carrier package (recorded 2026-08-21, operator concurred).

---

## The `prisma init` brief (operator's, verbatim — authoritative for the new command)

# Brief: `prisma init` — initialize the local filesystem for Prisma development

Repo: **prisma-cli** (branch from `main` after PR #218 merges — this brief assumes #218's grammar: subjects positional, no ambient targeting, no interactive pickers). Requested by Will Madden, 2026-08-21.

## What this command is

`prisma init` initializes the current repository for Prisma development. It is purely local: it writes files in the working copy and runs the agent-skills installer. It makes **no platform calls and no mention of the platform** — no project creation, no linking, no next-action hints naming platform commands. Platform setup is `project link` / `project create` and is not init's concern.

This is a new command reusing a retired name. The old `init` (deleted in #218) was a compute-config wizard; nothing from it comes back. Do not resurrect any of its code.

## Contract

`prisma init`, mounted at the root of the command tree. No positionals (there is no subject resource — see "Subjects are positional" in `docs/product/command-principles.md`). Idempotent: running it in an already-initialized repo reports each step as already done and exits 0.

### Step 1 — scaffold `prisma.config.ts`

If `prisma.config.ts` does not exist in the cwd, write:

```ts
import { definePrismaConfig } from "prisma/config";

export default definePrismaConfig({
  root: true,
});
```

Never overwrite an existing file; report "exists" and continue. See "The `root` flag" below for what `root: true` means.

The stub's shape is dictated by the engine's config contract (`packages/cli-engine/src/config-loader.ts` and `execution/needs.ts`) — a bare object export is invalid two ways, so both of these prerequisites are part of this slice:

1. **The default export must be a `definePrismaConfig` result.** The loader checks the `$prismaConfig` version marker and refuses an unmarked object with `CLI.CONFIG_MISSING_MARKER` (it reads as a Prisma 7 config). `definePrismaConfig` attaches the marker at runtime, so the scaffold cannot be import-free. Today the helper is only exported from `@prisma/cli-engine`, which user repos do not (and should not) depend on directly — add a `./config` export to the `prisma` package (`packages/prisma`) that re-exports `definePrismaConfig` (and its type) from the engine, and have the scaffold import from `prisma/config`. Note the resolution consequence: evaluating the config requires `prisma` to be installed in the repo, which is the normal case for an initialized project.
2. **`root` must become an engine-reserved file-level key.** The engine treats every unreserved top-level key as a config section and hard-errors on unknown ones (`CLI.CONFIG_UNKNOWN_SECTION`, `execution/needs.ts` ~line 213). Reserve `root` alongside `extends`/`$`-prefixed keys (`reservedConfigSectionName`, `config-loader.ts` ~line 58), have the loader validate it as an optional boolean, and surface it on `LoadedConfig` so the walk-up below can read it. Update the reserved-keys doc comment — this is the first engine-owned file-level *setting*, a new category next to the mechanical reservations, and the comment should say so.

### Step 2 — install agent skills

Invoke the skills installer. The installer itself is being built on a separate branch — do not build or modify it; init only hangs it off. Specify the seam as: init runs the same code path as `prisma agent install` with default targets (whatever that command's entry point is when both branches land — today `runAgentSkillsInstall` in `packages/cli/src/commands/agent/install.ts`; coordinate if the other branch moves it). Rules for the seam:

- A skills install that fails is a **diagnostic on a successful init, never a failed init**.
- Non-interactive contexts (no TTY, `--json`, CI) must not prompt; rely on the installer's own CI handling.

### Flags

Follow the old init's optional-boolean pattern for step opt-outs: `--no-skills` skips step 2, `--no-config` skips step 1. No other flags in v1.

### Output

Standard presentation: one line per step (`created` / `exists` / `installed` / `skipped` / diagnostic), JSON result carrying the same per-step outcomes. No platform-related next actions. Follow `docs/product/output-conventions.md`.

## The `root` flag and the walk-up (the substantive engineering)

#218 deleted the compute-config walk-up, so the link pin (`.prisma/local.json`) and state dir are now resolved against the exact cwd: a repo linked at its root finds nothing when a command runs from `apps/api/`. The scaffolded config becomes the durable root marker that fixes this. Two design decisions are already made; implement them as ruled:

1. **`root: true` uses ESLint semantics: it stops the upward search.** Config discovery walks up from cwd collecting `prisma.config.ts` files; the anchor is the **topmost** config found, unless one carries `root: true`, which stops the walk there. Rationale: a monorepo may hold several `prisma.config.ts` files (e.g. a dedicated ORM package); topmost-by-default means the repo root wins without anyone remembering a flag, and the flag exists for a genuinely nested independent project isolating itself. A forgotten flag degrades to "repo root", the almost-always-right answer.

2. **The shell never evaluates TypeScript to resolve a target.** `prisma.config.ts` is executable code; evaluating it to route `service show` would put user-code execution and esbuild-class startup cost into every command. So split the anchors:
   - **Pin and state dir:** walk up from cwd to the nearest `.prisma/` directory; read `local.json` and the state dir there. No config file is touched. A nested directory deliberately linked to a different project therefore wins over the root — nearest-wins is intended.
   - **Config discovery** (the `root: true` cascade above) is performed only by commands that evaluate the config anyway (the ORM family, and future config consumers). The shell may use config-file *presence* (a pure filesystem check, no read) if it needs a root heuristic, but must not parse or evaluate the file for targeting.

   Because `project link` writes `.prisma/local.json` beside the root config, the two anchors agree in practice; `.prisma/local.json` is per-developer local state and is not a substitute for the committed config as the durable marker.

   Note the engine loader is deliberately cwd-only today (its own doc comment: "cwd only, no walking up"). The config walk-up is therefore an engine change: `Runtime.loadConfig`'s resolve step walks up applying the topmost/`root: true` rule, and only that resolve step changes — evaluation, marker check, and section validation stay as they are. The `root` flag is read from the already-evaluated config of each candidate file during the walk; since only config-consuming commands trigger loadConfig, this stays inside the "shell never evaluates TS to route" rule.

## Mechanical obligations

- Mount `init` at the root: `packages/cli/src/cli.ts` mount table, plus the expected tree in `packages/cli/tests/mount-coverage.test.ts` (the grammar check fails until both agree).
- Unit tests for: fresh scaffold, existing-config no-overwrite, `--no-config`/`--no-skills`, skills failure reported as diagnostic with exit 0, non-interactive run. The scaffolded file must round-trip through the real loader: evaluate it with `Runtime.loadConfig` and assert no diagnostics.
- Engine tests: `root` accepted as a reserved file-level key (boolean-validated, surfaced on `LoadedConfig`, never reported as an unknown section), and the loader walk-up (topmost wins; `root: true` stops; cwd-only behavior preserved when no parent configs exist).
- `prisma/config` export: type + runtime re-export test in `packages/prisma`.
- Walk-up tests: pin found from a subdirectory; nearest `.prisma/` wins over a higher one; state dir follows the same anchor.
- e2e: per `packages/cli/AGENTS.md`, every mounted command needs e2e coverage or an `AWAITING_COVERAGE` entry with reasoning. `init` is local-only, so a credential-free e2e (run the built binary in a temp dir, assert the scaffold) should be cheap — prefer that over a backlog entry.
- Docs: command reference entries, and record the `root: true` semantics in `docs/product/command-principles.md` or a config doc — the flag is public surface.
- Close the deferred-ledger item in `.drive/projects/prisma-cli-v8/deferred.md` about pin discovery being cwd-exact (the "state-dir and local-pin discovery lost their project-root anchor" concern noted under the grammar-cleanup section's history), and record the walk-up rules wherever the ledger points.

## Non-goals

- No package.json mutation of any kind (a postinstall/prepare hook was considered and rejected).
- No platform calls, no linking, no hints naming platform commands.
- No compute-config resurrection, no editor-types install, no `.gitignore` edits.
- No changes to the skills installer itself — other branch's work.
- No config-shape decisions beyond the stub: the file's eventual typed shape lands separately.

---

## Integration notes for the init brief (reconciling it with the skills branch)

- **The skills installer seam.** The "separate branch" the brief refers to is #219. The installer's entry point is the `skills sync` path: `skillsSyncCommand` (`packages/cli/src/commands/skills/sync.ts`) wrapping `syncSkills` (`packages/cli/src/lib/skills/sync.ts`). It is not `runAgentSkillsInstall` — that belongs to the old `prisma agent` group, which still shells out to `npx skills@latest` for v6/v7 skills and is pending retirement (deferred item above). Init's step 2 should invoke the sync library entry (`readSkillsStatus` + `syncSkills`, or an exported helper around them) in-process, not spawn a subcommand, honoring the brief's rules: failure = diagnostic on a successful init; no prompting (sync never prompts); exit 0. Confirm with the operator whether landing `prisma init` also triggers the `agent` group's retirement.
- **Branch point.** The brief says branch after #218 merges. #219 must also be merged (or the init branch based on it) since the seam code lives there. Practical order: land #219, land #218 (second one rebases; see the conflict list above), then branch init work from `main` with both in.
- **The `--config`/walk-up finding.** Finding 2 in the fixes list is the same problem space as the brief's engine walk-up. If the walk-up lands with init, point the skills staleness check's config read at the same resolve step (`Runtime.loadConfig` with `invocation.state.configPath` semantics) instead of a bespoke fix.
- **Skills e2e note.** `prisma init` in a temp dir with no allowlisted packages installed: sync exits 0 with "no packages" — the credential-free e2e should assert that path too.

## Close-out (after all merges and the init slice)

Per drive process: verify `spec.md` acceptance criteria, closing health check, final retro with the operator, migrate long-lived docs into the repos, strip repo-wide references to `.drive/projects/agent-skills-npm-packages/**`, delete the project directory. The init slice belongs to prisma-cli's own ledger (`.drive/projects/prisma-cli-v8/`) once this project closes.
