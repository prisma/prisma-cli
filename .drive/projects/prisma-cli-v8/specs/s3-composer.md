# S3 — Composer adoption (slice contract, revision 2)

Status: DRAFT rev 2 (2026-08-11) — full rewrite after the
first-principles design session with the operator; rev 1 and its
two review reports are superseded (findings folded where they
survive the new topology). Precedence: this contract >
`specs/s2-overview.md` standing rulings >
`assets/s3/composer-inventory.md` > source. Unpinned facts are
STOP-and-surface.

Repos: **prisma/composer + prisma-cli.** Branches: `s3-composer`
(prisma-cli, stacked on merged S2a `main`); composer branch at D2.

## The design (operator-settled, 2026-08-11)

**One process.** Composer's commands are ENGINE commands: the
composer repo exports a `CommandFamily` whose handlers are
composer's own code, running in whichever process mounts the family
— composer's own thin CLI or the `prisma` bin. There is no composer
binary to delegate to and none is created. The engine's role is the
front door (grammar, help, arg validation, auth context) plus one
affordance for the moment composer hands the terminal to alchemy.

**`ctx.spawn`** (the affordance — ecosystem vocabulary, node's
`child_process.spawn` family):

```ts
const child = await ctx.spawn({ command, args, cwd, env });
// child: { exitCode: number | null, signal: string | null }
```

- Child runs with INHERITED stdio in the SAME process group: the
  terminal delivers Ctrl-C to it natively. The engine defers — it
  stops reacting to signals while a child is live, never exits
  before the child, and resumes signal ownership on child exit.
  In non-TTY contexts a programmatic abort (`ctx.signal`)
  terminates the child rather than the engine.
- No engine output may interleave with a live child: `ctx.report`
  (or any engine write) during a live spawn is a construction
  error.
- The HANDLER picks up afterwards with the child's status: it may
  present results, prompt, error structurally — or settle the run
  with the child's exit code VERBATIM via a sanctioned
  `exitWithChildStatus(child)` outcome that uses the settlement
  bypass server commands already have
  (`execution/settlement.ts` / `engine.ts` server path — the
  engine's undocumented-exit-code rejection does not apply to it;
  a signal-killed child settles 128+signal).
- Spawning enters through a `Runtime.spawn` seam (the bin passes a
  `node:child_process` adapter; the engine never imports
  `node:child_process`; `createTestCli` seeds a scripted fake
  recording command/args/cwd/env KEYS — never env values).
- Commands that may hand off declare it; a declaring command
  rejects `--json` at PARSE time (delegated terminal output cannot
  be framed; shown in help). The session-kind "always supports
  json" guarantee is amended accordingly in the draft.
- Telemetry: unchanged — `RunSummary.exitCode` already carries the
  settled code; `onSettled` fires; `durationMs` includes the child.

**Auth is declared, injected, and protocol-shaped.**
`PRISMA_SERVICE_TOKEN` + `PRISMA_WORKSPACE_ID` are the Prisma
ecosystem's inter-process credential protocol; the engine speaks
it. A command declaring credentials for spawn gets them resolved by
the ENGINE into the affordance's child env; handlers never touch
token material. Mechanism (the ONE credential-manager SPI amendment
this slice makes — flagged, operator-visible): the rule "the engine
never calls the storage view's methods" gains exactly one named
exception, the spawn path — `source: "environment"` sessions pass
the env token through with no accessor call (an env session's
workspaceId may be empty); `source: "stored"` sessions read
`tokenStorage(workspaceId).getTokens().accessToken` at spawn time.
The injected token is a snapshot: the child never refreshes
(composer reads the var once). The refresh token is NEVER injected.
Near-expiry (< a threshold ruled in D1) refuses the spawn with the
credentials-required error and a re-auth next action instead of
starting a doomed converge. The plan's coverage-ledger row "refresh
under long runs" is corrected in D4: S3 proves the static-token
handoff case.

**No engine-side consent.** `destroy` ports without confirmation
(legacy parity): the engine cannot know what the child will destroy
— any front-door consent would confirm a guess. If destroy deserves
a confirmation it belongs in composer, where the knowledge lives —
raised with the composer/product side as an upstream candidate, not
built here.

**The prisma bin imports the family directly** (operator ruling:
composer has no binary; this is the only option). Committed
consequences:
1. The merged bin's node floor is composer's: `prisma` v8 declares
   `node >= 24` (composer `>= 24` vs CLI `>= 22.12` — the max
   wins). Product-visible; operator informed.
