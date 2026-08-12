# S5 overnight run — state at handover

Run started 2026-08-11 evening, unattended. **Every command in the ORM CLI is ported.** Only the cutover remains.

## What is on `main`

| PR | Content |
| --- | --- |
| #29936 | Config per-section diagnostics, `defineConfig` version marker, `ControlClient` test double (the operator's own, taken over and landed) |
| #29970 | The port's foundations + `migration list` |
| #29973 | `migration show|log|graph` + typed next actions in the command layer |

## Open PRs — all built, all green locally

Everything below is **blocked on approval**, not on work. #29978 gates the six port PRs stacked on it.

| PR | Branch | Content |
| --- | --- | --- |
| #29977 | `errors-next-actions` | foundation `nextActions` + `{bin}` templating (independent of the stack) |
| #29978 | `s5-orm-adopt-engine-8` | engine 0.0.8, renderer conversion — **the base of everything below** |
| #29980 | `s5-orm-ref-format` | `ref set\|delete\|list`, `format` |
| #29981 | `s5-orm-contract` | `contract emit\|infer` + the import-anchor defect fix |
| #29982 | `s5-orm-migration-write` | `migration plan\|new\|status` + the four retired flag redirects |
| #29983 | `s5-orm-db-read` | `db schema`, `db init`, `migrate` |
| #29984 | `s5-orm-diagnostics` | `db verify`, `db sign`, `migration check` as completed-with-findings |
| #29985 | `s5-orm-lsp` | language-server injectable transport + `lsp` as a server command |
| #29986 | `s5-orm-db-update` | destructive consent (stacked on #29983, land that first) |
| #29987 | `s5-orm-init` | `init`, engine 0.0.9, the package capability |

## What still needs the operator

1. **Approvals.** Nothing else blocks the merge chain.
2. **A ruling: exit 1 is unreachable from a ported command.** R-S5-31's boundary catch converts every throw; the engine maps every structured failure but a cancelled prompt to 2. `InternalError` is now re-thrown as an interim (restores exit 1 for genuine bugs, no ruling needed), but the broader narrowing — catch only structured errors, re-throw the rest — changes every command's failure behaviour and is a conflict between two ruled rules.
3. **A decision: consent is not bound to the plan it was granted for.** `db update` re-plans after consent and applies under a blanket accept. A post-hoc divergence warning is in; binding it properly needs a control-API change.
4. **`MIGRATION.CONTRACT_SPACE_VIOLATION` and `CONTRACT.MARKER_REQUIRED` each do two jobs**, which is why `db verify --marker-only` still exits 2 on a per-space marker finding. The fix is two codes at each raise site.
5. **An engine defect**, narrowed and reproducible: on 0.0.9 under a real pty, `select`/`confirm`/`consent` work but **`prompt.text` never echoes typed characters**. Affects any consumer, not just this port.
6. **A libpq `host=… dbname=…` connection string** still falls back to the target id for the consent token.

## The recurring hazard, worth fixing at the root

Four separate times, `isolate: false` plus a module mock produced a green suite testing nothing — once spawning a real network install. Every ported test file now imports the command tree inside `beforeAll` after `vi.resetModules()`, and new files are checked under shuffled orderings. The suite is order-dependent **at the base commit too**. Worth its own change.

## Standing rules for whoever continues

- One git worktree per concurrent agent; never two agents in one checkout.
- Findings go in `execution-findings.md`, never a background-task chip.
- Build to the contract's default when something is unpinned; record it; do not stop.
- Verification per PR: full `pnpm build` first (a filtered build leaves stale dist and produces phantom typecheck failures), then package tests, `typecheck`, `lint`, `lint:deps`, `check:error-reference`, journeys.
- Compare every ported command against the commander binary through a pty — the commander auto-selects json off-TTY, so a piped comparison silently compares the wrong thing.
