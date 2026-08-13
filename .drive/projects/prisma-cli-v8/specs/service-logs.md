# service logs (slice contract)

Status: rev 1 (2026-08-13). One PR into `main`, branch
`service-logs`. Repo: prisma-cli only. Unshelves the S2c `service
logs` command against the platform's new HTTP page-read contract
(pdp-control-plane PR #4886, the base for this slice).

Operator rulings carried in: the command mounts as **`service logs`**
(legacy spelling — ruled 2026-08-13, recorded in `deferred.md`); no
engine WebSocket transport (R-S8-5; the WS live tail stays the
platform's, unused by the CLI until the live-streaming date).

## The endpoint contract (PR #4886, pinned)

`GET /v1/deployments/{deploymentId}/logs`, authenticated, plain GET:
one request returns ONE PAGE as `application/x-ndjson` — records
`{type:"log", text, byteStart, byteEnd}` — and ends with
`{type:"terminal", kind:"end"|"error", code, message, retryable,
cursor}` before closing. Query: `tail=N` (last N lines, default
100), `from_start=true` (page from the beginning), `cursor`
(continue a chain; the terminal record's cursor is the next start).
No held-open connection; the WebSocket upgrade on the same path is
out of scope for the CLI.

## The command

`service logs [<service>] [--service name] [--project id-or-name]
[--deployment id] [--tail n] [--from-start] [--follow]`

- Session command in the platform family's service group. Target
  resolution ports VERBATIM from the shelved S2c handler
  (`bot/s2c-services`, `packages/cli/src/v8/service/logs.ts`):
  explicit `--deployment` resolved globally then checked against the
  project; otherwise the service's live deployment; the S2c error
  shapes (`deploymentNotFoundError`, `deploymentOutsideProjectError`,
  `noDeploymentsError`, …) return with it. The dead parts do NOT
  port: `streamLogs`/compute-sdk, `getApiBaseUrl`,
  `logStreamCredentialsError` (no credential ever reaches the
  command — the transport is `ctx.api`).
- **Default: one page, then exit 0** — `tail` 100 like the endpoint,
  the kubectl-logs shape. `--tail n` passes through; `--from-start`
  maps to `from_start=true` (constructing it with `--tail` is a
  parse-time conflict). A routine terminal record (`kind:"end"`)
  ends the page; its cursor is not surfaced (the CLI owns resume).
- **`--follow`**: after each `kind:"end"` terminal record, wait the
  poll interval and re-request with that record's cursor; run until
  the user interrupts (the engine settles 130 from its signal
  record, as `dev` does). Poll interval 2 s on the injectable clock.
- Records map per `build logs` (R-S2c-2): `type:"log"` → `output`
  events, channel `data`; json mode frames them (session kind).
  `type:"terminal"` with `kind:"error"` → structured error carrying
  the record's code/message, exit non-zero; `retryable: true` on an
  error terminal in `--follow` mode retries ONCE after the interval,
  then fails (do not loop on a persistent error).
- Transport: `ctx.api.GET("/v1/deployments/{deploymentId}/logs",
  { parseAs: "stream", params: { query: ... } })` — the `build logs`
  shape, line-split NDJSON, tolerant of a final partial line.

## The SDK risk — RETIRED at D1 (the premise was wrong)

Rev 1 claimed the pinned SDK types this path's `query` as `never`.
That read the path-item boilerplate (identical on every path); the
OPERATION type (`getV1DeploymentsByDeploymentIdLogs`,
`dist/index.d.ts:6188` in `@prisma/management-api-sdk@1.55.0`)
already publishes `tail?: number`, `from_start?: "true" | "false"`
(a string union — the command sends `"true"`), and
`cursor?: string`. Verified empirically at D1 under `pnpm
typecheck`. The stream body keeps `build logs`' established cast
(the spec documents no 200 body); no new cast kind.

## D1 amendments (implementer decisions, orchestrator-ratified)

- The `--tail`/`--from-start` conflict refuses at HANDLER TOP per
  the `project transfer` precedent (the engine has no declarative
  flag-conflict mechanism), as `SERVICE.LOGS_RANGE_CONFLICT`, exit
  2, before any request.
- The poll interval is `PRISMA_CLI_SERVICE_LOGS_POLL_MS` per the
  `service domain wait` precedent — the engine's delay seam is not
  reachable from `CommandContext`; exposing it is an engine change
  this slice does not make.
- `build logs`' private NDJSON reader moved to `lib/ndjson.ts`,
  shared by both commands — an extraction, not a behavior change;
  duplicating chunk-boundary handling is the drift class the S8
  workspace-filter defect came from.
- Follow-mode retry: a retryable error terminal is retried once per
  FAILURE, with the budget reset by any successful page — a long
  follow survives repeated transients but never loops on a
  persistent error.
- e2e: `EXCLUSIONS` (needs a Composer-deployed service), matching
  the S8 lifecycle commands — supersedes acceptance item 6's
  "backlog" wording.

## Out of scope

The WebSocket live tail (later date, platform's move); any engine
transport work; `composer log` (different data source — the local
dev daemon); changes to `build logs`.

## Acceptance

- [ ] `service logs` mounted (legacy spelling), group help updated;
      grammar per above with the `--tail`/`--from-start` conflict at
      parse time.
- [ ] Page mode: fixture-backed tests for tail default, `--tail`,
      `--from-start`, explicit `--deployment`, the S2c resolution
      errors, unframed data output, json framing, and the error
      terminal record → structured error.
- [ ] Follow mode: fixture drives page → end(cursor) → page →
      interrupt on the injectable clock; cursor passed correctly;
      retryable-error single retry pinned; interrupt settles 130.
- [ ] Divergence entry (`assets/s2/parity-divergences-s8.md` gains a
      follow-up section or a new sibling file): default is page-read
      (legacy followed); `--follow` is polling, not push.
- [ ] `deferred.md`'s logs entry closes; e2e joins the
      deployed-service backlog beside `service open`.
- [ ] Suites green sequentially; typecheck + lint exit 0.
