# Brief: serve deployment logs over HTTP (for the platform/control-plane team)

Written 2026-08-13, for an agent working in `pdp-control-plane` with
no prior context on the CLI project. Operator: Will Madden.

## The ask, in one paragraph

Add an HTTP variant of the deployment-logs endpoint: the same
log/terminal records `GET /v1/deployments/{deploymentId}/logs`
streams over its WebSocket today, served instead as newline-delimited
JSON over a plain authenticated `GET`, keeping the `cursor` resume
semantics and the in-band terminal record. This was agreed in
principle on 2026-08-12 (team answer, via Will): **"HTTP instead of
WebSockets would be acceptable, as long as we can add live streaming
at a later date."** This brief is the concrete version of that ask.

## Why the CLI needs it

The v8 Prisma CLI (repo `prisma/prisma-cli`, built on
`@prisma/cli-engine`) must ship a `service deployment logs` command —
the last unported command in its entire surface. The old
implementation reached around the engine: it took a raw token and let
`@prisma/compute-sdk`'s `streamLogs` build a `wss:` URL and set the
Authorization header itself. The CLI's credential model now forbids
that — credentials never reach command code; the engine holds them —
so the command was shelved rather than shipped
(see the CLI-side design doc below).

The CLI's engine speaks HTTP only. Its `build logs` command already
consumes the sibling build-logs endpoint as a streamed HTTP response
(`packages/cli/src/v8/build/logs.ts` in prisma-cli — openapi-fetch,
`parseAs: "stream"`, NDJSON lines). If deployment logs serves the
same shape, the CLI needs zero new transport machinery and the
engine's WebSocket affordance stays unbuilt. That design exists and
is deliberately shelved as the future live-streaming path:

- **CLI transport design (read §5 and §7):**
  <https://github.com/prisma/prisma-cli/blob/main/.drive/projects/prisma-cli-v8/assets/engine/websocket-transport-design.md>
  §7's question 2 ("could this be plain HTTP?") is the question your
  team answered yes to; §5 records why reconnection-across-segments
  must survive in whatever transport ships.

## What exists on your side (verified against the repo, HEAD `deb158e4e`)

- **The route** is WebSocket-only. Spec text in
  `packages/management-api-sdk/src/api.d.ts` under
  `"/v1/deployments/{deploymentId}/logs"`: upgrades to a socket;
  messages are `type: "log"` (text + byte metadata) or
  `type: "terminal"` (end-of-segment with reconnect cursor); the
  stream ends after 10 minutes; reconnect with `cursor`.
- **The interactor** `packages/interactors/src/compute/streamLogs.ts`
  is a poll relay, not a push source: it polls Foundry's VM logs
  every `DEFAULT_POLL_INTERVAL_MS = 1_000`, chunks tails at
  `TAIL_CHUNK_SIZE = 10_240` (a Unikraft limit, per its comment),
  runs `SEGMENT_DURATION_MS = 10 * 60 * 1_000` segments, defaults to
  `DEFAULT_TAIL_LINES = 100`, holds a lease via
  `computeLogStreamLease.repository.ts`, and maps Foundry's 424 (no
  VM assigned / deallocated) explicitly. Record shapes:
  `LogLine { type: "log"; text; byteStart; byteEnd }` and
  `TerminalLine { type: "terminal"; kind: "end" | "error"; code;
  message; retryable; cursor; details? }`.
  Architecture: `docs/architecture/adrs/ADR-002-compute-log-relay-architecture.md`.
- **The template already in your repo**:
  `packages/interactors/src/compute/streamBuildLogs.ts` feeds the
  build-logs endpoint the CLI consumes over plain HTTP today. The
  deployment-logs HTTP variant is that shape fed by `streamLogs`.

Because the source is a 1-second poll relay, serving it over a
streamed HTTP response loses nothing real — there is no push
latency to preserve. Genuine live streaming stays a later upgrade,
which is exactly what the 2026-08-12 answer reserved.

## Contract the CLI will consume (pin this before shipping)

1. Authenticated `GET` (Authorization header; same credential as the
   rest of the management API — no token in the URL, ever).
2. Response: newline-delimited JSON; each line one record with the
   EXISTING shapes — `type: "log"` and `type: "terminal"` unchanged.
   The CLI maps `terminal.kind`/`retryable` onto its settlement, so
   the terminal record must arrive in-band, including on the routine
   10-minute segment end (`kind: "end"` with a `cursor`).
3. `cursor` query parameter resumes a segment chain; a `tail`
   parameter for initial history if the WS contract exposes one
   (interactor default is 100 lines).
4. The endpoint lands in the management-api OpenAPI spec so the
   generated SDK (`@prisma/management-api-sdk`) exposes it — the CLI
   consumes it through that SDK's types, not a hand-built URL.
   Whether it is a new path or content negotiation on the existing
   one is your call; the CLI only needs it addressable through the
   generated client.
5. Still marked experimental is fine. Tell the CLI project when the
   contract is pinned and when it deploys — that unshelves the
   command.

## CLI-side context, for pointers rather than action

- **Project plan** (S8 section records the whole history of this):
  <https://github.com/prisma/prisma-cli/blob/main/.drive/projects/prisma-cli-v8/plan.md>
- **The slice contract that ruled logs out of the last slice**
  (R-S8-5 records the 2026-08-12 answer verbatim):
  <https://github.com/prisma/prisma-cli/blob/main/.drive/projects/prisma-cli-v8/specs/s8-services.md>
- **The open-items file** (entry "Left open by S8": the logs
  follow-up and what unblocks it):
  <https://github.com/prisma/prisma-cli/blob/main/.drive/projects/prisma-cli-v8/deferred.md>
- **The consumer template the CLI will copy**:
  <https://github.com/prisma/prisma-cli/blob/main/packages/cli/src/v8/build/logs.ts>
  (`ctx.api.GET(..., parseAs: "stream")`, line-parsed records).

The shelved CLI handler (reviewed and green before shelving) is in
prisma-cli's `s2c-services` branch history; the CLI team restores and
reshapes it against your pinned contract, with fixture-driven tests —
so the CLI side can land before your deploy and light up when the
endpoint ships.
