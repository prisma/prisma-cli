# Prisma CLI v8 — divergences from the spec

Where the shipped CLI (8.0.0-rc.6, 2026-08-20) departs from the unified-CLI spec (the consolidate-clis grammar, Layers 1–5), for discussion. Changes the spec *asked for* are not discussion material and are summarized at the end. Sources: the five parity-divergence records, the operator rulings, and the spec itself; the per-slice records hold the fine detail.

## The headline: the proposal on the table

**`prisma.compute.ts` is deprecated and unsupported — and it is what `init` writes and what the service commands read.** Proposed response (2026-08-20): platform commands take parameters only.

| Dimension | Resolves from | What goes |
| --- | --- | --- |
| Project | `--project`, env override, the local project link (**kept**, per product team) | nothing |
| Service | `--service` / `PRISMA_SERVICE_ID` only | compute-config default, remembered selection, interactive picker |
| Branch | `--branch` only | current-git-branch inference |
| Compute config | — | dead everywhere; `init` shrinks to its link step pending a new meaning |

This deliberately reverses the spec's Layer 3 (resolution: git mapping, prompts, auto-creating projects). Ergonomics move above the platform commands — into orchestration or config — and the platform commands become plain plumbing over the API.

## Departures from the spec, by decision status

### A. Ruled during the build — standing decisions to revisit or reaffirm

| Area | Spec says | Shipped | Ruling |
| --- | --- | --- | --- |
| `service build` / `run` / `deploy` | flat service verbs exist | dropped, no successor — Composer supersedes; deploy's build-locally-and-upload shape judged wrong | 2026-08-10 |
| `composer` root | no product names in the tree ("there is no `prisma composer`") | `composer dev/deploy/destroy/log` mounted | interim parking 2026-08-10; final grammar open as TML-3189 |
| `init` | the single guided entry point into everything | the platform compute-config wizard; ORM scaffold moved to `orm init` (not in spec) | 2026-08-12 |
| `version` | listed as a utility command | removed; `--version` answers | 2026-08-11 |
| `service promote` / `rollback` | flat — Service-level traffic actions | moved under `service deployment` | S8, R-S8-1 |
| `service logs` | live streaming (deployment logs) | a page read; `--follow` polls every 2 s; WebSocket transport not built | 2026-08-10 shelve, later shipped in page shape |

### B. Never ruled — drifted from the spec without a decision

| Area | Spec says | Shipped | Note |
| --- | --- | --- | --- |
| Deletion verb | `delete` everywhere; `remove` explicitly avoided as ambiguous | `remove` on 6 commands (`project`, `project env`, `postgres`, `postgres connection`, `service`, `service domain`) — but `bucket delete` | ports inherited legacy verbs; the spec's verb table was never applied as a rename ruling. Six cheap renames if ruled |
| `migrate` | `db migrate` | top-level `migrate` | port kept `prisma-next`'s spelling |
| `format` | `contract format` | top-level `format` | same |
| `ref` group | `migration ref …` ("refs stay inside the migration group") | top-level `ref set/list/delete` | same |
| `postgres restore` | `postgres backup restore` | flat `postgres restore` | legacy shape kept |
| `build` group | no such group; `service deployment logs` covers builds from git push | `build logs` | legacy shape kept |
| `lsp` | not in the tree | top-level `lsp` | arrived with the ORM family |

### C. New surface the spec never described

| Command | Why it exists |
| --- | --- |
| `service create` | a service no longer exists only as a deploy side effect. **Open:** name-taken returns the existing service (`existing: true`) — hard-fail instead? |
| `service deployment start` / `stop` / `delete` | direct lifecycle over the API (S8). Stop unguarded (reversible), delete requires the id typed back |
| `service domain retry` / `wait` | operational conveniences from the legacy CLI |

### D. In the spec, not shipped

Orchestration (`project check/dev/plan/deploy/status`, `adopt/detach`, `unlink`), `branch create/show/delete`, `service deployment logs`, `service domain list`, `postgres update`, `postgres backup create/delete`, `bucket show`, `git status`, `db query/browse/seed`, `contract validate`, `auth token *`, `emulator *`, `project env pull`, `mcp`. None removed by ruling — simply not yet built. Worth agreeing which are on the roadmap and which quietly died.

## Engineering gaps still open (engine limitations, not spec questions)

| # | Item |
| --- | --- |
| 1 | A service token whose workspace only the server knows is refused; legacy resolved it via `/v1/me`. Complete it in the credential manager, or require the claim on every token |
| 2 | `build logs` cannot exit 1 on a failed build (exits 2; engine constrains codes) |
| 3 | Agent help spells itself two ways: bare examples vs package-runner next actions |
| 4 | Crash-recovery feedback pre-fill gone; needs a small engine hook |
| 5 | Composer help examples name the wrong invocation under the prisma bin; needs a mount-aware placeholder, cross-repo |
| 6 | `bucket key delete` asks no consent while `bucket delete` does (ported inconsistency) |
| 7 | One unswept `--trace` mention in service-reachable error prose |

## Reference: planned changes, executed

Spec- or design-mandated changes users of the old CLIs will feel. Not discussion material; kept for completeness.

- **Renames:** `database` → `postgres`, `app` → `service` (including flags, env vars, error copy; no aliases). Nested nouns per the spec: `service deployment list` replaces `list-deploys` etc., ids moved with paths.
- **One output model (engine design R1–R14):** JSON is an event stream with typed diagnostics and next actions; format auto-selects (piped = JSON); human mode writes presentation to stderr and raw data rows to stdout; exit codes unified (2 expected error, 3 cancelled prompt, 1 bugs only, 130/143 signals); dotted error codes with per-code docs links.
- **Consent per the spec's guarded-deletion invariant:** destructive commands require the exact id/name typed back or `--confirm <value>`; `--yes` never grants consent.
- **Auth on the session model:** per-workspace sessions plus one selection; `PRISMA_SERVICE_TOKEN` is a credential, not a session; mutations work while it is set; `whoami` describes the credential; no auto-login anywhere.
- **Retired:** fixture/mock mode, `--trace`, verbose-context blocks, per-error exit codes, the local live-deployment cache (live derives from the platform record alone; rollback refuses to guess and asks consent on the target deployment id).
- **Telemetry:** `PRISMA_NEXT_*` variables and the shared preference file renamed to `PRISMA_*` / `prisma/`, no fallback; `DO_NOT_TRACK` unchanged.
- **ORM family:** mounted unchanged; no user-visible divergence from `prisma-next` introduced by the mount.
