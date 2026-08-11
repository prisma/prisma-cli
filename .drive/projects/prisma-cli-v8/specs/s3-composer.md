# S3 — Composer adoption (slice contract, revision 2 final)

Status: rev 2 final (2026-08-11) — the first-principles design
(operator-settled) plus both delta reviews folded (architect + PE,
accept-with-changes; all findings adopted, dispositions in §10).
Precedence: this contract > `specs/s2-overview.md` standing rulings
> `assets/s3/composer-inventory.md` > source. Unpinned facts are
STOP-and-surface.

Repos: **prisma/composer + prisma-cli.** Branches: `s3-composer`
(prisma-cli, stacked on merged-S2a `main`); composer branch at D2.
D2 and D3 land as a STACK and release together (composer's CLI is
never commandless on `main`; the clipanion shell is deleted in D3,
not D2).

## The design (operator-settled, 2026-08-11)

**One process.** Composer's commands are ENGINE commands: the
composer repo exports a `CommandFamily` whose handlers are
composer's own code, running in whichever process mounts the family
— composer's own thin CLI or the `prisma` bin. Composer has no
binary and none is created. The engine is the front door (grammar,
help, arg validation, auth context) plus one affordance for the
moment composer hands the terminal to alchemy.

### `ctx.spawn` (the affordance)

```ts
const child = await ctx.spawn({ command, args, cwd, env });
// child: { exitCode: number | null, signal: string | null }
```

- **Terminal**: inherited stdio, SAME process group (POSIX) /
  shared console (Windows) — the terminal delivers Ctrl-C to the
  child natively. No forwarding, no detach, no new console.
- **Signals while live**: the engine neither aborts nor exits, but
  RECORDS delivered signals; on child exit it replays them into its
  normal ladder (one recorded → `ctx.signal` aborts as if just
  delivered; two+ → abort fires and the next signal force-exits).
  The latch never advances past what the user pressed; no
  force-exit path skips handler cleanup that has not had a turn.
  The engine always outlives the child. SIGTERM (no native path to
  the child — supervisors signal the engine pid) is forwarded to
  the child during a live window.
- **Programmatic abort** (`ctx.signal` aborted by non-signal
  means, or non-TTY contexts): the engine terminates the child —
  SIGTERM, a stated grace period (ruled in D1), then SIGKILL; the
  resulting `signal` appears on the child result.
- **Windows**: shared-console delivery covers Ctrl-C for
  `deploy`/`destroy` (spawned without `detached`, no new console);
  the engine keeps its own handling (no group semantics to defer
  to) and terminates the child on abort. `dev`/`log` refuse
  Windows, as today. Group-semantics tests are POSIX-only;
  Windows behavior is asserted at the fake-spawn level.
- **Output**: no engine write may interleave with a live child.
  Commentary events (`ctx.report`) during a live spawn are
  BUFFERED and flushed in order on child exit (session handlers
  have asynchronous producers — watchers, log pumps — that cannot
  be quiesced around a converge); `ctx.present`/settlement during
  a live spawn is a construction error.
- **Reentrancy**: one live child per run; a second `ctx.spawn`
  while one is live is a construction error. `dev` coalesces
  rebuilds, as today's loop does.
- **Afterwards**: the handler resumes with the child's status.
  **A signal-killed child is an ABORT, not a failure** — handlers
  branch on `signal` before `exitCode`. To exit with the child's
  code verbatim the handler settles via the sanctioned
  `exitWithChildStatus(child)` outcome, which uses the settlement
  bypass server commands already have (no envelope; a
  signal-killed child settles 128+signal). The session kind's
  settlement is amended to permit non-zero through this path
  (today `settleSessionCompleted` hard-codes 0), and the
  session-kind "always supports json" guarantee is amended: a
  command that may spawn rejects `--json` at PARSE time (delegated
  terminal output cannot be framed; stated in help).
