# prisma-cli-v8 — project plan

Consumer ordering (operator, 2026-08-09): **platform → Composer → ORM**.
The engine meets its first consumer in its own repo (flex is a same-PR
edit; the variable is isolated), its second across a repo boundary with
real config and sessions, and its hardest consumer last, twice-hardened.
Slices are one-PR units; each port slice ships its parity-divergence
list for operator review (spec FR6).

Branch mechanics: slices land as PRs into the prisma-cli repo's
`cli-engine-requirements` branch lineage (PR #128 is the living decision
record) or their own repos; #128 merges when the operator says so.

## Slices

### S1 — Engine package + one vertical command

Repo: prisma-cli. Implement `@prisma/cli-engine` per the v8 interface
(execution protocol, events, return-site presentation, config-section
tokens, prompts incl. consent + defaults, three command kinds,
envelopes/stream, mounting, `./protocol` subpath, the test harness;
`@stricli/core` exact-pinned). Prove it end to end with ONE ported
platform command (`project list` or `auth whoami`) mounted in a minimal
shell bin: parse → context → handler → presentation → envelope → exit
code, byte-asserted through the harness. First-contact flex on the v8
draft returns to the operator as design questions; the draft in
`assets/engine/` is updated to match what ships.

### S2 — Platform family port + auth extraction

Repo: prisma-cli. Port the ~60 management-API commands onto the engine
in grouped batches (auth + project; database + bucket; app + build +
git + agent + env; init wizard last — it stresses prompts hardest).
Extract the auth library (token storage, refresh, login-flow guts) as
its own package, distinct from Prisma Cloud code, consumed by the shell
for `getCredentials`. Retire the commander shell (`exitOverride` maze,
custom help formatter, WeakMap shims — the friction-points doc is the
kill list). DoD: every platform command on the engine, old shell
deleted, per-family shell integration proofs, parity list reviewed.

### S3 — Composer adoption (first cross-repo consumer)

Repos: composer + prisma-cli. Composer exports a `CommandFamily`
(the `composer` config section token — its validator rewritten from the
current throwing loader per the section API — plus its command set);
ports `deploy`/`destroy` (result commands), `dev`/`log` (session
commands), preserving the alchemy child-status passthrough exception.
Consumes the PUBLISHED engine (`./protocol` from outside, exact pins);
stands up the tandem-release workflow glue on committed versions. The
paused 1c brief is superseded by this slice — close it out against
what ships here. Proves: config machinery under real product use,
sessions, cross-repo consumption.

### S4 — ADR 239 amendment (parallel; before S5)

Repo: prisma/prisma. Completed-but-unsuccessful results carry dotted
codes as diagnostics inside completed envelopes with documented exit
codes; the severity-'info' evidence check (trim both scales together if
unused). Small, independent; the only ordering constraint is landing
before S5 relies on the semantics.
The amendment must also adopt the engine's `fix` → typed `nextActions`
rename (operator ruling, 2026-08-09) so Diagnostic stays
field-for-field identical to the settled envelope.

### S5 — ORM adoption

Repos: prisma/prisma + prisma-cli. The `orm` section token +
command family; port `contract *`, `migration *` (retiring the clipanion
migration-cli), `db *`, `init`, `telemetry`, `lsp` (the server
command). Proves the diagnostics model (`migration check`, `db verify`
as completed-with-findings + catalogued exit codes) and the
exit-code-4 semantics under S4's amendment. The paused 1b brief is
superseded here — close it out against the section API. The ORM's
three colliding exit-code schemes reconcile to the contract (survey
finding).

### S6 — Conformance checker (parallel after S1)

Repo: prisma-cli. The small three-check tool — import purity,
validator no-throw on hostile input, published-tarball verification —
wired into both products' publish CI as S3/S5 land.

### S8 — Service primitives (design first; after S3, before S7)

Repo: prisma-cli. Give the platform's service resources an atomic CLI surface, replacing what S2c ported for continuity.

**Why this slice exists.** The legacy `app` group fused three concerns — building an artifact, wiring a GitHub repo, and deploying — into single commands, most visibly `app deploy`, which builds, creates a project, creates branches, sets environment variables, optionally provisions a database, and deploys. Composer replaces the building and deploying. What the CLI should own is managing the remote resource, and today it cannot: there is no `service list` and no `service create` despite `GET`/`POST /v1/apps`, no deployment start or stop despite `POST /v1/deployments/{id}/start|stop`, and no deployment delete. A service can currently only be born as a side effect of deploying to it. S2c ported the surviving commands under their legacy names so the commander shell could die in S2d; that port is continuity, not endorsement of the shape.

**The resource model is already right; the CLI hides it.** `/v1/apps` supports list and create, `/v1/apps/{id}` get and delete, `/v1/apps/{id}/deployments` list and create, `/v1/deployments/{id}` get and delete, and `/v1/deployments/{id}/start|stop|logs`. Composer deploys through Alchemy rather than driving that sequence itself, but Alchemy's providers call the same management API, so Composer's services and deployments are ordinary resources under these endpoints. The seam the API already draws is the one to build on: **Composer produces deployments; the CLI manages them.** Promote, rollback, start, stop, delete and logs are resource management, not build concerns — `POST /v1/deployments/{id}/start` says the artifact must be uploaded before it is called, which is the separation stated in the API itself.

