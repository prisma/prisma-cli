# S8 — Service primitives (slice contract)

Status: rev 1 (2026-08-12) — design settled in operator discussion,
2026-08-12; rulings recorded in §Dispositions. One PR into `main`,
branch `s8-service-primitives`. Repo: prisma-cli only.

Gives the platform's service resources the atomic CLI surface the
plan describes: the resource model the Management API already draws
(**Composer produces deployments; the CLI manages them**), replacing
the shape S2c ported for continuity. Mostly a rename plus filling
holes — the expensive parts (engine, auth, presenters, error model,
the `service` noun) are done.

Normative sources and precedence as in `s2c-services.md`; S2b/S2c
mapping rules apply unchanged (namespace `SERVICE.*`). Unpinned facts
are STOP-and-surface.

## The command tree

```text
service list                    NEW   GET /v1/apps
service create                  NEW   POST /v1/apps
service show | open | remove          as today
service domain add|show|remove|retry|wait   as today
service deployment list         was: service list-deploys
service deployment show         was: service show-deploy
service deployment promote      was: service promote
service deployment rollback     was: service rollback
service deployment start        NEW   POST /v1/deployments/{id}/start
service deployment stop         NEW   POST /v1/deployments/{id}/stop
service deployment delete       NEW   DELETE /v1/deployments/{id}
```

## Mapping rules

R-S8-1 **The `deployment` subgroup.** `list-deploys`, `show-deploy`,
`promote`, `rollback` move under `service deployment` as
`list|show|promote|rollback`. The old spellings are DELETED — no
aliases (ruled: v8 is pre-rc, there is no compatibility debt; each
rename is a divergence entry). All paths, ids, help, presenters.

R-S8-2 **The five new commands**, all result commands on existing
endpoints, presenters in the established `service` style:

- `service list` — `GET /v1/apps`, table shape per `project list`
  precedent.
- `service create` — `POST /v1/apps`; args from the create body the
  API takes and Composer/legacy both send (`displayName`, project,
  optional region, optional branch — the four fields, nothing else;
  grounded in `ComputeService.ts:94-105` and
  `app-provider.ts:1037-1045`). Ends the state where a service can
  only be born as a side effect of deploying to it.
- `service deployment start|stop` — `POST /v1/deployments/{id}/start`
  / `stop`. The API states the artifact must be uploaded before
  `start`; the failure maps to a structured error, not a precondition
  the CLI invents.
- `service deployment delete` — `DELETE /v1/deployments/{id}`.
  Destructive: consent prompt per the `service remove` precedent
  (R-S2b-3).

R-S8-3 **Two presenter corrections**, in files this slice rewrites
anyway (both wrong today for Composer-deployed services):

- `service deployment show`'s `url`: for the LIVE deployment, the
  promoted `appEndpointDomain` — Composer reports the promoted
  address at deploy time, so the CLI must not show a different URL
  than the deploy did (`app-provider.ts:735`; `listDeployments`'s
  per-row preview domains at `:701` stay — identical promoted URLs
  on every row would be wrong, and no presenter renders that field).
  For a NON-live deployment, its own `previewDomain` — the promoted
  domain does not serve it (amended after D1, 2026-08-12: the
  original flat "always `appEndpointDomain`" violated its own
  rationale for non-live deployments).
- Local CLI live-state is RETIRED in both directions: the read
  fallback (`readKnownLiveDeployment`, `target.ts:400-448`) and the
  writes (`setKnownLiveDeployment` in promote/rollback) go. `live`
  derives from the service's `latestDeploymentId` alone. (Amended
  after D1, 2026-08-12: the premise "only legacy `app deploy` wrote
  that state" was falsified — v8 promote/rollback wrote it too;
  nothing in v8 reads it, so the writes are dead and go with the
  reads. Divergence entry.)

R-S8-4 **No Composer-ownership note** (ruled, 2026-08-12): `promote`,
`rollback`, `start`, `stop` print no "Composer will overwrite this"
warning. Users have full ownership of their resources; Composer
reconciling manual changes on the next deploy is accepted behavior.
Grounding fact: nothing in the app/deployment records identifies a
service as Composer-managed anyway — the only fingerprint is the
`COMPOSER_*` env-var namespace on the branch, which the CLI never
fetches. Revisit later; not now.

R-S8-5 **`service logs` stays shelved** (ruled, 2026-08-12). The
transport question is ANSWERED (API owners via operator, 2026-08-12):
**HTTP instead of WebSocket is acceptable, provided live streaming
can be added at a later date.** So no engine socket transport is
built — `service logs` returns as a copy of `build logs` (plain
HTTP, `parseAs: "stream"`) in a follow-up slice once the endpoint
serves HTTP. The engine WebSocket design
(`assets/engine/websocket-transport-design.md`) is shelved as the
later live-streaming path, not deleted. Nothing in this slice builds
the command; the shelved handler in the `s2c-services` history
remains the starting point.

