# S2b2 — Domain extraction (slice contract)

One PR into `main`, branch `s2b2-domain-extraction`, after S2b merges and **before S2c**. Gives the ported commands a domain layer of their own, so the engine tree stops reaching into the commander shell's abstractions.

Sequenced before S2c because S2c adds four more command groups against the same operation layer. Every symbol not moved now is moved later with more callers attached.

## Why now, and not during S2b

S2b deliberately re-homed invocation without rewriting operations: doing both at once would have mixed a runtime migration with a behavioural rewrite and made the parity record uncheckable. That trade was right, and it is now spent. The 1,007 tests S2b added assert the ported commands' behaviour from the outside, so changing what sits underneath them is verifiable in a way it was not before. This slice is the second half of that plan.

## The problem

53 of the 61 files under `src/v8/` import from the commander shell's tree — 40 distinct symbols across `controllers/`, `presenters/`, `lib/`, `shell/` and `adapters/`. Three specific harms:

1. **`CliError` and `usageError` come from `src/shell/errors.ts`** — 20 imports into a directory S2d deletes. S2d cannot delete it while the engine tree depends on it.
2. **`controllers/` and `presenters/` are the old shell's shapes**, not shapes the engine tree would choose. A controller is a commander command body; a presenter renders for a shell that is going away.
3. **Domain logic is trapped inside those shapes.** `resolveDatabase`, `resolveProjectTarget`, `parseUsageDate` and their kin are domain rules that have nothing to do with either CLI, and they are only reachable because S2b added `export` to them.

## The constraint that shapes the work

**The commander shell still runs.** It serves `app`, `service`, `build`, `agent`, `feedback` and `init` until S2d retires it, and it calls the same controllers. So this is extract-and-repoint, not extract-and-delete: a moved symbol gets one home and **both** trees call it. Nothing is duplicated, and no controller is deleted in this slice.

## Target shape

```text
src/errors.ts            CliError, usageError — out of shell/
src/domain/<area>/       extracted domain rules, no CLI in them
src/api/<area>/          the management-API providers, relocated from lib/*/provider.ts
src/v8/<group>/          command definitions, handlers, presentation (unchanged)
src/controllers/         thinner; commander command bodies only; dies at S2d
src/presenters/          untouched; shell rendering only; dies at S2d
```

## Mapping rules

R-X-1 **The error base moves first, on its own commit.** `CliError` and `usageError` move from `src/shell/errors.ts` to `src/errors.ts`, with `shell/errors.ts` re-exporting them so the shell's own imports are untouched. Every `src/v8/**` import repoints. Nothing else changes in that commit.

R-X-2 **Domain rules move to `src/domain/<area>/`.** These 12, named because they are domain logic reachable only through a controller today: `resolveDatabase`, `sortDatabases`, `ensureProjectId`, `parseUsageDate`, `parseBackupLimit` (database); `resolveScopeToApi`, `formatScopeFlag`, `toMetadata`, `runEnvAddFile`, `runEnvUpdateFile` (env); `listRealWorkspaceProjects`, `readProjectListLocalBinding`, `cleanupLocalPinForProject` (project). The controller keeps a re-export only where the shell still calls it; no logic is copied.

R-X-3 **Providers relocate to `src/api/<area>/`.** `lib/database/provider.ts`, `lib/bucket/provider.ts`, `lib/project/provider.ts`, `lib/app/app-provider.ts`. These are already the right shape — they talk to the management API and know nothing about either CLI — so this is a move and a rename, not a rewrite. No behaviour change.

R-X-4 **The serializers are reimplemented, not moved.** The eight legacy `serialize*` functions and the label formatters (`scopeLabel`, `listTargetLabel`, `formatGitConnectionDetail`, `formatScopeLabel`, `shortenHomePath`) exist to render for the commander shell. The engine tree already owns its presentation in `src/v8/<group>/presentation.ts`, and that is where the json shape belongs. Each is reimplemented there against the same result type and the same output, then the v8 import is dropped. The legacy copy stays for the shell.

R-X-5 **No behaviour changes.** This slice is a move. Any output difference is a defect, not a divergence — the divergence list gains nothing. The one exception: where a moved symbol carries a fault already recorded against it, fix it and say so.

R-X-6 **`src/auth/**` is not touched.** The auth stream owns it and v8 importing its public modules is sanctioned. `SERVICE_TOKEN_ENV_VAR`, `performLogin`, `environmentCredentialInForce` and `WorkspaceSelectionError` stay as they are.

R-X-7 **Both trees stay green throughout.** The legacy shell's tests are the check that extraction did not change behaviour, and they run on every commit. A commit that moves a symbol repoints every caller in the same commit.

R-X-8 **The legacy-context adapter dies with the extraction.** `src/v8/project/context.ts` fabricates a shell `CommandContext` so v8 can call legacy functions. Every function it feeds is in R-X-2's list, so once those take a plain argument list the adapter has no callers and is deleted, along with the proxy that guards it.

## Out of scope

Deleting `controllers/` or `presenters/` (S2d). The `v8/` directory name, which outlives its contrast at S2d. Consolidating the five near-identical error mappers, and extracting the shared test harness — both wait for S2c, which adds four more of each. Anything under `packages/cli-engine`.

## Acceptance

- [ ] No file under `src/v8/**` imports from `src/shell/`, `src/controllers/` or `src/presenters/`. Enforced by a test, not by inspection.
- [ ] `src/v8/project/context.ts` and its proxy are gone.
- [ ] Every symbol in R-X-2 and R-X-3 has exactly one definition; the shell reaches it through the new home.
- [ ] The legacy shell's own tests pass unchanged — no legacy test is edited to accommodate a move.
- [ ] Root verification green; the ported commands' tests pass without modification, which is what proves the extraction was behaviour-preserving.
