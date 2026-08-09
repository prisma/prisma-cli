# Brief: prisma/prisma config-contract repairs and ControlClient test double

Repo: prisma/prisma (main). Three independent deliverables; land as separate PRs or one PR with separate commits. Operator: Will Madden. Process: verify every claim below against current code before changing it; if you hit a judgment call this brief doesn't settle, stop and report it as a numbered question with options and a recommendation — do not decide it yourself.

## Context

These are the remaining config/contract items from the CLI-consolidation work. The governing rules are in-repo: ADR 239 (structural error envelopes, dotted codes), ADR 245 (errors structured at origin, no catch-all codes; one `ok` discriminator on results), and `docs/CLI Style Guide.md` (exit codes). The error-code registry is `docs/reference/error-reference.md`, enforced by `pnpm run check:error-reference` — any new code or new producing site is added there in the same change.

## Deliverable 1: config loading returns diagnostics instead of throwing

Today `loadConfig` (`packages/1-framework/3-tooling/config-loader/src/load.ts`, validation in `packages/1-framework/1-core/config/`) throws `CONFIG.VALIDATION_FAILED` / `CONFIG.EVALUATION_FAILED`-shaped errors on the first problem. The target semantics:

- Evaluating a config module never takes down the command wholesale. Loading returns the evaluated config **plus a diagnostics list** (each diagnostic a `CliErrorEnvelope`-shaped structured error with a `meta.section` identifying the config section it concerns).
- A command that needs section X fails (exit 2, rendering that diagnostic) only if section X has a diagnostic; commands not touching X proceed.
- A config file that cannot be evaluated at all (module threw, unparseable) yields a single evaluation diagnostic attached to no section; every command then fails early with it.
- Existing error codes are reused; genuinely new conditions get new registered codes. No behavior change to what users *see* for currently-failing configs beyond message framing — pin representative `--json` envelopes before and after.

Design the exact return type first (the repo convention is the shared `Result` from `@internal/utils/result`, but a config-with-diagnostics is not a failure — a `{ config, diagnostics }` value inside `Ok` is the expected shape) and validate it against every `loadConfig` call site before writing code.

## Deliverable 2: versioned `defineConfig` marker

`defineConfig` (`packages/1-framework/1-core/config/src/config-types.ts`) stamps the object it returns with a config-format version marker (non-enumerable; survives spreads is NOT required — document that configs must return the `defineConfig` result directly). The loader then enforces:

- Marker present and current → proceed.
- Evaluation succeeded but no marker (a plain object export, or a config produced by a different `defineConfig` — i.e. a classic Prisma 7 file once the unified filename lands) → **fail early** with a new registered code (suggested: `CONFIG.UNVERSIONED_CONFIG`) whose fix text names `defineConfig` and links the migration path. This ruling is settled: fail early; no best-effort reading of unmarked configs.

The marker's purpose is downstream: the future unified host loader will claim `prisma.config.ts`, a filename Prisma 7 already uses, and must distinguish the two by marker rather than misparse. Build the marker and enforcement here; do not build any Prisma-7-filename discovery in this repo.

## Deliverable 3: published fixture-backed `ControlClient` test double

Hosts and product tests need to drive the CLI's control-api surface without a real database. Export a fixture-backed double of the control client (`packages/1-framework/3-tooling/cli/src/control-api/client.ts`) from a **published** entrypoint (decide placement against how `@prisma/orm-toolchain` composes its published surface; the double must not drag the real driver/database imports into consumers). It covers every seam operation the control API exposes, returns the shared `Result` shapes with realistic fixture payloads, and its per-operation fixtures are overridable per test. Add a conformance-style test asserting the double's surface stays in sync with the real client (compile-time: same operation names and signatures).

## Verification (all must pass before pushing)

`pnpm turbo build --filter=@internal/cli...`; full test + typecheck + lint in config-loader, config, cli packages; `test/integration` typecheck; `pnpm run check:error-reference` with zero failures; `pnpm lint:deps`.

## Commit discipline

Explicit staging only. `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, body ends with `Co-Authored-By: <your model attribution>`. Push via the `bot` remote, never origin. Verify the PR is open before any push to an existing PR branch.
