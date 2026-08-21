# S3 parity divergences — the composer family

Every known place where the composer family as it now ships differs
from the `prisma-composer` CLI it replaces. Same entry format as
`parity-divergences.md`, and the same standing ruling behind it (S2
ruling 10: divergences are enumerated, not discovered).

**The baseline here is not `prisma-cli`.** The other files in this
directory compare a ported command against the shipping platform CLI.
Composer's four commands have no platform predecessor: what changes is
what a `prisma-composer` user sees, so every entry below is written
against composer's own CLI as inventoried in
[`../s3/composer-inventory.md`](../s3/composer-inventory.md).

Two engine-global records apply wholesale and are not repeated per
command: the S1 whoami-scoped record
([`../engine/whoami-parity-divergences.md`](../engine/whoami-parity-divergences.md))
for json framing, format auto-selection, channel discipline, rendering
style and the shared flag family; and this directory's `parity-divergences.md`
preamble. Composer's users have seen none of it before, so the engine's
shared flags (`--format`, `--log-level`, `--verbose`, `--quiet`, `--yes`,
`--confirm`, `--interactive`, `--color`, `--config`) are all new on these
four commands, and so is the fact that human output is chosen only when
stdout is a TTY.

## The invocation

`prisma-composer <command>` becomes `prisma composer <command>`: the
family mounts under a `composer` root in the prisma bin (S2 standing
ruling 1; TML-3189 holds the final grammar). Composer's own thin CLI
survives and keeps the unprefixed spellings, so both invocations exist
and run the same handlers in the same way — the prefix is the whole
difference.