- **Seam**: spawning enters through `Runtime.spawn` (the bin
  passes a `node:child_process` adapter; the engine never imports
  `node:child_process`); `createTestCli` seeds a scripted fake
  recording command/args/cwd/env KEYS — never env values.
- **Telemetry**: unchanged — `RunSummary.exitCode` carries the
  settled code; `onSettled` fires; `durationMs` includes the child.

### Auth — two legs, one protocol

`PRISMA_SERVICE_TOKEN` + `PRISMA_WORKSPACE_ID` are the Prisma
ecosystem's inter-process credential protocol; the engine speaks
it. A command declares credentials; handlers never touch token
material; the engine's own process env is NEVER mutated.

- **The CHILD leg**: the engine resolves the current session into
  the affordance's child env. `source: "environment"` passes the
  env token through (no accessor call — an env session's
  workspaceId may be empty); `source: "stored"` reads
  `tokenStorage(workspaceId).getTokens().accessToken` at spawn
  time — the ONE credential-manager SPI amendment this slice
  makes, recorded in `credential-manager-design.md` with the
  single named call site. The injected token is a snapshot; the
  child never refreshes; the refresh token is NEVER injected.
- **The IN-PROCESS leg**: container ensure/locate and preflight
  run in the engine process before any spawn, and composer's code
  reads env directly there today (`container.ts:138-149`,
  `preflight.ts:185`). They are authenticated instead through
  composer's existing injection seam: `ctx.api` (the engine's
  pinned, refreshing client) into `deps.client`
  (`container.ts:144-147` skips the env check when injected), and
  the workspace id from `ctx.session()` into
  `prismaCloud({workspaceId})`. Any extension path that still
  reads env directly is a composer-side change in this slice, not
  a family-boundary workaround. With this, the one-client-per-
  process invariant of the credential-manager design HOLDS (no
  second, non-refreshing client is ever constructed on a stored
  session) — recorded in the same SPI amendment.
- **Near-expiry**: if the session expires within a threshold
  (ruled in D1), the command refuses BEFORE the in-process leg —
  not merely before spawn (a late refusal would create platform
  resources and then abort) — with the credentials-required error
  and a re-auth next action. The child runs on a static token that
  may expire mid-run past that threshold; accepted and documented.
  The plan's coverage-ledger row "refresh under long runs" is
  corrected in D4: S3 proves the static-handoff case.

**No engine-side consent.** `destroy` ports without confirmation
(legacy parity): the front door cannot know what the child will
destroy. If destroy deserves a confirmation it belongs in composer
— raised upstream as a product candidate, not built here.

### The prisma bin imports the family directly (ruled)

