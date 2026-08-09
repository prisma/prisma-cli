# `prisma-v8 auth whoami` — parity divergences from `prisma-cli auth whoami`

Written for D6 of slice s1-engine-vertical (2026-08-09). Every known place
where the v8 port's output or behavior differs from the shipped
`prisma-cli auth whoami`, and why. The v8 side is pinned by
`packages/cli/tests/v8-whoami.test.ts`; the current-CLI side by
`packages/cli/tests/auth.test.ts`.

## 1. JSON envelope shape and framing

Current CLI writes ONE pretty-printed (2-space-indented) JSON object to
stdout:

```json
{ "ok": true, "command": "auth.whoami", "result": { … },
  "warnings": [], "nextSteps": [], "nextActions": [] }
```

v8 writes a stream of single-line StreamEvent frames, terminated by
exactly one `result` frame wrapping the envelope:

```json
{"kind":"result","envelope":{"ok":true,"commandId":"auth.whoami","result":{…},"exitCode":0,"diagnostics":[],"nextActions":[…]},"commandId":"auth.whoami","timestamp":"…"}
```

Field-level differences inside the envelope:

- `command` → `commandId` (same dotted value, `auth.whoami`).
- `warnings: string[]` is gone; findings are typed `diagnostics`.
- `nextSteps: string[]` (bare command strings) is gone; follow-ups are
  typed `nextActions` only (see §4).
- `exitCode` is now carried in the envelope; the current CLI never
  reports it in JSON.
- Every frame carries `commandId` + ISO `timestamp` stream metadata.

The `result` payload itself is byte-identical in shape: the raw
`AuthStateResult` (`authenticated`, `provider`, `user`, `workspace`,
`credential`), unchanged.

## 2. Format auto-selection

Current CLI is human unless `--json` is passed, regardless of where
stdout goes. v8 auto-selects json when stdout is not a TTY (draft
header: human on a TTY stdout, json otherwise). Piping
`prisma-v8 auth whoami` therefore produces the json stream where the
current CLI would produce the human card on stderr.

## 3. Human output: channel and rendering

Current CLI (signed out):

```
auth whoami → Showing the current authenticated identity.

│  status:  signed out
```

- written to STDERR (stdout stays empty),
- title line `auth whoami → …` with the command path label,
- rail (`│`) card with column-aligned, color-toned values
  (`signed in` green, `signed out` dim).

v8 (signed out), stderr:

```
ℹ Showing the current authenticated identity.
status: signed out
→ Sign in: prisma-cli auth login
```

v8 (signed out), stdout:

```
status: signed out
```

- the CHANNELS match the current CLI (operator ruling, 2026-08-09):
  human Blocks, next-action lines, and diagnostics are presentation
  prose on STDERR, exactly where the current CLI writes its card. The
  divergence shrinks to rendering STYLE:
  - the title survives as a `summary` block (tone `info`, rendered
    `ℹ …`) because the Block vocabulary has no title/descriptor
    primitive,
  - fields render as unpadded `label: value` lines — no rail, no
    column alignment, no per-value color tones,
  - the sign-in follow-up renders as a `→` line (see §4).
- one addition beyond the current CLI: the handler's
  `Presentations.stdout` payload lines (`label: value` rows) are
  written to STDOUT, always — the machine-usable payload of a pipe.
  The current CLI's whoami writes nothing to stdout in human mode.

Signed-in rows are otherwise identical in order and values: `status:
signed in`, `user: <email or token placeholder>`, `provider:
GitHub|Google` (only when the state carries a provider — real-mode state
never does today, so the row appears only against fixture-shaped data),
`workspace: <name>`.

## 4. Next-step suggestion when signed out

Current CLI: `nextSteps: ["prisma-cli auth login"]` in JSON only;
human mode shows nothing extra on success.

v8: a typed NextAction `{kind: "run-command", label: "Sign in",
command: "prisma-cli auth login"}` in the envelope's `nextActions`, and
the human renderer prints it (`→ Sign in: prisma-cli auth login`) — so
human mode now surfaces the suggestion too. The suggested command
remains `prisma-cli auth login` (the v8 bin mounts no login command;
signing in still happens through the shipped CLI in S1).

## 5. `--quiet`

Current CLI: whoami has no stdout presenter, so `--quiet` prints
nothing at all.

v8: `--quiet` is a log-level alias — shorthand for `--log-level error`
(operator ruling, 2026-08-09) — and nothing more. It silences
commentary on stderr; whoami's presentation (the stderr card and the
stdout payload lines) is unchanged by it, and since whoami emits no
commentary, a `--quiet` run's output is identical to a plain run.

## 6. Empty `PRISMA_SERVICE_TOKEN` (the errored path)

