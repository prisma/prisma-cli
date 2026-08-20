# Parity-divergence records — validation against rc.6 (2026-08-20)

The project keeps five parity-divergence records, each listing where the v8 CLI knowingly differs from the legacy CLI. This report checks their concrete claims against the code at `main` (8.0.0-rc.6). Verdict per record below; the records themselves are left untouched because the cumulative one is operator-ratified.

**Bottom line: every ratified decision still holds.** All six signed-off items and the class-level rules (dotted error codes, exit 2/3, `--trace` removal, the renames and removals, no `version` command) are accurate in today's code. What has gone stale is description, not decisions: later slices renamed the `service` grammar, shipped the shelved `service logs`, flattened the `src/v8/` tree, and bumped pinned versions, and the records were not updated to match.

## `s2/parity-divergences.md` — cumulative S2 record, ratified 2026-08-12

Signed-off items 1–6 all verified as still true, including the three escalated engine gaps (`build logs` cannot exit 1; a service token whose workspace only the server knows is refused; the crash-recovery feedback action is absent). Stale content:

1. **The S2c `service` rename tables are outdated.** S8 restructured the group: `service list-deploys`, `service show-deploy`, `service promote`, `service rollback` are gone, replaced by the `service deployment` subgroup. `service list` and `service create` are new commands with no divergence entry. The consent-point count ("two, later three") is now four (`service remove`, `service domain remove`, `service deployment rollback`, `service deployment delete`).
2. **`service logs` is recorded as shelved but ships.** It mounts at `service logs` and polls the Management API (no WebSocket). Everything the record says "went with the command" is back: its test file, `SERVICE.DEPLOYMENT_DETACHED`, `SERVICE.DEPLOYMENT_OUTSIDE_PROJECT`. The "one real capability loss of the pass" claim in the shell-deletion section no longer holds. The current contract is `specs/service-logs.md` + `s2/parity-divergences-service-logs.md`.
3. **D3 entry 41 is no longer true**: the `PROJECT_AMBIGUOUS` next step no longer says `app deploy` verbatim; it now offers `project list` / `project link <id>` (`resolution.ts:271`).
4. **File citations are dangling**: every `src/v8/…` path (tree flattened at shell deletion), every `src/shell/…` path (deleted), the `v8-` test-file prefixes, and the bin path `dist/v8/cli.js` (now `dist/cli.js`).
5. **One unswept `--trace` path**: five groups rewrite `--trace` out of legacy error prose, but `commands/service/errors.ts` does not, and legacy prose reachable through it still mentions `--trace` (`provider.ts:181`). Worth a small fix or a divergence entry.

## `s2/parity-divergences-s3.md` — composer

All behavioural entries verified in the shipping `@prisma/composer-cli` 0.10.0: mounting, the help-examples defect (still unfixed, deferral correct), `deploy --production` dropped while `destroy` keeps it, structured child output, exit-code semantics, config-path handling, the effect-resolution preflight. Stale:

1. **Version pins**: the record cites `@prisma/composer@0.6.0-dev.16`; the CLI now pins `composer-cli`/`composer` 0.10.0 (dev pins removed by #192). The examples also live in `@prisma/composer-cli`'s `dist/family.mjs`, not `@prisma/composer`'s.
2. **Near-expiry sessions are refreshed, not refused.** #183 changed `credentials: "child"` to rotate and persist a refreshable session inside the near-expiry window; only unrefreshable credentials are refused. The record still says close-to-expiry is "refused up front".
3. **The "legacy" baseline no longer runs anywhere.** The published `prisma-composer` bin is now the same engine and family mounted at top level; the clipanion shell the record's legacy column describes is gone. The comparisons stay valid as history, but cannot be reproduced against today's `prisma-composer`.

## `s2/parity-divergences-s7.md` — release

Mostly holds (no shipped command moved; the ORM redirect table ships). Stale:

1. It lists `prisma init` as an ORM-family mount. The ORM initializer was ruled to `orm init` (operator, 2026-08-12); top-level `init` is the platform's compute-config wizard.
2. "Eight `@prisma/orm-framework` subpaths" is now twelve in the pinned `orm-toolchain` 8.0.0-rc.4. The `arktype`/`esbuild` static-import complaint still stands.

## `s2/parity-divergences-s8.md` — services

Verified almost entirely accurate: the `service deployment` grammar with no aliases, command ids, consent rules (`deployment delete` requires the id as confirmation token and `--yes` cannot grant it), live-URL derivation, the retired local live-deployment cache, `service create`'s branch resolution and 409 handling. One mis-scoping:

1. The "narrower than the contract" caveat (live deployment must appear in the listing page) is attributed to `service show`, but lives in the shared `resolveCurrentLiveDeploymentId` (`target.ts:430`), so it equally applies to `service deployment list`, `service logs`, `service open`, and `service deployment promote`.

## `s2/parity-divergences-service-logs.md` — service logs

Fully accurate. Mount point, transport (NDJSON pages, 2 s `--follow` poll), flags and their conflict error, cursor/incomplete/failed error codes, single retry with budget reset, interrupt exit 130 — all verified. Two footnotes: the test-only `PRISMA_CLI_SERVICE_LOGS_POLL_MS` override is undocumented, and the unused WebSocket path (`streamDeploymentLogs`) still exists in the provider with no caller.