Committed consequences:
1. **Node floor, scoped to the bin**: the published `prisma`
   package declares `node >= 24` (composer's floor; max wins).
   `@prisma/cli-engine` and `@prisma/cli` floors do NOT move —
   composer itself consumes the engine and must not re-inherit its
   own floor through it.
2. **Install footprint** (operator-acknowledged consequence):
   every `prisma` install pulls composer's constellation —
   `alchemy@2.0.0-beta.67`, `effect@4.0.0-beta.103`,
   `@prisma/orm-*@8.0.0-rc.1`, esbuild, c12, arktype — whether or
   not composer commands are used. (Composer's alchemy pnpm patch
   is NOT a concern: it is types-only — a 13-line
   `Aliases?: … | undefined` widening in `lib/Resource.d.ts` with
   zero runtime effect. It stays applied in composer's repo for
   its own typecheck; upstreaming is a courtesy ask, not a slice
   dependency.)
3. **Alchemy must not load on `prisma version`.** The family's
   command DEFINITIONS and handler entry functions are statically
   imported (standing ruling). The EXECUTOR modules stay behind
   composer's existing dynamic-import boundary
   (`operations/deploy.ts:47`, `destroy.ts:45`, `dev.ts:68`,
   `log.ts:74`) — that boundary is the mechanism keeping effect
   out of the static graph (`execute-dev.ts:13` and
   `execute-log.ts:11` reach `effect/Layer` via
   `resolveLocalTargets`); flattening it is a contract violation,
   not an optimization. Alchemy/effect enter only at
   config-evaluation time (and dev/log's local-target thunk
   resolution) inside a running composer command. Enforced by a CI
   import check anchored at the family entrypoint and run against
   BUILT OUTPUT (type-only imports must be proven erased), catching
   any handler that statically imports an executor.
4. **Signal listeners**: alchemy's import-time listener
   registration (the @alchemy.run/node-utils exit-hook) is being
   fixed upstream — alchemy-run/node-utils#6 scopes the hooks to
   owned locks, so a bare import registers nothing. OPERATOR
   RULING (2026-08-11): NO workaround is built. The slice proceeds
   on the basis that the fix lands through the delivery chain
   (node-utils release → alchemy's exact pin bump → composer's
   alchemy bump) before D3 ships. The family's test suite keeps
   ONE assertion as the detector: after a composer command's
   config evaluation (and dev/log local-target resolution) the
   engine is the sole SIGINT/SIGTERM listener. If the chain has
   not delivered by D3, that failing test is the STOP that
   resurfaces this decision — nothing ships with alchemy's exit
   handlers live in the engine process. Residual (accepted):
   in-process alchemy code that ACQUIRES a lockfile lock registers
   handlers for the lock's duration; D2/D3 verify no in-process
   path takes locks.

## Mapping rules

R-S3-1 **Engine additions** (D1, `packages/cli-engine`):
`ctx.spawn` per above; `Runtime.spawn` + harness fake;
`exitWithChildStatus`; parse-time `--json` rejection + the two
kind amendments; credential injection (SPI amendment recorded);
the signal record-and-replay + SIGTERM forwarding + abort ladder;
**and a production, environment-only `CredentialManager` exported
from the MAIN entrypoint** — composes the env session from
`PRISMA_SERVICE_TOKEN`/`PRISMA_WORKSPACE_ID`, refuses mutations
with a structured error; composer's rebuilt CLI wires it (today
the only implementation lives in the testing entrypoint and is
not usable in production). Draft amendments; tests per the
acceptance split. Generic — no composer knowledge.

R-S3-2 **Config.** The engine's `composer` section is
`{ configPath?: string }` (fields grow only by contract
amendment). Discovery: with an explicit `configPath` the section
wins and the walk is skipped (and `CONFIG.PATH_MISMATCH` is
redundant and retires FOR THAT CASE); with no section or no
`prisma.config.ts` — the common case — composer's entry-anchored
walk runs unchanged and the PATH_MISMATCH check survives with it.
The throwing loader is rewritten to diagnostics-list semantics
(value + structured diagnostics; commands fail on sections they
need), rendered through ENGINE presentation. The effect-resolution
preflight moves INTO the shared config-load machinery (not import
time), mapping to the existing `DEPS.EFFECT_VERSION_CONFLICT`
structured error — the part of 1c deliverable 2 that S3 must own
because the prisma bin has no composer `bin.ts`; the rest stays
with the composer team. Composer-internal errors crossing into the
engine are translated at the family boundary (composer's
`CliStructuredError` shares the engine class's duck-typed name;
untranslated it would silently drop its `fix` text — mapped to
`nextActions`, pinned by test).

R-S3-3 **Family export + composer's own CLI** (D2/D3): composer
publishes the `CommandFamily` from a dedicated entrypoint with an
alchemy-free static graph. `@prisma/cli-engine` EXACT-pinned,
declared identically in BOTH `packages/9-public/composer` and the
internal CLI package, named in tsdown's `external` array
(bundling is the default there), Dependabot ignore per the
`@durable-streams/server-conformance-tests` precedent, verified
external in the packed tarball. **Composer's repo CLI is rebuilt
as a thin composition of its own exported family** — `createCli` +
`Cli.run` (public API suffices; the substantive work is the
`Runtime` composer constructs: streams, env, cwd, exit proxy,
signal subscription, and the R-S3-1 env-only credential manager) —
replacing the clipanion `main.ts`; shell and bespoke runner die in
D3. **Composer's CLI e2e tests are rewritten to drive the exported
commands** (rebuilt CLI for process-level coverage; `createTestCli`
for semantic coverage), so the family is proven standalone in
composer's CI before the prisma bin mounts it.

