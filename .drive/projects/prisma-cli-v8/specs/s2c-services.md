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

R-S2c-4 **`service run`** — RULED (operator, 2026-08-11): DROPPED. It
does not port and no engine child-exit-code passthrough is built for
it. Starting a local dev server and passing its exit code through is
Composer's `dev`. Divergence entry alongside `service build` and
`service deploy`.

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
install|update|status`, `feedback`. Dropped: `service run`,
`service build`, `service deploy` (ruled; superseded by Composer).

## Out of scope

`init`, shell deletion (S2d); Composer (S3).

## Acceptance

- [ ] All in-scope commands mounted and green on the R-S2b-9 matrix
      (streams included); `build logs` covered for the first time.
- [ ] `service` rename complete; no `app` path survives in v8.
- [ ] Deploy/promote/rollback/remove event sequences pinned by
      semantic tests (step/progress/status ordering).
- [ ] Divergence list updated (rename class, stream-wrapper drop,
      consent/exit unifications, error-code map).
- [x] Q2 ruled: `service run` dropped, so S2d deletes the commander
      shell with no exceptions.
- [ ] Legacy fixture tests for ported commands deleted; root
      verification green; PR ≥1k LOC; review loop run.
