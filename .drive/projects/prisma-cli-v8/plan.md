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

**CLOSED 2026-08-12** — shipped as prisma-cli #130 (S2a), #133 (S2b), #132 (S2c), #139 (S2d: init port, shell deletion, bin cutover, the v8 working name retired). Acceptance verified against `specs/s2d-init-and-retirement.md`; the cumulative divergence record `assets/s2/parity-divergences.md` was ratified by the operator on 2026-08-12; the deletion's survivor list is `assets/s2/shell-deletion-survivors.md`; ratified-as-shipped gaps and the stale-PR sweep's orphaned capabilities are in `deferred.md`.

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

**CLOSED 2026-08-12** — shipped as prisma-cli #136/#145/#150/#151/#155
plus the mount (#152) and composer #220/#224/#226; acceptance verified
in `specs/s3-composer.md`'s Close-out section; leftovers in
`deferred.md`. Next by the dependency graph: S8 (design first).

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

**CLOSED 2026-08-12** — shipped as PR #162; acceptance verified in
the contract's Status line, follow-ups in `deferred.md`. The e2e
suite's first real run caught a family-wide defect (the stale
workspace filter) that four review rounds and 1250 unit tests
missed — the convention earned its keep.

**Design settled 2026-08-12** (operator discussion); the slice
contract is `specs/s8-services.md`. The four questions below are
answered there: no ownership note for now, records verified
compatible, the log-ownership conflict dissolved on investigation
(`composer log` reads the local dev daemon, not the platform), and
the transport question is ANSWERED — the API owners accept HTTP with
live streaming later, so `service logs` stays shelved only until the
endpoint serves HTTP, and no engine WebSocket transport is built.

Repo: prisma-cli. Give the platform's service resources an atomic CLI surface, replacing what S2c ported for continuity.

**Why this slice exists.** The legacy `app` group fused three concerns — building an artifact, wiring a GitHub repo, and deploying — into single commands, most visibly `app deploy`, which builds, creates a project, creates branches, sets environment variables, optionally provisions a database, and deploys. Composer replaces the building and deploying. What the CLI should own is managing the remote resource, and today it cannot: there is no `service list` and no `service create` despite `GET`/`POST /v1/apps`, no deployment start or stop despite `POST /v1/deployments/{id}/start|stop`, and no deployment delete. A service can currently only be born as a side effect of deploying to it. S2c ported the surviving commands under their legacy names so the commander shell could die in S2d; that port is continuity, not endorsement of the shape.

**The resource model is already right; the CLI hides it.** `/v1/apps` supports list and create, `/v1/apps/{id}` get and delete, `/v1/apps/{id}/deployments` list and create, `/v1/deployments/{id}` get and delete, and `/v1/deployments/{id}/start|stop|logs`. Composer deploys through Alchemy rather than driving that sequence itself, but Alchemy's providers call the same management API, so Composer's services and deployments are ordinary resources under these endpoints. The seam the API already draws is the one to build on: **Composer produces deployments; the CLI manages them.** Promote, rollback, start, stop, delete and logs are resource management, not build concerns — `POST /v1/deployments/{id}/start` says the artifact must be uploaded before it is called, which is the separation stated in the API itself.

That makes the shape of the slice mostly a rename plus filling holes — a `service deployment` subgroup absorbing `list-deploys`, `show-deploy`, `logs`, `promote` and `rollback`, plus the five operations that have no command at all. The expensive parts (engine, auth, presenters, error model, the `service` rename) are done.

**Why it still waits for the design work.** Four questions need answers, and none of them is about whether the resources exist. The first three are S3's to give; the fourth is for the engine and the Management API owners, because it asks what can open an authenticated log socket and whether one is needed at all.

1. ~~Does Alchemy hold desired state?~~ **Answered (operator, 2026-08-10): yes, and changing the platform directly is overwritten on the next `composer deploy`. Accepted.** So the imperative operations stay, and their effect on a Composer-managed service is understood to be transient. What remains for the design is only whether the CLI says so at the point of use — a service the CLI can tell is Composer-managed could carry a line on `promote`, `rollback`, `start` and `stop` noting the next deploy reconciles it. That depends on question 2: whether the records carry anything identifying a service as Composer-managed.
2. What do Composer's app and deployment records actually contain? If the Alchemy path populates a different subset of fields than `app deploy` did, `service show` and `service deployment show` are presenting a shape nobody has looked at.
3. Where does log reading live? `composer log` and a `service deployment logs` would be two ways to read the same thing, and the project spec rules that a subgroup is owned by exactly one command family.
4. **If log reading lands here, what opens the socket?** Added during S2c, which shelved `service logs` rather than ship it. Deployment logs are the one endpoint in the list that upgrades to a **WebSocket**, and the engine's client is HTTP-only, so the port had been taking a raw token and letting the compute SDK build the URL and set the `Authorization` header itself. The rev-6 credential model rules that out — credentials never reach commands, and `getCredentials` is now deleted — so the command cannot come back until the engine can open an authenticated socket. The design for that, written at the operator's instruction, is `assets/engine/websocket-transport-design.md`: the engine opens the socket and hands back a decoded record stream, with reconnection across the ten-minute cutoff owned by the engine rather than reimplemented per command. **Read its §7 before building anything** — if deployment logs can be served over plain HTTP the way `build logs` already is, the transport work disappears and the command becomes a copy of `build logs`. The shelved handler is reviewed, green, and in the `s2c-services` history, so restoring it is small once the transport question is answered.

