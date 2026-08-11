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

- **A command that hands the terminal to a child still frames its pre-mount
  usage errors as json.** The engine refuses `--json` for such a command
  thoroughly — exit 2, no frames — but that refusal lives in
  `executeMounted`, which a parse or routing failure never reaches. Verified
  empirically on the merged tree: an unknown flag on such a command emits a
  json `CLI.INVALID_ARGUMENTS` frame on stdout, and a retired flag emits a
  json `CLI.COMMAND_MOVED` frame the same way. This predates the redirect
  table and is identical for both settlements, so the redirect work
  introduces no new divergence. Guarding only the redirect settlement would
  make the two siblings disagree, which is why it was not done here. The
  question — whether that refusal should cover failures that never reach the
  command — belongs to whoever owns the `--json` refusal next.

- **A re-mount silently kills a redirect, and nothing fails at construction
  to say so.** `from` is an absolute path in the shell's tree, so it is a
  fact about the shell, declared in family code. If the shell later moves a
  group, the family's redirects stop matching and every check still passes —
  construction cannot catch it, because a `from` naming something that does
  not exist is the normal case. The operator ruled this trade-off knowingly
  on 2026-08-11 when choosing family-declared redirects over shell-mounted
  ones; the review surfaced it independently. Carry it to the ORM port: a
  regroup means re-reading the redirect table by hand. Say so in the PR.

- The engine's error codes are catalogued nowhere. Eighteen `CLI.*` codes
  ship undocumented; `CLI.COMMAND_MOVED` makes nineteen. Operator ruled
  2026-08-11 that the catalogue waits for project close-out, when the full
  list has settled. Not this PR's work.
- `execution/command-tree.ts`, `execution/stricli-adapter.ts`,
  `execution/settlement.ts` and `execution/engine.ts` all have in-flight
  changes on the Composer and init/shell-retirement branches. Merge down
  from `main` before opening the PR.
