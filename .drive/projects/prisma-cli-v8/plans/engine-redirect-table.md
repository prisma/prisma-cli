# Plan — engine redirect table

Contract: `../specs/engine-redirect-table.md` (ruled 2026-08-11, §2 amended
the same day — read the amendment list at the top of §1 first; it overrides
the body wherever the two still read differently).

Branch `engine-redirect-table`, off `spec/redirect-table` (PR #141), one PR
stacked on #141 and retargeted to `main` when #141 merges.

## Dispatches

### D1 — the whole surface, verb and flag redirects together

One dispatch. The two halves share the matching table, the error
construction and the replacement rendering; splitting them would leave the
second dispatch wiring a second call site into machinery it did not build.

Outcome: a family can declare retired invocations, and typing one gets a
`CLI.COMMAND_MOVED` envelope naming the replacement instead of a generic
unknown-command or unknown-flag error.

Surfaces in play:

| File | What changes |
| --- | --- |
| `src/command-family.ts` | `CommandRedirect`; `redirects` on the family, optional in, always-present out |
| `src/execution/command-tree.ts` | Merge every family's entries into one table; the four construction-time validations |
| `src/execution/engine.ts` | Consult the table when routing failed; derive the attempted path |
| `src/execution/stricli-adapter.ts` | Intercept `FlagNotFoundError` for flag redirects; reuse `resolveExample` for the replacement |
| `src/execution/settlement.ts` | The `CLI.COMMAND_MOVED` settlement |
| `src/exports/index.ts` | Export `CommandRedirect` |
| `tests/` | Per contract §3 |

Validation gate, all green before commit, judged by pnpm's own exit code:

- `pnpm --filter @prisma/cli-engine test` (its `test` script runs build +
  typecheck + vitest)
- `pnpm --filter @prisma/cli test` — the consumer stays green
- `pnpm typecheck`
- `pnpm lint`

Halt and surface rather than improvise: any point where the contract and the
shipped engine disagree about an existing mechanism beyond what §4's
follow-the-code note settles; any need to touch a file outside the table
above.

## Open items

- The engine's error codes are catalogued nowhere. Eighteen `CLI.*` codes
  ship undocumented; `CLI.COMMAND_MOVED` makes nineteen. Operator ruled
  2026-08-11 that the catalogue waits for project close-out, when the full
  list has settled. Not this PR's work.
- `execution/command-tree.ts`, `execution/stricli-adapter.ts`,
  `execution/settlement.ts` and `execution/engine.ts` all have in-flight
  changes on the Composer and init/shell-retirement branches. Merge down
  from `main` before opening the PR.