One standing caveat: every endpoint above is marked experimental and subject to change without notice. Designing a stable CLI surface over an unstable API is how the next bastardization gets built, so the design has to say what it is willing to depend on.

**Ordering.** After S3, because Composer's contract is the input. Before S7, because S7 mounts the full grammar tree behind a build-time completeness check and this slice changes that tree.

### S7 — Release pipeline + rc1

**CLOSED 2026-08-12** — shipped as prisma-cli #164 plus the Release-immutability fix #166; acceptance verified in `specs/s7-release.md`'s Close-out; leftovers in `deferred.md`. The DoD artifact exists published: the operator's first real publish put `@prisma/cli@8.0.0-rc.1` (one binary answering platform, composer and ORM) and `@prisma/cli-engine@8.0.0-rc.1` on npm under `next`, `latest` untouched — RC releases publish under `next` by ruling until the deliberate flip. The bare-`prisma` cutover waits on `prisma7`; engine-pin convergence waits on the product repos bumping to the published engine. Next by the graph: S9 after the S5 cutover and S2d land (both dispatched elsewhere).

### S9 — The error-code catalogue (last)

Repo: prisma-cli. The engine raises its `CLI.*` codes from sixteen-plus
construction sites and catalogues them nowhere;
`docs/product/error-conventions.md` catalogues the LEGACY flat code
space (`BUILD_FAILED` and friends), which dies with the commander
shell. ADR 0003 requires a new error code to update that document, so
today every new engine code either updates the wrong catalogue or
silently skips the rule.

This slice writes the real one: every `CLI.*` code the shipped engine
raises, with its meaning, its exit code, and its `meta` shape; the
legacy flat catalogue is replaced, not appended to; ADR 0003's rule is
re-pointed at the new document. Products' own namespaces (`AUTH.*`,
`PROJECT.*`, `POSTGRES.*`, and the ORM/Composer families) are listed by
namespace owner, not enumerated here — each family documents its own.

**Ordering.** Last, deliberately. Ruled by the operator (2026-08-11)
while triaging the package-manager capability, whose spec asked for
"documented wherever the engine catalogues its own codes" and found no
such place. Cataloguing before the ports land would document a code
space still being written; cataloguing before the old CLI is retired
would document two competing spaces at once. So: after S5 (ports done),
after S2d (commander shell deleted), after S7 if it slips.

### S10 — Skills catch up (last, after S9)

Repo: prisma-cli (+ wherever each skill lives). Every agent skill
that teaches or drives these CLIs is rewritten against the shipped
v8 surface: the Composer skills (`skills-contrib/` in the composer
repo), the ORM skills, and the platform-CLI command skills. The v8
port renames commands, moves them between families, deletes
spellings, and changes output shapes; a skill written against the
legacy CLI silently teaches commands that exit 2. Added at operator
instruction (2026-08-12). Last, because skills document the shipped
surface: after S9, or after S7 if S9 slips — whichever means the
command tree and error catalogue have stopped moving.

## Dependency graph

```text
S1 ──► S2 ──► S3 ──► S5 ──► S7 ──► S9 ──► S10
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
  is recorded in the S2c section of `assets/s2/parity-divergences.md` (the per-slice files were folded into it at S2d).
- **`service logs` returns in S8**, once the engine can open an
  authenticated socket. Shelved, not rejected — unlike `service deploy`,
  which is not coming back in that shape.

## Coverage ledger (what proves what)

| Engine surface | Proven by |
| --- | --- |
| Sync commands, presenters, envelopes, exit codes | S1, S2 |
| Prompts (defaults, consent, wizard) | S2 (init) |
| Poll + status events; output streams | S2 (domain wait; `build logs` — `service logs` moved to S8) |
| Auth via context | S2, S3 (deploy, destroy) |
| Refresh under long runs | **Still unproven.** The child receives an access-token snapshot and never the refresh token. As of the 2026-08-14 amendment, the parent proactively rotates a refreshable stored OAuth pair before the handler when the access token is inside `CREDENTIAL_NEAR_EXPIRY_MS`; this avoids rejecting a healthy login and gives the child a fresh snapshot. Nothing bounds the child runtime, so a converge can still outlive that refreshed snapshot and fail after it has created resources. That remaining limitation is recorded in `deferred.md`. |
| Config sections, command families, validator absence | Two levels, and they are proven in different places. The section machinery — a total validator including absence, a validator's warning diagnostic, and the engine's unknown-section check — is proven by the engine's own suite (`packages/cli-engine/tests/config.test.ts`) against toy sections. What S3 adds is ONE real section end to end: composer's, a single optional string field, declared by one family, read from disk by the bin's real loader, accepted by composer's own validator, and arriving at composer's handler as the path it acts on (`v8-bin.test.ts`, "hands the composer section of prisma.config.ts to the composer family"). Only the accepting path is covered there: nothing in the bin shows composer's validator refusing a section, running on an absent one, or warning on an unknown key, because `log` against that one fixture is the only run a shipped composer command makes to config without credentials. The platform family declares no section, so two families contributing to one config file is unproven, and so is any section with required or structured fields. Both wait for S5. |
| Session commands, signal lifetime | S3 (dev, log) |
| Cross-repo/published consumption, pins, tandem releases | S3 |
| Child-status passthrough exception | S3 |
| Diagnostics model, catalogued exit codes | S5 |
| Server command (stdio) | S5 (lsp) |
| Grammar tree completeness | S7 |
| Engine error-code catalogue | S9 |

## Out of plan (per spec non-goals)

Daemon library and `emulator` root; ecosystem cutover/codemods/
deprecations; `prisma.compute.ts`; GA.
