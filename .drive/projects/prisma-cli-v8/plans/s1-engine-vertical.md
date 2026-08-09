# S1 dispatch plan — engine package + auth whoami vertical

Slice contract: `../specs/s1-engine-vertical.md`. The v8 draft
(`../assets/engine/engine-interface-draft.ts`) is normative; any
first-contact contradiction STOPS the dispatch and returns to the
operator as a design question.

Branch mechanics: all dispatches commit to one branch
`s1-engine-vertical` off `cli-engine-requirements`; the slice PR
targets `cli-engine-requirements`.

Codebase grounding (2026-08-09): pnpm workspace, packages/cli +
packages/compute; @prisma/cli builds with tsdown, tests with vitest
(`packages/cli/tests/*.test.ts`); the whoami vertical is
`runAuthWhoAmI` (packages/cli/src/controllers/auth.ts:114) over
`createAuthUseCases().whoami` (packages/cli/src/use-cases/auth.ts) with
presentations in packages/cli/src/presenters/auth.ts; token storage is
packages/cli/src/adapters/token-storage.ts (+ @prisma/credentials-store);
the commander shell lives in packages/cli/src/shell/.

## Dispatches (sequential)

### D1 — Package scaffold + protocol subpath

**Outcome:** `packages/cli-engine` (`@prisma/cli-engine`) exists in the
workspace, builds with tsdown, runs vitest, and exports the `./protocol`
subpath carrying the protocol types (`Diagnostic`, `CliStructuredError`
with `toEnvelope()`, `Result`, `NextAction`) ported from the
prisma/prisma donor sources with the settled adjustments (Diagnostic is
pure data ≡ envelope shape minus `ok`; NextAction has no `journey`;
severity scales identical).
**Builds on:** nothing (first dispatch).
**Hands to:** a building package whose `./protocol` import is proven
type-only (a test that imports it and a check that importing it executes
no engine code).
**Completed when:** package builds; protocol unit tests green
(`toEnvelope()` shape pinned); type-only import proven; workspace lint
passes.

### D2 — Definition surface + type-test suite

**Outcome:** the full v8 *type* surface compiles: defineCommand /
defineSessionCommand / defineServerCommand, flag + positional builders
with the `Char` alias typing, `Args`, `Outcome`, `Presentations` /
`PresentedResult`, `defineConfigSection` + `SectionValidation`,
`NeedsSpec` / `HelpSpec`, `ProductManifest`, `createCli` mounting types,
`Runtime` / `LoadedConfig` / `Credentials` shapes. Pure types and
constructors only — no execution.
**Builds on:** D1's package + protocol types.
**Hands to:** the definition types D3 executes against and D5 loads
config for.
**Completed when:** every compile-verified claim from the design
review rounds is a permanent
type-test with stale-@ts-expect-error discipline: Char alias
accept/reject, exitCode required-iff-catalogued in both directions,
needs.config → ctx.config inference, PresentedResult brand. Suite green.

### D3 — Execution engine + test harness (result commands)

**Outcome:** a result command runs end to end inside the package's own
tests: `createCli` mounts the tree on `@stricli/core@1.3.0`
(exact-pinned, fully internal), parse → needs checks → context assembly
→ handler → `ctx.present` materializing only the active format →
envelope → exit code. Both settlements work: COMPLETED (presented
result, diagnostics, documented exit codes) and ERRORED
(CliStructuredError → error envelope, engine-rendered). `--format
human|json` (`--json` alias, auto-json when stdout is not a TTY),
`--log-level` (`--verbose` alias), StreamEvent framing, `createTestCli`
harness (answers, abort, onEvent, cwd, now; exitCode/stdout/stderr/
json/events/presented). The engine never calls `process.exit` and
writes only to provided streams — proven by harness construction.
**Builds on:** D2's definition surface.
**Hands to:** an executable engine D4 completes and D6 mounts a real
command on.
**Completed when:** harness e2e for a toy in-test command byte-asserts
human, json-stream + envelope, and errored paths with correct exit
codes (0/1/2 + catalogued).

### D4 — Prompts, events, session/server lifetimes

**Outcome:** the remaining execution surface: `ctx.prompt` (product
defaults accepted by `--yes`/Enter; no default halts under `--yes`;
`prompt.consent` structurally undefaultable), the event vocabulary +
rendering rules (step, progress, message severities, output channels,
remediation (transcript-only per ruling R-I), endpoint/status/artifact,
opaque product `data`), `ctx.report`, `ctx.requireDependency`
(engine-phrased install error), session-command lifetime (runs until
signal, no presentation) and server-command stdio handoff, signal exit
codes (130, 143; 3 is user cancel per ruling R-K).
**Builds on:** D3's execution engine + harness.
**Hands to:** the complete engine surface the acceptance sweep checks.
**Completed when:** each behavior above has a harness test; prompt
default/consent semantics test-pinned; session command terminates
cleanly on abort in tests.

### D5 — Config loader (marker fail-early)

**Outcome:** `Runtime.config` is populated by a minimal loader:
discover `prisma.config.ts` from cwd, evaluate it, check the
`defineConfig` version marker, produce `LoadedConfig` (raw sections +
file-level diagnostics). An evaluated file WITHOUT the marker (a
Prisma 7 config) yields the settled typed fail-early diagnostic.
**Builds on:** D2's `LoadedConfig` / section-token types (not D4 —
non-linear; the loader needs no prompts/events surface).
**Hands to:** config loading D6's bin wires into its Runtime.
**Completed when:** loader tests cover found/absent/marked/unmarked
files; the Prisma 7 fail-early diagnostic is test-pinned (code +
summary + nextActions, formerly `fix` before ruling R-I).

### D6 — `prisma-v8` bin + auth whoami port + slice e2e

**Outcome:** a minimal unpublished bin (working name `prisma-v8`) in
packages/cli: `createCli` with one group, `auth whoami` mounted;
Runtime assembled from the real process (streams, env, TTY, signals),
`getCredentials` backed by the existing token-storage adapter in place;
the whoami definition + lazy handler calling the existing
use-case/controller logic as its operations layer; presentations
matching the current `prisma-cli auth whoami` output (parity), stdout
payload, json envelope.
**Builds on:** D3 (execution), D4 (full surface), D5 (config in
Runtime).
**Hands to:** the slice DoD: the proven vertical + the parity-divergence
list for operator review.
**Completed when:** harness e2e green for whoami human bytes, `--json`
stream + envelope, `--quiet`, errored, and unauthenticated
(needs.credentials) paths; parity divergences documented (expected:
envelope shape, exit codes); every slice acceptance box checkable.

## Completeness check

D1+D2 → package/protocol/type-test acceptance boxes; D3+D4 → engine
behavior + never-exits box; D5 → Prisma 7 fail-early box; D6 → parity +
e2e boxes and the draft-amendment box (any operator rulings during the
slice update `assets/engine/` before the PR opens).
