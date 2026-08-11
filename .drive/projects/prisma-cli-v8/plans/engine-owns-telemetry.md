# Plan — the engine owns telemetry reporting

Contract: `../specs/engine-owns-telemetry.md` (ruled 2026-08-11, amended the
same day — **read §1.1 first**; it strikes three things the original draft
asked for and overrides the body wherever the two still read differently).

Branch `spec/engine-owns-telemetry`, PR #143. The spec ships in the same PR
as the implementation.

Reference material for every dispatch: the shipped ORM implementation is the
specification. It is cloned at `.reference/prisma` (gitignored) —
`packages/1-framework/3-tooling/cli-telemetry/src/`,
`packages/1-framework/3-tooling/cli/src/utils/telemetry.ts`,
`packages/1-framework/3-tooling/cli/src/commands/telemetry/`, and the
user-facing contract in `docs/Telemetry.md`. Where the platform shell's copy
(`packages/cli-telemetry`, `packages/cli/src/v8/telemetry`) and the ORM's
disagree, the ORM wins.

## Dispatches

### D1 — the telemetry core inside the engine, called by nothing yet

Outcome: the engine can decide whether to report, read and write the user's
preference, mint an installation id, resolve the endpoint, and compose a
payload from a command snapshot — all pure or filesystem-only, all tested,
with no execution path calling it.

Surfaces in play:

| File | What changes |
| --- | --- |
| `cli-engine/src/telemetry/gating.ts` | `resolveGating` resolving directly to spec §2.3's five-value union, CI first |
| `cli-engine/src/telemetry/user-config.ts` | read / write / `ensureInstallationId` / path resolution, ported as-is |
| `cli-engine/src/telemetry/payload.ts` | `TelemetryPayload` (today's `ParentToSenderPayload`) and the snapshot → payload projection |
| `cli-engine/src/telemetry/endpoint.ts` | the constant and the `PRISMA_NEXT_TELEMETRY_ENDPOINT` override |
| `cli-engine/tests/` | the tables in contract §5 that do not need a running CLI |

The sanitiser stops redeclaring `EngineCommandSnapshot` structurally and
imports the real type from `../run-summary`.

Hands to D2 and D3: a tested internal module whose decision, store and
payload are importable from the engine's execution path and its commands.

### D2 — the engine reports, at command start

Builds on D1.

Outcome: a CLI that declares `telemetry: { docsUrl }` discloses on first run,
mints its id, and hands one payload to the runtime seam before the handler
runs — and no telemetry failure is observable in the run.

**First task, carried over from D1.** D1 ported the preference store as-is,
including its direct `process.env` reads for `$XDG_CONFIG_HOME` and
`%APPDATA%`. Contract §2.5 now pins the fix: thread `env` through
`userConfigPath`, `readUserConfig`, `writeUserConfig` and
`ensureInstallationId`, sourcing it from `runtime.env`. D2 is the first
caller, so it owns the signature change and the D1 test updates that follow;
D3's commands take `ctx.env`. `process.platform` and `process.pid` stay —
see §2.5. Until this lands, a `createTestCli` run reads and writes the real
user's config file, which is why D2's failure-isolation tests cannot be
written before it.

Surfaces in play:

| File | What changes |
| --- | --- |
| `src/cli.ts` | the `telemetry` block on `createCli` |
| `src/runtime.ts` | `isCI: boolean`; optional `spawnTelemetry` |
| `src/execution/engine.ts` | the fire point, immediately after `state.snapshot` is assigned (line 390 today) — exemption, gating, disclosure, mint, compose, hand off, swallow |
| `src/testing.ts` | `telemetrySpawner` and `isCI` seeds |
| `src/exports/index.ts` | whatever of the above is public |
| `tests/` | contract §5's timing, exemption, disclosure, no-values and failure-isolation cases |

The failure-isolation tests are the ones that matter most here: a throwing
spawner, an unwritable config directory and a malformed stored config must
each leave exit code, stdout and stderr byte-identical to the same run with
no telemetry declared.

Hands to D4: an engine that reports, seeded and assertable offline.

### D3 — `telemetry status|enable|disable` as engine commands

Builds on D1 (the store), verified against D2 (the exemption).

Outcome: a product mounts the three commands in one line and gets the help
text, output and json shape both CLIs already ship.

The platform shell's current versions (`packages/cli/src/v8/telemetry/
{status,enable,disable,consent}.ts`) are already engine commands and are the
closest thing to a finished port — move them, with their help text intact,
and drop the `@repo/cli-telemetry` imports in favour of D1's modules. Confirm
each against the ORM's `commands/telemetry/` before moving: the two agree
today, and the ORM is the authority where they do not.

Hands to D4: three mountable commands exported from the engine.

### D4 — the shell migrates, the duplication goes

Builds on D2 and D3.

Outcome: the platform CLI reports through the engine, its own telemetry
reporting code is gone, and `@repo/cli-telemetry` is reduced to the child
sender.

Surfaces in play:

| File | What changes |
| --- | --- |
| `cli/src/v8/runtime.ts` | wires `isCI` (`ci-info`) and `spawnTelemetry` |
| `cli/src/v8/main.ts` | the `resolveTelemetryHooks` block goes |
| `cli/src/v8/cli.ts` | mounts the engine's three commands |
| `cli/src/v8/telemetry/` | `reporting.ts`, `is-ci.ts`, `status.ts`, `enable.ts`, `disable.ts`, `consent.ts` deleted; `sender.ts` build entry stays |
| `cli-telemetry/src/spawn.ts` | shrinks to fork + send + disconnect + unref; no longer re-resolves gating or re-reads the user config |
| `cli-telemetry/src/` | `gating.ts`, `user-config.ts`, `sanitize.ts`, `endpoint.ts` and their tests deleted; `enrich.ts`, `sender.ts`, the payload validator stay |
| `cli/tests/v8-telemetry*.test.ts` | ported onto the engine surface, unchanged in intent |
| `assets/s2/parity-divergences.md` | contract §4's two entries |

Hands to: the slice DoD.

## Validation gate

All four green before each dispatch commits, judged by pnpm's own exit code:

- `pnpm --filter @prisma/cli-engine test` (its `test` script runs build +
  typecheck + vitest)
- `pnpm --filter @prisma/cli test`
- `pnpm typecheck`
- `pnpm lint`

## Halt and surface rather than improvise

- Any place the contract and the shipped ORM implementation disagree about
  what the behaviour is. The ORM is the authority; a disagreement means the
  contract is wrong and the operator decides.
- Any need to change the wire shape, the endpoint, the config path or the id
  lifetime — contract §3 forbids all four.
- Any need to touch a file outside the tables above.

## Open items

- **`CliRunHooks.onSettled` has no consumer after D4.** Left in place; see
  contract §8. Do not remove it as part of this slice.
- **`packages/cli-engine` gains no new dependency.** `ci-info` stays a bin
  dependency, reached through `Runtime.isCI`. If a dispatch finds itself
  wanting `ci-info` or `node:child_process` in the engine, that is the halt
  signal above, not a judgement call.
