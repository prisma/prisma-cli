# S2a dispatch plan — foundations

Contract: `../specs/s2a-foundations.md` (normative for this PR; the
overview `../specs/s2-overview.md` carries the standing rulings). One
branch `s2a-foundations` off `main`; the PR targets `main`. Every
dispatch verifies: engine + cli suites, `pnpm typecheck`, `pnpm lint`
exit 0 (measured as pnpm's own exit code), before its commit lands.
Commit discipline per the repo's standing rules (bot identity, dual
sign-off, explicit staging).

The contract leaves no design decisions to dispatches. Where a
dispatch meets a fact the contract did not pin, it STOPS and returns
the question to the orchestrator — never improvises.

## Dispatches (sequential)

### D1 — Publish metadata + production dependency

**Outcome:** contract §1 exactly: cli-engine publish metadata
(version 0.1.0, license file, README, publishConfig, repository,
prepack), `@prisma/cli-engine` in the cli's `dependencies`.
**Builds on:** merged S1.
**Hands to:** the operator's manual `npm publish`; every later
dispatch.
**Completed when:** `npm pack --dry-run` in packages/cli-engine lists
dist + README + LICENSE and nothing else; cli builds green with the
dependency move. THIS DISPATCH LANDS FIRST AND ALONE — the operator
publishes from it while later dispatches proceed.

### D2 — Auth module extraction

**Outcome:** contract §3: the three moves, `src/auth/index.ts` as the
single face with the exact export list, workspace operations extracted
from the controller, `makeGetCredentials` relocated, every importer
updated. Zero behavior change — the full existing cli suite passes
unmodified except for import paths in tests that mock the moved
modules.
**Builds on:** D1.
**Hands to:** D3 (getCredentials seam), D6 (the family port's
operations layer).
**Completed when:** legacy shell + v8 bin green; no import of
token-storage/auth-ops/client outside `src/auth/`.

### D3 — `ctx.api` + harness client override

**Outcome:** contract §2: SDK dependency exact-pinned in engine and
cli, `Runtime.managementApi`, lazy `ctx.api`, `CLI.CREDENTIALS_REQUIRED`
reuse on unauthenticated use, harness `managementApi.client` override,
draft amendments (§4, §10, §11), the four contract-listed tests.
**Builds on:** D2 (baseUrl source moved to `src/auth/client.ts`).
**Hands to:** D6 and every S2b/S2c port.
**Completed when:** contract §2 tests green; dist `.d.ts` shows
`api: ManagementApiClient` and no direct SDK type names beyond the
re-export alias.

### D4 — Clack prompt renderer

**Outcome:** contract §7: the adapter, the branch condition, the
draft notes, the fixture-driven clack-path tests. Reference: spike
branch `spike/clack-prompts` commit 903b25a (reimplement cleanly).
**Builds on:** D1 only (independent of D2/D3 — may run after D1 in
parallel with D2 if the orchestrator chooses; file overlap is nil).
**Hands to:** D6's `workspace use` prompt; S2d's wizard.
**Completed when:** all engine prompt tests green including the new
clack fixture suite; scripted/non-TTY paths proven clack-free.

### D5 — Telemetry package + engine hook + bin wiring

**Outcome:** contract §6: `packages/cli-telemetry` ported with the
preserved invariants, `EngineCommandSnapshot`, `RunHooks.onSettled` +
draft amendment, bin gating + detached sender, `telemetry
status|enable|disable` commands, the four contract-listed test areas.
**Builds on:** D3 (hook shape rides the same engine surface); D4 not
required.
**Hands to:** S2b/S2c ports (every command reports automatically).
**Completed when:** contract §6 tests green; a manual smoke run shows
the sender spawn under an enabled config and NO spawn under CI env.

### D6 — `auth *` family + update check + slice closure

**Outcome:** contract §4 (six commands, semantic tests, fixture-flag
removal, AUTH.* error mapping) and §5 (update-check move + both-shell
wiring). The S1 whoami handler rewires to `src/auth/index.ts`.
Divergence list updated (new: login flag removals, error-code
mapping, any update-check json-mode finding per §5). The PR
description is drafted per the operator's PR-description structure
(grounding example first, decision, narrative, alternatives last).
**Builds on:** D2, D3, D4 (prompt path), D5 (telemetry observes the
new commands automatically).
**Hands to:** operator review of the S2a PR; S2b.
**Completed when:** every acceptance box in the contract checks
except the operator-publish box (checked when the operator publishes);
review loop (architect + principal-engineer per the drive process)
run and findings fixed; PR opened non-draft.

## Completeness check

D1 → §1; D2 → §3; D3 → §2; D4 → §7; D5 → §6; D6 → §4 + §5 + closure.
Every contract section is owned by exactly one dispatch; the
acceptance boxes map 1:1 onto dispatch completion criteria plus the
review loop.
