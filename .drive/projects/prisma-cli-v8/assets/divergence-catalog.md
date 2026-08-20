# Prisma CLI v8 — divergence catalog

Everything the v8 CLI deliberately does differently from the CLIs it replaces, in one document. Compiled from the five parity-divergence records and the engine-global baseline, corrected to what actually ships at `main` (8.0.0-rc.6, 2026-08-20) — the per-slice records predate some later changes, and this catalog reflects the shipped state.

Three baselines apply, because v8 absorbs three CLIs: the platform CLI (`prisma-cli`), Composer's own CLI (`prisma-composer`), and the ORM CLI (`prisma-next`). Each section says which baseline it compares against. The cumulative record was ratified by the operator on 2026-08-12; entries marked **open** still need a ruling.

## Proposed ruling (2026-08-20, for discussion): platform commands take parameters only

Prompted by the discovery that `prisma.compute.ts` — the file `init` writes and the service commands read — is deprecated and no longer supported. The proposal: **platform commands operate on their parameters; the only ambient context is the directory's project link.** Concretely:

- **Project** resolves from `--project`, else the env override, else the local project link (`.prisma/local.json`). The link stays — the product team wants it — so `project link`, `project create`'s auto-link, and `project show`'s binding keep their meaning.
- **Service** resolves from `--service` or `PRISMA_SERVICE_ID` only. The compute-config default, the remembered selection in local state, and the interactive picker are removed.
- **Branch** resolves from `--branch` only. The current-git-branch inference is removed.
- **The compute config is dead everywhere:** `init`'s write, the service commands' read, the config-target positional, the `SERVICE.COMPUTE_CONFIG_*` error codes, and the agent setup-status read. `init` shrinks to its link step (the one part of today's command that survives) plus whatever new meaning the product gives it.

This is a deliberate reversal of the original spec's resolution layer (Layer 3: git mapping, prompts, auto-creating projects), not a refinement of it. Ergonomics move above the platform commands — into orchestration or a future config section — and the platform commands become plain plumbing over the API.

## 1. Global changes — every command, versus the legacy platform CLI

These hold for every ported command and are the largest single source of visible difference.

1. **JSON output is an event stream, not one object.** Legacy printed one pretty-printed JSON envelope. v8 prints newline-delimited frames (events plus exactly one final result frame). Inside the envelope: `command` → `commandId`, `warnings: string[]` → typed coded `diagnostics`, `nextSteps: string[]` → typed `nextActions`, and the exit code is now included. Result payloads themselves are mostly unchanged.
2. **Output format is auto-selected.** Human output only when stdout is a terminal; piped output is JSON automatically. Legacy was human unless `--json` was passed.
3. **Human mode writes a machine-usable payload to stdout.** Presentation (cards, tables, commentary) goes to stderr, exactly where legacy wrote it; the data rows additionally go to stdout with raw, unformatted values (no placeholders like `none`, byte counts instead of `2.0 KiB`). Legacy human mode wrote nothing to stdout. Piping a v8 command yields usable data.
4. **Exit codes are unified.** Expected errors exit 2, a cancelled prompt exits 3, exit 1 is reserved for bugs (`CLI.INTERNAL_ERROR`), signals exit 128 + signal number (130 for Ctrl-C). Legacy exited 1 or 2 per error type.
5. **Error codes are dotted and namespaced.** `PROJECT_NOT_FOUND` → `PROJECT.NOT_FOUND`, `DATABASE_API_ERROR` → `POSTGRES.API_ERROR`, and so on. Each code gets its own docs link.
6. **Remediation is typed.** Legacy `fix` prose becomes one `user-choice` next action; each `nextSteps` string becomes a `run-command` action; URLs become `open-url` actions. Package-runner command strings (`npx -y @prisma/cli@latest …`) are dropped from next actions in favour of plain `prisma-cli …`.
7. **Consent is engine-owned and stronger.** Destructive commands ask the user to type the exact id or name of the thing being destroyed (interactively) or pass `--confirm <that value>` (scripted). `--yes` never grants consent. Several commands that had only a flag, or asked nothing at all, now prompt. Cancelling a prompt exits 3 — a code these commands never produced before.
8. **Auto-login is gone.** An unauthenticated run settles `CLI.CREDENTIALS_REQUIRED` (exit 2) instead of opening a browser sign-in mid-command.
9. **Flags:** the shared family is `--format/--json`, `--log-level/-v/--verbose`, `-q/--quiet`, `-y/--yes`, `--confirm`, `--interactive/--no-interactive`, `--color/--no-color`, `-h/--help`. `--trace` no longer exists (log levels cover it); `--quiet` is just a log-level alias. `--verbose` is a log level, so the legacy "verbose context" blocks in results are gone.
10. **No `version` command** (ruled removal). `prisma --version` answers, printing the version alone. The legacy command's extra facts (invocation kind, node version, platform) had no consumer worth porting.
11. **Mock/fixture mode is gone** entirely, along with the fixture-only flags and error codes.
12. **Rendering style.** Human output is the engine's block style. The aligned, accent-coloured key columns of the legacy cards are back byte-for-byte; still missing are the dim `│` rail framing and the `command → description` header line (deferred, per-command opt-in exists).

## 2. Renames and removals

1. **`database` → `postgres`.** The whole group: paths, ids, help, error copy. No alias.
2. **`app` → `service`.** The whole group, including `--app` → `--service`, result fields, error copy, and `PRISMA_APP_ID` → `PRISMA_SERVICE_ID`. No alias.
3. **The deployment verbs moved under `service deployment`** (S8, no aliases): `service list-deploys` → `service deployment list`, `service show-deploy` → `service deployment show`, `service promote` → `service deployment promote`, `service rollback` → `service deployment rollback`. Command ids in JSON moved with them (`service.deployment.list` etc.). Old spellings answer `CLI.UNKNOWN_COMMAND`.
4. **Ruled removals:** `app build`, `app deploy`, `app run` — Composer supersedes all three; deploy's build-locally-and-upload shape was judged wrong, not just redundant. Also removed: `auth logout --workspace` (use `auth workspace logout`), the `rm` alias on `project env remove`, and the mock-only login flags.
5. **Top-level `init` is the platform's compute-config wizard; the ORM's initializer is `orm init`** (ruled 2026-08-12). A `prisma-next` user typing `prisma init` expecting a schema scaffold gets the compute wizard.
6. **Telemetry environment variables and the preference file drop the `prisma-next` name**: `PRISMA_DISABLE_TELEMETRY`, `PRISMA_TELEMETRY_ENDPOINT`, `PRISMA_DEBUG`; preference stored under `prisma/`. No fallback to the old names or path — an existing opt-out at the old location reverts to the default. `DO_NOT_TRACK` still works.

## 3. Authentication — the session model

The auth family sits on a new credential model: a set of stored per-workspace sessions plus one selection, and — separately — the credential the current process authenticates as, which may come from `PRISMA_SERVICE_TOKEN` and is not a session.

1. **Mutations succeed while `PRISMA_SERVICE_TOKEN` is set.** `auth login`, `auth logout`, `auth workspace use`, `auth workspace logout` all operate on the stored sessions and print a one-line notice that the environment credential remains in force. Legacy refused workspace switching in that state.
2. **`auth logout` ends every session** and reports how many, reaping orphaned entries legacy left behind.
3. **`auth workspace use` selects only** — it never creates a session or opens a browser. A workspace you have no session for is `AUTH.NO_SESSION_FOR_WORKSPACE`; the fix is `auth login`.
4. **`auth whoami` describes the active credential**, not an auth-state snapshot: `source` (`stored`/`environment`) and `expiresAt` are new; the identity-provider field is gone (nothing records it); a service token reports no user (its subject is a workspace, not a person); a credential naming no workspace reports `workspace: null`.
5. **Workspace names are not refreshed on read.** Fetched once at login, best-effort; a rename in the Console shows up locally only after the next login. Legacy re-fetched on every read.
6. **Ending a session is idempotent** — if another process already removed it, the command exits 0.
7. **A near-expiry stored session is refreshed and persisted before delegated runs; only an unrefreshable credential is refused.** (Later change; the S3 record's "refused up front" wording predates it.)
8. **Open — escalated engine gap:** a service token that the platform associates with a workspace, but whose own claims name none, is now refused (`SERVICE.WORKSPACE_REQUIRED`). Legacy asked the server (`/v1/me`) and carried on when the server named one. v8 commands never fetch their own identity from the network; if a server round-trip is wanted, it belongs in the credential manager. Ruling needed: complete the workspace server-side, or require every issued token to carry the claim.

## 4. Resource groups — project, postgres, bucket, branch, git

On top of the global changes:

1. **New consent prompts.** `postgres restore/remove`, `postgres connection rotate/remove`, `bucket delete`, `project remove`, `project transfer` previously had only a `--confirm` flag (or nothing interactive); they now type-to-confirm the exact id. `bucket key delete` still asks nothing — the legacy inconsistency ports unchanged, recorded for review.
2. **A rejected project listing now fails instead of looking empty.** Legacy swallowed API errors and printed "No projects found." with exit 0; every command resolving a project by name inherited the confusion. Fixed in both shells (ruled: this defect was not behaviour anyone chose).
3. **Plan-limit errors** lose the legacy full-page custom rendering; summary, why and upgrade guidance survive as a normal error with one action.
4. **Pre-result progress lines** (`Creating database...`) are gone on the synchronous commands.
5. **`git connect` works non-interactively again** where possible; the wait for the GitHub App installation is the engine's browser-wait (one endpoint event carrying the install URL, engine-owned polling). Install URLs are `open-url` actions instead of fake commands. Cancelling the wait exits 3 while sleeping between polls, 130 if a poll request was in flight — the split is accepted, not smoothed over.
6. **`bucket key create`** shows its four credential values as masked field rows in the human card (legacy named no values); the stdout `S3_*=` lines and the JSON secrets are unchanged.
7. Known small quirks recorded, not fixed: `project rename`'s validation copy still says "Project create requires a name"; `branch list` keeps its resolution quirk (no `--project` flag); `git connect`/`git disconnect` keep their raw JSON result shape.

## 5. Services and deployments

Versus the legacy `app` family, beyond the renames in section 2:

1. **Which deployment is live comes from the platform record alone.** The local cache of "live deployment" is retired in both directions — a stale cache can no longer make a deployment look live, and `service deployment list` rows report `null` (unknown) where a cache entry used to claim `true`/`false`.
2. **`service deployment rollback` asks for consent** (new — legacy asked nothing before changing what production serves). The token is the target deployment's id, so the user must look at which deployment is about to go live.
3. **Rollback refuses to guess.** With no `--to` and no identifiable live deployment, legacy promoted the newest deployment — most likely the one already live — and reported success. v8 refuses (`SERVICE.LIVE_DEPLOYMENT_UNKNOWN`) and tells the user to name a target or list deployments.
4. **Five commands are new:** `service list`, `service create`, `service deployment start/stop/delete`. `service create` changes what is possible — before it, a service only came into existence as a side effect of deploying.
5. **`service create` is idempotent-ish:** a name already taken on the branch returns the existing service with `existing: true` instead of failing (mirrors `service domain add`). **Open — operator ruling pending** on whether it should hard-fail instead. Also: `--branch` resolves *or creates* the named branch, so a typo silently creates a branch (shared-helper behaviour, recorded).
6. **`stop` asks no consent; `delete` demands the deployment id typed back.** Deliberate: the line is reversibility — a stopped deployment can start again, a deleted one cannot.
7. **A deployment's url follows liveness.** `service deployment show` reports the promoted address only for the live deployment and the preview address otherwise; presenters show `not deployed` rather than a dead address for never-promoted services.
8. **`service open`** now also opens the browser under `--json` in an interactive terminal, reports `opened: false` instead of erroring on a failed open, and prints the URL to stdout.
9. **Success lines are past tense.** A command that changed something ends on "Removed hello-world…" instead of opening with "Removing…".
10. **Follow-up suggestions pointing at `service deploy` are removed** (the command no longer exists); an empty `nextActions` list is now a normal outcome. Guidance can return pointing at Composer.

## 6. `service logs`

Shipped later than the rest of the family (the S2c port was shelved waiting on socket transport; what shipped is a different shape). Versus the old `app logs`:

1. **A page read replaces a held socket.** Default: the last 100 lines, then exit 0 — the `kubectl logs` shape. `--follow` restores the streaming behaviour via polling (2-second interval); latency is bounded by the poll, not the server's write. The WebSocket upgrade exists on the platform and the CLI does not use it; live streaming remains future work.
2. **New flags:** `--tail <n>` and `--from-start`; passing both is refused (`SERVICE.LOGS_RANGE_CONFLICT`).
3. **Refusals instead of silent nonsense:** a page with no resume cursor stops a follow (`SERVICE.LOGS_NO_CURSOR`); a page that ends without its terminal record settles `SERVICE.LOGS_INCOMPLETE` after printing what arrived — a truncated log is never presented as complete.
4. **A platform-reported log-read failure now fails the command** (`SERVICE.LOGS_FAILED`, exit 2) where the old command printed the message and exited 0. In `--follow`, a retryable failure is retried once, with the budget reset on success.
5. **Interrupting `--follow` exits 130** — a wrapper treating non-zero as failure sees one when a developer stops following.

## 7. `build logs`

1. Records become engine events; JSON framing is uniform (the legacy opt-out of the success wrapper does not port), and the header line is now framed in JSON output.
2. **Open — escalated engine gap: a failed build cannot exit 1.** Legacy streamed the logs and set exit 1 on a build failure. The engine constrains documented exit codes, so v8 settles `BUILD.FAILED` at exit 2. Still non-zero, still carries the resume cursor; the code changes 1 → 2. Ruling needed on giving streams a termination status or a documented code.
3. A run whose build produced no log records reports no cursor anywhere in JSON (nothing to resume from).

## 8. Composer — versus `prisma-composer`

The four commands (`dev`, `deploy`, `destroy`, `log`) mount under `prisma composer …`. The standalone `prisma-composer` bin survives with unprefixed spellings — and now runs the same engine and handlers, so the differences below apply to both invocations.

1. **All engine-global behaviour is new to composer users:** shared flags, JSON framing, format auto-selection, help layout.
2. **Parse failures say what was wrong** instead of reprinting the whole usage wall. A bare `prisma composer` exits 0 (was 2).
3. **`deploy --production` is gone from help and parsing** — legacy advertised it and always rejected it at runtime. `destroy` keeps it, where it is valid.
4. **The reproduce hint on a failed converge is a typed next action**, the redundant failure envelope is gone (the child already owned the terminal), and the hint is dropped when the user themselves killed the child with Ctrl-C.
5. **JSON mode works for spawning commands:** the child's output routes to diagnostics, stdout stays framed, and a failed child keeps its verbatim exit code with `CLI.CHILD_PROCESS_FAILED` carrying the status.
6. **`dev` (and `log`) exit 130 on Ctrl-C where legacy exited 0.** The most likely divergence to be noticed: supervisors treating non-zero as failure see one on every manual stop. Engine-wide rule — a signal-ended run is an abort whatever the handler concluded.
7. **`--tail` is a typed number flag:** `--tail 5abc` is now an error instead of silently 5; the trade is that fractional and negative values are now accepted and passed through (recorded, not narrowed).
8. **Failures move earlier:** unauthenticated `deploy`/`destroy` are refused before the config is read (legacy failed deep inside the child after doing platform work), and the effect-resolution preflight no longer takes out unrelated commands or `--help`.
9. **`destroy` still asks nothing** before tearing down — the guard remains the required explicit target. If it deserves a confirmation, that is a Composer product decision, raised upstream.
10. **Known defect, deferred:** help examples name the wrong invocation under the prisma bin (`prisma deploy …` instead of `prisma composer deploy …`) — the engine's placeholder substitutes the binary name only, and it needs a mount-aware placeholder plus composer rewriting eight strings. Unreachable from the standalone bin.

## 9. ORM family — versus `prisma-next`

Mounting the family introduced **no user-visible divergence**: the commands answer for the first time under this binary. The differences between the ORM commands under this shell and under `prisma-next` belong to the port record kept in prisma/prisma. Two notes:

1. The family ships its redirect table for spellings `prisma-next` had already retired (`migration apply`, `migration ref`, four `migration status` flags).
2. Operational cost, not a divergence: the ORM family's entry statically imports esbuild, arktype and a dozen framework subpaths, so every invocation of the bin pays that startup cost — including `prisma --version`. Fixing it is a prisma/prisma change; tracked as deferred.

## 10. `init`

1. **The three optional steps (install types, link, agent skills) default to no.** Ratified with a stated cost: interactive users press `y` where they pressed Enter; unattended runs keep exactly today's behaviour. One line per prompt to flip.
2. **`--format` is renamed `--config-format`** (the engine reserves `--format` for output format). The value must be exactly `ts` or `json` — `typescript`, mixed case and whitespace are no longer accepted.
3. **Cancelling a question aborts the run at exit 3** (legacy recorded a decline and exited 0); an already-written config stays on disk. Unattended runs report `declined` where legacy said `skipped` (JSON-only difference).
4. **The link step no longer auto-logs-in**; signed out, it reports `link.status: "unauthenticated"` with a sign-in action.
5. One legacy catch-all usage error split into nine distinct `INIT.*` codes (machine-facing contract change; every sentence preserved).

## 11. Agent skills, feedback, telemetry

1. **`agent install/update/status`** keep their spellings and behaviour; warnings and next steps become typed. **Open — escalated engine gap:** help examples lose the package-runner form (`pnpm dlx @prisma/cli@latest agent install` → bare `agent install`) while run-time next actions keep it, so the command spells itself two ways. Worth one group-wide ruling.
2. **The crash-recovery feedback action does not port — open, escalated engine gap.** Legacy pre-filled `prisma-cli feedback "<command> crashed: …"` on every unexpected error. The engine settles crashes itself with no contribution point for the shell, so a v8 crash offers no recovery action. The `feedback` command itself works; only the automatic pre-fill is gone. A small engine hook would restore it.
3. **`feedback`'s payload** reports the runtime truthfully (`runtime: {name, version}` instead of `nodeVersion`), so a bun or deno build identifies itself.
4. **Telemetry:** config-file enrichment dropped (the config it read does not exist in this product); events fire at command start (same point as the reference); first-run disclosure says "Prisma" not "Prisma Next" and no longer suggests hand-editing the machine-owned preference file; negated flags are counted under one name (`--color`, not `--color` and `--no-color`).

## 12. Open items in one place

For the discussion — everything above that still needs a decision:

1. Service token whose workspace only the server knows: refuse (current) or complete server-side in the credential manager (§3.8).
2. `build logs` exit code on a failed build: 2 today, legacy 1 (§7.2).
3. Agent-group help examples versus package-runner next actions: pick one spelling policy group-wide (§11.1).
4. Crash-recovery feedback pre-fill: needs a small engine hook (§11.2).
5. `service create` idempotency: return-existing (current) or hard-fail (§5.5).
6. Composer help examples under the prisma bin: needs a mount-aware placeholder, coordinated across repos (§8.10).
7. `bucket key delete` asks no consent while `bucket delete` does — ported inconsistency, review whether to keep (§4.1).
8. One unswept `--trace` mention survives in service-reachable legacy error prose; every other group rewrites it. Small fix.
9. The parameters-only proposal at the top of this document: ratify the rule, decide `init`'s new meaning, and schedule the removal of the deprecated `prisma.compute.*` machinery.