R-S3-4 **The four commands** (D3), engine handlers in composer's
family:
- `deploy <entry>` / `destroy <entry>`: result commands. Handler:
  section/args → near-expiry check → config evaluation → pipeline/preflight/artifact with engine
  presentation, authenticated via the in-process leg →
  `ctx.spawn(alchemy converge)` → branch on `signal` FIRST
  (signal-killed = abort: settle 128+signal, no failure envelope,
  no reproduce hint — replacing the status collapse at
  `run-alchemy.ts:61`) → failure: `exitWithChildStatus` with the
  reproduce hint as `nextActions` (stage stays container-derived,
  inventory H8) → success: read the deployment-result file,
  present the summary. `deploy --production` (accepted-but-always-
  errors today) is dropped. The `.alchemy` destroy warning ports
  verbatim, correctness tracked as H6.
- `dev <entry>`: session command (kind amendments apply). Watch
  loop, emulators, live attachments are handler state; converges
  via `ctx.spawn` (coalesced rebuilds); local-target thunk
  resolution followed by `reclaimSignals`. A converge failure
  BEFORE the session is live settles with the child's status;
  AFTER, it is a warn event and the session continues. A
  signal-killed converge is SHUTDOWN (cleanup, settle 130), never
  `converge-failed`. Ctrl-C settles 130 (legacy exits 0 —
  divergence). Windows: refuses, as today.
- `log <entry> [address]`: session command reading the LOCAL
  dev-emulator daemon (§4c; not the platform logs surface — S8
  note stands). Windows: refuses, as today.
- Auth: `deploy`/`destroy` declare credentials (both legs);
  `dev`/`log` credential-free.

R-S3-5 **Test surfaces** (D2/D3): (1) the fake child (scripted
program / `Runtime.spawn` fake) for engine and family tests.
(2) The published control-API double (claimed 1c deliverable 3)
from composer's `./testing` entrypoint: fixture-backed, same
signatures, working `DevSession` double, compile-time conformance
check in composer's typecheck; its built chunk must contain no
import path to the real implementation (types only; verified by
building the tarball and grepping the chunk for alchemy/effect).
(3) **The family-injection seam**: the family export takes an
optional operations argument (`createComposerFamily({operations?})`)
defaulting to the real control operations; prisma-cli's family
tests mount the family with the double. If D2 judges that seam
wrong, prisma-cli's family tests scope to grammar/mounting/arg
validation/credential refusal and the "green through the double"
claim moves entirely into composer's CI — D2 decides and records
which. Either way: prisma-cli's tests never spawn alchemy or
containers, and its typecheck must not require the alchemy/effect
constellation beyond what `@prisma/composer` itself demands.

