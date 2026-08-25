# Config-file resolution: ancestor discovery and per-key merging

Status: **decided** (operator rulings 2026-08-25). This file was the design discussion; it is now the slice contract. The discussion history survives condensed under "Design decisions"; the appendix's edge-case catalogue is carried forward as implementation requirements.

## At a glance

`prisma.config.ts` resolution grows from "one file in cwd" to "a chain of files discovered upward", merged per key with the most-local value winning — the ESLint/webpack-merge model users already know. The primary layout served: one config at the repository root (deploy target, platform settings), one in the `db` package (ORM settings) — already the mainstream monorepo pattern and part of Composer best practices. Discovery is automatic; an explicit `parent` key overrides it. The hand-rolled skills-config reader consolidates into the same resolver, and `prisma init` in a subdirectory scaffolds config only.

## Decided behavior

### Discovery

- From the anchor directory, search upward collecting every `prisma.config.ts` on the path. The anchor is cwd, or with `--config <file>` the named file's own directory (the named file is the nearest layer; its ancestors and `parent` declarations apply as usual — never cwd's lineage).
- The search stops at the repository boundary: the first directory containing `.git`. No `.git` found anywhere above → the anchor directory only. Filesystem root and home directory are never reached implicitly. Rationale: every file on the chain is *executed* TypeScript; nothing outside the repository runs without explicit consent.
- A file may declare `parent: false` — "I am the root", collection ends here (supersedes the earlier `root: true` design; one field, not two) — or `parent: "path"`, naming its parent explicitly. An explicit `parent` path may cross the repository boundary (git submodules); crossing is the consent. Absent `parent` means automatic discovery continues. A `parent` chain must be cycle-checked.
- `parent` is an engine-reserved top-level key like the `$prismaConfig` marker: read by the loader, never a section, rejected as a section name at tree construction (`reservedConfigSectionName` + `rejectReservedSectionName`).
- Automatic discovery cannot be replaced by `parent`: the common case is a subdirectory with **no config file at all**, which has nowhere to declare a parent. `parent` only overrides what discovery would have chosen.

### Merging

- Sections resolve **per key, most-local value winning**, over the discovered chain. A nested file shadows only the keys it actually writes; a root-level `skills: { check: false }` reaches every subdirectory that does not override it.
- Merge semantics are owned by the section type: `ConfigSection` gains an optional `merge(parent, child)` and the owner decides array/atomic behavior. The engine default, for sections that do not customize: per-key merge at the section's top level, replace below.
- No shadowing notices. Overriding parent config is the mechanism working as intended; introspection belongs in verbose output, not per-run warnings.
- `definePrismaConfig` freezes its result; merging constructs fresh objects and never mutates a file's export.

### Validation and provenance

- Per-file checks: evaluation, marker, version, and the unknown-top-level-key check run for **every** file on the chain — a typo'd key in a nested file errors even when the command's sections resolved elsewhere. A broken file anywhere on the chain fails the command with an error naming that file; no skipping.
- Required-key/section validation runs **after** the merge, on the resolved view — a child file may hold a valid partial that the parent completes. Validators keep their current contract (own absence, never throw); the ORM section's "required" absence-error now fires only when no file on the chain supplies the section, which is the intended semantics.
- Every resolved value carries provenance (which file contributed it), so post-merge validation errors and diagnostics name the file to fix, and:
- **Relative paths resolve against the file that declared them**, never against cwd or the nearest config. A root config's `orm: { migrations: "./migrations" }` means the root's `migrations` directory from anywhere in the repo.

### Consolidation

- `readProjectSkillsConfig` and every other out-of-handler config read (the skills staleness notice, the post-login tip) goes through the engine resolver. The hand-rolled `existsSync(cwd/prisma.config.ts)` + direct `loadConfig` path is deleted; there is exactly one resolution behavior in the product.

### `prisma init` in a subdirectory

- `init` acts on cwd with no special-casing of the scaffold itself (init at root makes the root config; init in `packages/db` makes the package config; discovery wires them together).
- When init runs in a directory that has an ancestor config on the discovered chain (a subdirectory init), the skills sync, the `postinstall` script, and the `prisma` devDependency additions are **skipped by default** — those belong to the repository root. Explicit flags may still opt in. Root init behavior is unchanged.

## Design decisions (condensed history)

