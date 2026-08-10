# S2 cumulative parity divergences

Every known place where the v8 ports differ from the shipping
`prisma-cli`, enumerated per PR for operator review (S2 standing ruling
10: divergences are enumerated, not discovered; maintainability
outranks byte parity). Later S2 PRs append their own sections here.

The S1 whoami-scoped record —
[`../engine/whoami-parity-divergences.md`](../engine/whoami-parity-divergences.md)
— remains the baseline for everything the engine changes globally
(json framing, format auto-selection, stderr/stdout channel discipline,
rendering style, `--quiet` as a log-level alias, exit-code semantics,
the dropped `--trace`, the shared flag family). Those apply to every
ported command and are not repeated per command below.

## S2a — auth family + update check (this PR)

The auth family is implemented ON the credential manager (the session
model: a set of per-workspace sessions, one current). The COMMAND NAMES
are the legacy ones and do not change — there is no rename class in
this list. What follows is what a user can still observe as different.

### Error-code mapping (flat → dotted, session vocabulary)

Every errored settlement exits 2 in v8, regardless of the legacy
per-error exit code. Legacy `fix` prose maps to one `user-choice`
nextAction; `meta` is preserved.

| Legacy flat code (exit) | v8 code (exit) | Raised by |
| --- | --- | --- |
| `AUTH_CONFIG_INVALID` (1) — blank `PRISMA_SERVICE_TOKEN` | `AUTH.SERVICE_TOKEN_EMPTY` (2) | every command, single-sourced from `currentSession()` |
| `WORKSPACE_NOT_AUTHENTICATED` (1) | `AUTH.NO_SESSION_FOR_WORKSPACE` (2) | `workspace use`, `workspace logout` |
| `WORKSPACE_AMBIGUOUS` (2) | `AUTH.WORKSPACE_AMBIGUOUS` (2) | `workspace use`, `workspace logout` |
| `WORKSPACE_SWITCH_UNAVAILABLE` (1) | `AUTH.ENV_SESSION_IN_FORCE` (2) | `workspace use`, `workspace logout`, `logout` |
| `USAGE_ERROR` (2) — "No authenticated workspaces" | `AUTH.NO_WORKSPACE_SESSIONS` (2) | `workspace use` |
| `USAGE_ERROR` (2) — "Workspace required" (blank ref) | `AUTH.NO_SESSION_FOR_WORKSPACE` (2) | `workspace logout` — a blank/whitespace ref matches no session rather than being its own usage error |
| (none — legacy could not happen) | `AUTH.LOGIN_WORKSPACE_UNKNOWN` (2) | `login`, when the minted credential carries no `workspace_id` claim |
| (none) | `CLI.CREDENTIALS_REQUIRED` (2) | the engine, for signed-out and sessions-held-none-current |

No documented 4–99 codes exist in this family.

### Exit unifications

Legacy exit 1 for `AUTH_CONFIG_INVALID`, `WORKSPACE_NOT_AUTHENTICATED`
and `WORKSPACE_SWITCH_UNAVAILABLE` becomes exit 2 (could-not-complete)
in v8. A failed login (browser launch, callback, token exchange) was an
unstructured crash at exit 1 in legacy and still settles at exit 1, now
as a structured `CLI.INTERNAL_ERROR`.

### `auth whoami` — json shape

The legacy result was `AuthStateResult`
(`authenticated`/`provider`/`user`/`workspace`/`credential`). The v8
result is the session:

```json
{ "authenticated": true, "workspace": { "id": "…", "name": "…" },
  "user": { "id": "…", "email": "…", "name": "…" },
  "source": "stored", "expiresAt": null }
```

- **`provider` has NO successor.** Nothing in the session model records
  which identity provider minted a credential, and the stored state
  records no identity at all, so the field is gone rather than renamed.
- `credential` is gone: the type/id/name of the credential is not a
  user-facing concept in the session model.
- `source` is new (`"stored"` | `"environment"`), and `expiresAt` is
  the session's expiry.
