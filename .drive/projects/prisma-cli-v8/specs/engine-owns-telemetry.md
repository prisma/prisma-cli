# Engine spec — the engine owns telemetry reporting

Status: ruled 2026-08-11 (operator: telemetry reporting is not a consumer's
responsibility; it belongs in the engine). Amended the same day by three
further rulings — **read §1.1 before the body**, it overrides the original
draft wherever the two still read differently.

Deliverable: one PR to `packages/cli-engine`, plus the deletion of the
shell's copy. The second consumer is the ORM's `prisma-next` bin, which must
not have to re-implement any of this.

## 1. What this is and why

The engine already knows everything telemetry needs at parse time: the
command path, the flag names with their value source, and a count of
positionals (`EngineCommandSnapshot`, `src/run-summary.ts`), built in
`executeMounted` (`src/execution/engine.ts:390`). It stops there. Sending is
left to each consumer, and today the platform shell does it in 136 lines of
bin code (`packages/cli/src/v8/telemetry/reporting.ts`): resolve gating,
print the first-run disclosure, resolve the sender's path, attach a hook,
spawn the detached sender, swallow every failure.

That leaves the ORM's `prisma-next` bin to write the same logic against a
second copy of the telemetry package, with the same installation id, the same
endpoint, the same wire shape, and the same first-run disclosure. The two
copies have **already drifted**: `@repo/cli-telemetry`'s gating resolves CI
inside `resolveGating` and reports `env-opt-out`, while the ORM's resolves CI
in the caller and reports `env-override`, with a second projection in its
`telemetry status` command translating one vocabulary into the other. Nothing
user-visible has broken yet; that is luck, not design.

The project's own framing has the engine owning "argv parsing, help, output
envelopes, JSON mode, prompts, consent, **telemetry**, error presentation,
and exit codes". Reporting is the half that never landed.

There is no purity argument against it: the engine already constructs an
authenticated API client, opens URLs, and reads the filesystem
(`src/config-loader.ts` imports `node:fs`). Telemetry is one more engine-owned
surface with a bin-supplied seam for the actual process work.

### 1.1 Operator rulings — these override the original draft

1. **Whatever the ORM does today moves into the engine, as it is.** The
   engine reproduces the shipped ORM behaviour; it does not improve it in
   passing. Where the platform shell and the ORM disagree, the ORM wins.
2. **Report a command's option names without special-casing; never report
   param values.** No per-command allowlist, no curation. Option names as the
   user spelled them, and no value of any option or positional ever leaves
   the process.
3. **Follow the ORM's example on timing** — the event fires at *command
   start*, from the parse-time snapshot, not at settlement.

Three things the original draft asked for are struck by those rulings:

- **No outcome data on the wire.** The draft added exit code, duration,
  platform/arch/node version and a CI flag. The shipped event has none of
  them, and prisma/prisma's published `docs/Telemetry.md` tells users in
  writing: "**No outcome data.** Phase 1 does not collect success/failure,
  exit code, or elapsed time." Firing at command start makes this structural
  — at that point no exit code or duration exists to send.
- **No `onSettled`.** `RunSummary` is by construction a settlement artifact.
  The engine fires from `EngineCommandSnapshot` instead, at the point the
  snapshot is built.
- **No `ctx.telemetryStatus`, no `ctx.telemetry.setEnabled`, no
  `managesTelemetry` capability.** The engine ships the three commands
  itself (§2.4), so no product needs private access to render or mutate the
  preference. Unbuilt surface, dropped rather than built unused.

## 2. The surface

### 2.1 Declaration at `createCli`

```ts
createCli({
  name,
  version,
  commandFamilies,
  groups,
  commands,
  telemetry: { docsUrl: 'https://…' },   // named in the first-run disclosure
})
```

One field. The endpoint, the opt-out environment variable names, the
user-config path and the disclosure wording are Prisma constants and live in
the engine — the engine is Prisma-specific by design, and a generic
extension mechanism here would be surface with one caller. The CLI's own
name and version come from `createCli`'s existing fields.

Omitting `telemetry` means the CLI reports nothing: the engine reads no
config, prints no disclosure, mints no id, and calls no seam. There is no
default endpoint and no way to report without declaring the block.

