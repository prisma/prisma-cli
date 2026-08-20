# Prisma CLI v8 — divergence catalog

Everything v8 deliberately does differently from the three CLIs it replaces (`prisma-cli`, `prisma-composer`, `prisma-next`), corrected to what ships at rc.6 (2026-08-20). Compiled from the five parity-divergence records; the ratified record is from 2026-08-12. Detail lives in those records — this is the review-friendly version.

**TL;DR**

- Output, exit codes, error codes, and consent are unified engine-wide; JSON is now a machine-friendly event stream and piped output is JSON automatically.
- Renames: `database` → `postgres`, `app` → `service`, deployment verbs under `service deployment`. Removals: `app build/deploy/run` (Composer supersedes), `version`, auto-login, fixture mode, `--trace`.
- Destructive commands now ask you to type the exact id/name; `--yes` never grants consent.
- Nine items still need a ruling — listed at the end, the parameters-only proposal first.

## Proposed ruling (2026-08-20, for discussion): platform commands take parameters only

`prisma.compute.ts` — the file `init` writes and the service commands read — is **deprecated and no longer supported**. Proposal:

| Dimension | Resolves from | What goes |
| --- | --- | --- |
| Project | `--project`, env override, the local project link (**kept**, per product team) | nothing — `project link`/`show`/`create` keep their meaning |
| Service | `--service` / `PRISMA_SERVICE_ID` only | compute-config default, remembered selection, interactive picker |
| Branch | `--branch` only | current-git-branch inference |
| Compute config | — | dead everywhere: `init`'s write, service reads, the config-target positional, `SERVICE.COMPUTE_CONFIG_*` codes |

`init` shrinks to its project-link step pending a new meaning. This deliberately reverses the original spec's resolution layer; ergonomics move above the platform commands, which become plain plumbing over the API.

## 1. Global changes (every command)

| Change | What you see now |
| --- | --- |
| JSON is an event stream | Newline-delimited frames + one result frame. `command`→`commandId`, `warnings`→coded `diagnostics`, `nextSteps`→typed `nextActions`, exit code included |
| Format auto-selects | Human only when stdout is a terminal; piped output is JSON |
| stdout carries data in human mode | Presentation on stderr (as before); raw data rows on stdout, so piping works. Legacy wrote nothing to stdout |
| Exit codes unified | 2 = expected error, 3 = cancelled prompt, 1 = bug only, 130/143 = signals |
| Error codes dotted | `PROJECT.NOT_FOUND`, `POSTGRES.API_ERROR`, … — each gets a docs link |
| Remediation typed | `fix` prose → `user-choice` action; `nextSteps` → `run-command` actions; URLs → `open-url` actions |
| Consent engine-owned | Type the exact id/name, or `--confirm <value>` in scripts. `--yes` never grants consent. Cancel = exit 3 |
| Auto-login gone | Unauthenticated runs fail with `CLI.CREDENTIALS_REQUIRED` instead of opening a browser |
| Flags | Shared family (`--format`, `--log-level`, `--quiet`, `--yes`, `--confirm`, `--interactive`, `--color`). `--trace` gone; `--verbose` is a log level, so "verbose context" blocks are gone |
| `version` removed | `prisma --version` answers |
| Fixture/mock mode gone | Including its flags and error codes |
| Rendering | Engine block style; legacy card alignment/colours restored byte-for-byte; the `│` rail framing and header line are deferred |

## 2. Renames and removals

| Was | Is | Notes |
| --- | --- | --- |
| `database …` | `postgres …` | Whole group, no alias |
| `app …` | `service …` | Whole group, incl. `--app`→`--service`, `PRISMA_APP_ID`→`PRISMA_SERVICE_ID` |
| `service list-deploys` / `show-deploy` / `promote` / `rollback` | `service deployment list` / `show` / `promote` / `rollback` | No aliases; JSON command ids moved too |
| `app build` / `app deploy` / `app run` | — | Ruled drops; Composer supersedes. Deploy's build-locally-and-upload shape judged wrong |
| `version`, `auth logout --workspace`, `rm` alias, mock login flags | — | Ruled removals |
| `prisma init` (ORM scaffold) | `orm init` | Top-level `init` is the platform wizard (ruled 2026-08-12) |
| `PRISMA_NEXT_DISABLE_TELEMETRY` etc. | `PRISMA_DISABLE_TELEMETRY` etc. | No fallback: an old-path opt-out reverts to default. `DO_NOT_TRACK` still works |

