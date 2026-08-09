# Daemon library — design conclusions, parked

Status: **excluded from the CLI-engine scope** (Will, 2026-08-09) — it is a
runtime dependency of product control clients, orthogonal to the engine.
These notes preserve what the design conversation concluded so the work is
picked up, not re-derived. Evidence citations: `output-modes-survey.md`
(emulators/daemons section).

## The finding that shaped the engine

"Daemon mode" needs **zero engine surface**. Commands touching daemons are
ordinary commands: `ls` is a result command presenting a table over
`scan()`; `stop` presents a result over `stop()`; `composer dev` calls
`ensure()` during startup then runs as a normal session command. The
daemon-ness lives in what handlers do (operations layer), like spawning
alchemy already does.

## What the library is

The lifecycle-and-discovery primitives that Composer's
`dev-emulators/src/daemon.ts` and `@prisma/dev`'s state layer each
hand-built (convergent evolution — the evidence they're one concept):

- **ensure(name, entry, opts)** — idempotent start: read registry entry,
  probe health (identity/version-matched), adopt a healthy same-version
  daemon, terminate-and-replace a stale-version one, spawn detached+unref
  when absent, record `{pid, port, version, logPath}`, await health — all
  serialized under a lockfile so concurrent CLI invocations can't race.
- **stop(name)** — SIGTERM, grace, SIGKILL, remove entry.
- **scan() / status(name)** — registry entries probed to
  running/starting/dead.
- **logs(name)** — per-daemon stdio log file.
- Daemon-side: an entry-script harness (bind localhost port, serve
  /health + the product's admin API, SIGTERM cleanup).

Each daemon's **admin API stays product-owned**; the library owns only
lifecycle and discovery. Registry entries need a product-data extension
slot (same shape of reasoning as the engine's R14).

## Open questions when picked up

1. **Unified machine-wide registry vs per-product registries + an
   aggregating command.** Unified (one `ls` shows Composer emulators and
   dev servers; one stop semantics; the second liveness implementation
   stops existing) costs a real `@prisma/dev` internal migration
   (`server.json` format, its `proper-lockfile` usage) including
   old-format servers; per-product costs nothing now but keeps two
   liveness protocols forever and adds one per future daemon.
2. **The package's home.**
3. The management-command surface the grammar parked (`emulator`
   root: ls/stop/status) — the gap that today lets Composer leave
   daemons on the machine with no user-facing way to list or stop them
   (`stopDaemon` is "not called by any v1 command").

## Effect on @prisma/dev (under unification)

Public API (`startPrismaDevServer`, scan/status surface) unchanged;
internals swap to the shared library; its domain fields (ports, exports)
ride the registry's extension slot; migration must handle servers created
under the old on-disk format.
