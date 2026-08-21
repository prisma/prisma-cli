# S2 cumulative parity divergences

Every known place where the v8 ports differ from the shipping `prisma-cli`, in one document for operator sign-off (S2 standing ruling 10: divergences are enumerated, not discovered; maintainability outranks byte parity; R-S2d-6 consolidates). The former per-slice files (`-s2b`, `-s2c`, `-s2d`) are folded in below verbatim, headings demoted one level. S3's and S8's lists belong to those slices and stay separate.

The S1 whoami-scoped record — [`../engine/whoami-parity-divergences.md`](../engine/whoami-parity-divergences.md) — remains the baseline for everything the engine changes globally (json framing, format auto-selection, stderr/stdout channel discipline, rendering style, `--quiet` as a log-level alias, exit-code semantics, the dropped `--trace`, the shared flag family). Those apply to every ported command and are not repeated per command below.

## Signed off

**Ratified by the operator, 2026-08-12**, together with the whole document: every divergence built to a stated default stands, including the items below, which were surfaced as explicit choices rather than defaults. The escalated engine gaps stay ratified-as-shipped; the work to close them is recorded in `../../deferred.md`.

1. **`init`'s optional steps default to no** — S2d list, entry 10 (marked DECIDE). Interactive users press `y` where they pressed Enter; unattended runs keep today's behaviour exactly. One line per prompt to flip.
2. **A service token whose workspace only the server knows is now refused** — S2c, "ESCALATED — engine gap".
3. **`build logs`: a failed build cannot exit 1** — S2c, "ESCALATED — engine gap".
4. **Help examples lose the package runner, and one command spells itself two ways** — S2c, "ESCALATED — engine gap"; worth one group-wide ruling.
5. **The crash-recovery feedback action does not port** — S2c, "ESCALATED — engine gap".
6. **Open ledger questions** (in `../../specs/s2-overview.md`, built to their stated defaults): Q1 auto-login stays dropped; Q3 the `rm` alias stays dropped; Q5 exit-code unification; Q6 telemetry docs URL; Q7 telemetry config enrichment dropped; Q8 disclosure timing. Signing off this document ratifies those defaults unless ruled otherwise first.

## Classes that hold for every ported command

Each slice restates these with its own group's legacy codes; the rules themselves are one set. Errored settlements exit 2 and cancellations exit 3, whatever the legacy per-error code was. Flat `UPPER_SNAKE` codes become dotted codes under the group's namespace. Legacy `fix` prose becomes one `user-choice` next action; each `nextSteps` string becomes a `run-command` action. `warnings: string[]` become coded diagnostics. Human rendering is engine blocks, with the machine-readable rows also written to stdout, where legacy wrote stdout nothing. `--trace` is gone (log levels cover it). Fixture mode is gone. The ruled renames: `database` → `postgres`, `app` → `service`; the ruled removals: `service build`, `service deploy`, `service run` (superseded by Composer), the mock-only login flags, and the `version` command (the engine's `--version` answers).

## S2a — auth family + update check (this PR)

The auth family is implemented ON the credential manager, whose normative design is [`../engine/credential-manager-design.md`](../engine/credential-manager-design.md). Read §11 there for the model this section describes: a set of stored per-workspace sessions plus one selection, and — separately — the credential this process authenticates as, which may come from `PRISMA_SERVICE_TOKEN` and is not a session. The COMMAND NAMES are the legacy ones and do not change — there is no rename class in this list. What follows is what a user can still observe as different.

### Error-code mapping (flat → dotted, session vocabulary)

Every errored settlement exits 2 in v8, regardless of the legacy
per-error exit code. Legacy `fix` prose maps to one `user-choice`
nextAction; `meta` is preserved.

| Legacy flat code (exit) | v8 code (exit) | Raised by |
| --- | --- | --- |
| `AUTH_CONFIG_INVALID` (1) — blank `PRISMA_SERVICE_TOKEN` | `AUTH.SERVICE_TOKEN_EMPTY` (2) | every command, single-sourced from `activeCredential()` |
| `WORKSPACE_NOT_AUTHENTICATED` (1) | `AUTH.NO_SESSION_FOR_WORKSPACE` (2) | `workspace use`, `workspace logout` |
| `WORKSPACE_AMBIGUOUS` (2) | `AUTH.WORKSPACE_AMBIGUOUS` (2) | `workspace use`, `workspace logout` |
| `WORKSPACE_SWITCH_UNAVAILABLE` (1) | **no successor** | nothing — the mutations it guarded now succeed (see below) |
| `USAGE_ERROR` (2) — "No authenticated workspaces" | `AUTH.NO_WORKSPACE_SESSIONS` (2) | `workspace use` |
| `USAGE_ERROR` (2) — "Workspace required" (blank ref) | `AUTH.NO_SESSION_FOR_WORKSPACE` (2) | `workspace logout` — a blank/whitespace ref matches no session rather than being its own usage error |
| (none — legacy could not happen) | `AUTH.LOGIN_WORKSPACE_UNKNOWN` (2) | `login`, when the minted credential carries no `workspace_id` claim |
| (none) | `CLI.CREDENTIALS_REQUIRED` (2) | the engine, for signed-out and sessions-held-none-selected |

No documented 4–99 codes exist in this family.

### Exit unifications

Legacy exit 1 for `AUTH_CONFIG_INVALID` and `WORKSPACE_NOT_AUTHENTICATED` becomes exit 2 (could-not-complete) in v8. A failed login (browser launch, callback, token exchange) was an unstructured crash at exit 1 in legacy and still settles at exit 1, now as a structured `CLI.INTERNAL_ERROR`.

### `auth whoami` — json shape

The legacy result was `AuthStateResult` (`authenticated`/`provider`/`user`/`workspace`/`credential`). The v8 result describes the active credential:

```json
{ "authenticated": true, "workspace": { "id": "…", "name": "…" },
  "user": { "id": "…", "email": "…", "name": "…" },
  "source": "stored", "expiresAt": null }
```

- **`provider` has NO successor.** Nothing in the model records which identity provider minted a credential, so the field is gone rather than renamed.
- `credential` is gone: the type/id/name of the credential is not a user-facing concept here.
- `source` is new (`"stored"` | `"environment"`) and comes from the credential's origin; `expiresAt` is the credential's expiry.
- `user` keeps `id`, `email` and `name`. There is one identity type for both the claimed and the fetched identity (design §11.6); a token's claims carry an id and an email, and only the online lookup supplies a name, so `name` is null offline. The human card's `user` row shows the email, or is omitted when there is none.
- **A service token reports no user at all.** Its subject names a workspace rather than a person, so `user` is null and the workspace is read from that subject. Reporting `workspace:<id>` as a user id was a defect.
- Identity display: the credential manager decodes the credential's own claims, and `/v1/me` is a best-effort online enrichment that wins field by field where it disagrees. whoami does not branch on the origin — it attempts the enrichment for an environment credential too, and falls back to the claims when the request fails. **This restores legacy behaviour that rev 5 had dropped:** a stored session offline now shows the claim-derived user again, where rev 5 showed the workspace and no user.
- **A credential nothing names renders no workspace at all.** An environment token whose claims carry no workspace reports `"workspace": null` and omits the workspace row from the human card. It is never an empty string and never the literal `undefined` — rev 5 wrote `workspaceId: ""` in that case.
- Signed out still exits 0.

### Mutations while `PRISMA_SERVICE_TOKEN` is set

The variable supplies the credential this process authenticates as. It is not a session, so it does not occupy a slot that a stored session could be moved into or out of, and commands that change stored state are free to run. Design §11.7 rules that all of them succeed:

| Command | Behavior while the variable is set |
| --- | --- |
| `auth workspace use` | **succeeds** — the stored selection moves; this process keeps authenticating as the environment credential |
| `auth workspace logout` | **succeeds** — the named session is removed |
| `auth logout` | **succeeds** — the store is cleared, whether or not it held sessions |
| `auth login` | **succeeds** — a new session is stored and selected |
| every read (`whoami`, `workspace list`) | works normally |

Each of the four mutations prints the same one-line notice in human output: the environment credential remains in force until the variable is unset. The notice itself is human-only. Two json results carry the fact as a field — `auth workspace list`'s `context.environmentCredentialInForce` and `auth login`'s `environmentCredentialInForce` — and those are the machine-readable signal.

This is the second change here. Legacy refused workspace switching with `WORKSPACE_SWITCH_UNAVAILABLE` and let `auth logout` clear stored state. Rev 5 of the design refused `workspace use`, `workspace logout` and `auth logout` with `AUTH.ENV_SESSION_IN_FORCE`, carving out an empty store so CI teardowns would not fail. **`AUTH.ENV_SESSION_IN_FORCE` no longer exists**, and neither does the carve-out. The net effect against legacy is that workspace switching now works while the variable is set, where legacy refused it.

A blank or whitespace-only `PRISMA_SERVICE_TOKEN` is unchanged: it is never an override, and every command — mutations included — fails with `AUTH.SERVICE_TOKEN_EMPTY`.

### `auth workspace logout` — json shape

The result is `{ workspace: { id, name }, wasSelected }`. `wasSelected` says whether the session that was removed had been the selected one; when it was, nothing is promoted in its place and the next actions offer `auth workspace list` and `auth workspace use`.

### Ending a session is idempotent

`auth workspace logout <ref>` resolves the ref against the sessions you hold, so a workspace you never had is still `AUTH.NO_SESSION_FOR_WORKSPACE`, exit 2. What changed is the race: if another `prisma` process removes that session between the resolution and the write, the command now exits 0 rather than exit 2 with a message that is no longer true. The postcondition — no session for that workspace — holds either way. Selecting is not idempotent and still refuses a workspace with no session.

### `auth workspace list`

- Rows are the sessions the manager holds: `name`, `id`, `status`, where status is `current` (legacy: `active`). The legacy `source` column and the `auth source` line are gone — the environment credential never appears as a row.
- While `PRISMA_SERVICE_TOKEN` is set the listing STATES that the environment credential is in force; the stored selection is still shown as current. The json context carries `environmentCredentialInForce: true` alongside `currentWorkspaceId`, which keeps naming the stored selection, not the environment credential's workspace. `currentWorkspaceId` and the per-item `current` keep the word "current" deliberately: they are an output contract, where the code says "selected" (design §11.1). `environmentCredentialInForce` was renamed from `environmentSessionInForce` — the thing it describes is not a session, which is the whole point of §11.
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
- The json result is `{ workspace: { id, name }, environmentCredentialInForce }` — the workspace the session was created for, not an auth-state snapshot.
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
- **Emission timing — retired, no longer a divergence.** v8 briefly
  emitted at settlement (`onSettled`), so a run that crashed, was
  SIGKILLed, or left through `process.exit` emitted nothing where the
  reference emitted one before the command started. The engine now
  fires at command start from the parse-time snapshot, immediately
  after it is built and before the handler — the same point the ORM
  CLI's commander `preAction` hook fires from. ADR 217 (prisma/prisma),
  which makes "spawned at command start" the isolation decision, stays
  true and needs no amendment.
- **First-run disclosure wording.** The ORM CLI says "Prisma Next
  collects anonymous CLI usage data"; the engine composes one
  disclosure for one product and says "Prisma collects anonymous CLI
  usage data". Same channel (stderr), same timing (first enabled run,
  before the command runs), same opt-out instructions, and the same
  `installationId`-keyed once-only behaviour. The ORM inherits this
  wording when its bin ports onto the engine.
- **The preference file and the opt-out variables drop `prisma-next`, and
  the file stops being shared.** Ruled by the operator on 2026-08-11: this is
  semver zero and the `prisma-next` binary is being retired, which is the
  point of the project. The preference now lives under `prisma/` rather than
  `prisma-next/`; `PRISMA_NEXT_DISABLE_TELEMETRY`, `PRISMA_NEXT_TELEMETRY_
  ENDPOINT` and `PRISMA_NEXT_DEBUG` become `PRISMA_DISABLE_TELEMETRY`,
  `PRISMA_TELEMETRY_ENDPOINT` and `PRISMA_DEBUG`. No read fallback, no
  dual-write, no migration — the old location is not consulted and the old
  variable names do nothing, pinned by tests so a fallback cannot return.
  Consequences, both accepted: every stored preference and installation id
  at the old path is abandoned, so an existing opt-out reverts to the
  opt-out default and the backend sees its population turn over once; and
  the two binaries stop sharing one answer until the ORM's ports onto the
  engine. `DO_NOT_TRACK` is a community convention and does not move.
