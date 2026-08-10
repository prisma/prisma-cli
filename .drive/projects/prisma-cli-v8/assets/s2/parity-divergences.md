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

### Error-code mapping (flat → dotted `AUTH.*`)

Pattern set by S1 (`AUTH_CONFIG_INVALID` → `AUTH.CONFIG_INVALID`).
Every errored settlement exits 2 in v8, regardless of the legacy
per-error exit code; `fix` prose maps to one `user-choice` nextAction
and the legacy `nextSteps` string list is folded into it (the S1
whoami precedent), while `meta` is preserved verbatim.

| Legacy flat code (exit) | v8 dotted code (exit) | Commands |
| --- | --- | --- |
| `AUTH_CONFIG_INVALID` (1) | `AUTH.CONFIG_INVALID` (2) | whoami, login, logout, workspace list |
| `WORKSPACE_SWITCH_UNAVAILABLE` (1) | `AUTH.WORKSPACE_SWITCH_UNAVAILABLE` (2) | workspace use |
| `WORKSPACE_NOT_AUTHENTICATED` (1) | `AUTH.WORKSPACE_NOT_AUTHENTICATED` (2) | workspace use, workspace logout, logout --workspace |
| `WORKSPACE_AMBIGUOUS` (2) | `AUTH.WORKSPACE_AMBIGUOUS` (2) | workspace use, workspace logout, logout --workspace |
| `USAGE_ERROR` (2) — "No authenticated workspaces" | `AUTH.USAGE_ERROR` (2) | workspace use |
| `USAGE_ERROR` (2) — "Workspace required" (blank ref) | `AUTH.USAGE_ERROR` (2) | workspace logout |

No documented 4–99 codes exist in this family.

### `auth login`

- The fixture-only flags `--provider`, `--user`, `--workspace` do NOT
  port (hidden mock-selection surface; fixture machinery dies in S2d).
  The `--workspace` name is reused by `auth logout` only.
- The flow now speaks engine events: `step-started`/`step-finished`
  around the browser flow, and an `endpoint` event named `verification`
  carrying the OAuth authorize URL (surfaced via a new optional
  `onVerificationUrl` hook on `performLogin`; legacy callers are
  unaffected). Legacy printed the URL only inside the interactive
  instruction prose.
- The interactive paste-fallback prompt and instruction prose inside
  `performLogin` still write to the process's own stdin/stderr (the
  reference implementation owns that flow); unchanged from legacy.
- Presentation is the whoami-style card (summary + `label: value`
  rows) titled with the legacy copy "Starting an authenticated CLI
  session.", not the legacy mutate-card layout.
- Agent-setup tip: the legacy helper suppressed the tip under
  `--json`, `--quiet`, CI (unless `--interactive`), and non-TTY
  stderr. In v8: CI suppression is kept (`ctx.env.CI`; the engine does
  not expose the `--interactive` flag to handlers, so its override is
  dropped); the tip LINE renders only in the human presentation, so
  json output never shows it; but the tip nextAction and the
  `agentSetupTip` result field DO appear in json envelopes (the
  contract's nextActions row), where legacy omitted the tip from
  `--json` entirely. `--quiet` no longer suppresses it (log-level
  alias ruling). There is no stderr-TTY check; format auto-selection
  covers the piped case.
- A failed login (browser launch, callback, token exchange) was an
  unstructured crash (exit 1) in legacy; in v8 it settles as
  `CLI.INTERNAL_ERROR`, exit 1 — same class, structured envelope.
- nextActions: `prisma-cli auth whoami`, `prisma-cli project list`,
  plus the tip command when present (legacy: same strings as
  `nextSteps`).

### `auth logout`

- `--workspace <ref>` no longer re-dispatches at the argv level: the
  handler calls the shared workspace-logout operation directly. The
  envelope therefore reports commandId `auth.logout` where legacy
  reported `auth.workspace.logout` for the same invocation. Semantics
  and presentation are those of `auth workspace logout`.
- Plain logout keeps the legacy copy ("Clearing the current CLI
  session." / "Session removed from local CLI state.") in the block
  vocabulary; the json result stays the raw post-logout
  `AuthStateResult` (legacy had no serializer either).

### `auth workspace list`

- Human table ports the exact legacy column rule: name, id, status,
  with a source column only when sources are mixed; the `auth source`
  line is kept. Rail/padding/color styling goes the way of all v8
  rendering (S1 doc §3).
- The json serializer is `serializeAuthWorkspaceList`, ported
  verbatim (context/items/count shape).
- Human mode now also writes the table's data rows to stdout (the
  machine payload surface); legacy wrote nothing to stdout.

### `auth workspace use`

- Absent positional + multiple workspaces + non-interactive: legacy
  threw its own `USAGE_ERROR` ("Interactive workspace selection
  unavailable", exit 2); v8 lets the engine's structural prompt
  failure speak — `CLI.PROMPT_REQUIRED`, exit 2. An invalid scripted
  answer is `CLI.PROMPT_INVALID` (exit 2); cancellation is
  `CLI.PROMPT_CANCELLED` (exit 3).
- Single-workspace auto-select and the zero-workspace usage error
  port unchanged; the picker itself is `ctx.prompt.select` (clack on
  real TTYs) with the legacy label shape
  `name (id)[ active]`.

### `auth workspace logout`

- Ported unchanged, including was-active handling (never
  auto-falls-through; suggests `auth workspace use <id>` when the
  active workspace was removed). Raw result shape in json (legacy
  serializer was the identity).

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

### `auth workspace list` — empty service token

- An empty/blank `PRISMA_SERVICE_TOKEN` now errors as
  `AUTH.CONFIG_INVALID` (exit 2), matching whoami/login/logout. Legacy
  let the raw `EmptyServiceTokenError` crash unstructured.

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
  and `tests/v8-update-check.test.ts`.
