# S3 — Composer adoption (slice contract)

Status: DRAFT for architect/PE review (2026-08-11). Normative
sources and precedence: this contract > `specs/s2-overview.md`
standing rulings > `assets/s3/composer-inventory.md` (the record of
current behavior) > this repo's engine source. Unpinned facts are
STOP-and-surface, never improvised.

Repos: **prisma/composer + prisma-cli.** Two PRs, coordinated:
composer exports the family; prisma-cli gains the engine subshell
primitive and mounts the family under the ruled `composer` root.
Branches: `s3-composer` (prisma-cli, off `main`-merged S2a state),
composer-side branch created at D2.

## Operator rulings this contract implements (2026-08-11)

1. **Subshell primitive**: the engine exposes child-process handoff
   primitives on the command context; the engine controls auth
   pass-through, steps aside for the child's terminal, manages the
   process, and passes the exit code through.
2. **`workspace`-style auth injection**: composer's extension code
   keeps reading `PRISMA_SERVICE_TOKEN`; the ENGINE injects it into
   the child environment from the credential manager's current
   session. No composer-side auth changes.
3. **Signals**: the engine process never imports alchemy (config
   evaluation moves child-side), so alchemy's import-time signal
   handlers never exist in our process. The upstream ask (lazy
   exit-hook registration in @alchemy.run/node-utils) is tracked
   with the maintainer separately; the port does not depend on it.
4. **Config**: verified — evaluating `prisma-composer.config.ts`
   pulls the alchemy/effect provider tree by design (ADR-0017), and
   the value holds functions and Layers. Therefore the engine's
   `composer` section validates a light serializable PROJECTION
   only; the heavyweight evaluation and the diagnostics-returning
   validator rewrite live child-side.
5. **The 1c test double is CLAIMED into S3** (operator: "Agreed").
   1c deliverable 1 (throwing loader → diagnostics) is superseded
   by rule R-S3-4. 1c deliverable 2 (effect preflight off import
   time) is a recorded NON-GOAL left with the composer team — the
   1c closure note must say so explicitly.

## Mapping rules

R-S3-1 **The subshell primitive** (engine, `packages/cli-engine`).
A command-context affordance for handing the run to a child
process. Normative properties:
- Declared on the command definition (a capability like
  `managesCredentials`): `handsOffTerminal: true`. Only commands
  declaring it get the context affordance.
- The affordance takes `{ command, args, cwd, env, credentials }`
  where `credentials: "service-token"` instructs the ENGINE to
  resolve the current session via the credential manager and set
  `PRISMA_SERVICE_TOKEN` in the child env (absent session → the
  standard credentials-required error BEFORE spawn). Handler code
  never touches token material.
- Spawn is ASYNC (never `spawnSync`); stdio `inherit`; the engine's
  own presentation is suspended for the child's duration (no
  engine output interleaves); the engine forwards SIGINT/SIGTERM to
  the child process group and waits for exit — `ctx.signal` aborts
  are delivered as signals to the child, and the engine's
  double-SIGINT hard-exit behavior is preserved.
- The child's exit code becomes the CLI's exit code, verbatim —
  including codes that collide with engine-reserved meanings
  (documented; this is the ruled passthrough exception).
  Spawn-failure (ENOENT etc.) is NOT passthrough: normal structured
  error, exit 2.
- `--json` on a command whose run reached the handoff is a usage
  error (exit 2): passthrough output cannot be framed. DEFAULT
  built to this; flagged for operator veto in review.
- Telemetry still records the run (duration, passthrough exit code
  in meta — never child output).
- Draft amendments (§context/§definitions) land with the
  implementation. This primitive is also the mechanism `service
  run` (S2 ledger Q2, parked) will ride — Q2 is thereby resolved
  "built in S3"; the S2 overview ledger row is updated in D4.