- **The first-run notice no longer offers to be opted out of by hand.** It
  named the config file as a third route ("or set `enableTelemetry: false`
  in …"); the operator ruled the file is machine-edited and the commands
  exist for this. The notice keeps `telemetry disable` and both environment
  variables, and `telemetry status` still prints the path.
- **A negated flag ships one name, not two.** Commander gives
  `--no-color` the same attribute name as `--color`, so the ORM CLI's
  sanitiser sees both option entries sourced from the command line and
  emits `["color", "no-color"]` — whichever spelling the user typed.
  The engine maps a `--no-<flag>` token back to its base key and emits
  `["color"]`. Neither preserves polarity, so nothing is lost: the ORM
  simply ships a flag the user never typed and double-counts these in
  aggregate. Affects `--color` and `--interactive`, the only negatable
  flags on either side. This is not new — the engine's snapshot builder
  has behaved this way since S1 — but the engine becoming the shared
  implementation is when the ORM's counts for those two flags change,
  so the backend should expect the discontinuity at its cutover, not at
  this PR.

### Test surface

- `tests/auth.test.ts` fixture-mode cases covering the six ported commands are deleted; the file keeps its real-mode storage cases and the legacy-shell presentation cases (help text, TTY header) until S2d. The v8 side is pinned semantically in `tests/v8-auth.test.ts` (over the harness's in-memory credential manager, with manager state read-back) and `tests/v8-update-check.test.ts`; the byte pins live in `tests/v8-golden-rendering.test.ts` and `tests/v8-whoami.test.ts`.
- `Runtime.getCredentials` and its `makeGetCredentials` builder are gone. The engine asks the credential manager for the active credential and its token storage instead, so the bin no longer supplies a second, parallel way to read a token.

## S2b — resources (project, postgres, bucket, branch, git)

Divergences introduced by the S2b resource port. Grows per dispatch;
D4 consolidates. The auth stream owns `parity-divergences.md` — this
file never duplicates it.

### D1 — the `project` group

Delivered: all 11 commands — `project
list|show|create|link|rename|remove|transfer` and
`project env add|update|list|remove`. `remove` and `transfer` landed
in round 2, once the engine's consent tokens arrived
(conventions §5).

#### Class divergences

1. **Exit codes.** Every errored settlement exits 2. The legacy
   commands exited 1 for `PROJECT_NOT_FOUND`, `PROJECT_AMBIGUOUS`,
   `PROJECT_SETUP_REQUIRED`, `LOCAL_STATE_STALE`,
   `LOCAL_PROJECT_WORKSPACE_MISMATCH`, `LOCAL_STATE_WRITE_FAILED`,
   `PROJECT_CREATE_FAILED`, `PROJECT_RENAME_FAILED`,
   `ENV_VARIABLE_ALREADY_EXISTS`, `ENV_VARIABLE_NOT_FOUND`,
   `ENV_BRANCH_NOT_FOUND`, `ENV_BRANCH_SCOPE_IS_PRODUCTION`,
   `ENV_BRANCH_CREATE_REQUIRES_DEFAULT_BRANCH`,
   `ENV_FILE_APPLY_FAILED`, `ENV_API_ERROR` and the API-passthrough
   codes; usage errors already exited 2.
2. **Auto-login dropped** (R-S2b-2). Every command declares
   `needs.credentials`; an unauthenticated invocation settles with the
   engine's `CLI.CREDENTIALS_REQUIRED` (exit 2) instead of launching
   an interactive browser login.
3. **Error codes** are dotted (§ "Error code map" below).
4. **`verboseContext` dropped.** `--verbose` is a log level in v8, so
   the env results no longer carry the resolved-context block, and the
   "Resolved context" / "Env target" verbose blocks do not port. The
   json `result` is unchanged, because the legacy serializers already
   stripped `verboseContext`.
5. **NextActions.** The legacy `fix` prose becomes exactly one
   `user-choice` action and each legacy `nextSteps` string becomes a
   `run-command` action whose label is the command. The legacy
   `journey` field has no v8 counterpart and is dropped.
6. **Package-runner command strings dropped.** Command strings in
   nextActions are `${CLI_NAME} …`, never
   `npx -y @prisma/cli@latest …`.
7. **`--trace` fix text** becomes `--log-level verbose`.
8. **List data rows go to stdout** in human mode (`project list`,
   `project env list`); legacy human mode wrote nothing to stdout.
9. **Human rendering** is engine blocks, not the legacy rail-and-card
   bytes. The title, field labels, table columns and empty-state
   sentences port verbatim.

   **Narrowed by the engine-colour slice** (`specs/engine-colour.md`).
   The card's aligned key column and its accent-coloured keys are back,
   and byte-equal to the legacy `renderFieldRows` — a test in
   `packages/cli/tests/v8-golden-rendering.test.ts` asserts the engine's
   output against the commander shell's own renderer rather than against
   a copied string. Tables align the same way. What is still missing is
   the framing around the card, not the card: the dim `│` rail exists as
   `fields.rail` but no command sets it yet, and the header line
   (`project show → description`), its blank-line spacing and its
   `Read more` row have no engine counterpart. Adopting the rail per
   command is recorded in `deferred.md`.

#### D1-specific divergences

10. **`rm` alias dropped** for `project env remove` (R-S2b-8). The v8
    tree has exact paths only.
11. **`project link` picker, non-interactive.** Without a positional
    and without a TTY (or under `--yes`), the engine's
    `CLI.PROMPT_REQUIRED` (exit 2) replaces the legacy
    `PROJECT_LINK_TARGET_REQUIRED` error. Its `meta.candidates`,
    `meta.suggestedProjectName` and its rich nextActions are lost —
    **flagged for operator review**.
12. **`PROJECT_AMBIGUOUS`** was exit 1 in the legacy code (the
    inventory says 2); it is exit 2 in v8 like every other errored
    settlement.
13. **`--role` invalid values.** The engine's enum parse failure
    replaces commander's `Allowed choices are production, preview.`
    message.
14. **The legacy `AUTH_REQUIRED` code maps mechanically to
    `PROJECT.AUTH_REQUIRED`** (summary, why and next steps verbatim,
    exit 2 instead of 1). The engine owns every real credentials
    failure — an expired stored session settles
    `CLI.CREDENTIALS_REQUIRED` and a rejected env token settles
    `AUTH.SERVICE_TOKEN_REJECTED`, both before a handler sees them —
    so what still reaches `apiCallError` is the permission residue, a
    returned 403, which is not a sign-in problem. The legacy next
    step's `prisma auth login` copy bug normalizes to
    `prisma-cli auth login`. Its fix text also loses the clause ", or
    rerun the command in a TTY to sign in interactively." and reads
    "Run prisma-cli auth login." — auto-login is gone (R-S2b-2), so
    rerunning in a terminal can no longer sign anyone in and the
    sentence pointed at a remedy v8 does not have (operator ruling
    2026-08-10; conventions §4). The legacy shell keeps the original
    sentence, which is still true there.
15. **`project rename` name-validation copy** still reads "Project
    create requires a name" — the legacy copy bug ports verbatim
    (recorded, not fixed).
16. **Preview-default warning becomes a diagnostic.** The legacy
    `warnings` string on `project env add` (branch scope, key absent
    from preview) becomes a `warn` diagnostic under the code
    `PROJECT.ENV_PREVIEW_DEFAULT_MISSING` (d1-project.md §4.8; the
    operator ratifies it through this list). The local-pin warnings
    of `project remove` and `project transfer` become `warn`
    diagnostics the same way, under the already-pinned
    `PROJECT.LOCAL_STATE_WRITE_FAILED`.
17. **Env file-mode nextSteps.** A `#`-comment line in the legacy
    `splitFileNextSteps` output is not an action of its own: it
    becomes the `reason` of the run-command action it introduces, so
    `# existing keys: "A"` explains the `project env update --file
    …existing` step rather than standing beside it.
18. **Legacy shell-context adapter.** The pinned resolution and env
    functions (`resolveProjectTarget`, `inspectProjectBinding`,
    `resolveEnvWriteInput`, `runEnvAddFile`, `runEnvUpdateFile`,
    `cleanupLocalPinForProject`, `rewriteOrClearLocalPinForProject`)
    take the legacy shell `CommandContext` but read only
    `runtime.cwd`, `runtime.env` and `runtime.signal`. v8 calls them
    through the runtime-slice adapter in `v8/project/context.ts`
    (d1-project.md §4.9) — accepted for this slice; the signature
    cleanup belongs to S2d, when the legacy shell dies.
19. **Consent is engine-owned** (conventions §5). `project remove`
    and `project transfer` declare no `--confirm` flag; the engine
    injects the shared repeatable one, with the same CLI spelling and
    the same exact-project-id value. Interactively the user types the
    project id (there was no prompt at all before). The legacy
    `CONFIRMATION_REQUIRED` error is gone: a missing or wrong grant is
    the engine's `CLI.CONSENT_REQUIRED` (exit 2, was exit 2) or
    `CLI.PROMPT_INVALID`, and its `meta.expectedConfirm` /
    `meta.receivedConfirm` do not survive. `--yes` never grants
    consent.
20. **Transfer's recipient resolution** drops the fixture branch and
    calls `resolveRecipientWorkspaceSession` directly; the
    service-token guard, the recipient error mapping and every copy
    string are unchanged.
46. **A rejected project listing now fails instead of looking like an
    empty workspace.** (Numbered after D3 because the sequence is
    file-wide.) `listRealWorkspaceProjects` (`controllers/project.ts`)
    read only `data` from the SDK response and discarded `error` and
    `response`, so any non-2xx became `data === undefined` and then an
    empty list. `project list` printed "No projects found." and exited
    0 while the API was refusing the request, and because
    `resolveProjectTarget` resolves project names through the same
    function, every command that resolves a project by name reported
    "Choose a Project before running this command" or a not-found when
    the real cause was a rejected request.

    Operator ruling 2026-08-11: fixed rather than recorded. The
    function now raises `projectApiError`, which the v8 mapper carries
    to `PROJECT.API_ERROR` at exit 2, and the `project list` case
    "surfaces a rejected projects request instead of an empty list"
    proves it. This is a legacy body change and therefore a divergence
    in the other direction: the old shell reported success on a
    rejected listing, and both shells now report the failure. Reporting
    a refusal as a success was not a behaviour anyone chose, and the
    database, branch, bucket, app and env controllers all read through
    the same function, so the fix reaches them too.
47. **stdout rows carry raw values where the human table formats
    them.** The Option A channel ruling (2026-08-09) makes the human
    Blocks presentation prose on stderr and the `Presentations.stdout`
    lines the machine-usable payload, so no human formatting and no
    placeholder may reach a stdout row: an absent value is an empty
    field, and where the two lanes differ the command builds two sets
    of rows. The human tables and cards are unchanged, and `--json`
    remains the lossless record.

    What changed on stdout, by command. `project list`: an absent
    default region is empty, not `none`. `project show`: the local
    repo path is raw rather than shortened to `~`, the single
    `platform: <workspace> / <project>` line becomes a `workspace` and
    a `project` line — the labels this command already uses when the
    directory is not linked — and an unlinked directory leaves the
    project field empty instead of saying `Not linked`. `project env
    list` already carried the bare key (entry 42's sibling, fixed the
    same day). `postgres list`: absent branch and region are empty, and
    the status field carries the raw status — the `isDefault` fallback
    is a different fact and does not belong in that column, so an
    absent status is empty there too. `postgres show`: the same three.
    `postgres usage`: the period becomes `period start` and `period
    end` rather than one glued sentence, each metric carries its number
    without the unit, and an absent bound or timestamp is empty.
    `postgres backup list`: the size is the byte count, not `2.0 KiB`,
    and an absent timestamp is empty. `postgres connection list` and
    `bucket list`: absent timestamp and branch are empty.
    `branch list` and `bucket key list` needed no change — every cell
    was already a raw required field.

    Two placeholders survive on stdout and this slice cannot remove
    them. `postgres backup list`'s `backupType` and `status` are the
    literal string `unknown` when the API omits them, because
    `normalizeBackupList` (`lib/database/provider.ts`) substitutes that
    word in the **operation layer**, before any presentation runs — the
    fix is a legacy body change, out of scope here. Recorded so the
    gap is visible rather than assumed closed.

#### Error code map

| legacy code | v8 code |
| --- | --- |
| `USAGE_ERROR` (project/app domain) | `PROJECT.USAGE_ERROR` |
| `USAGE_ERROR` "Workspace required" (auth domain) | `AUTH.USAGE_ERROR` |
| `PROJECT_NOT_FOUND` | `PROJECT.NOT_FOUND` |
| `PROJECT_AMBIGUOUS` | `PROJECT.AMBIGUOUS` |
| `PROJECT_SETUP_REQUIRED` | `PROJECT.SETUP_REQUIRED` |
| `LOCAL_STATE_STALE` | `PROJECT.LOCAL_STATE_STALE` |
| `LOCAL_PROJECT_WORKSPACE_MISMATCH` | `PROJECT.LOCAL_WORKSPACE_MISMATCH` |
| `LOCAL_STATE_WRITE_FAILED` | `PROJECT.LOCAL_STATE_WRITE_FAILED` |
| `PROJECT_CREATE_FAILED` | `PROJECT.CREATE_FAILED` |
| `PROJECT_RENAME_FAILED` | `PROJECT.RENAME_FAILED` |
| `ENV_VARIABLE_ALREADY_EXISTS` | `PROJECT.ENV_VARIABLE_ALREADY_EXISTS` |
| `ENV_VARIABLE_NOT_FOUND` | `PROJECT.ENV_VARIABLE_NOT_FOUND` |
| `ENV_BRANCH_NOT_FOUND` | `PROJECT.ENV_BRANCH_NOT_FOUND` |
| `ENV_BRANCH_SCOPE_IS_PRODUCTION` | `PROJECT.ENV_BRANCH_SCOPE_IS_PRODUCTION` |
| `ENV_BRANCH_CREATE_REQUIRES_DEFAULT_BRANCH` | `PROJECT.ENV_BRANCH_CREATE_REQUIRES_DEFAULT_BRANCH` |
| `ENV_FILE_APPLY_FAILED` | `PROJECT.ENV_FILE_APPLY_FAILED` |
| `ENV_API_ERROR` | `PROJECT.ENV_API_ERROR` |
| `PROJECT_API_ERROR` | `PROJECT.API_ERROR` |
| `PROJECT_REMOVE_BLOCKED` | `PROJECT.REMOVE_BLOCKED` |
| `PROJECT_TRANSFER_REJECTED` | `PROJECT.TRANSFER_REJECTED` |
| `TRANSFER_RECIPIENT_REQUIRED` | `PROJECT.TRANSFER_RECIPIENT_REQUIRED` |
| `TRANSFER_RECIPIENT_UNAVAILABLE` | `PROJECT.TRANSFER_RECIPIENT_UNAVAILABLE` |
| `WORKSPACE_AMBIGUOUS` / `WORKSPACE_NOT_AUTHENTICATED` | `AUTH.WORKSPACE_AMBIGUOUS` / `AUTH.WORKSPACE_NOT_AUTHENTICATED` |
| `AUTH_REQUIRED` | `PROJECT.AUTH_REQUIRED` |
| raw API `error.code` X | `PROJECT.X` |
| `FEATURE_UNAVAILABLE` (fixture only) | unreachable in v8 |

`PROJECT.CONFIRMATION_REQUIRED` and `PROJECT.LINK_TARGET_REQUIRED`
remain in the mapper table but are unreachable: the engine's consent
and prompt errors replace them.

#### Conformance rows

| command | inventory entry | rules applied | divergences |
| --- | --- | --- | --- |
| `project list` | `project list` | R-S2b-2, 5, 9, 10; d1 §3.1 | 1, 2, 3, 5, 6, 8, 9 |
| `project show` | `project show` | R-S2b-2, 5, 9, 10; d1 §3.2 | 1, 2, 3, 5, 9, 12, 18 |
| `project create` | `project create` | R-S2b-2, 5, 9, 10; d1 §3.3 | 1, 2, 3, 5, 9 |
| `project link` | `project link` | R-S2b-2, 5, 6, 9, 10; d1 §3.4 | 1, 2, 3, 5, 9, 11, 12 |
| `project rename` | `project rename` | R-S2b-2, 5, 9, 10; d1 §3.5 | 1, 2, 3, 5, 9, 15, 18 |
| `project env add` | `project env add` | R-S2b-2, 5, 9, 10; d1 §3.8 | 1, 2, 3, 4, 5, 9, 13, 14, 16, 17, 18 |
| `project env update` | `project env update` | R-S2b-2, 5, 9, 10; d1 §3.9 | 1, 2, 3, 4, 5, 9, 13, 14, 17, 18 |
| `project env list` | `project env list` | R-S2b-2, 5, 9, 10; d1 §3.10 | 1, 2, 3, 4, 5, 8, 9, 13, 14, 18 |
| `project env remove` | `project env remove` | R-S2b-2, 5, 8, 9, 10; d1 §3.11 | 1, 2, 3, 4, 5, 9, 10, 13, 14, 18 |
| `project remove` | `project remove` | R-S2b-2, 3, 5, 9, 10; d1 §3.6 | 1, 2, 3, 5, 9, 16, 18, 19 |
| `project transfer` | `project transfer` | R-S2b-2, 3, 5, 9, 10; d1 §3.7 | 1, 2, 3, 5, 9, 16, 18, 19, 20 |

### D2 — the `postgres` group

Delivered: all 11 commands —
`postgres list|show|create|usage|restore|remove`,
`postgres backup list`, and
`postgres connection list|create|rotate|remove`.

#### Divergences

D1's class entries 1 (exit codes), 2 (auto-login dropped), 5
(nextActions from fix and nextSteps), 6 (package-runner strings
dropped), 7 (`--trace` → `--log-level verbose`), 9 (engine blocks
replace the legacy rail rendering) and 18 (the shell-context adapter,
used here for project resolution) apply identically. On top of them:

21. **Rename** (R-S2b-1). The group, its subgroups, every command
    path and id (`postgres.connection.rotate`), every help string and
    example, and every command reference inside `why`, `fix` and
    nextAction text move from `database` to `postgres`. No alias
    survives. The resource noun "database" in prose is unchanged —
    the resource is a Prisma Postgres database.
22. **Error-code map** (see below), including the mechanical
    passthrough of raw API codes as `POSTGRES.<code>`.
23. **Consent is engine-owned** for `restore`, `remove`,
    `connection rotate` and `connection remove`: no `--confirm` flag
    is declared, the engine injects the shared one with the same
    spelling and the same exact-id value, and interactively the user
    types that id. The legacy `CONFIRMATION_REQUIRED` error is
    unreachable, so `POSTGRES.CONFIRMATION_REQUIRED` has no entry in
    the mapper and `meta.expectedConfirm` / `meta.receivedConfirm`
    are gone. `--yes` never grants consent; a wrong typed answer is
    `CLI.PROMPT_INVALID`, exit 2; and cancelling the prompt with
    Ctrl-C or EOF settles `CLI.PROMPT_CANCELLED`, exit 3 — an exit
    code these commands never produced before, because they had no
    prompt to cancel.
24. **Consent prompts are new.** The legacy commands had no
    interactive confirmation at all — only the flag. The prompt's
    question is each command's legacy confirmation `why` sentence,
    verbatim.
25. **Plan-limit rendering.** PR #127's `humanLines` full-page
    override does not port. The error keeps its summary, why and meta
    verbatim and carries exactly one `user-choice` nextAction whose
    reason is the upgrade URL and plan name when the best-effort
    subscription lookup returned them, and the Console guidance
    otherwise.
26. **List commands write their data rows to stdout** in human mode
    (`postgres list`, `postgres backup list`, `postgres connection
    list`); legacy human mode wrote nothing to stdout. `show` and
    `usage` mirror their field rows the same way.
27. **Pre-result progress lines dropped.** `Creating database...`,
    `Creating connection...` and `Rotating connection...` have no v8
    counterpart: these are sync commands with no events.
28. **`verboseContext` dropped** from every result, and with it the
    `--verbose` "Resolved context" and metadata blocks. The json
    envelope is unchanged, since the legacy serializers already
    stripped it.
29. **Fixture-only `DATABASE_CONNECTION_NOT_FOUND`** has no v8
    counterpart: in real mode an unknown connection is an API
    passthrough code on rotate and remove.
30. **`database-plan-limit.test.ts` trimmed to its provider cases.**
    Seven cases drove the ported `database show` through the legacy
    shell and are deleted; the mapped plan-limit error is covered by
    the v8 postgres tests, both with and without a subscription
    lookup result. The eleven provider unit cases stay, because the
    provider is the operation layer v8 calls (d2 §5): the plan-limit
    discriminator, the responses that must not be classified as plan
    limits, and the 3-second subscription-lookup timeout. The one
    behavior that goes with the deleted cases is the legacy shell's
    cancel path (exit 130 with `COMMAND_CANCELED` when the caller
    aborts during enrichment); in v8 cancellation is engine-owned.

#### Error code map

| legacy code | v8 code |
| --- | --- |
| `USAGE_ERROR` (database domain) | `POSTGRES.USAGE_ERROR` |
| `USAGE_ERROR` "Workspace required" (auth domain) | `AUTH.USAGE_ERROR` |
| `DATABASE_NOT_FOUND` | `POSTGRES.NOT_FOUND` |
| `DATABASE_AMBIGUOUS` | `POSTGRES.AMBIGUOUS` |
| `DATABASE_CONNECTION_MISSING` | `POSTGRES.CONNECTION_MISSING` |
| `DATABASE_CONNECTION_STRING_MISSING` | `POSTGRES.CONNECTION_STRING_MISSING` |
| `DATABASE_BACKUPS_UNSUPPORTED` | `POSTGRES.BACKUPS_UNSUPPORTED` |
| `DATABASE_RESTORE_CONFLICT` | `POSTGRES.RESTORE_CONFLICT` |
| `DATABASE_BACKUP_NOT_FOUND` | `POSTGRES.BACKUP_NOT_FOUND` |
| `DATABASE_API_ERROR` | `POSTGRES.API_ERROR` |
| `PLAN_LIMIT_REACHED` | `POSTGRES.PLAN_LIMIT_REACHED` |
| raw API `error.code` X | `POSTGRES.X` |
| `PROJECT_NOT_FOUND` / `PROJECT_AMBIGUOUS` / `PROJECT_SETUP_REQUIRED` / `LOCAL_STATE_STALE` / `LOCAL_PROJECT_WORKSPACE_MISMATCH` | the project group's codes, mapped by the single source in `v8/project/errors.ts` |
| `CONFIRMATION_REQUIRED` | unreachable — the engine's `CLI.CONSENT_REQUIRED` replaces it |
| `AUTH_REQUIRED` / `AUTH_CONFIG_INVALID` | unreachable behind `needs.credentials` |

#### Conformance rows

| command | inventory entry | rules applied | divergences |
| --- | --- | --- | --- |
| `postgres list` | `database list` | R-S2b-1, 2, 5, 9, 10; d2 §3.1 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 25, 26, 28 |
| `postgres show` | `database show` | R-S2b-1, 2, 5, 9, 10; d2 §3.2 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 26, 28 |
| `postgres create` | `database create` | R-S2b-1, 2, 4, 5, 9, 10; d2 §3.3 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 25, 27, 28 |
| `postgres usage` | `database usage` | R-S2b-1, 2, 5, 9, 10; d2 §3.4 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 26, 28 |
| `postgres restore` | `database restore` | R-S2b-1, 2, 3, 5, 9, 10; d2 §3.5 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 23, 24, 28 |
| `postgres remove` | `database remove` | R-S2b-1, 2, 3, 5, 9, 10; d2 §3.6 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 23, 24, 28 |
| `postgres backup list` | `database backup list` | R-S2b-1, 2, 5, 9, 10; d2 §3.7 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 26, 28 |
| `postgres connection list` | `database connection list` | R-S2b-1, 2, 5, 9, 10; d2 §3.8 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 26, 28 |
| `postgres connection create` | `database connection create` | R-S2b-1, 2, 4, 5, 9, 10; d2 §3.9 | 1, 2, 5, 6, 7, 9, 18, 21, 22, 27, 28 |
| `postgres connection rotate` | `database connection rotate` | R-S2b-1, 2, 3, 4, 5, 9, 10; d2 §3.10 | 1, 2, 5, 6, 7, 9, 21, 22, 23, 24, 27, 29 |
| `postgres connection remove` | `database connection remove` | R-S2b-1, 2, 3, 5, 9, 10; d2 §3.11 | 1, 2, 5, 6, 7, 9, 21, 22, 23, 24, 29 |

### D3 — the `bucket`, `branch` and `git` groups

Delivered: `bucket list|create|delete`, `bucket key list|create|delete`,
`branch list`, `git connect` and `git disconnect` — all nine commands,
`git connect` included.

`git connect` shipped in two parts. Everything but the wait for the
GitHub App installation landed first; the wait followed once the operator
extended the engine (commit c463aa1) with an optional `interval` on
`BrowserWaitRequest` and an `open-url` kind on `NextAction`, and settled
the three facts d3 §3.8 had pinned against a helper that could not supply
them. The four resolutions are recorded below as divergences 42 to 45 —
42 is the `open-url` change, 43 to 45 the rest — and in §3.8's STEP 5
RESOLVED block.

#### Divergences

D1's class entries 1 (exit codes), 2 (auto-login dropped), 5 (nextActions
from fix and nextSteps), 6 (package-runner strings dropped), 7 (`--trace`
→ `--log-level verbose`), 9 (engine blocks replace the legacy rail
rendering) and 18 (the shell-context adapter, used here for project
resolution) apply identically, as do D2's 26 (list data rows go to
stdout), 27 (pre-result progress lines dropped) and 28 (`verboseContext`
dropped). On top of them:

31. **Error-code maps** (see below), including the mechanical passthrough
    of raw API codes as `BUCKET.<code>`, `BRANCH.<code>` and
    `GIT.<code>`.
32. **`bucket delete` gains a consent prompt.** The legacy command had a
    `--confirm <bucket-id>` flag and no prompt at all. In v8 the flag is
    the engine's shared repeatable `--confirm`, with the same CLI
    spelling and the same exact-bucket-id value; interactively the user
    types the bucket id. The question is the legacy confirmation `why`
    sentence verbatim: "Deleting this bucket permanently removes all
    objects and access keys." The legacy `CONFIRMATION_REQUIRED` error is
    unreachable, so the bucket mapper has no entry for it and
    `meta.expectedConfirm` / `meta.receivedConfirm` are gone. `--yes`
    never grants consent; a wrong typed answer is `CLI.PROMPT_INVALID`,
    exit 2; cancelling with Ctrl-C or EOF settles `CLI.PROMPT_CANCELLED`,
    exit 3 — an exit code this command never produced before.
33. **`bucket key delete` still has no confirmation.** The legacy
    inconsistency ports unchanged: deleting a bucket needs consent,
    revoking one of its keys does not. Recorded for review, not fixed.
34. **Fixture-only errors die with the fixture machinery.**
    `BUCKET_NOT_FOUND`, `BUCKET_KEY_NOT_FOUND` and the bucket domain's
    `BRANCH_NOT_FOUND` were raised only by the fixture provider. In real
    mode the Management API's own code passes through as
    `BUCKET.<code>`, so none of the three has a v8 counterpart.
35. **`bucket key create --role` invalid values.** The engine's enum
    parse failure replaces commander's choices error. The controller's
    own defaulting is unchanged: any value that is not exactly `read`,
    the omitted flag included, is `read_write`.
36. **`bucket key create` credentials are a masked field block.** The
    four stdout lines are unchanged and exact —
    `S3_ENDPOINT=`, `S3_ACCESS_KEY_ID=`, `S3_SECRET_ACCESS_KEY=`,
    `S3_BUCKET=`, in that order — and the json `result` still carries the
    secrets. The human card gains the same four values as field rows,
    with `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` masked
    (`sensitive: true`); the legacy human output named no values at all.
37. **`branch list` keeps its resolution quirk.** It declares no
    `--project` flag and passes no command name to the resolver, so an
    unbound directory still reads "…and this command will not choose
    one…" and still lacks the retry-with-`--project` next step. The
    fixture-mode branch of the legacy controller — which returned
    `projectName: "not resolved"` and an empty list instead of erroring —
    has no v8 counterpart.
38. **`git connect` no longer refuses every scripted run.** It was
    ported declaring `needs: { interaction: true }`, which failed any
    non-interactive invocation before the handler ran — including the
    ones the legacy command completed happily, where the repository was
    already connected or the app already installed. Operator ruling
    2026-08-11 removed the declaration: only the install wait needs a
    person, and `prompt.browserWait` refuses a non-interactive session
    on its own. Remaining divergence from legacy: where the legacy
    command raised `REPO_INSTALLATION_REQUIRED` or `REPO_NOT_ACCESSIBLE`
    with the install URL in `meta`, v8 settles the engine's
    `CLI.INTERACTION_REQUIRED`, whose summary names the same URL and
    whose next action says to finish there and rerun.

39. **`git connect` and `git disconnect` keep their raw json result.**
    Neither had a serializer, so `--json` still emits
    `{ workspace, project, resolution, repositoryConnection }` —
    resolution object included, unlike the bucket and branch results,
    which strip or reshape. Unchanged; recorded for review.
40. **The legacy 401/403 → `AUTH_REQUIRED` mapping does not port.** The
    engine settles every real credentials failure itself, so what still
    reaches the git mapper is the permission residue of a returned 403.
    It maps mechanically to `GIT.AUTH_REQUIRED` — D1's class entry 14,
    same reasoning, including that entry's fix-text change: the offer
    to rerun in a TTY to sign in interactively is dropped, so the fix
    reads "Run prisma-cli auth login."
41. **`PROJECT_AMBIGUOUS`'s hardcoded `app deploy` next step ports
    verbatim** for `bucket list`, `bucket create` and the git commands, as
    it did in D1. A pre-existing quirk, recorded rather than fixed.
42. **Install-URL next steps become `open-url` actions.** The legacy
    `REPO_INSTALLATION_REQUIRED` and `REPO_NOT_ACCESSIBLE` errors put the
    raw install URL first in `nextSteps`, beside real commands.
    Conventions §4's mechanical mapping would turn it into a
    `run-command` whose command is a URL, which tells a consumer to
    execute it. `NextAction` now has an `open-url` kind and a `url`
    field, so the git mapper sends a `nextSteps` entry that is a URL to
    `{ kind: "open-url", label: <the URL>, url: <the URL> }` and leaves
    command strings on the `run-command` mapping. The URL text is
    unchanged.
43. **The install wait moves onto the engine's browser-wait helper.**
    The legacy handler opened the browser itself, wrote one wait line to
    stderr and ran its own poll loop. `ctx.prompt.browserWait` now owns
    all three: it emits one `endpoint` event carrying the wait sentence
    and the install URL — which is what the single legacy stderr line
    was — opens the browser, and polls on the engine clock. The handler
    supplies only the URL, the message, the cadence and the question
    being polled, and emits no events of its own. The poll question is
    unchanged: re-list the workspace's GitHub App installations and look
    for the repository in them.
44. **`opened` is dropped from the wait's terminal errors.**
    `browserWait` does not report whether the browser actually opened.
    Both legacy branches existed to make sure the user still had the
    install URL when no browser opened, and the engine now always writes
    the URL, so the distinction has no work left to do.
    `GIT.REPO_INSTALLATION_REQUIRED` therefore always carries the
    browser-opened fix text, "Finish installing the GitHub App in the
    browser, then rerun prisma-cli git connect.", and both terminal
    errors carry `meta: { repository, installUrl }` — the `opened` key
    is gone. Which of the two errors is raised is unchanged:
    `GIT.REPO_NOT_ACCESSIBLE` when at least one installation could be
    inspected, `GIT.REPO_INSTALLATION_REQUIRED` otherwise.