**Help examples name the wrong invocation under the prisma bin.**
Composer writes its examples as `{bin} deploy src/service.ts`, which is
right for `prisma-composer` and wrong for `prisma`, where the command is
`prisma composer deploy`. The engine's `resolveExample`
(`packages/cli-engine/src/execution/stricli-adapter.ts`) substitutes
`{bin}` with the CLI name and nothing else (operator ruling, 2026-08-09:
examples never contain the binary name), and composer cannot know where
a host mounted it. So `prisma composer deploy --help` currently shows
`prisma deploy src/service.ts` in its Examples block — an invocation the
bin answers to with `CLI.UNKNOWN_COMMAND`, since there is no top-level
`deploy`. All eight examples are wrong the same way: two on each of the
four commands, verified in `@prisma/composer@0.6.0-dev.16`'s
`dist/family.mjs`. Nothing else in the help is wrong, and the same
defect is unreachable from composer's own CLI. Fixing it needs a
mount-aware placeholder in the engine (`{command}` substituted with the
command's mounted path) and composer rewriting those eight strings to
use it — a coordinated change across both repos, recorded in
`deferred.md`.

## `deploy --production` is dropped

Legacy declared `--production` on the shared abstract command class, so
clipanion listed it in `deploy --help`, and passing it always failed
with `DEPLOY.FLAG_INVALID` (exit 2) — the flag was accepted by the
parser and rejected by the command (inventory D1). The v8 `deploy`
declares only the flags it honours, so `--production` is gone from its
help and `prisma composer deploy --production <entry>` settles
`CLI.INVALID_ARGUMENTS` ("No flag registered for --production"), exit 2.

The exit code does not move; the error code and message do, and the
help no longer advertises a flag that cannot work. `destroy` keeps
`--production`, where it is genuinely valid.

## The reproduce hint is a next action, and the failure envelope is gone

When the alchemy child failed, legacy printed the `DEPLOY.ENGINE_FAILED`
envelope and then two bare `console.error` lines to stderr
(`render-error.ts:27-37`):

```text
Generated stack file: <path>
Run `<alchemy command>` from <cwd> to reproduce this directly.
```

The v8 handler settles through `exitWithChildStatus({ nextActions })`
instead. Three things change for the user:

- **The hint is a typed `run-command` next action**, rendered in the
  engine's next-action style: label "Run the converge directly from
  `<cwd>` to reproduce this", the command as its `command`, and
  "Generated stack file: `<path>`" as its `reason`. Same three facts,
  now machine-readable.
- **No failure envelope is printed.** The child owned the terminal and
  already said what went wrong; the run exits with the child's status
  verbatim and prints only the next action. `DEPLOY.ENGINE_FAILED` is
  therefore no longer a code a user sees on this path — it survives
  only for a failure that never reached a child.
- **The hint is dropped when a signal killed the child.** The user
  pressed Ctrl-C: there is nothing to reproduce, so the run settles
  128 + the signal number with no envelope and no actions, whatever the
  handler asked for. Legacy collapsed a signalled child's status
  (`run-alchemy.ts:61`) and printed the hint anyway.

## `deploy`, `destroy`, `dev`, and `log` support structured output

Amended 2026-08-14: `maySpawn` no longer disables JSON. In human mode the
child still inherits the terminal. In JSON mode its stdout and stderr are
routed to diagnostic stderr while the engine retains framed NDJSON stdout and
emits the command family's terminal result. A failed child keeps its verbatim
process exit code and emits `CLI.CHILD_PROCESS_FAILED` with the child status in
`error.meta`.

This also restores normal format auto-selection: a piped
`prisma composer deploy <entry>` produces structured output, including
Composer's deployment summary, without requiring an explicit flag.

## Usage, parse errors and bare invocation

- **A parse failure now says what was wrong.** Any clipanion parse error
  — unknown flag, missing `<entry>`, a dangling `--name` — was replaced
  by the full detailed usage text with the reason discarded (inventory
  D6). The engine reports the specific failure: `CLI.INVALID_ARGUMENTS`
  naming the flag and the value it could not read, or
  `CLI.UNKNOWN_COMMAND` with a suggestion (`prisma composer nope` →
  "No command registered for `nope`, did you mean `log`?"). Both exit 2,
  as the usage wall did.
- **A bare group invocation exits 0, not 2.** `prisma-composer` with no
  arguments printed usage to stderr and exited **2** (inventory D7).
  `prisma composer` prints the group's usage and exits **0**. A script
  that used the exit code to tell "no arguments" from "ran successfully"
  can no longer.
- **Help output shape.** The engine's `USAGE` / `FLAGS` / `ARGUMENTS`
  blocks replace clipanion's, every command gains the shared flag family
  in its usage line, and the group gains a `COMMANDS` list. `--help`
  still exits 0. Which stream it lands on is now the engine's global
  format rule rather than a constant: human format writes help to
  stdout, json format to stderr, and format is auto-selected from
  whether stdout is a TTY — so a piped `--help` writes to stderr, where
  legacy always wrote to stdout.

## `--tail` becomes a typed number flag, and its validation widens

Legacy took `--tail` as a string and ran `Number.parseInt(value, 10)`
over it, so `--tail 5abc` silently became `5` (inventory D5), and a
hand-written check rejected `NaN` and negatives with a `UsageError`
("`--tail` must be a non-negative integer."), exit 2.

The v8 `log` declares `flag.number`, which changes the answer in both
directions:

| input | legacy | v8 |
| --- | --- | --- |
| `--tail 5abc` | silently `5` | `CLI.INVALID_ARGUMENTS`, exit 2, naming the value |
| `--tail abc` | usage error, exit 2 | `CLI.INVALID_ARGUMENTS`, exit 2 |
| `--tail 1.5` | silently `1` | **accepted** as `1.5` |
| `--tail -1` | usage error, exit 2 | **accepted** as `-1` |

The first two rows are the fix the port was for. The last two are a
real widening: the engine's number flag validates only that the value is
a number, so "non-negative integer" is enforced nowhere, and a negative
or fractional tail reaches the attachment's `logs(signal, { tail })` for
it to interpret. Recorded here rather than silently narrowed, per the
deferred item this closes. One correction to that item while closing it:
it said legacy rejected negatives *and* non-integers, and legacy
rejected only negatives — `parseInt` truncated `1.5` to `1` and the
check saw nothing wrong. If the constraint is wanted back it belongs on
the flag (a validated number flag in the engine), not in the handler.

## `[dev]` and `[log]` prefixes become engine events

Legacy wrote its own notices with a literal source prefix: `[dev]
converge failed — …`, `[dev] stopped.`, `[log] stream failed: …`,
`[log] falling behind — dropped the N oldest lines.` — all
`console.error` straight to stderr, unconditionally.

Those become engine events (`message` at warn/error, `status`,
`endpoint`), which means they are rendered by the engine, filtered by
`--log-level`, hidden by `--quiet`, and framed in json for `log`. The
`[dev]` / `[log]` prefixes are gone: the engine's own rendering
identifies what it is showing.

What does **not** change: a log line still reads `[<service>] <line>`
and still goes to stdout, because the service prefix is part of the line
the handler emits rather than a rendering decision. And the empty case
still exits 0 — no running services is a warn event and a clean
shutdown, as legacy's single stderr line and exit 0 were.

## `CONFIG.PATH_MISMATCH` retires for the explicit-path case only

Legacy loaded the config through c12 and then compared the file c12
reported against the file its own discovery walk had found; a mismatch
failed with `CONFIG.PATH_MISMATCH` — "Refusing to deploy against a
different file." (`load-config.ts:156-169`).

With the engine's `composer` section in `prisma.config.ts`, an explicit
`configPath` wins and the walk is skipped, so there is no second opinion
to disagree with and the check cannot fire. In its place a path that
does not exist is `CONFIG.FILE_MISSING`, naming the section's path and
saying why there is no fallback ("An explicit configPath is used as
given — there is no walk to fall back on").

The common case is unchanged: with no `composer` section, composer's
entry-anchored walk runs exactly as before and `CONFIG.PATH_MISMATCH`
survives with it. The code is retired for one branch, not deleted.

## `dev` settles 130 on Ctrl-C, where legacy exited 0

Legacy's watch loop treated Ctrl-C as a clean shutdown and returned 0
(`run-dev.ts:132`), so `prisma-composer dev` ended a successful session
and an interrupted one identically. The handler still cleans up and
still returns success; the ENGINE now settles the run at 128 + the
signal number from its own record of the signal — 130 for SIGINT, 143
for SIGTERM — because a run a delivered signal ended is an abort
whatever the handler concluded (operator ruling, 2026-08-11).

This is the divergence most likely to be noticed: a wrapper script,
Makefile or supervisor that runs `dev` in the foreground and treats a
non-zero exit as failure now reports failure every time a developer
stops the session. `dev` itself documents no exit code of its own, and
a converge failure before the session is live still exits with the
child's status.

`log` is unaffected in principle but changes the same way in practice:
it also returned 0 on Ctrl-C and now settles 130 through the same rule.

## Exit-code unifications on the engine-side error paths

Legacy's top-level mapping was: a number returned by `run()` passes
through; a clipanion `UsageError` prints its raw message to stderr and
exits 2; a `CliStructuredError` renders its envelope and exits 2;
anything else prints `Error: …` plus "this is a bug, please report it"
naming composer's issue tracker, and exits 1.

What the engine does with each:

| legacy path | legacy | v8 |
| --- | --- | --- |
| structured composer error | rendered envelope, exit 2 | engine envelope, exit 2 — the code and `meta` survive, and the `fix` prose becomes one `user-choice` next action (untranslated it would be dropped silently: the engine has no `fix` field) |
| clipanion `UsageError` | raw message, exit 2 | `CLI.INVALID_ARGUMENTS` / `CLI.UNKNOWN_COMMAND`, exit 2 |
| unexpected throw | `Error: …` + report-a-bug line naming composer's issues, exit 1 | engine `CLI.INTERNAL_ERROR`, exit 1 — same code, engine envelope, and no composer issue URL |
| alchemy child failed | child's status verbatim, plus an envelope and two hint lines | child's status verbatim, no envelope, hint as a next action (above) |
| alchemy child signalled | collapsed status | 128 + signal, no envelope, no hint (above) |

Three refusals are new, and all three move work earlier in the run:

- **Unauthenticated `deploy` / `destroy` fail before anything happens.**
  They declare `needs.credentials`, so a signed-out run settles
  `CLI.CREDENTIALS_REQUIRED` (exit 2) before the config is read, let
  alone before a container is ensured. Legacy never checked: the
  credential env vars were read by provider code inside the alchemy
  child, so an unauthenticated deploy failed deep in the child, after
  the platform work the parent had already done.
- **A session close to expiry is refused up front.** `deploy` and
  `destroy` refuse before the in-process leg when the credential expires
  within the threshold, rather than creating platform resources and
  then failing. New; legacy had no expiry concept.
- **The effect-resolution preflight no longer takes out every command.**
  Legacy ran `checkEffectResolution` at import time in `bin.ts`, before
  anything else, and exited 2 on a mismatched `effect` — including for
  `--help`. It now runs inside config loading and surfaces as the
  `DEPS.EFFECT_VERSION_CONFLICT` diagnostic, so commands that need no
  config still work on a broken dependency tree, and `prisma --help`,
  `prisma composer --help` and every platform command are unaffected by
  composer's dependency resolution. Where it moved to, in the published
  `0.6.0-dev.16`: `configSource`, the front that the throwing loader and
  the diagnostics-returning loader both go through, so every config load
  runs it first whichever shape called. (That the diagnostics-returning
  loader itself is still uncalled — the `deferred.md` item — does not
  reach this check.) A failed executor import diagnoses the same
  condition a second time, turning the load failure into
  `DEPS.EFFECT_VERSION_CONFLICT` rather than `DEPS.EXECUTOR_UNLOADABLE`.

## Not a divergence, recorded because it looks like one

`destroy` still asks nothing before tearing down. The front door cannot
know what the child will destroy, so no engine-side confirmation was
added; the guard remains the required explicit `--stage` /
`--production` target, exactly as legacy. If destroy deserves a
confirmation it is a composer product decision, raised upstream rather
than built at the mount.

## Command grammar cleanup (2026-08-21 PM review)

The `composer` group is dissolved: `composer deploy` and `composer
dev` mount at the root as `deploy` and `dev`, and `composer destroy`
and `composer log` are dropped from the mounted tree entirely. The
sections above describe the family as S3 mounted it.