## 3. Authentication

New model: stored per-workspace **sessions** plus one selection; `PRISMA_SERVICE_TOKEN` is a separate credential, not a session.

| Change | What you see now |
| --- | --- |
| Mutations work under `PRISMA_SERVICE_TOKEN` | login/logout/workspace commands operate on stored sessions, with a notice that the env credential stays in force. Legacy refused switching |
| `auth logout` ends every session | Reports the count; reaps orphaned entries |
| `auth workspace use` selects only | Never creates a session or opens a browser |
| `auth whoami` describes the credential | `source` and `expiresAt` new; provider field gone; a service token reports no user; no-workspace credential reports `workspace: null` |
| Names not refreshed on read | A Console rename shows locally only after the next login |
| Session logout is idempotent | Already-removed session → exit 0 |
| Near-expiry sessions refresh | Refreshed and persisted before delegated runs; only unrefreshable credentials are refused |

**Open:** a service token whose workspace only the server knows is now refused (legacy asked `/v1/me`). Ruling: complete it server-side in the credential manager, or require the claim on every token.

## 4. Resource groups (project, postgres, bucket, branch, git)

| Change | What you see now |
| --- | --- |
| New consent prompts | `postgres restore/remove`, `connection rotate/remove`, `bucket delete`, `project remove/transfer` now type-to-confirm. `bucket key delete` still asks nothing (ported inconsistency, for review) |
| Rejected listings fail | Legacy printed "No projects found." with exit 0 on API errors; fixed in both shells |
| Plan-limit errors | Lose the custom full-page rendering; keep summary, why, upgrade action |
| Progress lines gone | `Creating database...` etc. — sync commands emit no events |
| `git connect` | Works non-interactively where possible; install wait is engine-owned; install URLs are `open-url` actions. Cancel during the wait: exit 3 between polls, 130 mid-request |
| `bucket key create` | Human card shows the four credentials as masked rows; stdout `S3_*=` lines and JSON secrets unchanged |
| Recorded quirks | `project rename` copy bug kept; `branch list` resolution quirk kept; `git` JSON result shape kept raw |

## 5. Services and deployments

| Change | What you see now |
| --- | --- |
| Live = platform record only | Local live-deployment cache retired both ways; stale cache can't fake a live deployment; unknown renders as `null`, not `false` |
| Rollback asks consent | New — token is the **target deployment id**, so you look at what's about to go live |
| Rollback refuses to guess | No `--to` + no known live deployment → `SERVICE.LIVE_DEPLOYMENT_UNKNOWN`. Legacy promoted the newest (often the already-live one) and claimed success |
| Five new commands | `service list`, `service create`, `deployment start/stop/delete`. `create` means a service no longer exists only as a deploy side effect |
| `create` is idempotent-ish | Name taken → returns the existing service with `existing: true`. **Open:** should it hard-fail? Also: `--branch` creates a missing branch (shared-helper behaviour) |
| `stop` free, `delete` guarded | Stop is reversible → no consent; delete requires the id typed back |
| URLs follow liveness | Promoted address only for the live deployment; `not deployed` instead of dead addresses |
| `service open` | Also opens the browser under `--json` in a terminal; failed open reports `opened: false`; URL printed to stdout |
| No more "deploy the service" hints | The command they pointed at is gone; empty `nextActions` is now normal |

## 6. `service logs`

| Change | What you see now |
| --- | --- |
| Page read, not a socket | Default: last 100 lines, exit 0 (the `kubectl logs` shape). `--follow` polls every 2 s. Live WebSocket streaming remains future work |
| New flags | `--tail <n>`, `--from-start`; both together refused |
| Refusals over silent nonsense | No resume cursor → stop the follow; truncated page → `SERVICE.LOGS_INCOMPLETE` after printing what arrived |
| Platform log failure fails the run | Exit 2 (legacy printed and exited 0); in follow, one retry per failure, budget resets on success |
| Ctrl-C on follow | Exit 130 |

## 7. `build logs`