- **"Highest file wins"** (with `root: true`): rejected — ignores a `db` package's ORM config entirely; briefly implemented in the engine (commits `ba48d46`, `f72503c`, removed by `9b2f9d0`), recoverable from history as reference.
- **"Nearest file wins"**: rejected — root-scoped commands (`deploy`, `project link`) break from inside packages.
- **Per-scope declarations** (sections declare root- vs nearest-scoped): rejected as redundant — where a section is written already encodes it.
- **Atomic per-section resolution** (nearest definition of a section wins whole): superseded 2026-08-25 by per-key merging — with merge semantics delegated to typed section owners, merging does what users of ESLint/tsconfig already expect, and partial overrides (`skills.check` at the root, `skills.agents` in a package) work.
- **`export default merge(parentConfig, {...})`** as the layering mechanism: rejected — moves resolution into user code, defeating loader-controlled ordering, caching, error attribution, per-file validation, and the boundary rule. Fine as userland sugar; not the contract.
- **`--config` reads only the named file**: rejected in favor of the named file anchoring the normal chain.

## Implementation requirements (carried from the prior round's review)

- Resolve the search's starting directory through symlinks so errors name real paths.
- Keep loader tests anchored so a stray `prisma.config.ts` in a real ancestor of the checkout cannot leak into them — this repository itself will contain fixture configs; the test harness must pin the chain.
- Enforce reserved-key handling on the engine side of the pluggable-loader boundary, not only inside the default loader.
- Name the offending value (and now its file) in validation errors.
- Windows: realpath both sides of any path comparison (the loaded-file identity check already does; the chain comparisons must too).

## Scope

**In:** engine loader (chain discovery, `parent`, boundary stop, per-file checks), `LoadedConfig` shape change and everything downstream of it (`needs.ts`, hosts, tests), `ConfigSection.merge` and the default merge, provenance, declaring-file-relative path contract, skills-reader consolidation, init subdirectory behavior, user docs, ledger updates.

**Deliberately out:** ORM and composer `merge()` customizations (upstream packages; the engine default covers them), any change to their validators, the topology of which sections exist, performance work beyond bounded-depth evaluation (cache within a run only if free), shadowing introspection UX.

## Hazards

- The engine's exact-peer discipline: this slice changes `@prisma/cli-engine`'s public surface (`LoadedConfig`, `ConfigSection`), so it must ride an **unpublished** engine version (0.2.3 at the time of writing) or trigger the three-repo family re-peer chain. Verify the version is unpublished at merge time; if a release train has shipped it, bump first.
- `ConfigSection` is implemented by the shipped orm-toolchain and composer dists against the current engine; adding `merge` must be optional and backward-compatible at the type level, or it forces the family chain regardless.
- c12/`extends` stays off; `parent` is ours, not c12's merge directive. `omit$Keys` stays off or the marker dies.
- The frozen exports: any in-place mutation during merge throws in strict mode.

## Slice-specific done conditions

- The two-config monorepo layout works end to end: from `packages/db`, ORM commands read the package's `orm` section; `deploy`-scoped sections fall through to the root; a root `skills.check: false` reaches the package.
- `readProjectSkillsConfig`'s hand-rolled resolution is gone; the staleness notice and commands agree on which config governs from any directory.
- Subdirectory `prisma init` writes only the scaffold; root init unchanged; both covered by tests (unit + the existing init e2e extended).
- Ledger: the stale pathe entry is closed (the loader fix shipped in engine 0.2.2; the init e2e rerun workaround at `e2e/init.e2e.ts:189-200` comes out with this slice if the chain work removes its cause, else its entry is updated honestly).

## References

- Engine: `packages/cli-engine/src/config-loader.ts`, `config-section.ts`, `runtime.ts` (`LoadedConfig`), `execution/needs.ts` (`checkConfiguration`), `execution/command-tree.ts` (reserved names), `execution/shared-flags.ts` (`--config`).
- Shell: `packages/cli/src/commands/skills/config.ts` (`readSkillsConfig`, `readProjectSkillsConfig`), `packages/cli/src/commands/init.ts` (`renderConfigScaffold`, the postinstall/devDependency steps), `packages/prisma/src/config.ts` (`prisma/config`).
- Section owners at current pins: skills (shell), `orm` (orm-toolchain rc.5+: absence is an error), `composer` (composer-cli 0.12.0+: absence is `{}`).
- Prior implementation for reference: commits `ba48d46`, `f72503c` (removed by `9b2f9d0`); review findings in `.drive/projects/agent-skills-npm-packages/reviews/code-review.md`, round "Init slice — Round 1".