A host that declares the block but wires no `spawnTelemetry` (§2.5) is the
same case and takes the same path. Both halves are required before anything
happens, and the check comes first, before the config read. A CLI that
cannot deliver an event must not tell the user it collects data, and must
not mint an installation id it has no use for — the disclosure is a promise
about what the binary does, not about what it declares.

### 2.2 What the engine does, and when

Immediately after `state.snapshot` is assigned in `executeMounted`
(`src/execution/engine.ts:390`) — before the needs check, before the handler,
before any command output — and exactly once per run:

1. **Skip the exemption.** A run whose command path starts with `telemetry`
   sends nothing and mints nothing. `telemetry disable` must not report a
   usage event on its way to disabling, and `telemetry status` must not mint
   an id while merely reporting state. This is the only command-specific
   exemption, and it is the one the ORM already has.
2. **Resolve gating**, in the ORM's order: CI hard-disables first, then the
   environment opt-outs (`PRISMA_DISABLE_TELEMETRY` truthy, or
   `DO_NOT_TRACK=1`), then a stored `enableTelemetry: false`, then a stored
   `true`, then the opt-out default (absent means on). The resolution carries
   its reason from the five-value union in §2.3.
3. **Print the first-run disclosure** when the decision is enabled and no
   installation id is stored yet — to stderr, never stdout, so it cannot
   corrupt piped output. Composed by the engine from the CLI name and the
   declared `docsUrl`. It names the `telemetry disable` command and the two
   environment variables, and does **not** name the preference file: that
   file is machine-edited, which is what the commands are for (operator
   ruling, 2026-08-11). `telemetry status` reports its path for anyone who
   wants it — describing where the preference lives is not the same as
   telling someone to edit it there.
4. **Mint and store the installation id** — a v4 UUID, written without
   touching `enableTelemetry`, so a default-on first run records no consent
   the user never gave. Never rotated, never derived from anything
   machine-identifying.
5. **Compose the payload and hand it to the seam** (§2.5). The engine
   composes; the bin spawns.
6. **Swallow every failure.** An unwritable config directory, a throwing
   seam, a malformed stored config — none of it changes an exit code, writes
   to a command's output, or delays the run.

A run that never mounts a command (`--help`, `--version`, an unknown
command, a usage error) builds no snapshot and therefore reports nothing.

**No values, ever.** The payload carries the command path joined with
spaces and the *names* of the options whose source is `cli` — the options
the user actually typed, in the engine's own kebab-case spelling, with no
per-command filtering. Option values, positional values and raw argv never
reach the payload. `positionalCount` exists on the snapshot and is
deliberately never read.

### 2.3 The status reasons

The five the two CLIs already agree on at the surface, evaluated in that
order:

```ts
type TelemetryStatusReason =
  | 'ci'              // a CI environment was detected
  | 'env-opt-out'     // DO_NOT_TRACK / PRISMA_DISABLE_TELEMETRY
  | 'stored-opt-out'  // "enableTelemetry": false
  | 'stored-opt-in'   // "enableTelemetry": true
  | 'default-on';     // no explicit choice stored
```

The original draft's `env-override` and `not-configured` spellings are
dropped. `env-override` is the ORM's *internal* gating vocabulary, which its
own `telemetry status` already translates to `env-opt-out` before showing a
user; the engine collapses that translation by resolving to the user-facing
union directly. `not-configured` describes a CLI that declared no telemetry
block, which has no status command mounted to report it.

### 2.4 The commands

The engine ships `telemetry status`, `telemetry enable` and `telemetry
disable`, mountable by a product in one line, with the help text, output and
exit behaviour the two CLIs already share:

- **`status`** — read-only. Reports enabled/disabled with the reason, the
  config file path, and whether an installation id is stored. Never prints
  the id itself, never mints, never writes, never sends.
- **`enable`** — stores `enableTelemetry: true` and mints an installation id
  if none exists.
- **`disable`** — stores `enableTelemetry: false`. Mints nothing, sends
  nothing.

They are ordinary engine commands: `ctx.present` with human, stdout and json
presentations, so `--json` works the way it does everywhere else.

