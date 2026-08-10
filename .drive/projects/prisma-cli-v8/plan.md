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

**Blocked on design work, and the design work is blocked on a fact we do not have.** Composer does not deploy through the management API — it deploys through Alchemy, on a completely different path (operator, 2026-08-10). So a Composer-deployed service does not appear in `/v1/apps` or `/v1/apps/{id}/deployments`, and the resource model those endpoints describe is the compute product Composer is replacing. Until we know what a Composer-deployed service *is* to the platform — whether it is represented at all, and under which nouns — there is nothing to design atomic primitives over. An earlier sizing of this slice as "small, mostly a rename" assumed Composer would create deployments through the platform API. That assumption is false and the sizing with it: the domain model is unknown, so the slice is unsized.

**What the design work has to answer, before any dispatch is planned.**

1. What is a service, after Composer? Does the platform represent a Composer-deployed workload, and under which resource?
2. Who owns the deployment noun? The platform API separates producing an artifact from making it live — `POST /v1/deployments/{id}/start` states the artifact must be uploaded first — so promote, rollback, start, stop and logs are resource management rather than build concerns. Whether that separation survives Alchemy is the question.
3. Which of the S2c-ported commands are superseded outright, which are renamed, and which stay.
4. Every endpoint involved is marked experimental and subject to change without notice. Designing a stable CLI surface over an unstable API is how the next bastardization gets built; the design has to say what it is willing to depend on.

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

## Coverage ledger (what proves what)

| Engine surface | Proven by |
| --- | --- |
| Sync commands, presenters, envelopes, exit codes | S1, S2 |
| Prompts (defaults, consent, wizard) | S2 (init) |
| Poll + status events; output streams | S2 (domain wait; app/build logs) |
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
