# S2c — Services (slice contract)

One PR into `main`, branch `s2c-services`, after S2b merges. Ports the
deployment-and-delivery groups: `service *` (renamed from `app`, incl.
`domain`), `build logs`, `agent *`, `feedback`.

Normative sources and precedence as in `s2b-resources.md`; S2b's
mapping rules R-S2b-2/3/4/5/6/9/10 apply here unchanged (with
namespace `SERVICE.*`, `BUILD.*`, `AGENT.*`, `FEEDBACK.*`). Additional
rules:

R-S2c-1 **Rename**: `app` ports as `service` (ruled: the deployable
unit's noun is Service). All paths, ids, help, presenters. No alias.
Divergence entry per command.

R-S2c-2 **Streams** (`service logs`, `build logs`): session commands.
Records map to `output` events — the inventory's per-record
`source`/`level` routing maps channel `data` (stdout) vs `diagnostic`
(stderr); json mode frames them (the legacy JSON wrapper-event opt-out
for `build logs` does not port — the engine stream IS the json
surface; divergence entry). `build logs` gains its first tests ever
(inventory finding): the full R-S2b-9 matrix.

R-S2c-3 **Progress operations** (`service deploy`, `promote`,
`rollback`, `remove`, `domain wait`): result commands emitting
`step-started/finished`, `progress`, and `status` events per the
inventory's step structure; SDK polling drives events through the
injectable clock. `service remove`'s type-the-name confirmation ports
to `prompt.consent` + its current flag per R-S2b-3.

R-S2c-4 **`service run`** — PARKED (morning-questions ledger Q2). The
legacy command passes the child dev-server's exit code through as the
CLI's exit code; engine session commands have no exit-code channel,
and the same passthrough exception is already ruled for Composer's
S3 adoption. Decision needed: build the engine's child-status
passthrough mechanism here (S2c) or defer `service run`'s port to
ride S3's mechanism. DO NOT port `service run` until ruled; the
legacy shell keeps serving it meanwhile (shell deletion is S2d — if
Q2 resolves "defer to S3", S2d keeps a minimal legacy path for
`service run` only, recorded there).

R-S2c-5 **`service build`**: result command; local build; progress
events from the SDK build reporter; no `ctx.api`.

R-S2c-6 **Browser opening** (`service open`, inherited by S2b's
`git connect`): the URL is presented as an `endpoint` event + opened
via the operation layer's existing opener; `--no-open`-style flags
per inventory.

R-S2c-7 **Update notification + shell parity**: no new work — S2a
landed both shells on the shared module; S2c only confirms the v8 bin
covers the newly ported groups (no per-command wiring exists).

## Commands in scope (24 + 1 parked)

`service build|deploy|show|open|logs|list-deploys|show-deploy|promote|
rollback|remove`, `service domain add|show|remove|retry|wait`,
`service env *` — NOTE: the inventory places env under `project env`
(S2b) only; `app` has a `domain` subgroup and no `env` subgroup —
scope follows the inventory. `build logs`, `agent
install|update|status`, `feedback`. Parked: `service run` (Q2).

## Out of scope

`init`, shell deletion (S2d); `service run` until Q2; Composer (S3).

## Acceptance

- [ ] All in-scope commands mounted and green on the R-S2b-9 matrix
      (streams included); `build logs` covered for the first time.
- [ ] `service` rename complete; no `app` path survives in v8.
- [ ] Deploy/promote/rollback/remove event sequences pinned by
      semantic tests (step/progress/status ordering).
- [ ] Divergence list updated (rename class, stream-wrapper drop,
      consent/exit unifications, error-code map).
- [ ] Q2 either ruled and implemented or still parked with the legacy
      path intact and S2d's contract updated accordingly.
- [ ] Legacy fixture tests for ported commands deleted; root
      verification green; PR ≥1k LOC; review loop run.