2. Composer's alchemy pnpm patch (`patchedDependencies`) does not
   survive npm consumption: it must land upstream (second ask to
   the alchemy maintainer, alongside the signal-handler ask) or be
   vendored. Tracked as a D2 work item with an explicit
   disposition; the slice does not ship a bin whose alchemy differs
   silently from composer's tested one.
3. **Alchemy must not load on `prisma version`.** The family's
   STATIC import graph (definitions + handlers) is alchemy-free and
   effect-free; alchemy enters only at config-evaluation time
   inside a running composer command (this is where composer's own
   ADR-0017 boundary already points). Enforced by an import-graph
   check in composer CI (and consumed by S6 when it lands).
   Handlers are statically imported (standing ruling) — it is
   ALCHEMY that arrives at runtime, via the evaluation that already
   happens per-run.
4. Alchemy's import-time process signal listeners (the exit-hook
   registration in @alchemy.run/node-utils) therefore appear
   mid-run, after config evaluation, inside the engine's process.
   Until the upstream fix lands, the family's shared config-load
   machinery strips them immediately after evaluation (composer's
   existing `run-dev.ts` defense, relocated and catalogued as
   retained behavior, scoped to composer-command runs). The engine
   re-owns signals from that point; `ctx.spawn` windows follow the
   defer rule above.

## Mapping rules

R-S3-1 **The engine additions** (`packages/cli-engine`, dispatch
D1): `ctx.spawn` + `Runtime.spawn` + the `exitWithChildStatus`
settlement outcome + the parse-time `--json` rejection for
declaring commands + the credential injection (with the SPI
amendment recorded in `credential-manager-design.md`) + draft
amendments + tests per the acceptance split below. Generic — no
composer knowledge.