R-S8-6 **What this slice depends on.** Every endpoint above is
marked experimental in the Management API specification. The slice
depends on: `GET/POST /v1/apps`, `GET/DELETE /v1/apps/{id}`,
`GET /v1/apps/{id}/deployments`, `GET/DELETE /v1/deployments/{id}`,
`POST /v1/deployments/{id}/start|stop`, `POST /v1/apps/{id}/promote`
— the CRUD-and-lifecycle set, and deliberately NOT the logs
endpoint (the one known to carry a transport question). A breaking
change to any of these is absorbed at the provider layer
(`app-provider.ts`), not in command shapes.

## Out of scope

`service logs` and the engine WebSocket transport (R-S8-5); any
Composer-managed marker or API ask for one (R-S8-4); `service
deploy`/`service build`/`service run` (dropped in S2c, superseded by
Composer — not coming back); S7's grammar-tree completeness check
(this slice changes the tree; S7 checks it).

## Pre-investigated edge cases

- An app created but never promoted carries a placeholder
  `appEndpointDomain` that does not resolve (`Deployment.ts:129-132`)
  — `service show`'s `live url` and `service create`'s output must
  not present a dead URL as live. Present the domain only when a
  live deployment exists (`latestDeploymentId` set).
- `DELETE /v1/deployments/{id}` against the currently-promoted
  deployment: ANSWERED during D3 (2026-08-12), from the control
  plane's source (`pdp-control-plane`,
  `packages/interactors/src/compute/deployment.ts:494-522` and
  `tearDownDeployment.ts`; integration tests pin the order
  detach-endpoint → stop → delete). The API permits it and handles
  liveness by teardown, not refusal; `latestDeploymentId` is cleared
  in the same transaction. No CLI-side guard. Consequence for the
  divergence file: the server does NOT clear the service's
  `endpointDomain`, so after deleting the live deployment the
  service keeps a non-resolving domain — already neutralized in the
  CLI because every S8 presenter reports a live url only when
  `latestDeploymentId` is set. Caveat: read from a checkout one
  minor ahead (SDK 1.56.0 vs the pinned 1.55.0); shape unchanged
  across the drift.

## Acceptance

- [ ] The tree above is the whole `service` grammar: old spellings
      gone, subgroup mounted, five new commands green through the
      harness (byte-asserted presenters, envelope + exit codes, the
      R-S2b-9 matrix where a command streams nothing).
- [ ] `service create` proven against the real API end to end
      (e2e suite), including the no-region and no-branch defaults.
- [ ] Consent prompt on `service deployment delete` per the
      `service remove` precedent.
- [ ] R-S8-3's two presenter corrections, pinned by test.
- [ ] Divergence entries (`assets/s2/parity-divergences-s8.md`): the
      four renames, the deleted spellings, the `live` derivation
      change, the `url` change.
- [ ] `deferred.md` updated: the ownership-note revisit (R-S8-4) and
      the logs follow-up slice (R-S8-5) recorded.
- [ ] Suites green: `pnpm --filter @prisma/cli test`,
      `pnpm --filter @prisma/cli-engine test`, `pnpm typecheck`,
      `pnpm lint`.

## Dispositions

Design discussion (operator + architect lens, 2026-08-12), settling
the plan's four questions:

1. Ownership note: NOT NOW (R-S8-4). Alternatives rejected: warn
   unconditionally (noise on non-Composer services); ask the API for
   a `managedBy` field (deferred with the revisit — no marker exists
   today, verified against the create bodies and both record
   schemas).
2. Records content: verified — Composer and legacy `app deploy` send
   identical create bodies for apps and deployments; presenters
   render nothing Composer fails to populate, except the two
   corrections R-S8-3 folds in.
3. Log reading: the plan's ownership conflict DISSOLVED on
   investigation — `composer log` attaches to the local dev daemon's
   streams (`execute-log.ts`), a `service deployment logs` would
   read the platform endpoint. Different data, no shared subgroup.
   Shelved per R-S8-5 regardless, pending the transport answer.
4. Transport: ANSWERED (API owners via operator, 2026-08-12). HTTP
   is acceptable in place of the WebSocket, as long as live
   streaming can be added later. Consequence: the engine socket
   affordance is not built; `service logs` follows the `build logs`
   HTTP shape once the endpoint serves it; the socket design shelves
   as the future live-streaming path.
