# Summary

Ship the unified `prisma` CLI: one binary, one `prisma.config.ts`, and the
ORM, Composer, and Cloud command families mounted on the agreed grammar
tree — built on the settled engine design (interface v8, requirements
R1–R14). **Definition of done: the operator can publish the `prisma` npm
binary as `8.0.0-rc1` implementing the full design.** Publishing is the
operator's act; this project delivers the publishable state.

# Description

Prisma users today face three CLIs (`prisma-next`, `prisma-composer`,
`@prisma/cli`), three config files, and three unrelated help/output/error
dialects. The consolidation direction, grammar tree, and engine design
are settled (see `design-notes.md` for the authoritative map: engine
interface v8 with five review rounds closed; requirements R1–R14 on
prisma-cli PR #128; packaging, auth, config, and error-model rulings).
What remains — this project — is to build it: the engine library, the
unified config machinery, the shell, the auth library, and the port of
all three command families, ending in a release pipeline that can produce
`prisma@8.0.0-rc1`.

Repos involved: **prisma-cli** (the shell, the engine package, the auth
library — home repo), **prisma/prisma** (ORM product integration; the
ADR 239 amendment), **prisma/composer** (Composer product integration).

# Requirements

## Functional Requirements

1. **The engine library exists and is consumable**: `@prisma/cli-engine`
   implements interface v8 — the execution protocol
   (completed/errored), events, return-site presentation, config-section
   tokens, prompts (defaults, `consent`), the three command kinds, the
   envelopes and json stream, mounting, and the test harness — with a
   `./protocol` subpath for types-only consumers and `@stricli/core` as
   an exact-pinned internal dependency. Every deviation from the v8
   draft discovered during implementation returns to the operator as a
   design question, not a silent fix.
2. **ADR 239 is amended first** (prisma/prisma): completed-but-
   unsuccessful results carry dotted codes as diagnostics inside
   completed envelopes with documented exit codes; includes the
   severity-`info` evidence check (trim `CliStructuredError` and
   `Diagnostic` scales together if unused).
3. **One config file**: the shell discovers and evaluates
   `prisma.config.ts` exactly once; the `defineConfig` version marker
   distinguishes v8 configs, and an evaluated file without the marker —
   in particular a classic Prisma 7 config — fails early with a typed
   error naming the migration path (fail-early is ruled; no best-effort
   reading). Products contribute sections via their command families
   (`CommandFamily`: section token + commands + docs base); validation
   is per-section diagnostics; a command fails only when a section it
   needs is invalid.
4. **The shell**: the `prisma` binary in the prisma-cli repo — mounts
   the grammar tree (shell-owned paths, R12), injects the shared flag
   family, implements formats (`--format`, `--json` alias, auto-json on
   non-TTY stdout), log levels, prompts, signals, exit codes, and the
   crash envelope, all through the engine.
5. **Auth**: the auth library (token storage, refresh, login flow guts —
   extracted from `@prisma/cli`'s existing implementation) lives in the
   prisma-cli repo, distinct from Prisma Cloud code; the shell consumes
   it to supply `getCredentials`; credentials authenticated through any
   command reach every product's operations through context.
6. **All three command families port onto the tree** per the grammar
   doc: ORM (`contract *`, `migration *`, `db *`, `init`, `lsp`, …),
   Composer (`composer deploy|dev|log|destroy`, stubs where ruled — a
   subgroup is owned by exactly ONE command family; mixing management-API
   and Composer commands in one subgroup is ruled out (operator,
   2026-08-10). Interim parking (operator, 2026-08-10): Composer's
   commands live under a `composer` root, the platform's cloud-project
   CRUD keeps `project`; the final grammar — including whether the
   old "no composer-named surface" goal returns — stays open as
   TML-3189; moving the tree later is cosmetic), and
   Cloud/platform (`auth *`, `project *`, `postgres *`, `service *`,
   `bucket *`, `git`, `agent`, with the ruled renames). Parity bar:
   behavior equivalent to the shipping CLIs except where a settled
   ruling changed it (envelopes, exit codes, renames) — divergences are
   enumerated, not discovered.
7. **Products integrate as designed**: prisma/prisma and composer export
   their command families; the shell pins exact versions; tandem
   releases run on committed versions with workflow glue.
8. **Product-repo e2e is real** (R7): each product runs argv-in/
   bytes-out tests against the engine's harness in its own repo; the
   shell's own suite proves composition per family (R8).
9. **The conformance checker exists**: the small three-check tool —
   import purity, validator no-throw on hostile input, published-tarball
   verification — wired into CI where products publish.
10. **A release pipeline produces the publishable artifact**: versioned
    per the committed-versions ruling, capable of emitting
    `prisma@8.0.0-rc1` on demand.

## Non-Functional Requirements

- Requirements **R1–R14** (prisma-cli `docs/architecture/
  cli-engine-requirements.md`) govern throughout; this spec does not
  restate them.
- The settled error/result conventions (prisma/prisma ADR 239 as
  amended, ADR 245; composer ADR-0043/0044) hold everywhere.
- The exit-code contract: 0 completed / 1 bug only / 2 errored /
  3 abort / 4–99 documented / 130,143 signals.
- The CLI is never a package manager (R13, amended 2026-08-11); optional
  capability = optional peer dependency + engine-phrased error. A command
  may run the USER's manager, in the user's project, at their request,
  through the engine's package operations — visible command, structured
  failure, bin-owned execution.
- Runtime-agnostic products (R4): context-not-environment discipline
  throughout the ports.
- The engine design artifacts live in this project directory
  (`assets/engine/`); the durable subset (the final interface record,
  ADRs) migrates into `docs/` at the appropriate slices and at
  close-out.

## Non-goals

- **Daemon library and emulator management commands** — parked by
  ruling (`assets/engine/daemon-library-notes.md`); the `emulator`
  root stays off this project's tree.
- **Prisma 7 config compatibility** beyond the fail-early typed error.
- **Ecosystem cutover**: codemods (`prisma-next.config.ts` →
  `prisma.config.ts`), create-prisma templates, deprecation of the
  three existing binaries, docs-site updates, the npm takeover
  sequencing itself — follow-on work after rc1 exists.
- **`prisma.compute.ts` migration** — separate Terminal effort.
- **Resuming the paused 1b/1c briefs** — sequenced after the engine's
  config API lands; their revision is the trigger to unpause, tracked
  in delivery, but their content is not this project's deliverable.
- **GA (non-rc) release.**

# Acceptance Criteria

- [ ] `@prisma/cli-engine` published (or publishable) from the
      prisma-cli repo; its `./protocol` subpath consumed type-only by at
      least one product; the v8 draft's compile-verified typing claims
      hold in the shipped package's tests.
- [ ] ADR 239 amendment merged in prisma/prisma before any port relies
      on completed-with-diagnostics semantics.
- [ ] A v8 `prisma.config.ts` with sections for all three products
      drives a real workflow end to end; a Prisma 7 config file produces
      the typed fail-early error, test-pinned.
- [ ] Every command family mounted; the shipped tree checked against the
      grammar doc by a build-time test; per-family parity divergence
      lists reviewed by the operator.
- [ ] `prisma auth login` through to a Composer deploy consuming the
      same credentials via context, e2e.
- [ ] Product-repo e2e suites exist and pass in prisma/prisma and
      composer using the engine harness; shell integration proofs pass
      per family.
- [ ] Conformance checker runs in CI for both products' publish paths.
- [ ] The release pipeline emits a `prisma@8.0.0-rc1` artifact from a
      tagged commit; the operator can publish it with one action.

# Cross-cutting

- Drive process governs delivery: slices are one-PR units; deviations
  from settled design return to the operator; retros land learnings in
  durable memory.
- Commit/PR discipline per the operator's standing rules (bot identity,
  dual sign-off, explicit staging, verify-PR-open-before-push).