45. **The poll cadence is unchanged but now belongs to the engine.**
    `PRISMA_CLI_GITHUB_INSTALL_POLL_INTERVAL_MS` (default 2000) and
    `PRISMA_CLI_GITHUB_INSTALL_TIMEOUT_MS` (default 120000) are still
    read from the environment with the legacy positive-integer parsing —
    a non-positive or unparseable value falls back to the default — and
    are passed to `browserWait` as `interval` and `timeout`. The engine
    raises `CLI.BROWSER_WAIT_TIMEOUT` when the timeout elapses; the
    handler catches exactly that code and settles the legacy terminal
    error in its place, so the timeout the user sees is unchanged.
    Cancelling with Ctrl-C splits by timing: while the wait is sleeping
    between polls — where a user spends almost all of a two-minute wait —
    it settles `CLI.PROMPT_CANCELLED`, exit 3, where the legacy loop
    aborted with the shell's `COMMAND_CANCELED`, exit 130. When a poll
    request is already in flight the abort surfaces from the SDK client
    instead, and the engine settles `CLI.ABORTED`, exit 130 — the legacy
    exit code, unchanged. Both paths are tested. The split is accepted
    rather than smoothed over: reshaping the second into the first would
    mean catching the engine's own abort settlement inside the handler,
    and the engine is a hard boundary for this slice (conventions §14).

#### Error code maps

| legacy code | v8 code |
| --- | --- |
| `USAGE_ERROR` (bucket domain) | `BUCKET.USAGE_ERROR` |
| `BUCKET_KEY_SECRET_MISSING` | `BUCKET.KEY_SECRET_MISSING` |
| `BUCKET_API_ERROR` | `BUCKET.API_ERROR` |
| raw API `error.code` X (bucket) | `BUCKET.X` |
| `CONFIRMATION_REQUIRED` (bucket) | unreachable — the engine's `CLI.CONSENT_REQUIRED` replaces it |
| `BUCKET_NOT_FOUND` / `BUCKET_KEY_NOT_FOUND` / `BRANCH_NOT_FOUND` (fixture only) | unreachable in v8 |
| `BRANCH_API_ERROR` | `BRANCH.API_ERROR` |
| raw API `error.code` X (branch) | `BRANCH.X` |
| `USAGE_ERROR` (project domain, raised by git) | `GIT.USAGE_ERROR` |
| `REPO_PROVIDER_UNSUPPORTED` | `GIT.REPO_PROVIDER_UNSUPPORTED` |
| `REPO_ALREADY_CONNECTED` | `GIT.REPO_ALREADY_CONNECTED` |
| `REPO_INSTALLATION_REQUIRED` | `GIT.REPO_INSTALLATION_REQUIRED` |
| `REPO_NOT_ACCESSIBLE` | `GIT.REPO_NOT_ACCESSIBLE` |
| `REPO_NOT_CONNECTED` | `GIT.REPO_NOT_CONNECTED` |
| `REPO_CONNECTION_FAILED` | `GIT.REPO_CONNECTION_FAILED` |
| `AUTH_REQUIRED` (403 residue, git) | `GIT.AUTH_REQUIRED` |
| raw API `error.code` X (git) | `GIT.X` |
| `USAGE_ERROR` "Workspace required" (auth domain) | `AUTH.USAGE_ERROR` |
| `PROJECT_NOT_FOUND` / `PROJECT_AMBIGUOUS` / `PROJECT_SETUP_REQUIRED` / `LOCAL_STATE_STALE` / `LOCAL_PROJECT_WORKSPACE_MISMATCH` | the project group's codes, mapped by the single source in `v8/project/errors.ts` |

#### Conformance rows

| command | inventory entry | rules applied | divergences |
| --- | --- | --- | --- |
| `bucket list` | `bucket list` | R-S2b-2, 5, 9, 10; d3 §3.1 | 1, 2, 5, 6, 7, 9, 18, 26, 28, 31, 41 |
| `bucket create` | `bucket create` | R-S2b-2, 5, 9, 10; d3 §3.2 | 1, 2, 5, 6, 7, 9, 18, 27, 28, 31, 34, 41 |
| `bucket delete` | `bucket delete` | R-S2b-2, 3, 5, 9, 10; d3 §3.3 | 1, 2, 5, 6, 7, 9, 31, 32, 34 |
| `bucket key list` | `bucket key list` | R-S2b-2, 5, 9, 10; d3 §3.4 | 1, 2, 5, 6, 7, 9, 26, 31, 34 |
| `bucket key create` | `bucket key create` | R-S2b-2, 4, 5, 9, 10; d3 §3.5 | 1, 2, 5, 6, 7, 9, 27, 31, 34, 35, 36 |
| `bucket key delete` | `bucket key delete` | R-S2b-2, 5, 9, 10; d3 §3.6 | 1, 2, 5, 6, 7, 9, 31, 33, 34 |
| `branch list` | `branch list` | R-S2b-2, 5, 9, 10; d3 §3.7 | 1, 2, 5, 6, 7, 9, 18, 26, 28, 31, 37 |
| `git connect` | `git connect` | R-S2b-2, 5, 7, 9, 10; d3 §3.8 | 1, 2, 5, 6, 7, 9, 18, 31, 38, 39, 40, 41, 42, 43, 44, 45 |
| `git disconnect` | `git disconnect` | R-S2b-2, 5, 9, 10; d3 §3.9 | 1, 2, 5, 6, 7, 9, 18, 31, 39, 40, 41 |

#### Legacy tests deleted

- `bucket.test.ts` and `branch.test.ts` in full. Every case in both
  drove one of the seven ported bucket and branch commands through the
  legacy shell, help cases included, and neither file held a provider or
  adapter unit test. There is no bucket-provider unit test anywhere, so
  nothing survived them to keep.
- `project.test.ts`: the six git connect and git disconnect fixture
  cases. The project and env help cases stay — they belong to D1 and
  still pass, and one of them also asserts the legacy shell's git help,
  which lives until the shell is deleted in S2d.
- `project-real-mode.test.ts`: six cases in two passes. With the first
  D3 commit went connecting through an installed GitHub App, the
  already-connected-same-repository short-circuit, and disconnecting
  through the source-repositories API. Once `git connect`'s wait landed,
  three more followed: the non-interactive install intent when the
  workspace has no GitHub App installation, the interactive wait that
  connects after approval, and `REPO_NOT_ACCESSIBLE` when the App cannot
  see the repository. All six are covered by `v8-git.test.ts`.

Kept deliberately: `git-adapter.test.ts` (URL-parsing units for
`parseGitHubRepositoryUrl`, an operation-layer function v8 calls);
`branch-controller.test.ts` and `branch-usecases.test.ts` (unit tests for
the branch helpers, which survive as the operation layer — d3 §5's rule,
not the unported-group rule: `branch list` is ported and has a
conformance row); `read-branch.test.ts` and `local-branch.test.ts`
(unported, until S2d);
the two pagination-cursor-stall cases in `project-real-mode.test.ts`,
which cover `listScmInstallations` and `findRepositoryInInstallation`,
operation-layer functions v8 calls and does not otherwise cover; and the
one `project-real-mode.test.ts` case from the GitHub App install path,
"creates an install intent when the stored GitHub App installation is
unavailable". It drives a stored installation answering 422 and being
skipped inside `findRepositoryInInstallations`, an operation-layer
function v8 calls and does not otherwise exercise. Its three siblings
were held while `git connect`'s wait was unported and were deleted once
the wait landed and gave them v8 equivalents.

## S2c — services (service, build, agent, feedback)

Every known place where the S2c ports differ from the shipping
`prisma-cli`. Same entry format as `parity-divergences.md`; S2d
consolidates the per-slice files. The S1 whoami-scoped record and the
engine-global divergences (json framing, channel discipline, `--quiet`
as a log-level alias, dropped `--trace`, shared flag family, errored
settlements exit 2) apply to every command here and are not repeated.

### Dispatch 1 — service group core (show, open, list-deploys, show-deploy, domain add/show/remove/retry/wait)

#### The rename (R-S2c-1), one entry per command

`app` ports as `service` — paths, ids, help, presenters, error copy,
flags, positionals. No alias; the legacy `app` spellings do not exist
in the v8 tree.

| Legacy invocation | v8 invocation | Also renamed on this command |
| --- | --- | --- |
| `prisma-cli app show [app]` | `prisma-cli service show [service]` | `--app <name>` → `--service <name>`; result field `app` → `service` |
| `prisma-cli app open [app]` | `prisma-cli service open [service]` | `--app` → `--service`; result field `app` → `service` |
| `prisma-cli app list-deploys [app]` | `prisma-cli service list-deploys [service]` | `--app` → `--service`; result field `app` → `service` |
| `prisma-cli app show-deploy <deployment>` | `prisma-cli service show-deploy <deployment>` | result field `app` → `service` |
| `prisma-cli app domain add <hostname> [app]` | `prisma-cli service domain add <hostname> [service]` | `--app` → `--service`; result fields `app`/`appId` → `service`/`serviceId` |
| `prisma-cli app domain show <hostname> [app]` | `prisma-cli service domain show <hostname> [service]` | same as domain add |
| `prisma-cli app domain remove <hostname> [app]` | `prisma-cli service domain remove <hostname> [service]` | same, plus consent question "Detach … from App …?" → "… from Service …?" |
| `prisma-cli app domain retry <hostname> [app]` | `prisma-cli service domain retry <hostname> [service]` | same as domain add |
| `prisma-cli app domain wait <hostname> [app]` | `prisma-cli service domain wait <hostname> [service]` | same as domain add |

- Command ids follow: `app.domain.add` → `service.domain.add`, etc.
- Env override rename: `PRISMA_APP_ID` → `PRISMA_SERVICE_ID` (domain
  target selection; `PRISMA_PROJECT_ID` unchanged). The legacy name is
  NOT read in v8.
- NOT renamed: `prisma.compute.ts` keys (`app:`/`apps:` are
  SDK-owned; rename needs @prisma/compute-sdk coordination — flagged
  for the operator), and the shared local state file's internal keys
  (`state.json`'s `app.selectedByProject` — the store is still shared
  with the legacy shell until S2d).

#### Error-code mapping (flat → dotted `SERVICE.*`)

Every errored settlement exits 2 (engine rule; the legacy exit-1
errors below change as a class). `fix` prose maps to a `user-choice`
nextAction — appended after the legacy typed `nextActions` when an
error carries both (e.g. `PROJECT_SETUP_REQUIRED`), so no advice is
lost; command-shaped `nextSteps` map to `run-command` nextActions
with the renamed `service` spelling.

Rename inside ported error prose: command lines (`prisma-cli app …` →
`prisma-cli service …`) and the "app target" noun rename;
prose that names the SDK-owned config entries deliberately keeps
`app` — `defineComputeConfig({ app })` and
`ComputeConfigTargetUnknownError`'s "this config defines a single
app." refer to the `prisma.compute.ts` `app:`/`apps:` keys, which do
not rename until the compute-sdk coordination lands (decided, not an
accident of the substitution list).

| Legacy flat code (exit) | v8 dotted code (exit) | Commands |
| --- | --- | --- |
| `USAGE_ERROR` (2) — named target without a config | `SERVICE.COMPUTE_CONFIG_TARGET_UNKNOWN` (2) | show, open, list-deploys, domain * |
| `COMPUTE_CONFIG_INVALID` (2) | `SERVICE.COMPUTE_CONFIG_INVALID` (2) | show, open, list-deploys, domain * |
| `COMPUTE_CONFIG_TARGET_UNKNOWN` (2) | `SERVICE.COMPUTE_CONFIG_TARGET_UNKNOWN` (2) | all with `[service]` |
| `USAGE_ERROR` (2) — unknown `--app`/saved selection | `SERVICE.SELECTION_INVALID` (2) | show, open, list-deploys, domain * |
| `USAGE_ERROR` (2) — "App selection required in non-interactive mode" | engine `CLI.PROMPT_REQUIRED` (2) | show, open, list-deploys, domain * (see picker entry) |
| `USAGE_ERROR` (2) — domain target has no app | `SERVICE.DOMAIN_TARGET_REQUIRED` (2) | domain * |
| `USAGE_ERROR` (2) — invalid `--timeout` | `SERVICE.TIMEOUT_INVALID` (2) | domain wait |
| `USAGE_ERROR` (2) — "Workspace required" | `SERVICE.WORKSPACE_REQUIRED` (2) | all platform commands |
| `PROJECT_NOT_FOUND` (1) | `SERVICE.PROJECT_NOT_FOUND` (2) | show, open, list-deploys, domain * |
| `PROJECT_AMBIGUOUS` (2) | `SERVICE.PROJECT_AMBIGUOUS` (2) | same |
| `PROJECT_SETUP_REQUIRED` (1) | `SERVICE.PROJECT_SETUP_REQUIRED` (2) | same |
| `LOCAL_STATE_STALE` (1) | `SERVICE.LOCAL_STATE_STALE` (2) | same |
| `LOCAL_PROJECT_WORKSPACE_MISMATCH` (1) | `SERVICE.LOCAL_PROJECT_WORKSPACE_MISMATCH` (2) | same |
| `NO_DEPLOYMENTS` (1) | `SERVICE.NO_DEPLOYMENTS` (2) | open, domain add |
| `FEATURE_UNAVAILABLE` (1) — no live URL | `SERVICE.FEATURE_UNAVAILABLE` (2) | open |
| `DEPLOYMENT_NOT_FOUND` (1) | `SERVICE.DEPLOYMENT_NOT_FOUND` (2) | show-deploy |
| `DEPLOY_FAILED` (1) | `SERVICE.DEPLOY_FAILED` (2) | all remote-listing failures |
| `BRANCH_NOT_DEPLOYABLE` (2) | `SERVICE.BRANCH_NOT_DEPLOYABLE` (2) | domain * |
| `DOMAIN_HOSTNAME_INVALID` (2) | `SERVICE.DOMAIN_HOSTNAME_INVALID` (2) | domain * |
| `DOMAIN_NOT_FOUND` (1) | `SERVICE.DOMAIN_NOT_FOUND` (2) | domain show/remove/retry/wait |
| `DOMAIN_ALREADY_REGISTERED` (1) | `SERVICE.DOMAIN_ALREADY_REGISTERED` (2) | domain add |
| `DOMAIN_QUOTA_EXCEEDED` (1) | `SERVICE.DOMAIN_QUOTA_EXCEEDED` (2) | domain add |
| `DOMAIN_DNS_NOT_CONFIGURED` (1) | `SERVICE.DOMAIN_DNS_NOT_CONFIGURED` (2) | domain add |
| `DOMAIN_RETRY_NOT_ELIGIBLE` (1) | `SERVICE.DOMAIN_RETRY_NOT_ELIGIBLE` (2) | domain retry |
| `DOMAIN_VERIFICATION_FAILED` (1) | `SERVICE.DOMAIN_VERIFICATION_FAILED` (2) | domain wait |
| `DOMAIN_VERIFICATION_TIMEOUT` (1) | `SERVICE.DOMAIN_VERIFICATION_TIMEOUT` (2) | domain wait |