R-S3-2 **The `composer` config section** (engine section API): a
serializable projection only — `{ configPath?: string }` plus
whatever D2 proves necessary (stage selection stays per-command,
matching today's flags). The section validator performs NO module
evaluation. Everything the inventory documents about c12 loading,
same-path checks, and field validation moves into composer's
control library (child/CLI-process side), rewritten from throw-per-
field to the diagnostics list semantics (evaluated value + list of
structured diagnostics; commands fail on the sections they need) —
the 1c deliverable-1 semantics, delivered via the section rewrite.

R-S3-3 **Family export** (`prisma/composer`): composer publishes
its `CommandFamily` (the `composer` command set + section token)
from a dedicated entrypoint; prisma-cli mounts it under the ruled
`composer` root. `@prisma/cli-engine` is an EXACT-pinned production
dependency of composer. Two hazards from the inventory are
acceptance items: composer's pin-enforcement check is extended to
cover the `@prisma/` scope (today it keys off `pnpm list -r`), and
the published tarball is verified to treat the engine as EXTERNAL
(tsdown must not inline it — inlining would void the published-
consumption proof while appearing to pass).

R-S3-4 **The four commands**, per the inventory:
- `composer deploy <entry>` / `composer destroy <entry>`: result
  commands whose execution reaches the subshell handoff for the
  alchemy converge (R-S3-1). Pre-child phases (config load,
  preflight, artifact assembly) run engine-side with normal
  engine presentation and structured errors. `destroy` gains
  consent per the engine's consent-token mechanism: token = the
  entry's application name, satisfied by `--confirm <name>`
  (legacy has NO confirmation — a deliberate safety divergence,
  catalogued).
- `composer dev <entry>`: session command; the watch loop's alchemy
  converges go through the subshell primitive (each converge one
  child); the local-target services and emulator lifecycle move
  child-side per ruling 3 (no alchemy imports in the engine
  process). `process.removeAllListeners` DIES; the engine owns
  signals, `ctx.signal` drives shutdown, dev's cleanup runs as
  handler finalization.
- `composer log <entry> [address]`: session/stream command reading
  the LOCAL dev-emulator daemon (inventory 4c: zero platform
  involvement — this is not the platform logs surface and must not
  be conflated with it; S8 note).
- No command gets `--json` beyond the engine's standard behavior
  for its kind (and R-S3-1's handoff restriction). Composer's
  current bare-bones flag surfaces port as-is; divergence entries
  for every behavior change (consent on destroy, exit-code
  unifications on non-passthrough paths, engine help/error shapes).

R-S3-5 **Credentials**: engine-injected per ruling 2. The env var
remains the ONLY composer-side credential interface. When no
session exists and a command needs the child authenticated, the
engine's standard credentials-required error fires before any child
spawns. `dev`/`log` remain credential-free (inventory).

R-S3-6 **The published control-API test double** (claimed 1c
deliverable 3): composer publishes a fixture-backed double of its
control operations (deploy/destroy/dev/log) — same signatures, same
result shapes, per-operation fixtures overridable per test, a
`DevSession` double with working lifecycle, and a compile-time
conformance check that the double's surface matches the real
operations. prisma-cli's tests for the composer family consume the
double; no test in prisma-cli ever spawns alchemy or containers.

R-S3-7 **Tandem release**: the glue that lets a composer release
pin an exact engine version and a prisma-cli release consume the
family on committed versions — workflow additions per the
inventory's §5 findings (no tag-triggered release exists; publish
is merge-a-release-PR; the glue follows that convention in both
repos). The S6 conformance checker's tarball verification is the
enforcement backstop when S6 lands; S3 ships the check scripts it
can (tarball externality per R-S3-3).

## Out of scope

`service run` porting (rides the primitive in a later platform-CLI
change); S8 entirely (its design consumes this slice's outputs);
1c deliverable 2 (composer team); any alchemy upstream change
(tracked with the maintainer, not a dependency); platform logs
surface.

## Acceptance

- [ ] Engine subshell primitive: spec'd behaviors tested (async
      spawn, presentation suspension, signal forwarding incl.
      double-SIGINT, env/auth injection, exit passthrough incl.
      collision codes, spawn-failure structured error, `--json`
      rejection, telemetry record).
- [ ] Engine process provably free of alchemy imports (import-
      purity check on the family's engine-side modules).
- [ ] Four commands mounted under `composer` and green through the
      test double; the double's conformance check green.
- [ ] Composer tarball: engine external + exact pin, verified in
      CI on both repos.
- [ ] `dev`'s `removeAllListeners` deleted; signal ownership
      demonstrated by test (SIGINT during dev stops services
      cleanly).
- [ ] Divergence file `assets/s2/parity-divergences-s3.md`
      complete (destroy consent, exit unifications, help/error
      shapes, engine-owned flags).
- [ ] 1c brief closed with explicit dispositions (D1 superseded
      here, D2 left with composer team, D3 delivered here).
- [ ] S2 overview ledger Q2 row updated (mechanism built in S3).
- [ ] Both PRs reviewed (slice review loop), suites green in both
      repos.
