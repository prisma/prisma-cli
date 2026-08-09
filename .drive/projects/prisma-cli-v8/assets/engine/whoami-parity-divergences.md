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

v8 (signed out):

```
ℹ Showing the current authenticated identity.
status: signed out
→ Sign in: prisma-cli auth login
```

- written to STDOUT (the engine's rule: presented result is data →
  stdout; commentary/events → stderr),
- the title survives as a `summary` block (tone `info`, rendered `ℹ …`)
  because the Block vocabulary has no title/descriptor primitive,
- fields render as unpadded `label: value` lines — no rail, no column
  alignment, no per-value color tones,
- the sign-in follow-up renders as a `→` line (see §4).

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

v8: `--quiet` leaves the machine-consumable data lines, one `label:
value` line per field (`status: signed out`, or the signed-in
status/user/provider/workspace rows). The engine contract says quiet
mode leaves the stdout payload; the port supplies one, so quiet output
is now non-empty by design.

## 6. Empty `PRISMA_SERVICE_TOKEN` (the errored path)

Current CLI: `AUTH_CONFIG_INVALID` (flat code + `domain: "auth"`), JSON
envelope written to stdout even in error, EXIT 1.

v8: structured error `AUTH.CONFIG_INVALID` (dotted namespace form, no
domain field), settled as ERRORED per the v8 protocol → EXIT 2. Same
summary ("Authentication configuration is invalid"), same why/fix text.
Human rendering differs: engine layout
`✖ [AUTH.CONFIG_INVALID] … / why: … / fix: …` on stderr, versus the
current CLI's `✖ summary [CODE]` + `Why:`/`Fix:` +
"More: Re-run with --trace" block.

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

1. D3: in human non-quiet mode the engine renders human Blocks only;
   the materialized `stdout` presentation lines are written only under
   `--quiet` (they would duplicate the blocks). The draft honors
   materialization exactly; this rendering-rule reading is unruled.
   (It is what makes §5's quiet behavior observable.)
2. D4: remediation events render as nextActions at settlement in human
   mode (not live in the transcript); json streams them live as frames.
3. Diagnostic severity stays `error|warn|info`; the trim to two awaits
   the ADR 239 amendment (project slice S4).
4. D5: a file-level config diagnostic (unmarked/unreadable
   `prisma.config.ts`) fails EVERY command, including ones with no
   config need — the draft's `LoadedConfig` comment says so and won
   over the 1a foundation design, which says the opposite. Needs an
   operator ruling before S3.
5. D5: diagnostics returned on a SUCCESSFUL `SectionValidation`
   (warnings) are currently dropped; the draft doesn't say where they
   go.

One new D6 finding, same category (not a draft contradiction, but
friction worth an operator look): the draft's lazy-handler pattern
(`handler: () => import("./whoami.handler")` with the handler annotated
`CommandHandler<typeof def>`) is circular for TypeScript inference — tsc
rejects it (TS7022/TS2502) unless the definition const carries an
explicit type annotation. The port breaks the cycle by annotating
`authWhoamiCommand: CommandDefinition` (exact here, since whoami has no
flags/positionals/config/exit codes). Commands WITH inferred surfaces
will need explicit `CommandDefinition<…>` generics or a different
pattern; the draft's comment promises the annotation round trip works
without mentioning this.