#### Auth (Q1 class)

The service group's legacy commands never auto-logged-in
(`requireComputeAuth`); v8 keeps that: `needs.credentials` settles
unauthenticated runs with the engine's `CLI.CREDENTIALS_REQUIRED`
(exit 2) instead of the legacy `AUTH_REQUIRED` (exit 1).

The workspace those commands then act in comes from the credential the
engine is authenticating with (`ctx.activeCredential()`), which is the
only sanctioned identity surface a handler has; no v8 command reads the
credential file itself. The entry below records what moving to it
fixed.

#### The workspace comes from the engine, not the credential file

`requireWorkspace` (`src/v8/service/target.ts`) used to call `readAuthState`, which builds a `FileTokenStorage` and asks it for tokens (`src/auth/operations.ts`). That legacy reader and the engine's credential manager resolve to the same file by default, and that file's shape is about to change. Today `auth login` writes the legacy `{tokens: […]}` shape through `storeLegacyCredential` and `FileTokenStorage` reads it. Once the auth rework merges down from `bot/s2a-foundations`, `auth login` calls `credentialManager.createSession` instead, which writes `{version, sessions, currentWorkspaceId}`; `@prisma/credentials-store` reads `data.tokens || []`, finds nothing, and the legacy reader reports nobody signed in while `credentialManager.currentSession()` still returns a valid session.

**This entry used to say the merge-down broke 13 of this slice's 20 commands and that the fix belonged to the auth stream. The count was right; the blame was not, and the misplaced part was ours.** That count describes the slice as it stood before `service deploy` and `service build` were dropped and before `service logs` was shelved, when it had 20 commands; it is history, and so is the list. With no tokens `readAuthState` returned `{authenticated: false}` and the command settled `SERVICE.WORKSPACE_REQUIRED`, so a credential file the legacy reader cannot parse made `deploy`, `show`, `open`, `list-deploys`, `logs`, `promote`, `rollback`, `remove` and all five `domain` commands unusable. But no v8 command should have been reading auth state that way at all. The engine hands a handler its identity through the credential manager, whose reader understands both the new `{version, sessions, currentWorkspaceId}` shape and the legacy `{tokens: […]}` one (`src/auth/state-file.ts` adopts the legacy store on read).

**`requireWorkspace` now reads `ctx.activeCredential()`. Of the 13 that broke, 11 still ship, and the fix repairs all 11.** `show`, `open`, `list-deploys`, `promote`, `rollback`, `remove` and all five `domain` commands resolve their workspace after the merge-down exactly as they do before it. The other two are gone from the slice: `deploy` is no longer a v8 command at all, and `logs` is shelved — both under dispatch 4. `show-deploy` was never affected: it is the one caller that swallows a workspace failure and degrades to a missing live-deployment hint. `build logs`, the three `agent` commands and `feedback` read no auth state at all.

**A workspace with no name now shows its id.** `ActiveCredential.workspaceName`
is optional where the old `AuthWorkspace.name` was required, so a
session the manager could not name — a workspace-bound service token,
or a login whose best-effort name fetch failed — presents as its
workspace id (`workspace: ws_…`) instead of failing. Legacy asked the
API for the name on every read and settled `WORKSPACE_REQUIRED` when it
could not build a workspace at all; v8 prefers the identifier the user
can still act on. `SERVICE.WORKSPACE_REQUIRED` is still raised when
there is no credential at all, and it is now also raised when there is
a credential that names no workspace — see the escalated entry that
follows this one.

**A credential that names no workspace is now refused instead of silently getting an empty one.** One commit before the merge-down, `ctx.session()` composed an environment credential's session as `workspaceId: serviceTokenWorkspaceId(token) ?? ""` (`src/auth/credential-manager.ts`), so a `PRISMA_SERVICE_TOKEN` whose claims name no workspace handed `requireWorkspace` `{id: "", name: ""}` and the run carried on: it filtered projects by an empty workspace id, found none, and named a blank workspace in the error it eventually produced. `ActiveCredential.workspaceId` is absent rather than empty in that case, `requireWorkspace` tests it, and the run settles `SERVICE.WORKSPACE_REQUIRED` instead. `tests/v8-service-session.test.ts` pins the refusal.

**The tests now seed one credential source.** Every service test used to
mock `readAuthState` at the module seam while the engine's credential
check was seeded through the credential manager, so the harness had two
credential seams where production has one file — which is why nothing in
the suite could see any of this. Those mocks are gone: the harness seeds
a session on the credential manager and both the credentials check and
the workspace come from it. `tests/v8-service-session.test.ts` pins the
direction, seeding a session that names a workspace the Management API
fake never reports for the project, so a run taking its identity from
anywhere else resolves a different project or prints a different name.
The refusal above is pinned there too, from a seeded
`PRISMA_SERVICE_TOKEN` whose claims name no workspace.

#### A service token whose workspace only the server knows is now refused (ESCALATED — engine gap)

**What legacy did.** With `PRISMA_SERVICE_TOKEN` set, `readAuthState` handed off to `readServiceTokenAuthState` (`src/auth/operations.ts`), which asked the server first: `readCurrentPrincipalAuthState` read `GET /v1/me`, documented in the Management API types as returning the user, workspace and credential the current token represents. When the server named a workspace, legacy used it and the command ran, whatever the token's own claims said. Only when that call produced nothing did legacy decode the token, and only then — finding no workspace in it — did it return signed-out state, which the old `requireWorkspace` settled as `SERVICE.WORKSPACE_REQUIRED`.

**What v8 does.** `requireWorkspace` reads `ctx.activeCredential()` and nothing else. For an environment credential the workspace id is `serviceTokenWorkspaceId(token)` (`src/auth/claims.ts`): the `workspace_id` claim, or a `sub` of the form `workspace:<id>`. There is no network call, and a credential that names no workspace is refused with `SERVICE.WORKSPACE_REQUIRED` — the same error, from the same builder, that legacy raised on the same input.

**The one case that differs.** A service token that the platform associates with a workspace, but whose JWT carries neither `workspace_id` nor a `sub` of the form `workspace:<id>`, used to work whenever `/v1/me` answered and named that workspace. It is now refused. Every other input behaves as it did: legacy refused the same token when it could not reach `/v1/me`, when the response carried no principal or no credential, and when the principal named no workspace. The claims derivation is otherwise wider than legacy's, which read only the `sub` form, so this is the single direction in which the new path resolves less. The difference arrived with the rev-6 credential model rather than with any command in this slice, but this slice is where it becomes visible: every service command resolves its workspace this way.

**The refusal's advice does not fit this case.** `SERVICE.WORKSPACE_REQUIRED` offers one next action, "Sign in" → `auth login`. Under `PRISMA_SERVICE_TOKEN` that cannot clear it: `createSession` writes the stored session but leaves the process pinned to the environment credential, so the next run resolves the same token and fails the same way until the variable is unset. Legacy's advice had the same hole, so this is not a regression — but the case is now reachable where before it produced an empty workspace. The wording is left to the auth stream, because the condition it fires on is an environment-credential state that stream owns.

**Why this is not fixed here.** Restoring the lookup would mean a service command calling `/v1/me` to complete its own identity. `ctx.activeCredential()` is documented local-only and deliberately never touches the network, and a command reaching around the engine for its own auth state is the exact mistake that produced the defect the entry above records. If identity needs a server round-trip when the claims are insufficient, it belongs in the credential manager, which owns the credential and can do it once for every command — not in one group's `requireWorkspace`.

**Ruling needed, from the operator and the auth stream:** whether the credential manager should complete an environment credential's workspace from the server when its claims carry none, or whether every token the platform issues is required to carry the claim, which closes this case in the token format instead.

#### `service domain remove` consent

Recorded with the group's other consent points in "Consent" under
dispatch 2 below — one table, one mechanism, for all three.

#### Interactive service picker

The legacy picker errored with per-command `USAGE_ERROR` copy in
non-interactive contexts and when a saved selection went stale
non-interactively. In v8 the engine prompt settles those runs with the
structural `CLI.PROMPT_REQUIRED` error (R-S2b-6); a stale saved
selection falls through to the picker in both modes.

#### `service open` browser launch

The legacy command opened the live URL whenever prompting was allowed
(TTY + not CI + not `--json`). v8 hands the URL to the engine's
`ctx.openUrl`, which announces it as an `endpoint` event and opens the
browser when the session is interactive. Differences from legacy: a
`--json` run in an interactive terminal now DOES open the browser
(legacy suppressed it because json implied non-interactive), a failed
open reports `opened: false` instead of raising, and the URL is also
printed as the stdout payload line (legacy printed nothing on stdout).

#### `service domain wait`

- Now a result command with engine `status` events (one per status
  change, `from`/`status`/`data.domainId`/`data.elapsedMs`) instead of
  the legacy streaming stderr lines / per-poll json events; json mode
  frames each status change exactly once (legacy emitted an event per
  poll cycle in json mode, including unchanged statuses).
- Success now settles with a result envelope
  (`{…target, hostname, status: "active", liveUrl}`); legacy ended
  with only the streaming success wrapper event.
- Poll interval still honors `PRISMA_CLI_DOMAIN_WAIT_POLL_MS`
  (default 5s); `--timeout` grammar unchanged (default `15m`, `0` =
  single check).

#### Result shape changes (all commands)

- `verboseContext` (the `--verbose` "Local context" block and json
  field) is dropped — `--verbose` is a log-level alias in v8 and is
  not otherwise retained. S2 ruling 8 drops `--trace` because log
  levels cover it; the same reasoning covers `--verbose`, which that
  ruling does not name.
- `service list-deploys` json result is the plain
  `{projectId, service, deployments}` record; the legacy
  `items`/`count` list-serializer wrapper does not port.
- Domain results drop the `branch.id` field (legacy emitted
  `branch: {id, name, kind}` with `id` always `null` for domain
  commands; v8 emits `branch: {name, kind}`).