### 2.5 The runtime seam

```ts
interface Runtime {
  // …existing members…
  /** True when this process runs in CI. The bin wires `ci-info`; the
   *  engine never detects CI itself. */
  readonly isCI: boolean;
  /** Fire-and-forget delivery of one composed telemetry payload. The bin
   *  owns the process work and the detachment. Absent means this host
   *  reports nothing — not an error. */
  readonly spawnTelemetry?: (payload: TelemetryPayload) => void;
}
```

The engine composes and hands over; the bin forks. An absent seam is not an
error, and per §2.1 it suppresses the whole sequence rather than only the
delivery. The engine imports no `node:child_process` and performs no network
I/O for telemetry. `isCI` is a
Runtime field rather than an engine-side `ci-info` import because the engine
never reads process globals — the same rule that keeps TTY detection on the
Runtime.

That rule binds the preference store too, and it is the one place a
port-as-is would break it. `$XDG_CONFIG_HOME`, `%APPDATA%`, `$HOME` and
`%USERPROFILE%` are all invocation inputs: they must resolve from
`runtime.env`, threaded through the path resolver, the reader, the writer and
the id mint, not read from `process.env` — and `os.homedir()` is a
`process.env` read wearing a different hat, so it has no place here either.
When none of the four is present the store has no path, and telemetry reports
nothing rather than guessing at one. In production every host sets `$HOME`, so
this only ever fires in a test that seeded no environment — where doing
nothing is the correct answer. The engine reads `process.env` nowhere today — five separate
doc comments across `context.ts`, `credential-manager.ts`,
`environment-credential-manager.ts` and `execution/debug.ts` say so — and a
telemetry module that did would also mean any `createTestCli` run touched the
real user's config file.

`process.platform` and `process.pid` stay. Neither varies with an invocation,
neither is modelled on the Runtime, and adding a `platform` field for one
caller is surface without a second consumer. Nothing in either CLI's test
suite exercises the Windows branch of the path resolver today, so this
changes no coverage.

`createTestCli` gains a `telemetrySpawner` seed and an `isCI` seed so a
product's telemetry behaviour is assertable offline; no test contacts a real
endpoint.

### 2.6 What moves, and what stays

| Module | Where it lands |
| --- | --- |
| `cli-telemetry/src/gating.ts` | engine — resolving to the §2.3 union |
| `cli-telemetry/src/user-config.ts` | engine — read, write, mint, path resolution |
| `cli-telemetry/src/sanitize.ts` | engine — importing the real `EngineCommandSnapshot` instead of redeclaring it |
| `cli-telemetry/src/endpoint.ts` | engine — constant plus the `PRISMA_TELEMETRY_ENDPOINT` test override |
| `ParentToSenderPayload` (the type) | engine — it is what the engine composes |
| `isParentToSenderPayload` (the validator) | stays in `cli-telemetry` — it guards the child's trust boundary |
| `cli-telemetry/src/enrich.ts`, `sender.ts` | stay — the child still probes the system and POSTs |
| `cli-telemetry/src/spawn.ts` | stays, shrunk: the engine has already decided, so it forks and sends, and no longer re-resolves gating or re-reads the user config |
| `cli/src/v8/telemetry/reporting.ts`, `is-ci.ts`, `status.ts`, `enable.ts`, `disable.ts`, `consent.ts` | deleted |
| `cli/src/v8/telemetry/sender.ts` | stays — the build entry that carries the forkable sender into the published cli |

`packages/cli/src/v8/runtime.ts` gains `isCI` (wiring `ci-info`) and
`spawnTelemetry`; `main.ts` drops its `resolveTelemetryHooks` block; `cli.ts`
mounts the engine's three commands in place of its own.

## 3. What must not change, and the one thing that does

**The wire shape and the endpoint.** The 13-field `TelemetryEvent` is
untouched, and the parent still sends
`{ installationId, version, command, flags, projectRoot, endpoint }` over IPC,
so events from the platform CLI before and after this change are
indistinguishable to the backend.

**The `prisma-next` naming goes, with no legacy support** (operator ruling,
2026-08-11). This overrides the earlier draft, which required the config path
and environment variables to stay put:

| Was | Is |
| --- | --- |
| `$XDG_CONFIG_HOME/prisma-next/config.json`, `~/.config/prisma-next/config.json`, `%APPDATA%\prisma-next\config.json` | the same three, under `prisma` |
| `PRISMA_NEXT_DISABLE_TELEMETRY` | `PRISMA_DISABLE_TELEMETRY` |
| `PRISMA_NEXT_TELEMETRY_ENDPOINT` | `PRISMA_TELEMETRY_ENDPOINT` |
| `PRISMA_NEXT_DEBUG` | `PRISMA_DEBUG` |

`DO_NOT_TRACK` is a community convention and does not move.

No read fallback, no dual-write, no migration: the old location is not
consulted and the old variable names do nothing. Tests pin that absence, so a
fallback cannot creep back in later.

Two consequences, both accepted on the ruling. Every stored preference and
installation id at the old path is abandoned — an existing opt-out reverts to
the opt-out default and an existing id is orphaned, so the backend sees the
population turn over once. And the file stops being shared with the ORM's
`prisma-next` binary, so until that binary ports onto the engine each holds
its own answer. Both are acceptable because this is semver zero and retiring
that binary is the project's whole purpose.

`PRISMA_DEBUG` is now one switch for every diagnostic the CLI has — the
engine's execution valve, the auth layer's state-file logging, the telemetry
spawner and the child sender. Renaming only the telemetry half would have left
a user setting one variable and getting half an answer.

`ParentToSenderPayload.databaseTarget` stays on the type for wire
compatibility and the engine never populates it — the ORM's parent never did
either; the child derives it from the user's config.

## 4. Divergences this creates

Both are recorded in `assets/s2/parity-divergences.md` as part of the slice.

- **The platform CLI moves from settlement to command start.** Its S2a
  divergence note — that a run which crashes or exits early before settlement
  emits nothing — is retired rather than extended, because the event now
  fires before the command runs at all. ADR 217 (prisma/prisma), which makes
  "spawned at command start" the load-bearing isolation decision, stays true
  and needs no amendment.
- **The ORM's first-run disclosure wording changes** from "Prisma Next
  collects anonymous CLI usage data" to "Prisma collects anonymous CLI usage
  data", because the engine composes one disclosure for one product. Same
  channel, same timing, same opt-out instructions.

## 5. Testing

- **Gating precedence**, every combination of CI, both environment opt-outs
  (including the falsy spellings `''`, `'0'`, `'false'`, which must not
  disable), and stored `true` / `false` / absent — asserted on both the
  decision and its reason.
- **Disclosure** fires exactly once, only on an enabled run with no stored
  id, only on stderr; never when disabled, never in CI, never for
  `telemetry *`.
- **The id** is minted once, never rotated across an on → off → on cycle, and
  a default-on mint leaves `enableTelemetry` absent.
- **Timing and exemption**: the seam is called before the handler runs, not
  after; once per run; never for `--help`, `--version`, an unknown command,
  or any `telemetry *` path.
- **No values**: a run with option values, positionals and an option that
  defaults asserts the payload carries the command path and the typed option
  names only.
- **Every failure is invisible**: a throwing spawner, an unwritable config
  directory and a malformed stored config each leave exit code, stdout and
  stderr byte-identical to the same run without telemetry.
- The platform CLI's existing telemetry tests
  (`packages/cli/tests/v8-telemetry*.test.ts`) port onto the new surface and
  keep passing unchanged in intent.

## 6. Coordination

- Lands in `packages/cli-engine` and ships in a published
  `@prisma/cli-engine`; consumers pick it up by version.