- Identity display: for an environment session it is decoded from the
  token's own claims; for a stored session it comes from `/v1/me` when
  online. Offline, a stored session shows its workspace and no user —
  legacy showed the claim-derived user in that case. (The Session shape
  carries no token by design, so the command cannot decode a stored
  credential's claims itself.)
- Signed out still exits 0.

### Env-override mutation refusals (`PRISMA_SERVICE_TOKEN` set)

One error family, `AUTH.ENV_SESSION_IN_FORCE`, exit 2, whose `why`
names the variable and states whether stored sessions exist, with the
literal `unset PRISMA_SERVICE_TOKEN` as its nextAction:

| Command | Behavior under the override |
| --- | --- |
| `auth workspace use` | refuses — `AUTH.ENV_SESSION_IN_FORCE`, exit 2 |
| `auth workspace logout` | refuses — same error, exit 2 |
| `auth logout`, stored sessions exist | refuses — same error, exit 2; nothing is cleared |
| `auth logout`, no stored sessions | **succeeds as a no-op**, exit 0, `endedCount: 0` (CI teardowns must not fail) |
| `auth login` | **succeeds**, and prints the mandatory one-line notice that the env token remains in force until unset |
| every read (`whoami`, `workspace list`) | works normally |

Legacy refused workspace switching with `WORKSPACE_SWITCH_UNAVAILABLE`
and let `auth logout` clear stored state even while the variable was
set. Stated consequence: while the variable is set, existing stored
state cannot be cleared.

### `auth workspace list`

- Rows are the sessions the manager holds: `name`, `id`, `status`,
  where status is `current` (legacy: `active`). The legacy `source`
  column and the `auth source` line are gone — the environment session
  never appears as a row.
- Under an env override the listing STATES that the env session is in
  force; the file's own current marker is still shown as current. The
  json context carries `environmentSessionInForce: true` alongside
  `currentWorkspaceId`, which keeps naming the stored marker, not the
  env session's workspace.
- The json shape is new (`context`/`items`/`count` with
  `workspaceId`/`workspaceName`/`current`/`expiresAt`); the legacy
  fields `credentialWorkspaceId`, `switchable`, `lastSeenAt` and
  `source` have no successor.
- A session whose name was never fetched renders by its workspace id in
  both columns.
- Human mode also writes the data rows to stdout; legacy wrote nothing.

### `auth logout` — orphan reaping and the count

- `auth logout` ends EVERY workspace session, not just the active one,
  and reports how many it ended (`endedCount`). Legacy cleared the
  active credential and could leave orphaned per-workspace entries
  behind; those are now reaped, together with the legacy files.
- The presentation reports the count; the json result is
  `{ endedCount, workspaceIds }`, replacing the raw post-logout
  `AuthStateResult`.
- **`auth logout --workspace <ref>` no longer exists.** `auth workspace
  logout <ref>` is the one way to end a single session.

### `auth workspace use` — selects only

Ruled: `workspace use` SELECTS among the sessions you have and never
creates one. A ref naming a workspace you hold no session for is
`AUTH.NO_SESSION_FOR_WORKSPACE`, exit 2, whose nextAction is the
literal `prisma auth login` ("sign in and pick it in the browser"). No
browser ever opens from `use`. Legacy behaved the same way in effect
(it could not create a session either) but said
`WORKSPACE_NOT_AUTHENTICATED` at exit 1.

- Ref resolution is command-side: exact workspace id first, then
  case-insensitive workspace NAME (legacy matched names exactly).
  Several sessions sharing a name is `AUTH.WORKSPACE_AMBIGUOUS`, which
  lists the matching workspace ids in `meta.workspaceIds`.
- Absent positional + several sessions + non-interactive: legacy threw
  its own `USAGE_ERROR`; v8 lets the engine's structural prompt failure
  speak — `CLI.PROMPT_REQUIRED` (exit 2), `CLI.PROMPT_INVALID` (exit 2)
  for an invalid scripted answer, `CLI.PROMPT_CANCELLED` (exit 3) on
  cancellation. Single-session auto-select is unchanged.

### Workspace names are never refreshed on read

A workspace name is fetched once, best-effort, when the session is
created. Reads are entirely offline, so a workspace renamed in the
console keeps its stored name locally until the next login to it (and a
session whose name fetch failed renders by id). Legacy re-fetched names
on every `whoami`/`list` and wrote them back. Accepted and stated.

### `auth login`

- The fixture-only flags `--provider`, `--user`, `--workspace` do NOT
  port (hidden mock-selection surface; fixture machinery dies in S2d).
- The flow speaks engine events: `step-started`/`step-finished` around
  the browser flow, and an `endpoint` event named `verification`
  carrying the OAuth authorize URL (via the optional
  `onVerificationUrl` hook on `performLogin`). Legacy printed the URL
  only inside the interactive instruction prose.
- The interactive paste-fallback prompt and instruction prose inside
  `performLogin` still write to the process's own stdin/stderr;
  unchanged from legacy.
- The json result is `{ workspace: { id, name },
  environmentSessionInForce }` — the workspace the session was created
  for, not an auth-state snapshot.
- Agent-setup tip: legacy suppressed it under `--json`, `--quiet`, CI
  (unless `--interactive`), and non-TTY stderr. In v8 CI suppression is
  kept (`ctx.env.CI`); the tip LINE renders only in the human
  presentation; the tip nextAction appears in json envelopes, where
  legacy omitted it entirely. `--quiet` no longer suppresses it.
- nextActions: `prisma-cli auth whoami`, `prisma-cli project list`,
  plus the tip command when present.

### Update check (§5)

- The module moves to `packages/cli/src/update-check.ts` with a
  structural `UpdateCheckRuntime` (env/argv/stderr); both shells
  consume it. Sequencing copied from the legacy call sites: cached
  notify + detached refresh spawn awaited before dispatch
  (`src/cli.ts` for the legacy shell, `src/v8/main.ts` for the v8
  bin), worker branch in both bins
  (`PRISMA_CLI_RUN_UPDATE_CHECK_WORKER=1`).
- json mode: the legacy shell prints NOTHING when argv contains
  `--json`/`--quiet`/`-q` — copied as-is (the contract's
  decide-by-current-behavior rule). Note the check is literal argv
  matching: the v8 spelling `--format json` is NOT suppressed (and
  `-q` still suppresses although v8's quiet is only a log-level
  alias). Same for `--version`, CI, non-TTY stderr, and
  `NO_UPDATE_NOTIFIER`.

### Telemetry (§6)

- **Config enrichment dropped.** The ORM CLI's detached sender loaded
  `prisma-next.config.*` via c12 (evaluating arbitrary user TS in the
  child) to derive the `databaseTarget` and `extensions` event fields.
  That config file does not exist in this product, so the load was
  removed: `databaseTarget` ships `null` (unless a parent-side override
  is supplied on the wire, kept for compatibility) and `extensions`
  ships `[]`, always. The wire shape is unchanged.
- **Emission timing.** The ORM CLI emitted from a commander `preAction`
  hook, before the command body ran. v8 emits at settlement
  (`onSettled`, by design) with the first-run disclosure printed
  pre-run, before the command's output. Consequence: a run that
  crashes, is SIGKILLed, or leaves through `process.exit` before
  settlement emits NO telemetry event, where the reference emitted one
  before the command started.

### Test surface

- `tests/auth.test.ts` fixture-mode cases covering the six ported
  commands are deleted; the file keeps its real-mode storage cases and
  the legacy-shell presentation cases (help text, TTY header) until
  S2d. The v8 side is pinned semantically in `tests/v8-auth.test.ts`
  (over the harness's in-memory credential manager, with manager state
  read-back) and `tests/v8-update-check.test.ts`; the byte pins live in
  `tests/v8-golden-rendering.test.ts` and `tests/v8-whoami.test.ts`.