- Human output: whoami-style summary + field rows (and a table for
  list-deploys) on stderr; these commands write no stdout payload in
  human mode except `service open`, which now prints the URL as its
  stdout payload line (pipe-clean; legacy printed nothing on stdout).
  Legacy opened every block with a present-progressive title ("Removing
  the selected app."). In v8 that summary line is the only success
  signal the engine prints, so a command that changed something ends on
  a past-tense `ok` line instead ("Removed hello-world and every
  deployment it owned."), and only the commands that merely report keep
  the informational heading.

#### Fixture mode

Legacy app commands refused to run in fixture mode
(`FEATURE_UNAVAILABLE` via `ensurePreviewAppMode`). The v8 tree has no
fixture mode, so the refusal path does not port (fixture machinery
dies in S2d).

### Dispatch 2 — promote, rollback, remove

#### The rename (R-S2c-1), one entry per command

| Legacy invocation | v8 invocation | Also renamed on this command |
| --- | --- | --- |
| `prisma-cli app promote <deployment> [app]` | `prisma-cli service promote <deployment> [service]` | `--app` → `--service`; result field `app` → `service`; error copy "App promote requires an existing app" → "Service promote requires an existing service" |
| `prisma-cli app rollback [app]` | `prisma-cli service rollback [service]` | same, plus "…requires an existing service" |
| `prisma-cli app remove [app]` | `prisma-cli service remove [service]` | same, plus the confirmation question "…app removal" → `Remove Service "<name>" and every deployment it owns?` |

Command ids follow: `app.promote` → `service.promote`, etc.

#### Consent (Q5 class; operator-ruled 2026-08-10 and 2026-08-11, shipped)

Consent is engine-owned and this is what ships: each consent point
declares a token — the natural noun of the action — so an interactive
session type-to-confirms it, and the engine's global repeatable
`--confirm <value>` grants it non-interactively when a supplied value
matches the token exactly (each value consumed once per run). No command
declares a consent flag of its own. `--yes` alone never grants consent;
`--yes` together with a matching `--confirm <token>` does, because it
takes the same non-interactive branch.

| Command | Legacy grant | v8 grant | Token |
| --- | --- | --- | --- |
| `service remove` | typed app name on a TTY; `-y/--yes` skipped it; non-interactive without `--yes` → `CONFIRMATION_REQUIRED` (exit 1) | type the service name interactively, or `--confirm <service>` | the service name |
| `service domain remove` | `-y/--yes` skipped the yes/no confirm | type the hostname interactively, or `--confirm <hostname>` | the hostname |
| `service rollback` | none — the command asked nothing and rolled production back | type the target deployment's id interactively, or `--confirm <deployment>` | the target deployment's id |

`service rollback`'s consent is new in v8, not a ported one: this is an operator ruling of 2026-08-11, and it answers the follow-up this file used to carry under "`service promote` / `service rollback`". The shipping CLI changes what production serves and asks nothing at all. **The token is the target deployment's id, not the service name.** The hazard the command carries is promoting the wrong deployment, and typing the service name would not make anyone look at which deployment is about to go live; typing `dep_123` does. The question names both — `Roll back Service "hello-world" to deployment dep_1 and make it live?` — and is asked after the target is resolved, because a user cannot consent to a deployment id the command has not chosen yet. It is asked on both paths: an explicit `--to`, and the resolved default. It is also asked when the target turns out to be the deployment already live, which is the one place a caller sees a behaviour change beyond the consent itself: `service rollback --to <already-live>` used to complete with a warning in a non-interactive run and now needs `--confirm <already-live>` to reach that same warning.

`service deploy`'s production replace was a consent point too, until deploy was dropped (see "`app deploy` and `app build` are dropped" under dispatch 4). The mechanism below is unchanged by its removal.

Transitions, identical on all three:

- **Granted** interactively by typing the token, non-interactively by
  `--confirm <token>`. `--confirm` never SKIPS an interactive prompt: an
  interactive session always type-to-confirms, whether or not the flag
  was passed. It is a non-interactive affordance only.
- **Wrong token typed interactively**: the engine's structural consent
  mismatch, exit 2. Legacy re-asked a bad yes/no answer and treated an
  explicit "no" as a cancellation, so what used to be a decline is now a
  mismatch — there is no longer a "no" to give.
- **Wrong or missing `--confirm` value non-interactively** (including
  under `--yes`): `CLI.CONSENT_REQUIRED`, exit 2, naming the expected
  value and carrying it as `meta.consentToken`. Legacy's
  `CONFIRMATION_REQUIRED` exited 1 (ledger Q5).

#### Error-code mapping (dispatch 2 additions)

| Legacy flat code (exit) | v8 dotted code (exit) | Commands |
| --- | --- | --- |
| `DEPLOY_FAILED` (1) | `SERVICE.DEPLOY_FAILED` (2) | promote, rollback |
| `REMOVE_FAILED` (1) | `SERVICE.REMOVE_FAILED` (2) | remove |
| `NO_PREVIOUS_DEPLOYMENT` (1) | `SERVICE.NO_PREVIOUS_DEPLOYMENT` (2) | rollback |
| `DEPLOYMENT_NOT_FOUND` (1) | `SERVICE.DEPLOYMENT_NOT_FOUND` (2) | promote, rollback |
| `USAGE_ERROR` (2) — "App promote/rollback/remove requires an existing app" | `SERVICE.TARGET_REQUIRED` (2) | promote, rollback, remove |
| `USAGE_ERROR` (2) — empty `--branch` | `SERVICE.BRANCH_INVALID` (2) | remove |
| *(no legacy code — legacy promoted the newest deployment and reported success)* | `SERVICE.LIVE_DEPLOYMENT_UNKNOWN` (2) | rollback (see the ruling below) |

The deploy-only rows this table used to carry went with the command; see "`app deploy` and `app build` are dropped" under dispatch 4. Two of those codes survive because a read command still raises them, and they keep their dispatch 1 rows: `SERVICE.PROJECT_SETUP_REQUIRED`, which still carries the candidate list and the suggested project name in `meta` exactly as legacy did, and `SERVICE.LOCAL_STATE_STALE`.

#### `--no-db` cannot be told apart from "not passed" (RETIRED — was an escalated engine gap)

Retired: this was escalated to the operator as an engine gap and became moot when `service deploy` was dropped, because `--db` was a deploy flag and no shipped command declares it. Kept here so the escalation list reads honestly — seven engine gaps went to the operator during this slice, three are now retired (this one, the `prompt.text` validator below, and the log-stream token under dispatch 3), and four are still open: the service token whose workspace only the server knows under dispatch 1, the `build logs` exit code under dispatch 3, and the `agent` group's help examples and the crash-recovery feedback action under dispatch 4. The dispatch 1 gap is the newest: it arrived with the rev-6 credential merge-down, after the drop ruling under dispatch 4 counted the open ones. All seven are marked where they are written, so the count can be checked against the entries.

The engine's boolean flag is two-state with an automatic `--no-<name>`
negation and a `false` default, so the legacy tri-state (`--db` request /
`--no-db` opt out / absent = prompt when a database signal is found) was
not expressible. v8 deploy shipped `--db` as the explicit request; both
absent and `--no-db` took the signal-driven prompt path, whose default
answer is No (so a non-interactive `--no-db` still skipped setup). The
legacy "passing both → USAGE_ERROR" check disappeared with the flag pair,
and so did "Database setup requires --yes in non-interactive mode" —
`--db` was itself the explicit request. The ask was smaller than a new
flag type: the engine already computes the missing fact at parse time and
sends it somewhere else. `explicitFlagKeys`
(`packages/cli-engine/src/execution/command-snapshot.ts`) scans argv for
which flag names appear and deliberately marks the base flag when it sees
a `--no-<flag>` token; `buildCommandSnapshot` then labels every declared
flag `source: "cli"` or `source: "default"`. Together with the parsed
boolean the handler already receives, that settles all three states:
`default` means absent, `cli` with `true` means `--db`, `cli` with
`false` means `--no-db`. The snapshot goes only to `RunHooks.onSettled`,
after the run, for telemetry; it never reaches `CommandContext`. So what
parity needed was an accessor that hands the handler a fact the engine
already holds — not a declarable tri-state boolean with its own negation
rules. Any future command that wants a three-way boolean will hit this
again.

#### `prompt.text` has no validator and no re-ask (RETIRED — was an escalated engine gap)

Retired: this was escalated to the operator as an engine gap and became moot when `service deploy` was dropped, because the first-deploy Project setup prompt was the only place in the slice that needed a validated text answer. No shipped command calls `prompt.text` with a value it must validate.

Legacy passed a `validate` function to the clack text prompt
(`lib/project/interactive-setup.ts`), so an invalid Project name was
re-asked in place and the deploy continued. The engine's `prompt.text`
takes only `placeholder` and `default` — no validator, no re-ask — so v8
deploy validated the answer afterwards and settled the whole command with
`SERVICE.PROJECT_NAME_INVALID` (exit 2). A user who typo'd during
first-deploy setup lost the run and reran deploy. The ask was a prompt
validator, or a re-ask affordance, on `prompt.text`; the next command that
takes a constrained text answer will need it.

#### `service promote` / `service rollback`

- The already-live short-circuit is unchanged, but the legacy `warnings`
  array becomes an engine warn diagnostic
  (`SERVICE.DEPLOYMENT_ALREADY_LIVE`), and no promote call or step events
  are emitted in that case.
- The SDK's promote progress lines become `status` events for the target
  deployment (`starting` → `start-requested` → the SDK's own status values →
  `running` → `promoting` → `promoted`) plus an `endpoint` event for the
  promoted URL, bracketed by a `promote` / `rollback` step.
- **`service rollback` now asks for consent** — this entry used to record
  that it did not, and flagged for the operator that rollback was the
  obvious next consent point with the target deployment id as its token.
  The operator ruled on it on 2026-08-11 and that is what ships: rollback
  is the group's third consent point, on exactly that token. Nothing is
  left open — see the consent entry above for the wording, the ordering
  and what changes for a non-interactive caller.

#### `service rollback` refuses to guess which deployment is live (operator ruling, 2026-08-11)

The second of the two rollback rulings, and like the consent it is a deliberate divergence rather than a port decision.

**What the shipping CLI does.** Without `--to`, rollback picks "the newest deployment that is not the live one" — `deployments.find((deployment) => deployment.id !== currentLiveDeploymentId)` (`src/controllers/app.ts`, `resolveRollbackTarget`). `resolveCurrentLiveDeploymentId` returns `null` when the service record, the platform's deployment listing and the local cache all fail to name a live deployment, and against `null` that predicate is true for every deployment. So the command takes the newest one — most likely the deployment already live — promotes it, and reports a successful rollback. The user is told production was rolled back when nothing moved, and the local cache is then written with that guess.

**What v8 does.** `resolveRollbackTarget` (`src/v8/service/release.ts`) refuses instead: with no `--to` and no identifiable live deployment it raises the new `SERVICE.LIVE_DEPLOYMENT_UNKNOWN` (exit 2), whose `why` says nothing names a live deployment and whose two typed next actions are `service rollback --to <deployment>` and `service list-deploys`. The refusal lands before the consent prompt, before any promote call and before any local state write.

The scope is exactly the ambiguous case:

- **`--to` given** — the user named the target, so there is nothing to resolve. Unchanged, including when the live deployment is unknown: the run promotes the named deployment and reports `previousLiveDeploymentId: null`, which the human presentation already renders as "unknown".
- **No `--to`, live deployment known** — unchanged: the newest deployment that is not the live one.
- **No `--to`, live deployment unknown** — the new refusal.
- **No deployments at all** — still `SERVICE.NO_PREVIOUS_DEPLOYMENT`, which is checked first. An empty listing has no live deployment either, but "there is no earlier deployment" is the more useful of the two answers, and the new error's advice — name a deployment, list them — would point at an empty list.

#### `service remove`

- The SDK's internal teardown polling becomes `progress` events
  (`stop-deployments`, `delete-deployments`, each with completed/total) and
  a `status` event (`removing` → `deleted`), bracketed by a `remove` step.
  This required an additive `progress` pass-through on the operation layer's
  `removeApp` (`packages/cli/src/lib/app/app-provider.ts`); legacy callers
  are unaffected.
- Local state cleanup failures become warn diagnostics
  (`SERVICE.LOCAL_STATE_CLEANUP_FAILED`) instead of the legacy `warnings`
  array; the removal still succeeds.

#### Result shape changes (dispatch 2)

- `verboseContext` is dropped on all three commands (S2 ruling 8, as recorded
  for D1).
- Result field `app` → `service` on every result.
- Legacy `warnings` (promote's already-live note, remove's cleanup failures)
  become engine diagnostics on the completed envelope.


### Dispatch 3 — the log stream (`build logs`)

#### The rename (R-S2c-1) does not reach this command

`build logs <buildId>` keeps its spelling; its command id is `build.logs`
and its errors move into the `BUILD.*` namespace.

This dispatch also ported `app logs` as `service logs`. That command is shelved and does not ship — see "`service logs` is shelved" under dispatch 4 — so the entries describing it are gone from this file, and the entries it shared with `build logs` now describe `build logs` alone.

#### Records become engine events (R-S2c-2)

`build logs` is a session command. Every record becomes an `output`
event, and the channel decides where human mode writes it: a record is
`diagnostic` when its source is `stderr` or its level is `error`, `data`
otherwise — the legacy routing exactly. A terminal record whose code is
not `end` (e.g. `no_logs`) is a `diagnostic` line, as legacy did.

Json mode: the engine frames one event per record and terminates with
exactly one result frame. Legacy `build logs` set
`emitJsonSuccessEvent: false` so its json stream had NO wrapper event;
that opt-out does not port — the engine's framing is uniform, so a
completed `build logs` now ends with a result frame. Each record's own
frame is an `output` frame with the engine's envelope shape
(`{kind, source, channel, line, commandId, timestamp}`) instead of the
legacy `{type, command, timestamp, data}` shape.

The record's own fields ride in the event's free-form `data`, so a json
consumer keeps everything legacy published per record: `cursor`,
`level`, `source` and `step` on a log record, and `kind`, `cursor`,
`code` and `retryable` on a reported terminal record (a `no_logs` end,
any error terminal).

Two json-surface losses remain, both because the engine owns rendering
and a handler cannot see the format:

- **The normal terminal record is no longer framed.** Legacy framed
  every record in json mode, including the terminal `end` that human
  mode printed nothing for; v8 emits no event for it. What a consumer
  loses: on a `build logs` run whose build produced no log records at
  all, `--json` now reports no cursor anywhere, so there is nothing to
  pass to `--cursor` on the next run. On a run that produced log records
  the last record's own cursor is the resume point, so nothing is lost
  there. Carrying it needs an engine event kind that is framed in json
  and silent in human mode; the only such kind is `remediation`, which
  carries a `NextAction` and means something else.
- **The header is framed too.** Legacy wrote its header only when
  neither `--json` nor `--quiet` was set. `--quiet` still hides it in
  v8 — it is `diagnostic` output, whose display severity is `info`,
  and `--quiet` is a log-level alias — but `--json` does not, because a
  handler cannot read the format and must not branch on it. A json
  consumer therefore reads one extra `output` frame before the records
  ("Streaming logs for build <id>").

`build logs` defaults to json when stdout is not a TTY (engine
auto-format), where legacy defaulted to human text unless `--json` was
passed.

#### `build logs`: a failed build cannot exit 1 (ESCALATED — engine gap)

Legacy set `process.exitCode = 1` on a terminal `error` record and let
the stream close normally: the logs printed, and the CLI reported the
build's failure through the exit code. The engine has no equivalent —
a session command returns `Result<void>` and carries no exit-code set,
and documented exit codes are constrained to 4–99
(`packages/cli-engine/src/execution/command-tree.ts` validateExitCodes),
so exit 1 is reachable only through the engine's own internal-error
path. v8 therefore streams every record and then settles the run as an
errored envelope, `BUILD.FAILED` (exit 2), carrying the terminal
record's message, code, retryable flag and cursor, plus a
`build logs <id> --cursor <cursor>` resume action.

The failure is still reported and still non-zero, but the code changes
1 → 2 and the settlement is an error rather than a clean close. Ruling
needed: either the engine grows a stream termination status (or allows
a documented exit 1), or `build logs` becomes a result command with a
documented code in 4–99. One line in `src/v8/build/logs.ts` changes
either way.

#### `service logs`: the log stream has no sanctioned token (RETIRED — was an escalated engine gap)

Retired: this was escalated to the operator as an engine gap and became unreachable when `service logs` was shelved, because no shipped command asks for a raw token. It is the gap the shelve waits on, so the description below stays as the statement of what the engine has to grow before the command can be ported — see "`service logs` is shelved" under dispatch 4.

Everything from here to the end of the entry describes the base this slice was written against, before the rev-6 credential merge-down; it is kept as the statement of the ask, not as a description of the tree today.

The log stream did not go through the Management API client: it opened
its own connection and needed the raw access token (legacy built one
from `PRISMA_SERVICE_TOKEN` or the token file in
`createPreviewLogAuthOptions`). On that base the only accessor that
reached a session command at all was `ctx.getCredentials()`, which the
engine already documented as staged for deletion:

- `ctx.session()` — the accessor that named the workspace, which the
  rev-6 model later replaced with `ctx.activeCredential()`, never
  alongside it — deliberately omitted the token. The engine's comment
  on it read "The token is INTERNAL" at the time; that sentence is gone
  from `credential-manager.ts` now, and the rule it stated survives as
  "Carries no token material".
- `ctx.credentialManager` (whose `tokenStorage()` was marked
  engine-facing) was exposed only to result commands that declared
  `managesCredentials`.
- `ctx.getCredentials()` forwarded straight to
  `runtime.getCredentials()` and never consulted the credential
  manager. The shipping bin wired `makeGetCredentials(proc.env)`, which
  returned `PRISMA_SERVICE_TOKEN` when it was set and otherwise
  whatever `FileTokenStorage` read out of the credential file — the
  same two sources, in the same order, that legacy used.

v8 asked `ctx.getCredentials()` and, when it resolved nothing, settled with `SERVICE.LOG_STREAM_CREDENTIALS_UNAVAILABLE`; that error builder is deleted with the command. Whether it ever fired was decided by the shape of the credential file rather than by whether the user was signed in, which is the trap this entry existed to record. On that base `auth login` wrote the legacy `{tokens: […]}` shape through `storeLegacyCredential` and `FileTokenStorage` read it, so the error was unreachable. Once the auth rework merged down from `bot/s2a-foundations`, `auth login` called `credentialManager.createSession` instead, `@prisma/credentials-store` read `data.tokens || []` and found nothing, and every signed-in user who had not set `PRISMA_SERVICE_TOKEN` would have hit it. The workspace half of the same problem was real for the commands that do ship, and it is fixed — see "The workspace comes from the engine, not the credential file" under dispatch 1.

A second, smaller engine ask retires with this one, and it is why the `service logs` tests were red. Those tests seeded `rawTokenSeed`, which selected `createTestCli`'s manager-less runtime — the only way the harness made `ctx.getCredentials()` resolve a token. A manager-less runtime had no session at all, so once the workspace came from `ctx.session()` every one of those runs settled `SERVICE.WORKSPACE_REQUIRED`. The shipping bin wired a credential manager and `getCredentials` together (`src/v8/runtime.ts`), but `createTestCli` rejected that combination (`packages/cli-engine/src/testing.ts`), so no harness could model the runtime the product assembled. The tests are deleted with the command and the seed is gone from the testkit; whatever transport the engine grows for the ported command will need a harness seam of its own.

**Settled by the merge-down.** The runtime this whole entry describes no longer exists: the rev-6 credential surface has landed here and **deleted `getCredentials` outright**, so there is now no accessor a command could take a token from, and `ctx.session()` is `ctx.activeCredential()`. Shelving the command was therefore the only correct call rather than a cautious one — had it shipped, it would now fail to compile rather than merely fail at runtime. The harness inconsistency retires with the accessor it was about.

#### Error-code mapping (dispatch 3 additions)

| Legacy flat code (exit) | v8 dotted code (exit) | Commands |
| --- | --- | --- |
| `BUILD_NOT_FOUND` (1) | `BUILD.NOT_FOUND` (2) | build logs |
| `BUILD_LOGS_FAILED` (1) | `BUILD.LOGS_FAILED` (2) | build logs |
| *(exit code 1, no error)* | `BUILD.FAILED` (2) | build logs (see the gap above) |

#### `service open`'s announced URL

`ctx.openUrl` carries one string that is both the human label and the
endpoint event's `name`, so the slug `live-url` became the human phrase
`Live URL`. The json `endpoint.name` changes with it; endpoint events
are a v8-only surface (legacy emitted none), so nothing that shipped
depends on the old spelling.


### Dispatch 4 — agent, feedback, closure

No rename applies here: R-S2c-1 covers the `app` group only, so
`agent install|update|status` and `feedback` keep their legacy
spellings, flags, positionals and result records. Command ids are
`agent.install`, `agent.update`, `agent.status` and `feedback`.
Neither group touches the Management API or declares
`needs.credentials`, so the Q1 auth class does not apply to them.

#### Error-code mapping (flat → dotted)

| Legacy flat code (exit) | v8 dotted code (exit) | Commands |
| --- | --- | --- |
| `AGENT_SKILLS_INSTALL_FAILED` (1) | `AGENT.SKILLS_INSTALL_FAILED` (2) | agent install, agent update |
| `USAGE_ERROR` (2) — empty message | `FEEDBACK.MESSAGE_REQUIRED` (2) | feedback |
| `USAGE_ERROR` (2) — message over 4000 characters | `FEEDBACK.MESSAGE_TOO_LONG` (2) | feedback |
| `USAGE_ERROR` (2) — malformed or over-long `--email` | `FEEDBACK.EMAIL_INVALID` (2) | feedback |
| `FEEDBACK_SEND_FAILED` (1) | `FEEDBACK.SEND_FAILED` (2) | feedback |

The engine validates neither string length nor pattern, so the three
`FEEDBACK.*` argument checks stay hand-rolled in the handler, with the
legacy limits, the legacy order, and the same refusal before any
network call. The one argument failure the engine owns is a missing
`<message>`, which settles as its own usage error
(`CLI.INVALID_ARGUMENTS`, exit 2).

`agent status` has no error path at all, in legacy or in v8: a skills
CLI that cannot be read degrades to a warning (below), never to a
failed run.

#### `feedback`'s json output: the envelope reshape, and nothing command-specific

An earlier draft of this entry claimed `feedback` gained a json envelope
it never had, because it registered no `renderJson` serializer. That was
wrong, and the correction matters for anyone reading this file to judge
parity. Legacy's `runCommand` writes a full envelope for every command
and consults the serializer only for the `result` field —
`result: presenter.renderJson ? presenter.renderJson(success.result) :
success.result` (`packages/cli/src/shell/command-runner.ts:110-116`).
With no serializer, `result` simply carried the raw result object, which
for this command is what a serializer would have produced anyway.

So `feedback` has no command-specific json divergence. Its `--json`
output changes exactly as every other ported command's does, through the
engine-global envelope reshape this file's preamble already covers
(`{ok, command, result, warnings, nextSteps, nextActions}` becomes
`{ok, commandId, result, exitCode, diagnostics, nextActions}`). The
`result` payload itself is unchanged: `{id, email, context: {cliVersion,
nodeVersion, platform, arch}}`. The submitted payload, the 3-second
timeout, the `PRISMA_CLI_FEEDBACK_URL` override (read from `ctx.env`)
and the default endpoint are all unchanged.

#### `agent install` / `agent update`

- Legacy's single `nextSteps` line ("Run … to verify the installed
  Prisma skills.") becomes the `run-command` nextAction "Verify the
  installed Prisma skills", carrying the same package-manager-aware
  command string. A `--dry-run` still offers nothing, as legacy did.
- The install failure keeps the installer's own command line, now as a
  typed `run-command` nextAction ("Retry the installer directly")
  instead of a free-text `nextSteps` entry plus the separate fix "Run
  the command below to retry the installer directly." The legacy
  `debug` field (the installer's stack) disappears with `--trace`
  (engine-global divergence).
- Flags, defaults and the built installer command line are unchanged,
  including `--copy` forced on Windows, `--all-agents` sending
  `--agent *`, and the package manager detected from the project.
- Human output is the engine's summary line plus field rows instead of
  the legacy rail-drawn block. Neither writes a stdout payload. Since the
  engine-colour slice the field rows align and their keys carry the accent
  colour, byte-equal to the legacy `renderFieldRows`; the rail itself is
  available as `fields.rail` but not yet set here.
- **Help examples lose the package runner, and the command now spells itself two ways (ESCALATED — engine gap).** Legacy rendered the `agent` group's examples through the project's own runner (`resolvePrismaCliPackageCommandFormatterSync`), so help read `pnpm dlx @prisma/cli@latest agent install`. The operator ruling of 2026-08-09 on the engine interface says examples are written without the binary name — the engine substitutes `{bin}`, or prepends the CLI name to an example that carries none (`assets/engine/engine-interface-draft.ts`, `HelpSpec.examples`) — so the ported examples are bare (`agent install`). The engine has no way to express the old form: examples are static strings resolved at definition time, and the runner is discovered from the filesystem at run time. The visible consequence is that one command now names itself two ways — help says `agent install`, while the same command's own next action still carries the package-runner form `npx -y @prisma/cli@latest agent status`, because next actions are built at run time and keep legacy's string. Worth settling once, group-wide, alongside the same question for every other ported group; nothing here should diverge on its own.

#### `agent status`

- Legacy's `warnings` array becomes an engine warn diagnostic,
  `AGENT.SKILLS_LIST_UNAVAILABLE`, with the same sentence (including
  the project-scope "Falling back to skills-lock.json"). The run still
  completes with exit 0 and still reports `statusSource` as
  `skills-lock` or `unavailable`.
- Legacy's `nextSteps` line ("Run … to install or refresh Prisma
  skills.") becomes the `run-command` nextAction "Install or refresh
  Prisma skills" with the same command string, offered on the same
  condition (no skills installed).
- The result record is unchanged field for field. Human output is a
  summary line, field rows and a skills table instead of the legacy
  rail-drawn block. Since the engine-colour slice the rows and the table
  align and carry the accent colour; only the rail is still absent, and
  it is now a per-command opt-in rather than a missing capability.

#### `app run` is dropped (operator ruling, 2026-08-10)

`prisma-cli app run` has no v8 counterpart and is not coming back:
Composer's commands supersede it. This is a ruled drop, not a
deferral. There is no `service run` port, and S2d needs no
legacy carve-out, because deleting the commander shell deletes the
command with it. (This entry also said there was no engine mechanism
for passing a child process's exit code through, which is what ledger
Q2 asked about. True when written; S3 built one for composer's
converge — `ctx.spawn` and the `exitWithChildStatus` settlement. The
drop stands, and Q2 stays closed by it: the mechanism now exists and
the command still does not.) Anyone running a local dev server through
`prisma-cli app run` moves to Composer.

#### `app deploy` and `app build` are dropped (operator ruling, 2026-08-10)

`prisma-cli app deploy` and `prisma-cli app build` have no v8 counterpart. Composer supersedes both. Like `app run`, this is a ruled drop and not a deferral: neither command will be ported as it stands, so there is no `service deploy` and no `service build`, and this ruling took the slice from 20 commands to 18. (The `service logs` shelve below then took it to 17, which is what ships.)

The reasoning is about the shape of the command, not about how the port went. `app deploy` conflates two different jobs — compiling the service on the developer's machine, and uploading the resulting tarball to the platform — and that shape is wrong. Future commands are to work directly with platform Compute resources instead of shipping a locally built archive. `app build` is the local-compiling half of the same job, so it goes with it.

Nobody loses a command today. The legacy commander shell still serves `app deploy` and `app build`, and keeps serving them until S2d deletes the shell. What that deletion replaces them with is a Composer question, not a port question, so unlike `app run` this drop does leave something for S2d to answer.

Two engine gaps escalated during this slice existed only for `app deploy` and are retired with it: the `--db` / `--no-db` three-way flag problem, and the missing validator on `prompt.text`. Both are recorded as retired entries under dispatch 2, so this ruling took the open escalations from six to four (the `service logs` shelve below then took them to three; the rev-6 credential merge-down later added a seventh gap, open, under dispatch 1). The consent table under dispatch 2 loses `service deploy`'s production replace and is down to two consent points (the 2026-08-11 ruling on `service rollback` later made it three again). The dispatch 1 and dispatch 2 divergence entries that described only these two commands are gone, and the entries that covered several commands now name only the ones that ship.

The tap this slice added to legacy code for `service build` is reverted. `executeAppBuild` and `resolveAppBuildStrategy` (`packages/cli/src/lib/app/build.ts`) had gained an optional `io` parameter so the v8 command could stream the bundler's per-line output as engine events; nothing in the legacy shell ever passed it, so the parameter is removed and the file is back to what it was.

#### `service logs` is shelved (operator ruling, 2026-08-10)

`prisma-cli service logs` does not ship in this slice. This is a shelve, not a drop: unlike `app deploy`, the command is coming back in the shape it has, as soon as the engine can carry the connection it needs. Nothing about the command is wrong; the engine cannot yet transport it. The slice ships 17 commands.

The reason is the transport. The log endpoint (`/v1/deployments/{deploymentId}/logs`) is an HTTP request that upgrades to a **WebSocket**, so the compute SDK opens its own socket and sets an `Authorization` header on the upgrade. The engine's API client is HTTP-only and cannot open or authenticate a socket, which is why the ported command reached for a raw token through `ctx.getCredentials()` — and the ruled credential design says commands never receive credentials. Porting it correctly therefore waits on the engine owning authenticated WebSocket transport. The operator has ruled that engine work into a later slice, and the orchestrator is writing its design now; when it lands, the command returns as it stands, with its handler asking the engine for a stream instead of asking for a token.

Two facts about the endpoint belong in the record, because whatever the engine grows has to serve them. The endpoint is marked **experimental** in the Management API specification, so its shape is not yet a stable contract. And the stream ends after ten minutes: continuing means reconnecting with the cursor the stream last reported, so a long tail is a sequence of connections, not one.

What went with the command: `src/v8/service/logs.ts` and `tests/v8-service-logs.test.ts`; its mount in `src/v8/cli.ts`; the `SERVICE.LOG_STREAM_CREDENTIALS_UNAVAILABLE` error builder and the two `SERVICE.DEPLOYMENT_NOT_FOUND` variants only it raised (a deployment with no service, and a deployment outside the resolved project); `getCredentials` on the service commands' `ServiceContext`, which no shipped command now needs; and the read flow's `skipSelectionWhenUnnamed` / `namedService` pair, which existed only so a bare `--deployment <id>` could skip the service picker. The escalated log-stream token gap is retired with it (dispatch 3), and so is the smaller harness ask that kept its tests red. The legacy `prisma-cli app logs` still ships and still streams, until S2d deletes the commander shell.

#### Surviving commands no longer suggest a follow-up command

Ten typed next actions across the shipped commands told the user to run `service deploy`, which the binary has not answered to since `app deploy` was dropped. They are removed. The errors and results keep their explanation and lose the action, so an empty `nextActions` array is now a normal outcome — `service show` on a project with nothing deployed, `service list-deploys` with an empty listing, and a failed deployment listing all offer nothing to run.

The removals: `SERVICE.NO_DEPLOYMENTS`, `SERVICE.TARGET_REQUIRED` and `SERVICE.NO_PREVIOUS_DEPLOYMENT` lose "Deploy the service"; `SERVICE.DOMAIN_TARGET_REQUIRED`, the `PRISMA_SERVICE_ID` selection error and the domain-add 422 lose "Deploy to production"; `service list-deploys`'s own `SERVICE.DEPLOY_FAILED` loses the single action it carried; and the `service show`, `service list-deploys` and `service remove` presentations lose theirs. All ten are pinned by tests asserting the surviving actions exactly.

One of the ten needed a replacement rather than a straight removal. The domain-add 422 carried two legacy next steps in order — deploy to production, then rerun `domain add` — plus the `fix` line "Deploy the app to the production branch, then rerun the domain command." Removing the first step left the second one telling the user to rerun the command that had just failed, and the `fix` line had never been carried across as the advice action this file's preamble says every `fix` becomes. The advice is now carried, worded for the commands v8 has: "Promote a deployment on the service's production branch, then add the domain again."

They can come back pointing at Composer once those commands exist. Nothing about the underlying situation changed — a user with no deployment still has to deploy something — so this is a loss of guidance, not of capability.

#### The crash-recovery feedback action does not port (ESCALATED — engine gap)

Legacy pre-filled a bug report on every unexpected error. The shell
caught the crash, built `prisma-cli feedback "<command> crashed:
<first line of the error>"` (`src/shell/output.ts:104`), and shipped
it twice: as a human next-step line and, under `--json`, as a typed
`recover` nextAction inside the `UNEXPECTED_ERROR` envelope
(`src/shell/output.ts:120`, wired at `src/cli.ts:72,86`). The
inventory records this under `feedback`, and the S2c contract asks the
v8 shell to keep an equivalent.

It cannot, on the current engine. The engine settles unexpected
failures itself: `settleBug`
(`packages/cli-engine/src/execution/settlement.ts`) emits
`CLI.INTERNAL_ERROR` with `nextActions: []` written into the envelope
literally, and `settleUnhandled` does the same for framework-level
failures. The only seam a bin may attach is `CliRunHooks.onSettled`,
which receives a `RunSummary` of `{commandId, exitCode, durationMs,
snapshot}` — no error object, no message — and which fires after the
envelope has already been written. Nothing reachable from the shell
ever sees the crash.

So a v8 crash is the engine's own `CLI.INTERNAL_ERROR` envelope (exit
1) with no recovery action: the user is not offered the pre-filled
report, and an agent gets no `recover` action to run. The command it
would have pointed at (`feedback`) is ported and works; only the
automatic pre-fill is gone.

Ruling needed, and the affordance is small. The engine would need an
internal-error contribution point — for example
`createCli({onInternalError: (context: {commandId, error}) => readonly
NextAction[]})`, or the same as a `CliRunHooks` member — called from
`settleBug` and `settleUnhandled` before the envelope is emitted, with
the returned actions merged into `nextActions`. The shell would then
supply exactly the legacy action, in both human and json mode.

No partial version is worth shipping in the meantime. The bin can see
only the run's exit code, so anything it printed afterwards would be a
generic hint with no failing-command text, it would arrive after the
run's terminal output, and it could not reach the json envelope at all
— which is the surface the legacy action existed for. Wrapping every
handler body in a catch that rethrows unknown errors as a structured
one is reachable without an engine change, but it is not the same
thing: it would have to be repeated in every command, it would change
the crash's code and exit code (`CLI.INTERNAL_ERROR` exit 1 becomes a
group error exit 2), and it would still miss every crash outside a
handler — parsing, the needs checks, prompting, presentation — which
is where an unexpected failure is most likely.

## S2d — init, version, and the host surface

Divergences introduced by the S2d work on `version` and `init`. Grows as the slice proceeds; the closing dispatch folds this, `parity-divergences-s2b.md`, the S2c list and the auth-owned `parity-divergences.md` into one document for operator sign-off.

One entry needs an explicit decision rather than a nod, and is marked **DECIDE**.

### `version` — the command does not port. RULED (operator, 2026-08-11): removed.

R-S2d-2 asked for the `version` command to be ported. It is not, and the reasoning belongs in the record because the contract said otherwise.

The engine already answers the question. `--version` is a pre-parse fast path (`settleVersion`, `packages/cli-engine/src/execution/settlement.ts`) that prints the version in human mode and emits `{"commandId":"version","result":{"version":"…"}}` in json. Legacy had the same split, and the command inventory's own note on `version` says the port should unify the two rather than carry both forward.

Nothing else the command reported survives scrutiny:

- **`invocation`** (`dev | npx | bunx | global | unknown`) had exactly one consumer in the whole codebase: the presenter that printed it. It was derived from `process.argv[1]` — the process inspecting how it was launched, which is precisely what the engine withholds argv from handlers to prevent. Restoring it would have meant piping an environment fact through the runtime to a command, and no command may reach for the environment that way.
- **node version, platform and arch** are collected for bug reports by the command that actually needs them: `controllers/feedback.ts` builds its own `{cliVersion, nodeVersion, platform, arch}` context. A separate command that prints them for a human to copy is not the mechanism.

**Consequence for R-S2d-5.** `version` becomes a ruled removal, alongside `service build`, `service deploy`, `service run` and the mock-only login flags. The grammar completeness check must exclude it, or it will report the command as missing against the inventory.

**Consequence for users.** `prisma-cli version` stops existing; `prisma-cli --version` answers instead, printing the version alone rather than a three-line card.

### `init`

#### Class divergences

1. **Exit codes.** Every errored settlement exits 2. Legacy `INIT_CONFIG_EXISTS`, `INIT_CONVERT_UNSUPPORTED`, `INIT_CONVERT_INCOMPLETE` and `INIT_DETECTION_FAILED` exited 1; `COMPUTE_CONFIG_INVALID` and the usage errors already exited 2.
2. **Error codes are dotted** under `INIT.*` — see the map below.
3. **NextActions.** The legacy `fix` prose becomes one `user-choice` action; each legacy `nextSteps` string becomes a `run-command` action.
4. **Human rendering** is engine blocks rather than the legacy rail-and-card bytes. Every sentence ports verbatim.
5. **The written config path goes to stdout** in human mode. Legacy human mode wrote nothing to stdout.
6. **`warnings: string[]` becomes coded diagnostics.** The five legacy warning sentences keep their text and gain codes.

#### Init-specific divergences

7. **`--format <ts|json>` is renamed `--config-format <ts|json>`.** The engine reserves `--format` globally for the output format (`RESERVED_FLAG_NAMES` in `packages/cli-engine/src/execution/shared-flags.ts`), and the legacy flag means the format of the config file it writes. Values, defaults and behaviour are unchanged, including the conversion path where an explicit `ts` over an existing `prisma.compute.json` rewrites and deletes it.
8. **`--config-format` no longer accepts `typescript`, mixed case, or surrounding whitespace.** Legacy trimmed and lower-cased the value and took `typescript` as a synonym for `ts`. The engine's enum accepts exactly `ts` and `json`; anything else is the parser's `CLI.INVALID_ARGUMENTS` rather than a `USAGE_ERROR` reading "Unknown config format".
9. **Auto-login is dropped from the link step** (R-S2d-1). Legacy reached `requireAuthenticatedAuthState`, which could open a browser sign-in on a terminal. The port reads the credential the way `auth whoami` does. Signed out, the step reports the new status `link.status: "unauthenticated"`, records `INIT.LINK_REQUIRES_SIGN_IN` at warn severity, and offers `prisma-cli auth login` as a next action. `unauthenticated` is a new value in the json result's status union.
10. **The three optional steps now default to no.** **DECIDE.** The engine has one knob where the legacy CLI had two: a preselected answer when it asks, and a separate behaviour when nobody can be asked. `prompt.confirm`'s `default` serves both, because `--yes` and non-interactive take the same branch and a handler cannot read TTY state. Defaulting install-types, link and the agent-skill offer to yes would make `init --yes` in CI run a package-manager install, call the Management API and write agent-skill files into the repo, none of which today's command does; it would also produce a spurious warning on every unattended signed-in run, because the project picker has no default. Defaulting them to no keeps unattended runs behaving exactly as they do today. **The cost:** an interactive user presses `y` rather than Enter to accept each of the three, and the prompt reads `(y/N)` where it read `(Y/n)`. One line per prompt to flip if the other trade is preferred.
11. **`declined` where the legacy said `skipped`.** Because the handler cannot tell a person's "no" from a default answer, an unattended run reports `types.status: "declined"` and `link.status: "declined"` where legacy reported `"skipped"`. Both render the same sentence; only the json result differs. `"skipped"` still means `--no-install` / `--no-link`, no `package.json`, or the JSON config format.
12. **Cancelling the install or link question aborts the run.** Legacy caught the cancel, recorded `declined` and finished at exit 0. A cancelled prompt is now the engine's `CLI.PROMPT_CANCELLED` at exit 3. A config file already written stays on disk.
13. **The agent-skill offer is suppressed in CI via `ctx.env.CI`**, following `v8/auth/agent-setup-tip.ts`; legacy suppressed it through `canPrompt`, which the handler can no longer read. **Residual gap worth review:** a non-CI run with no terminal (piped stdin) answers the offer from its default and records a dismissal in the state directory that nobody gave, which would stop a later `app deploy` offering it. Legacy neither asked nor recorded anything there.
14. **The settings preview is a commentary event, not a styled stderr block.** Same padded columns, same position — after the adjust question, before the write. The source column is no longer dimmed, it is suppressed by the log level rather than by a flag check, and under `--format json` it is a framed `message` event rather than being hidden.
15. **Step events are new stderr commentary** (`▸ write-config`, `✔ install-types`, and so on). The legacy `Installing @prisma/compute-sdk...` line is gone; the `install-types` step event replaces it.
16. **The human next steps now include the types-install command.** The legacy presenter listed only `app deploy` and `project link`, while its json `nextSteps` also carried the install command. There is now one list, and it is the json one.
17. **An invalid port typed at the adjust prompt fails the run.** Legacy passed a `validate` callback so the prompt re-asked. `prompt.text` has no validation hook, so an out-of-range answer settles as `INIT.HTTP_PORT_INVALID` (exit 2) after the framework has already been chosen.

#### Error code map

| legacy | v8 |
| --- | --- |
| `INIT_CONFIG_EXISTS` | `INIT.CONFIG_EXISTS` |
| `INIT_CONVERT_UNSUPPORTED` | `INIT.CONVERT_UNSUPPORTED` |
| `INIT_CONVERT_INCOMPLETE` | `INIT.CONVERT_INCOMPLETE` |
| `INIT_DETECTION_FAILED` | `INIT.DETECTION_FAILED` |
| `COMPUTE_CONFIG_INVALID` | `INIT.COMPUTE_CONFIG_INVALID` |
| `USAGE_ERROR` (unknown config format) | `CLI.INVALID_ARGUMENTS` (engine parser) |
| `USAGE_ERROR` (`--install` with json) | `INIT.INSTALL_NOT_APPLICABLE` |
| `USAGE_ERROR` (custom framework with json) | `INIT.CUSTOM_FRAMEWORK_NEEDS_TYPESCRIPT` |
| `USAGE_ERROR` (resolution flags during conversion) | `INIT.CONVERSION_FLAGS_NOT_APPLICABLE` |
| `USAGE_ERROR` (unknown framework) | `INIT.FRAMEWORK_UNKNOWN` |
| `USAGE_ERROR` (empty `--name`) | `INIT.NAME_EMPTY` |
| `USAGE_ERROR` (bad `--http-port`) | `INIT.HTTP_PORT_INVALID` |
| `USAGE_ERROR` (unknown `--region`) | `INIT.REGION_UNKNOWN` |
| `USAGE_ERROR` (`--entry` unsupported) | `INIT.ENTRY_UNSUPPORTED` |
| warning: package.json unreadable | `INIT.TYPES_PACKAGE_JSON_UNREADABLE` (warn) |
| warning: install failed | `INIT.TYPES_INSTALL_FAILED` (warn) |
| warning: link failed | `INIT.LINK_FAILED` (warn) |
| *(no legacy equivalent)* | `INIT.LINK_REQUIRES_SIGN_IN` (warn) |
| warning: skill not installed | `INIT.AGENT_SETUP_FAILED` (warn) |

Splitting one legacy `USAGE_ERROR` into nine codes changes the json `error.code` for those failures. Every summary, why and fix sentence is preserved verbatim. Distinct codes were chosen because the engine derives a docs link per code, and one shared code across nine unrelated failures makes those links useless — but it is a machine-facing contract change.

### Two notes on the source documents

- **R-S2d-1's own summary lists steps the shipping command does not have.** It names "project name" and "env write-out" as wizard steps. Today's `init` has no project-name prompt — the app name comes from `--name`, then `package.json`, then the directory name — and writes no env file. The port follows the inventory, which R-S2d-1 itself names as the contract. A project-name prompt does exist, but inside `project link`'s create-a-Project branch, which `init` reaches only when the user picks "create a new Project".
- **`init`'s link step is now literally `project link`.** The inventory records that legacy `init` called `runProjectLink`, and `runProjectLink` is what the v8 `project link` command ports. Rather than a second picker, `project link`'s handler body is extracted as `linkDirectoryToProject` and both call it, so the two commands cannot drift.

### Carried out of this slice: commands no longer read `process`

Not a user-visible divergence, but it changes the engine surface and two files on the services branch, so it belongs in the record.

Three ported commands reached directly into `process` for host facts, because nothing else offered them: `v8/init/agent-setup.ts` and `v8/agent/skills-cli.ts` both for `process.platform === "win32"`, and `v8/feedback.ts` for `process.version`, `process.platform` and `process.arch`. Handlers already take the working directory and the environment from the context so they never touch process globals; there was no equivalent for the machine.

`Runtime.host` now carries it, `ctx.host` hands it to commands, and the bin fills it once. The shape is `{ runtime: { name, version }, platform, arch }` — not node-shaped, so bun and deno describe themselves instead of being flattened into a field called `nodeVersion`, which is what R4's runtime-agnostic rule asks for.

`init` is converted. **The two call sites in the services branch are not**, because converting them means touching that branch. `v8/feedback.ts` should send `ctx.host` rather than building its own payload, and its wire field `nodeVersion` should follow the same renaming. Both are recorded for the deletion pass, which already sweeps the whole tree.

## The shell deletion itself (S2d, final pass)

1. **Four legacy commands stop existing**, each previously ruled: `app build`, `app deploy`, `app run` (superseded by Composer) and `version` (`--version` answers). Their error codes, flags and side effects go with them.
2. **`app logs` is shelved, not dropped.** The S2c record said the legacy command would keep shipping "until S2d deletes the commander shell"; that has now happened, so streaming service logs is unavailable in any form until the engine grows the transport `service logs` needs. This is the one real capability loss of the pass.
3. **The feedback payload changes shape.** `{ cliVersion, nodeVersion, platform, arch }` becomes `{ cliVersion, runtime: { name, version }, platform, arch }`, read from `ctx.host` rather than `process`, so a bun or deno binary reports itself truthfully. The human summary line is unchanged; the wire payload and `--format json` result are not.
4. **The bin is the engine shell.** `prisma-cli` resolves to `dist/v8/cli.js`; the `prisma-v8` working name and its root script are gone; `commander` and five other now-unimported dependencies leave the manifest. Proven from a packed tarball on plain Node.
5. **The survivor list** — every legacy file the v8 tree still reaches, and where each went — is [`shell-deletion-survivors.md`](shell-deletion-survivors.md).

## Ruled during the S7 merge (operator, 2026-08-12)

**Top-level `init` is the platform's compute-config wizard; the ORM's project initializer mounts at `orm init`.** The unified grammar had both families claiming `init` — the S2d contract for the platform wizard, the ORM family's own command key for the initializer — and the collision only became mountable when S7 landed the ORM family. Users of the old ORM CLI who type `prisma init` expecting a schema scaffold now get the compute wizard and must type `orm init`. The `orm` group exists solely for this command until the ORM family grows more residents or the ruling is revisited (TML-3189 holds the final grammar).

## Command grammar cleanup (2026-08-21 PM review)

The grammar cleanup slice supersedes several spellings this record
documents. Top-level `init` and the compute config
(`prisma.compute.ts`/`.json`) are removed; service commands take
parameters only (`--service`/`PRISMA_SERVICE_ID`, `--branch`; the
picker, remembered selection, and git-branch inference are gone);
`project remove`, `project env remove`, `postgres remove`, `postgres
connection remove`, `service remove`, and `service domain remove` are
renamed to `delete`; `postgres restore` moves to `postgres backup
restore`. No aliases or redirects for the old spellings. This entry
records the change; the sections above stay as written for history.