R-S3-6 **Tandem release** (D4): order engine → composer →
prisma-cli; no step consumes an unpublished sibling (previews via
composer's pkg.pr.new mid-slice). The `@prisma/`-scope
pin-enforcement extension lands in composer's `ci.yml`
(publish.yml runs no checks). prisma-cli pins `@prisma/composer`
exactly; S7 consumes committed versions.

## Out of scope

`service run` (rides `ctx.spawn` later; ledger Q2 closes
"mechanism built in S3", updated in D4); S8 (consumes this slice;
its remaining unknown — planner drift detection — is a D2 read of
alchemy's source from installed node_modules, reported to the
operator); 1c deliverable 2 beyond the config-load effect check
(composer team; recorded in the closure); alchemy upstream asks
(courtesy, not dependencies).

## Acceptance

- [ ] Engine (real child, trivial script): exit passthrough incl.
      1/2/3; ENOENT structured error; native Ctrl-C reaching the
      child (POSIX; fake-level on Windows); record-and-replay
      after child exit (one signal → abort; two → escalation);
      SIGTERM forwarded during window; abort ladder
      TERM→grace→KILL; engine-outlives-child; unframed child
      stdout; buffered events flushed in order.
- [ ] Engine (fake spawn): `--json` parse rejection;
      near-expiry refusal; env composition both session sources;
      env KEYS never values; reentrancy construction error;
      telemetry settlement; the env-only credential manager's
      composition + mutation refusals.
- [ ] SPI amendment recorded (single named call site + the
      one-client invariant outcome).
- [ ] Composer family static graph alchemy-free + effect-free on
      BUILT output (CI check anchored at the family entrypoint);
      executors remain behind the dynamic-import boundary; the
      engine-sole-listener DETECTOR assertion after config
      evaluation and local-target resolution (see design
      consequence 4 — no workaround behind it, by ruling).
- [ ] Composer's rebuilt CLI (engine + own family + env-only
      manager) replaces clipanion; e2e tests drive the exported
      commands; old shell/runner deleted in D3; D2/D3 stacked.
- [ ] Four commands green in composer CI (double + fake child; no
      alchemy, no containers) and mounted under `composer` in the
      prisma bin.
- [ ] Tarball checks: engine external + exact pin; double's chunk
      import-clean; dual-manifest pin equality; Dependabot ignore.
- [ ] prisma bin: `node >= 24` (bin only); install-footprint
      consequence recorded.
- [ ] Divergences (`assets/s2/parity-divergences-s3.md`): dev
      Ctrl-C 130-vs-0; `--production` dropped; reproduce-hint
      shape; `--json` rejection; PATH_MISMATCH conditional
      retirement; help/usage output shape + bare-invocation exit
      (inventory D6/D7); `--tail` becomes a typed number flag
      (D5); `[dev]`/`[log]` console prefixes become engine events;
      exit unifications on engine-side error paths.
- [ ] 1c closed with explicit dispositions (D1 → R-S3-2; D2 split:
      config-load effect check owned here, rest composer team;
      D3 → R-S3-5).
- [ ] Ledger Q2 + coverage-ledger rows corrected.
- [ ] Both PRs through the slice review loop; suites green in
      both repos.

## §10 Disposition record

Rev 1 (2026-08-11): reviewed architect (reject) + PE
(accept-with-changes); superseded by the operator's first-
principles session — one process, `ctx.spawn`, native signal
delivery, no engine-side consent, direct family import, composer
CLI rebuilt on its own family with e2e against the exported
commands.

Rev 2 deltas (architect + PE, accept-with-changes; all adopted):
two-leg auth via composer's `deps.client` seam + workspace-id
threading; diff-based `reclaimSignals` at both alchemy entry
points; record-and-replay signal latch + SIGTERM forwarding +
abort ladder; buffered commentary during live spawns; reentrancy
rule; family-injection seam with the D2 fallback; D2/D3 stacking;
Windows shared-console mechanism; effect-resolution check into
config load; divergence additions; node floor scoped to the bin;
alchemy patch downgraded to a types-only note (PE read the
patch); executor lazy boundary named as the static-graph
mechanism + built-output check; production env-only credential
manager added to D1 (composer's rebuilt CLI needs one; only a
testing implementation exists); PATH_MISMATCH conditional
retirement; session-kind settlement amendment. Post-fold operator
ruling: the reclaimSignals workaround is OMITTED on the basis of
alchemy-run/node-utils#6 (verified: deletes the module-scope
registration, scopes hooks to owned locks); the sole-listener test
remains as the detector. Operator items:
install footprint acknowledged as a committed consequence
(accepted — operator proceeded to implementation, 2026-08-11); everything else mechanical.