Current CLI: `AUTH_CONFIG_INVALID` (flat code + `domain: "auth"`), JSON
envelope written to stdout even in error, EXIT 1.

v8: structured error `AUTH.CONFIG_INVALID` (dotted namespace form, no
domain field), settled as ERRORED per the v8 protocol → EXIT 2. Same
summary ("Authentication configuration is invalid"), same why text; the
fix prose is now a typed `nextActions` entry (operator ruling,
2026-08-09: `fix` renamed to `nextActions`). Human rendering differs:
engine layout `✖ [AUTH.CONFIG_INVALID] … / why: … / → <next action>`
on stderr, versus the current CLI's `✖ summary [CODE]` +
`Why:`/`Fix:` + "More: Re-run with --trace" block.

## 7. Exit-code semantics generally

Both exit 0 for signed-in AND signed-out whoami (parity kept: whoami
reports auth state; it does not fail when unauthenticated — accordingly
the v8 whoami declares NO `needs.credentials`). Beyond that: v8 reserves
1 for bugs only (an unexpected operations throw is
`CLI.INTERNAL_ERROR`, exit 1), 2 for expected structured errors, 3/130/
143 for aborts/signals. The current CLI's exit codes are per-error
(`CliError.exitCode`), e.g. exit 1 for the service-token case above.

## 8. The `needs.credentials` early failure is proven elsewhere

Because whoami itself must complete when signed out, the engine's
credentials precondition (early failure with
`CLI.CREDENTIALS_REQUIRED`, exit 2, before the handler loads) is
byte-asserted in the slice e2e through a tiny in-test command mounted
only in the harness (`auth locked` in v8-whoami.test.ts), not in the
shipped bin tree.

## 9. Global flag family

The v8 bin exposes the engine's shared family (`--format/--json`,
`--log-level/-v/--verbose`, `-q/--quiet`, `-y/--yes`,
`--interactive/--no-interactive`, `--color/--no-color`, `-h/--help`).
The current CLI's `--trace` does not exist in v8 (bugs settle as
`CLI.INTERNAL_ERROR`; no stack-trace flag), and the current CLI has no
`--format`, `--log-level`, `--yes`, or `--interactive`.

## 10. Mock-fixture mode is not ported

`prisma-cli auth whoami` supports the fixture mode
(`PRISMA_CLI_MOCK_FIXTURE_PATH` / `--fixture`) via the shell runtime.
The v8 whoami handler calls only the real-mode operations layer
(`readAuthState`); fixture mode is shell infrastructure and out of the
slice's scope. The harness e2e instead stubs the operations layer.

## 11. Operations residue pending S2 extraction

The v8 handler reads `process.env` directly to call
`readAuthState(process.env, ctx.signal)` — the engine context
deliberately carries no `env`, and the auth operations still live in
`packages/cli/src/lib/auth/`. The same applies to the bin's
`getCredentials` (service token env var, else the stored access token
via `FileTokenStorage`). Both are explicitly "in place" per the slice
contract; the S2 auth-library extraction is where this residue resolves.

## 12. Update notification / agent tips

The current CLI shell may prepend a cached update notification to any
command's output, and login (not whoami) appends agent-setup tips. The
v8 bin has none of that shell behavior.

---

## Open interpretation items carried from the slice (operator review)

Recorded during D3–D5 and re-listed here per the handover instruction;
none were resolved unilaterally.

1. RULED (2026-08-09, Option A channel discipline): human Blocks are
   presentation prose on stderr; the `Presentations.stdout` payload
   lines are the machine-usable payload and are always written to
   stdout in human mode — that is what the surface is for. Human mode
   is pipe-clean; json mode unchanged (frame stream on stdout).
2. RULED (2026-08-09): the engine never aggregates remediation events
   into any envelope. The event kind stays in the vocabulary as
   transcript-only — json streams it live as a frame; human mode never
   renders it. Follow-ups are handler-owned: completed via
   `presentations.next`, errored via the error's own typed
   `nextActions` (the renamed `fix`), which the envelope copies.
3. Diagnostic severity stays `error|warn|info`; the trim to two awaits
   the ADR 239 amendment (project slice S4).
4. RULED (2026-08-09): a file-level config diagnostic fails only
   commands with a `needs.config` section; every other command runs
   normally, and a missing file was never a diagnostic at all.
5. RULED (2026-08-09): diagnostics on a SUCCESSFUL `SectionValidation`
   are written to stderr as warning commentary (log-level filtered,
   both formats), never into the stream or the envelope.

The D6 finding about the lazy-handler pattern's circular type inference
is resolved by an operator ruling (2026-08-09): handlers are never
dynamically imported. `handler` is the handler function itself, so the
inference cycle no longer exists; the whoami handler now lives inline in
`packages/cli/src/v8/auth/whoami.ts`.