R-S3-2 **Config.** The engine's `composer` section is a light
serializable projection: `{ configPath?: string }` (fields may grow
only by contract amendment — nothing else is currently proven
necessary; the plan's "config sections proven by S3" ledger claim
is scoped honestly in D4: S3 proves section presence/absence and
family coupling; the deep section proof is S5's). Discovery
reconciliation: composer's entry-anchored walk for
`prisma-composer.config.ts` is preserved; the section's
`configPath` is an OVERRIDE — when both exist and disagree, the
explicit section path wins and the walk is skipped (the
`CONFIG.PATH_MISMATCH` same-file check retires with the walk it
guarded, catalogued). The throwing loader is rewritten to
diagnostics-list semantics (evaluated value + structured
diagnostics; commands fail on the sections they need) and — now
that composer commands run IN an engine process — diagnostics
render through ENGINE presentation as structured errors.
Composer-internal errors that reach the engine are translated at
the family boundary: composer's `CliStructuredError` shares the
engine class's duck-typed name, so untranslated it would pass the
guard and silently drop its `fix` text — the boundary maps `fix` →
`nextActions`, pinned by test.

R-S3-3 **Family export + composer's own CLI** (D2/D3): composer
publishes the `CommandFamily` (command set + section token) from a
dedicated entrypoint with an alchemy-free static graph.
`@prisma/cli-engine` is an EXACT-pinned production dependency,
declared at the same version in BOTH `packages/9-public/composer`
and the internal CLI package, named explicitly in tsdown's
`external` array (bundling is the default there —
`skipNodeModulesBundle: false`; a dependency declaration alone does
NOT externalize), given a Dependabot ignore entry per the
`@durable-streams/server-conformance-tests` precedent, and verified
external in the packed tarball. **Composer's repo CLI is rebuilt as
a thin composition of its own exported family** — `Cli.run` +
the family, replacing the clipanion `main.ts`; the clipanion shell
and its bespoke runner die in this slice. **Composer's CLI e2e
tests are rewritten to drive the exported commands** (through the
rebuilt CLI for process-level coverage and `createTestCli` for
semantic coverage), so the family is proven standalone in
composer's CI before the prisma bin mounts it.

R-S3-4 **The four commands** (D3), all as engine handlers in
composer's family, per the inventory:
- `deploy <entry>` / `destroy <entry>`: result commands. Handler:
  section/args → config evaluation (alchemy loads; listeners
  stripped) → pipeline/preflight/artifact with engine presentation
  and structured errors → `ctx.spawn(alchemy converge)` →
  afterwards: read the deployment-result file, present the
  summary; converge failure settles with the child's code via
  `exitWithChildStatus` and the reproduce hint ports to
  `nextActions` (stage stays container-derived — inventory H8;
  divergence entry for the hint's shape). `deploy --production`
  (accepted-but-always-errors today) is dropped; divergence entry.
  The `.alchemy` destroy warning ports verbatim, correctness
  tracked as inventory H6 (needs alchemy planner source).
- `dev <entry>`: session command (json-support amendment applies).
  Watch loop, emulators, and live local-target attachments are
  handler-state in the composer process; each converge is one
  `ctx.spawn`. A converge failure BEFORE the session is live
  settles with the child's status; AFTER, it is a warn event and
  the session continues (today's behavior). Ctrl-C: native
  delivery + `ctx.signal`-driven cleanup; settles 130 (legacy
  exits 0 — divergence entry). Windows: refuses to run, as today.
- `log <entry> [address]`: session command reading the LOCAL
  dev-emulator daemon (inventory §4c; not the platform logs
  surface — S8 note stands). Windows: refuses, as today.
- Auth: `deploy`/`destroy` declare credentials-for-spawn;
  `dev`/`log` stay credential-free.

R-S3-5 **Test surfaces** (D2/D3): (1) the fake child — a scripted
program the `Runtime.spawn` fake or a real trivial script stands in
for; used by engine tests (D1) and family tests. (2) The published
control-API double (claimed 1c deliverable 3) from composer's
existing `./testing` entrypoint: fixture-backed, same signatures
and result shapes, a working `DevSession` double, compile-time
conformance check in composer's typecheck job; its built chunk must
contain no import path to the real implementation (types only —
verified by building the tarball and grepping the double's chunk
for `alchemy`/`effect`). prisma-cli's family tests must pass
without alchemy or containers, and its typecheck must not require
the alchemy/effect constellation beyond what `@prisma/composer`
itself demands.

R-S3-6 **Tandem release** (D4): release order engine → composer →
prisma-cli; no step consumes an unpublished sibling (previews via
composer's pkg.pr.new workflow where needed mid-slice). The
`@prisma/`-scope pin-enforcement extension lands in composer's
`ci.yml` (publish.yml runs no checks). prisma-cli pins
`@prisma/composer` exactly; the S7 release pipeline consumes the
committed versions.

## Out of scope

`service run` (rides `ctx.spawn` in a later platform-CLI change —
S2 ledger Q2 closes "mechanism built in S3", updated in D4); S8
(consumes this slice; its remaining unknown — whether alchemy's
planner drift-detects — is assigned to D2 as a read of alchemy's
planner source from composer's installed node_modules); 1c
deliverable 2 (composer team; recorded in the 1c closure); the
alchemy upstream asks (tracked with the maintainer; not
dependencies of this slice).

## Acceptance

- [ ] Engine: `ctx.spawn` behaviors tested with the split — REAL
      child (trivial script): exit passthrough incl. codes 1/2/3,
      ENOENT structured error, native Ctrl-C reaching the child
      (POSIX; skipped on Windows), engine-outlives-child,
      programmatic-abort termination, unframed child stdout; FAKE
      spawn: `--json` parse rejection, credentials-refused-before-
      spawn (near-expiry), env composition both session sources,
      env KEYS recorded never values, telemetry settlement.
- [ ] SPI amendment recorded in `credential-manager-design.md`
      with the single named call site.
- [ ] Composer family static graph provably alchemy-free +
      effect-free (CI import check); alchemy loads only during a
      composer command's config evaluation; listener strip after
      evaluation covered by test.
- [ ] Composer's rebuilt CLI (engine + own family) replaces
      clipanion; e2e tests drive the exported commands; old shell
      and runner deleted.
- [ ] Four commands green in composer CI (double + fake child; no
      alchemy, no containers) and mounted under `composer` in the
      prisma bin.
- [ ] Tarball checks: engine external + exact pin, double's chunk
      import-clean; dual-manifest pin equality; Dependabot ignore.
- [ ] prisma bin: node `>= 24` declared; alchemy-patch disposition
      resolved and recorded (upstream or vendored).
- [ ] Divergence file `assets/s2/parity-divergences-s3.md`:
      dev Ctrl-C 130-vs-0, `--production` dropped, reproduce-hint
      shape, `--json` rejection, PATH_MISMATCH retirement,
      exit unifications on engine-side error paths.
- [ ] 1c closed with explicit dispositions (D1 superseded by
      R-S3-2; D2 left with composer team, recorded; D3 delivered
      per R-S3-5).
- [ ] S2 overview ledger Q2 row updated; coverage-ledger rows
      ("refresh under long runs", "config sections") corrected.
- [ ] Both PRs through the slice review loop; suites green in both
      repos.
