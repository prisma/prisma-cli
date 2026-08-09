# S1 — Engine package + one vertical command (slice contract)

One PR into the `cli-engine-requirements` lineage (prisma-cli repo).

## Goal

`@prisma/cli-engine` exists, implements the v8 interface, and is proven
end to end by ONE ported platform command — `auth whoami` — running
through a minimal bin: parse → preconditions → context → handler →
presentation → envelope → exit code, byte-asserted through the
package's own test harness.

## In scope

1. **The engine package** (new workspace package in this repo):
   - The protocol types (`CliStructuredError`, `Result`, `Diagnostic`,
     `NextAction`) implemented from the prisma/prisma donor sources
     (`packages/1-framework/0-foundation/utils/`, `1-core/errors/
     control.ts` lines ~9–111) with the settled adjustments (Diagnostic
     as pure data ≡ envelope shape; NextAction without `journey`),
     exposed at the `./protocol` subpath.
   - The full v8 surface from
     `.drive/projects/prisma-cli-v8/assets/engine/
     engine-interface-draft.ts`: defineConfigSection, defineCommand/
     defineSessionCommand/defineServerCommand, flag/positional builders
     (Char alias typing), Args, CommandContext (present with Outcome,
     report, prompt incl. consent + defaults under --yes, signal, cwd,
     requireDependency, getCredentials), events + rendering rules,
     Blocks + Ui, envelopes + StreamEvent framing, createCli + Runtime +
     LoadedConfig, createTestCli. `@stricli/core@1.3.0` exact-pinned,
     fully internal.
   - The compile-verified typing claims from the design review rounds
     become permanent type-tests in the package
     (@ts-expect-error suites): Char alias accept/reject, Outcome
     exitCode required-iff-catalogued both directions, needs.config →
     ctx.config inference, PresentedResult brand.
2. **A minimal config loader** behind `Runtime.config`: discover
   `prisma.config.ts` from cwd, evaluate it, check the `defineConfig`
   version marker, produce `LoadedConfig` (raw sections +
   file-level diagnostics). An evaluated file WITHOUT the marker (a
   classic Prisma 7 config) yields the typed fail-early diagnostic —
   test-pinned. (Full loader polish, section registration UX, and the
   `defineConfig` helper's final home evolve in S3; the marker
   semantics are settled and land now.)
3. **A minimal bin** (`prisma-v8` working name, not published):
   createCli with one group, `auth whoami` mounted, Runtime assembled
   from the real process (streams, env, TTY, signals) with
   `getCredentials` backed by the EXISTING token-storage adapter
   in place (extraction is S2).
4. **The `auth whoami` port**: definition + lazy handler calling the
   existing controller logic as its operations layer; presentations per
   the platform's current output (parity), stdout payload, json
   envelope.
5. **Tests**: engine unit tests; harness e2e for whoami (human bytes,
   `--json` stream + envelope, `--quiet`, exit codes incl. errored and
   unauthenticated preconditions); marker fail-early; "engine never
   calls process.exit and writes only to provided streams" proven by
   harness construction.

## Out of scope

Every other command; commander-shell removal (S2); auth-library
extraction (S2); ProductManifest consumption from another repo (S3);
publishing.

## Design authority

The v8 draft is normative. Where implementation contradicts it, STOP
and return the question — the draft gets amended by the operator's
ruling, never silently. Requirements R1–R14
(`docs/architecture/cli-engine-requirements.md`) govern.

## Acceptance

- [ ] Package builds; `./protocol` subpath importable type-only.
- [ ] Type-test suite green, including every ported compile-verified
      claim (with stale-@ts-expect-error control discipline).
- [ ] `prisma-v8 auth whoami` parity with `prisma-cli auth whoami`
      (documented divergences only: envelope shape, exit codes).
- [ ] Harness e2e green for human/json/quiet/errored/unauthenticated.
- [ ] Prisma 7 config file → typed fail-early error, test-pinned.
- [ ] v8 draft in `assets/engine/` updated to match any operator-ruled
      amendments made during the slice.