- Touches `cli.ts`, `runtime.ts`, `testing.ts`, `execution/engine.ts` — the
  same files as the package-manager capability (PR #140) and the redirect
  table (PR #142). Sequence with the operator.
- **The ORM port depends on this for its cutover.** Until it publishes, the
  ORM's new bin reports nothing and the commander CLI keeps reporting as it
  always has — no user-visible gap, because the commander CLI owns the binary
  until then.

## 7. Acceptance

- [ ] `createCli({ telemetry: { docsUrl } })` is the only wiring a consumer
      writes; no consumer re-implements gating, disclosure, id minting, or
      firing.
- [ ] The event fires at command start, from the parse-time snapshot, before
      the handler runs.
- [ ] Gating precedence, disclosure timing and id lifetime match the shipped
      ORM behaviour exactly.
- [ ] The engine mounts `telemetry status|enable|disable`; a `telemetry *`
      run reports nothing and mints nothing.
- [ ] The payload carries no value from argv; positionals never appear.
- [ ] Every telemetry failure is invisible to the run.
- [ ] `createTestCli` seeds the spawner and `isCI`; no test reaches a real
      endpoint.
- [ ] The shell's `reporting.ts`, `is-ci.ts` and three telemetry commands are
      deleted, and its telemetry tests pass against the engine surface.
- [ ] Wire shape, endpoint, config path and installation ids are unchanged
      for existing users.

## 8. Follow-ups

Two questions were raised during review and ruled by the operator rather than
left open:

- **A non-boolean `enableTelemetry` leaves telemetry on.** `readUserConfig`
  casts parsed JSON without validating field types, so a hand-edited
  `"enableTelemetry": "false"` — the string — matches neither the `false` nor
  the `true` branch and lands on the opt-out default. **Ruled: leave it**
  (operator, 2026-08-11). It is the ORM's behaviour exactly, it takes a
  malformed hand-edit to reach, and the three other opt-out routes — the
  `telemetry disable` command and both environment variables — cannot be
  mistyped into the wrong answer.
- **The first-run notice named `prisma-v8`.** The engine composes it from
  `createCli`'s `name`, which the shell hardcoded, while every other
  user-facing string in the same shell used the `CLI_NAME` constant.
  **Ruled: pass the constant** (operator, 2026-08-11). Fixed; the shell no
  longer contradicts itself between its help output and its next actions.

- **`CliRunHooks.onSettled` has no consumer left.** It was introduced for
  telemetry. Kept as-is here — removing published engine surface is its own
  decision — and recorded so the next person to touch `cli.ts` can weigh it.
- **prisma/prisma's `docs/Telemetry.md` documents the old names.** The page
  describes the `prisma-next` binary as shipped, which still reads
  `prisma-next/config.json` and `PRISMA_NEXT_DISABLE_TELEMETRY`, so it is
  correct today and would be wrong if updated now. It changes when that binary
  ports onto the engine. The hand-editing half of the ruling did not have to
  wait and is already in flight as prisma/prisma#29976.
- **The engine has two different answers to "am I in CI".** Interactivity
  is decided by `runtime.isTty.stdin && runtime.env.CI === undefined`
  (`src/execution/shared-flags.ts`), overridable with `--no-interactive`;
  telemetry gates on `Runtime.isCI`, which the bin fills from `ci-info`. They
  disagree on `CI=false`, and on a vendor that sets its own marker but not
  `CI` — and `--no-interactive` moves one and not the other. Nothing is wrong
  today, because each is used only where it was meant to be, and `ctx.isCI`'s
  documentation now says so explicitly. Reconciling them is its own change:
  it decides whether `--no-interactive` should also suppress telemetry, which
  is a product question, not a cleanup.
- **`Runtime.isCI` is a required field on a published interface.** Every host
  that constructs a `Runtime` must add it. Correct — a host that forgot an
  optional one would silently report from CI — but it needs a release note at
  `8.0.0-rc.1`.
- **A CLI that declares telemetry without mounting the commands prints an
  opt-out instruction naming a command it does not have.** §2.1 lets the two
  halves mount independently on purpose, and the notice always names the
  environment variables and the config file as well, so a working opt-out
  survives — but the friendliest one it offers would not run. No consumer is
  in that state today: the platform shell mounts both.
- **An unwritable config directory makes `telemetry enable|disable` fail as
  `CLI.INTERNAL_ERROR`.** Identical to the platform shell's current behaviour
  and better than the ORM's, so §1.1 rule 1 says leave it here. But a consent
  surface deserves a phrased error naming the file it could not write, not the
  engine's generic one — "my opt-out did not take" is the worst failure this
  surface has.