| Change | What you see now |
| --- | --- |
| Uniform JSON framing | The legacy no-wrapper opt-out doesn't port; the header is framed in JSON |
| **Open:** failed build exits 2, not 1 | Engine constrains exit codes; still non-zero, still carries the resume cursor |
| No-record run | Reports no cursor in JSON (nothing to resume from) |

## 8. Composer (vs `prisma-composer`)

The four commands mount as `prisma composer …`; the standalone bin survives and now runs the same engine, so these apply to both.

| Change | What you see now |
| --- | --- |
| Engine behaviour is all new here | Shared flags, JSON framing, auto-format, help layout |
| Parse errors are specific | No more full usage wall; bare `prisma composer` exits 0 (was 2) |
| `deploy --production` gone | Legacy advertised it and always rejected it. `destroy` keeps it |
| Failed converge | Reproduce hint is a typed action; redundant envelope gone; hint dropped on Ctrl-C |
| JSON works for spawning commands | Child output → diagnostics; failed child keeps its exit code with `CLI.CHILD_PROCESS_FAILED` |
| **`dev`/`log` exit 130 on Ctrl-C** (was 0) | Most likely to be noticed: supervisors treating non-zero as failure see one on every manual stop |
| `--tail` typed | `5abc` now errors; trade: fractional/negative now accepted and passed through |
| Failures move earlier | Unauthenticated deploy/destroy refused before config read; effect preflight no longer breaks unrelated commands or `--help` |
| `destroy` still asks nothing | Guard is the explicit target; a confirmation would be a Composer product decision |
| **Open:** help examples wrong under the prisma bin | `prisma deploy …` instead of `prisma composer deploy …`; needs a mount-aware placeholder, cross-repo |

## 9. ORM family (vs `prisma-next`)

No user-visible divergence — the commands answer for the first time under this binary; the port record lives in prisma/prisma. Two notes: the redirect table covers spellings `prisma-next` already retired, and the family's static imports (esbuild, arktype) slow every invocation including `--version` — deferred, prisma/prisma's fix.

## 10. `init`

(See the proposal up top — under it, most of this command goes.)

| Change | What you see now |
| --- | --- |
| Optional steps default to no | Interactive users press `y` where they pressed Enter; unattended runs unchanged. Ratified; one line per prompt to flip |
| `--format` → `--config-format` | Value must be exactly `ts` or `json` |
| Cancel aborts | Exit 3 (legacy recorded a decline, exit 0); written config stays |
| Link step never auto-logs-in | Signed out → `link.status: "unauthenticated"` + sign-in action |
| Nine `INIT.*` codes | One legacy catch-all usage error split up (machine-facing change; prose preserved) |

## 11. Agent skills, feedback, telemetry

| Change | What you see now |
| --- | --- |
| **Open:** agent help spells itself two ways | Help examples are bare (`agent install`), runtime actions keep the runner form (`npx -y @prisma/cli@latest …`). One group-wide ruling wanted |
| **Open:** crash-recovery pre-fill gone | Legacy pre-filled `feedback "<command> crashed: …"` on crashes; the engine offers no hook. `feedback` itself works |
| `feedback` payload | `runtime: {name, version}` instead of `nodeVersion` — bun/deno report truthfully |
| Telemetry | Config-file enrichment dropped; events at command start; disclosure says "Prisma"; negated flags counted under one name |

## 12. Open items for the discussion

| # | Item | Where |
| --- | --- | --- |
| 1 | **Parameters-only proposal**: ratify, give `init` a new meaning, schedule the compute-config removal | top of this doc |
| 2 | Service token whose workspace only the server knows: refuse vs resolve in the credential manager | §3 |
| 3 | `build logs` exit code on a failed build: 2 today, legacy 1 | §7 |
| 4 | Agent help examples vs package-runner actions: one spelling policy | §11 |
| 5 | Crash-recovery feedback pre-fill: needs a small engine hook | §11 |
| 6 | `service create`: return-existing vs hard-fail | §5 |
| 7 | Composer help examples under the prisma bin: mount-aware placeholder, cross-repo | §8 |
| 8 | `bucket key delete` asks no consent while `bucket delete` does | §4 |
| 9 | One unswept `--trace` mention in service-reachable error prose | small fix |