That makes the shape of the slice mostly a rename plus filling holes — a `service deployment` subgroup absorbing `list-deploys`, `show-deploy`, `logs`, `promote` and `rollback`, plus the five operations that have no command at all. The expensive parts (engine, auth, presenters, error model, the `service` rename) are done.

**Why it still waits for the design work.** Three questions need answers that only S3 can give, and none of them is about whether the resources exist.

1. ~~Does Alchemy hold desired state?~~ **Answered (operator, 2026-08-10): yes, and changing the platform directly is overwritten on the next `composer deploy`. Accepted.** So the imperative operations stay, and their effect on a Composer-managed service is understood to be transient. What remains for the design is only whether the CLI says so at the point of use — a service the CLI can tell is Composer-managed could carry a line on `promote`, `rollback`, `start` and `stop` noting the next deploy reconciles it. That depends on question 2: whether the records carry anything identifying a service as Composer-managed.
2. What do Composer's app and deployment records actually contain? If the Alchemy path populates a different subset of fields than `app deploy` did, `service show` and `service deployment show` are presenting a shape nobody has looked at.
3. Where does log reading live? `composer log` and a `service deployment logs` would be two ways to read the same thing, and the project spec rules that a subgroup is owned by exactly one command family.
4. **If log reading lands here, what opens the socket?** Added during S2c, which shelved `service logs` rather than ship it. Deployment logs are the one endpoint in the list that upgrades to a **WebSocket**, and the engine's client is HTTP-only, so the port had been taking a raw token and letting the compute SDK build the URL and set the `Authorization` header itself. The rev-6 credential model rules that out — credentials never reach commands, and `getCredentials` is now deleted — so the command cannot come back until the engine can open an authenticated socket. The design for that, written at the operator's instruction, is `assets/engine/websocket-transport-design.md`: the engine opens the socket and hands back a decoded record stream, with reconnection across the ten-minute cutoff owned by the engine rather than reimplemented per command. **Read its §7 before building anything** — if deployment logs can be served over plain HTTP the way `build logs` already is, the transport work disappears and the command becomes a copy of `build logs`. The shelved handler is reviewed, green, and in the `s2c-services` history, so restoring it is small once the transport question is answered.

One standing caveat: every endpoint above is marked experimental and subject to change without notice. Designing a stable CLI surface over an unstable API is how the next bastardization gets built, so the design has to say what it is willing to depend on.

**Ordering.** After S3, because Composer's contract is the input. Before S7, because S7 mounts the full grammar tree behind a build-time completeness check and this slice changes that tree.

### S7 — Release pipeline + rc1

Repo: prisma-cli. The `prisma` binary package assembled: full grammar
tree mounted with the build-time grammar check, committed-versions
release automation, pinned product versions, and the pipeline emitting
a publishable `prisma@8.0.0-rc1` artifact from a tagged commit. Ends
when the operator can publish with one action (project DoD).

## Dependency graph

```text
S1 ──► S2 ──► S3 ──► S5 ──► S7
        │      ▲      ▲             ▲
        └──────┘      │             │
S4 (prisma/prisma) ───┴──► S5       │
S6 (after S1) ─────────────► wired in during S3/S5
S3 ──► S8 (design first) ───────────┘
```

## Follow-ups parked on other work

Recorded so they are not lost between slices.

- **Restore the "what to run next" hints that pointed at `service
  deploy`.** S2c dropped `service deploy` and `service build` (operator
  ruling: they conflated local compiling with uploading a tarball, and
  Composer supersedes them). Ten typed next actions in the surviving
  service commands suggested running `service deploy`, and were removed
  rather than left pointing at a command the binary no longer answers
  to — `show`, `list-deploys`, `open`, `promote`, `rollback`, `remove`
  and the domain commands now explain a failure without offering a
  follow-up command. **Once Composer's deploy commands exist, add them
  back pointing there** (operator instruction, 2026-08-10). The removal
  is recorded in `assets/s2/parity-divergences-s2c.md`.
- **`service logs` returns in S8**, once the engine can open an
  authenticated socket. Shelved, not rejected — unlike `service deploy`,
  which is not coming back in that shape.

## Coverage ledger (what proves what)

| Engine surface | Proven by |
| --- | --- |
| Sync commands, presenters, envelopes, exit codes | S1, S2 |
| Prompts (defaults, consent, wizard) | S2 (init) |
| Poll + status events; output streams | S2 (domain wait; `build logs` — `service logs` moved to S8) |
| Auth via context, refresh under long runs | S2, S3 (deploy) |
| Config sections, command families, validator absence | S3, S5 |
| Session commands, signal lifetime | S3 (dev, log) |
| Cross-repo/published consumption, pins, tandem releases | S3 |
| Child-status passthrough exception | S3 |
| Diagnostics model, catalogued exit codes | S5 |
| Server command (stdio) | S5 (lsp) |
| Grammar tree completeness | S7 |

## Out of plan (per spec non-goals)

Daemon library and `emulator` root; ecosystem cutover/codemods/
deprecations; `prisma.compute.ts`; GA.
