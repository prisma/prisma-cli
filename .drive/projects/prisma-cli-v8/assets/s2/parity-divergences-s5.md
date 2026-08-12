# S5 parity divergences — the ORM port

Every known place where a command ported onto `@prisma/cli-engine` differs
from the commander `prisma-next` it replaces, enumerated per command for
operator review. §7 of [`../../specs/s5-orm.md`](../../specs/s5-orm.md) lists
what this file must contain.

The global divergences §7 names — `--format pretty` → `--format human`,
`--trace` removed, per-command `--config` removed, off-TTY json
auto-selection now specified, `--quiet` as a log-level alias, interactivity
derived from stdin rather than stdout, human prose and drawings off stdout,
tone-based colour and engine-sized tables, SIGTERM at 143, errored
settlements all at exit 2, engine-owned help and did-you-mean text, typed
`nextActions` replacing `fix`, and whole-`orm`-section config blocking —
apply to every ported command and are not repeated per command below.

One qualifier on that list, and two more global divergences §7 did not name,
recorded here rather than in every section below:

- **"Human prose and drawings off stdout" has four exceptions.**
  `migration list`, `migration graph`, `migration log` and `migration show`
  supply their rendering — the tree, the DOT text, the ledger table, the
  package listing — as the `stdout` payload. The first three wrote it there
  under the commander too; `migration show` wrote it to stderr and moves the
  other way. What changed for all four is that the payload is never coloured,
  because the machine channel carries no escape sequences. `contract emit`
  writes its two emitted file paths there. Every other ported command writes
  nothing to stdout in human mode.

- **A handler cannot see which config file the engine loaded.**
  `CommandContext` carries the validated `orm` section but not the
  `LoadedConfig.path` behind it, and `--config` is an engine flag the handler
  never sees. So every header card loses its `config:` row, `contract infer`'s
  and `db schema`'s `--json` documents lose `meta.configPath`, `db sign`
  reports the fixed spelling `prisma-next.config.ts` in its own
  `meta.configPath`, and error prose that named the loaded file now names that
  same default. Recorded in the findings with two possible engine-side fixes;
  each section below names only the artifact that command loses.
- **Header cards lose their "Read more" docs link, and are rendered at
  settlement rather than before the work starts.** The engine's `fields` block
  has no row for a URL; the link is not lost from failures, because the engine
  derives a docs URL for every error and diagnostic from the family's
  `docsBaseUrl` plus the dotted code. The timing change is visible on a failing
  run: an errored settlement presents nothing, so a command that fails prints
  no header at all, where the commander printed one and then failed.

Each round appends its own command section.

## `init`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next init` |
| Applied rules | R-S5-1, R-S5-2, R-S5-6, R-S5-7, R-S5-8, R-S5-9, R-S5-10, R-S5-11, R-S5-12, R-S5-13, R-S5-14, R-S5-15, R-S5-20, R-S5-21, R-S5-25, R-S5-31, R-S5-32, §6 (the package-manager capability), STOP-2 |
| Engine version | 0.0.9 — the first version carrying the package-manager capability |

### Flags

| Commander | Engine command | Note |
| --- | --- | --- |
| `--target <db>` | `--target <db>` | unchanged; `flag.string` with handler validation, so `postgresql`/`mongodb`/`ts` and every capitalization still resolve |
| `--authoring <style>` | `--authoring <style>` | unchanged, same reason |
| `--schema-path <path>` | `--schema-path <path>` | unchanged |
| `--write-env` | `--write-env` | unchanged |
| `--probe-db` | `--probe-db` | unchanged |
| `--strict-probe` | `--strict-probe` | unchanged |
| `--no-install` | `--skip-install` | renamed per R-S5-6 (the engine's booleans have no negated form) |
| `--no-skill` | `--skip-skills` | renamed per R-S5-6 |
| `--force` | **no successor** | R-S5-14: re-scaffolding consent is `prompt.consent` with the working directory's name as its token, granted non-interactively by `--confirm <name>` |
| — | `--keep-previous-facade` | **new**. The Style Guide requires a flag for every prompt, and the facade-removal confirm had none — `--force` answered it before. Passing it keeps the previous target's package and skips the prompt |

`--config` is gone as a command flag and arrives from the engine's shared
family (R-S5-4). Its help text says `./prisma.config.ts`, which is not the
file this bin reads — an engine-side wording defect already recorded.

### Prompts

Six today, six after. Each keeps a flag that answers it.

| # | Question | Engine surface | Flag equivalent | `--yes` |
| --- | --- | --- | --- | --- |
| 1 | re-scaffold over an existing project | `prompt.consent`, token = `basename(cwd)` | `--confirm <name>` | refuses — consent is undefaultable |
| 2 | which database | `prompt.select` (no default) | `--target` | cannot answer it |
| 3 | how to author the schema | `prompt.select` (no default) | `--authoring` | cannot answer it |
| 4 | where the schema file goes | `prompt.text`, default per authoring | `--schema-path` | takes the default |
| 5 | also write `.env` | `prompt.confirm`, default false | `--write-env` | takes the default (false) |
| 6 | drop the previous target's package | `prompt.confirm`, default true | `--keep-previous-facade` | takes the default (remove) |

Divergences inside the matrix:

- **`--yes` now answers the schema-path prompt.** The commander asked for the
  schema path in every interactive run, `--yes` included; `-y` means "accept
  declared prompt defaults", so the engine command takes the default.
- **`CLI.INIT_MISSING_FLAGS` keeps its code, its `meta.missingFlags` list and
  its exit 2, but its `why` prose changed.** The commander could say whether
  stdin was a pipe or `--no-interactive` was passed; a handler cannot see the
  session's interactivity, so the wording is now "This session cannot prompt,
  so the answers have to arrive as flags." The code is raised by translating
  the engine's `CLI.PROMPT_REQUIRED` at the two prompts that stand in for a
  required flag.
- **A cancelled prompt is `CLI.PROMPT_CANCELLED` at exit 3**, not
  `CLI.INIT_USER_ABORTED`. `CLI.INIT_USER_ABORTED` has no raise site left in
  the engine command: a token consent resolves to `true` or throws, so there
  is no "declined" value for the handler to convert. The code survives for the
  commander shell.
- **`CLI.INIT_REINIT_NEEDS_FORCE` has no raise site in the engine command
  either.** A non-interactive re-scaffold without `--confirm` settles as the
  engine's `CLI.CONSENT_REQUIRED` at exit 2, which names the exact token to
  pass. R-S5-13 keeps the code's spelling and its error-reference entry is
  rewritten for consent; the commander still raises it.
- **A mistyped consent token is `CLI.PROMPT_INVALID` at exit 2** where the
  commander treated any non-`true` answer as `CLI.INIT_USER_ABORTED` at
  exit 3.

### Package installs

All four invocation sites go through `ctx.packages` (§6): the runtime
dependency install, the development dependency install, the npm retry, and the
three agent-skill runs. The handler spawns nothing and spells no
package-manager command line.

- **The install command line is now the engine's.** It composes
  `npm add …` / `pnpm add …` / `deno add npm:…`, announces it as a step, and
  streams the manager's output as `output` events. The commander printed a
  clack spinner and a summary line.
- **The pnpm→npm fallback survives, caller-side.** `init` inspects the
  returned failure's `meta.manager` and `meta.stderrTail`, matches the same
  predicate as before, and retries the pair with an explicit `npm` override.
  The engine learns nothing about pnpm's error strings.
- **`--skip-install`'s manual instructions changed shape.** The commander
  printed a "Manual steps" note containing the two `add` command lines. The
  engine command names the packages in a typed next action instead, because a
  handler must not phrase a package-manager command.
- **The `nextSteps` strings in the `--json` document no longer carry a
  package-manager prefix.** They said `` `pnpm prisma-next contract emit` ``;
  they now say `` `prisma-next contract emit` ``.

### Settlement and exit codes

| Outcome | Commander | Engine command |
| --- | --- | --- |
| success | 0 | 0 |
| preconditions (`CLI.INIT_MISSING_FLAGS`, `CLI.INIT_INVALID_FLAG_VALUE`, `CLI.INIT_AUTHORING_SCHEMA_PATH_MISMATCH`, `CLI.INIT_STRICT_PROBE_WITHOUT_PROBE`, `CLI.INIT_INVALID_MANIFEST`, `CLI.INIT_INVALID_TSCONFIG`, `CLI.INIT_PROBE_FAILED`) | errored, 2 | errored, 2 |
| cancel | `CLI.INIT_USER_ABORTED`, 3 | `CLI.PROMPT_CANCELLED`, 3 |
| non-interactive re-scaffold | `CLI.INIT_REINIT_NEEDS_FORCE`, 2 | `CLI.CONSENT_REQUIRED`, 2 |
| dependency install failed | errored `CLI.INIT_INSTALL_FAILED`, 4 | **completed** with that code as a diagnostic, 4 |
| contract emit failed | errored `CLI.INIT_EMIT_FAILED`, 5 | **completed** with that code as a diagnostic, 5 |
| agent-skill install failed | errored `CLI.INIT_SKILL_INSTALL_FAILED`, 6 | **completed** with that code as a diagnostic, 6 |
| invalid output document | `CLI.INIT_INVALID_OUTPUT_DOCUMENT`, 1 | same code, errored at **2** |

The three numbers 4/5/6 are preserved for scripts, and their meaning is
declared in the command's `exitCodes` map. What changed is the envelope: a
run that fails one of those phases now settles `ok: true` with the failure as
an `error`-severity diagnostic, because the scaffold is on disk and the run
has a result to report. A consumer that branched on the exit code sees no
change; one that branched on the envelope's `ok` field does.

Exit 1 is unreachable from this command, as it is from every ported command:
`defineOrmCommand` converts each failure at the handler boundary, and the
engine maps every errored code except `CLI.PROMPT_CANCELLED` to 2. The
already-recorded tension between R-S5-31 and R-S5-12 covers it; `init` is its
second instance.

### Output

- The `--json` document is carried inside the engine's result frame rather than
  written bare to stdout. On a 4/5/6 run the document is present where the
  commander wrote an error envelope instead — and its `ok` field is still
  `true`, since it now means "the scaffold was written", with the envelope's
  `exitCode` and `diagnostics` carrying the failure.
- **`packagesInstalled.skipped: boolean` becomes
  `packagesInstalled.status: 'installed' | 'skipped' | 'failed'`.** A shape
  change on a published schema (`@internal/cli/init-output`). The boolean could
  not tell a deliberate `--skip-install` from an install that was attempted and
  failed, so a consumer reading the exit-4 document saw `ok: true`,
  `skipped: true` and next steps describing a healthy deferred scaffold — for a
  project that cannot run. `nextSteps` now leads with the install in both
  non-installed states and says which one happened. The commander's document
  gains the field but never carries `failed`: that shell raises instead of
  reporting.
- Human mode drops clack's intro, outro and boxed note. It renders a `fields`
  rail (target, authoring, schema), a `tree` of the files written, removed and
  installed, and a `summary` line, followed by the engine's rendering of the
  typed next actions. Nothing is written to stdout.
- Warnings become `message` events at `warn` and stay in the document's
  `warnings` array. The tsconfig merge line becomes a `message` at `info`.
- The emit step reports `step-started`/`step-finished`; each package-manager
  run does the same, from the engine.

### Behaviour preserved exactly

The precondition-then-write phasing (nothing is written until every file the
scaffold merges with has parsed), the file list and every template's bytes,
the stale-artifact cleanup on re-scaffold, the unconditional removal of retired
skill directories, the `.env` never-overwrite rule, the manifest synthesis for
a bare directory, the `@types/node` skip, the pnpm catalog honour-and-warn
warning, and the probe's opt-in-only contract with `--strict-probe`
escalation. Verified by scaffolding the same project with both binaries in
scratch directories: the emitted trees are byte-identical apart from the
package name each derives from its own directory.

## `lsp`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next lsp` |
| Applied rules | R-S5-1 (the one server command), R-S5-12, R-S5-22 |
| Engine version | 0.0.8 |

The global divergences do not apply here: a server command gets no shared
flags, no presentation, no events and no json mode, because a foreign client
owns the conversation.

### Flags

| Commander | Engine command | Note |
| --- | --- | --- |
| `--stdio` | `--stdio` | still declared, now genuinely accepted and ignored (R-S5-22) — the engine chooses the transport, so there is nothing for the flag to select |
| — | — | `--clientProcessId=<pid>`, which `vscode-languageclient` appends to every server its NodeModule form spawns, is refused by both shells: `CLI.INVALID_ARGUMENTS` at exit 2 here, "unknown option" at exit 1 there. A recorded hole, not a change |

### A fix, not a regression

`prisma-next lsp` without `--stdio` crashes on the commander shell:
`vscode-languageserver/node`'s `createConnection()` scans `process.argv` for a
transport and throws `Connection input stream is not set` when it finds none,
uncaught, with a stack trace — despite the help text calling `--stdio` "the
default and only transport". The engine hands the streams over itself, so the
ported command answers the same exchange with or without the flag. Verified by
driving both built binaries as child processes over real `Content-Length`
framing.

The port also fixes a process-killing crash that the commander shell shares: a
send on a connection the client has already left throws, and a throw escaping a
notification handler is reported by jsonrpc over that same dead connection,
which throws again inside a `.catch()`. The ported server wraps the connection
so no send can do that.

### Settlement and exit codes

| Outcome | Commander | Engine command |
| --- | --- | --- |
| `exit` after `shutdown` | 0, via `process.exit` inside the transport | 0, returned by the handler |
| input ends without `shutdown` | 1, via `process.exit` | 1 |
| `exit` notification | the code the notification implies, via `process.exit` | the same code, returned |
| SIGTERM / SIGINT | not handled — the transport had already taken the process | 143 / 130, translated by the command |
| malformed `Content-Length` | hangs; the reader desynchronises and nothing settles | 1, with the reader's message on stderr |
| unknown launch argument | commander's own "unknown option", exit 1 | `CLI.INVALID_ARGUMENTS`, exit 2 |

Nothing calls `process.exit` any more: the handler returns a code and the bin
sets it. The signal translation is the command's, because the engine settles a
server command's code verbatim on purpose — the tension between that and
R-S5-12 is recorded in the findings and needs one ruling.

### Output

Nothing changes on the wire: the same responses, byte for byte, with
`Content-Length` counted in bytes. Two behaviours around the stream changed.

- **Console output is redirected for the length of the run.** The commander
  path gets `patchConsole` from `vscode-languageserver/node`, which sends
  `console.*` to the client as `window/logMessage`. The injected path installs
  its own redirect to the host's stderr instead, so a stray write from a
  dependency lands somewhere a person can read rather than corrupting the frame
  stream. A client that showed those messages in its output channel now sees
  them in the server's stderr log.
- **Back-pressure is gone.** `OutputStream.write(text): void` returns nothing
  to wait on, so every write reports flushed immediately where the commander
  path waited for the descriptor. A client that stops reading grows the host's
  output queue instead of slowing the server down. Engine-side to fix.

### Behaviour that does not carry over

The parent-process watchdog. `vscode-languageserver/node` polls the client's
process id every three seconds and exits when the editor dies; the injected
transport has no such poll, because the same condition normally arrives as end
of input. Normally, but not always: a wrapper script or supervisor holding the
pipe's write end, or a client dying with the descriptor duplicated, leaves the
server running with a parser and a config watcher and nobody to talk to. The
trade-off is deliberate — implementing the watch would mean reading
`--clientProcessId`, which is refused today, and calling `process.kill` from a
handler that owns no process.

## `migration list`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next migration list` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-7, R-S5-8, R-S5-10, R-S5-13, R-S5-20, R-S5-21, R-S5-31 |
| Ported in | #29970 (`s5-orm-cli-port`), merged |

### Flags

| Commander | Engine command | Note |
| --- | --- | --- |
| `--space <id>` | `--space <id>` | unchanged |
| `--ascii` | `--ascii` | still forces ASCII glyphs; what changed is what happens without it — see Output |
| `--legend` | `--legend` | still renders the key in human mode |

### Settlement and exit codes

Unchanged: 0 on success, 2 for every structured failure. No code was added or
changed.

**`--legend` under `--json` or `--quiet` no longer errors.** The commander
refused both with `MIGRATION.LEGEND_HUMAN_ONLY` at exit 2. Engine 0.0.8
exposes the active format nowhere a handler can read it, so the flag renders a
legend in human mode and is silently ignored otherwise. One recorded finding
covers this command, `migration graph` and `migration status`.

### Output

- **The drawn tree stays on stdout.** This command supplies a `stdout`
  presentation, so the preamble's "human prose and drawings off stdout" does
  not describe it: the header card (`migrations`, plus `space` when narrowed)
  goes to stderr as a `fields` block and the tree itself is the machine
  payload, exactly where the commander wrote it. `migration graph`, `log` and
  `show` do the same.
- **The tree is no longer coloured.** The commander painted lanes, hashes and
  refs whenever stdout was a TTY and `--no-color` was absent. The `stdout`
  presentation is the machine channel, so the port renders it with colour off
  (`useColor: false`, `colorize: false`) and the paint is gone in every mode.
- **Glyph auto-detection is gone.** The commander drew ASCII unless stdout was
  a TTY *and* the locale was UTF-8; the port draws Unicode unless `--ascii` is
  passed. A recorded finding covers this command, `graph`, `log` and `status`:
  the handler cannot do better, because `Ui` carries `width` and nothing else.
- The header path is relative to the invocation directory. #29970 shipped it
  absolute; #29973 corrected it in the same renderer.
- `--json` is the engine's result frame rather than the bare document. The
  document itself is unchanged inside `envelope.result`.

### Behaviour preserved exactly

Sort order, the extension-space head-ref fold, the per-space grouping, the
operation counts, the invariants on each migration row, the refs on
destination contract nodes and the empty-project line.

## `migration graph`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next migration graph` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-7, R-S5-8, R-S5-10, R-S5-17, R-S5-20, R-S5-21, R-S5-31 |
| Ported in | #29973 (`s5-orm-pr2`), merged |

### Flags

| Commander | Engine command | Note |
| --- | --- | --- |
| `--space <id>` | `--space <id>` | unchanged; still ignored under `--dot` |
| `--dot` | `--dot` | still a command-owned boolean — the engine reserves `--format`, so DOT cannot be a format value (R-S5-17) |
| `--ascii` | `--ascii` | unchanged |
| `--legend` | `--legend` | unchanged |

### Settlement and exit codes

Unchanged. `--legend --dot` is still `MIGRATION.LEGEND_HUMAN_ONLY` at exit 2 —
`--dot` is a flag the handler can read, so that refusal survives where the
`--json` and `--quiet` ones could not (see `migration list`).

### Output

- **`--dot` no longer beats format auto-selection.** Piping selects json, and
  the DOT text then rides the result document as a `dot` field, so
  `migration graph --dot | dot -Tsvg` needs `--format human` to keep working.
  That is R-S5-17's ruled precedence, not an accident.
- The tree — or the DOT text under `--dot` — is the `stdout` payload,
  uncoloured, with Unicode glyphs unless `--ascii`: the same three changes
  recorded under `migration list`.

### Behaviour preserved exactly

Node id truncation to 12 characters, the DOT rendering itself, and the summary
line's counts.

## `migration show`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next migration show` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-7, R-S5-8, R-S5-10, R-S5-20, R-S5-21, R-S5-31 |
| Ported in | #29973 (`s5-orm-pr2`), merged |

### Flags

`<target>` stays a required positional. `--config` is gone (R-S5-4). Neither
shell declares anything else.

### Settlement and exit codes

Unchanged.

### Output

- **The package rendering moved from stderr to stdout.** The commander printed
  it through `ui.log`, which writes to stderr; the port supplies it as the
  `stdout` payload. The header card (`contract`, `migrations`, `target`) is
  the only stderr block.
- It is rendered uncoloured, for the reason given under `migration list`.

### Behaviour preserved exactly

App-space-only resolution, the naive "looks like a path" detection, and the
rendered package layout.

## `migration log`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next migration log` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-5, R-S5-7, R-S5-8, R-S5-10, R-S5-13, R-S5-20, R-S5-21, R-S5-31 |
| Ported in | #29973 (`s5-orm-pr2`), merged |

### Flags

| Commander | Engine command | Note |
| --- | --- | --- |
| `--db <url>` | `--db <url>` | unchanged, from the shared `dbFlag` spec (R-S5-5) |
| `--utc` | `--utc` | unchanged |
| `--ascii` | `--ascii` | unchanged |

### Settlement and exit codes

**A target that provides no migration runner is now
`MIGRATION.TARGET_UNSUPPORTED` where it was `CLI.UNEXPECTED`.** Same exit code
(2), and the code is the one every sibling already raised for that condition.
The contract listed this as a defect fix carried by the port. Everything else
is unchanged.

### Output

- The ledger table is the `stdout` payload, uncoloured, with Unicode glyphs
  unless `--ascii` — the three changes recorded under `migration list`.
- The header card keeps its `database` row (masked).
- The "no migrations applied" line keeps its wording.

### Behaviour preserved exactly

The chronological merge across contract spaces, rollbacks and re-applies shown
in place, the local/UTC timestamp rule and the connection masking.

## `ref set` / `ref delete` / `ref list`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next ref set <name> <contract>` / `ref delete <name>` / `ref list` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-7, R-S5-8, R-S5-9, R-S5-10, R-S5-13, R-S5-16, R-S5-20, R-S5-21 |
| Ported in | #29980 (`s5-orm-ref-format`) |

### Flags

Positionals are unchanged: `set <name> <contract>`, `delete <name>`, nothing
for `list`. `--config` is gone (R-S5-4) and was the only flag any of the three
declared.

### Settlement and exit codes

Unchanged: 0 on success, 2 for every structured failure. No error code was
added or changed — every code these three can raise was already in the error
reference.

**These three are defined through `defineCommand`, not `defineOrmCommand`.**
Each converts its operation's `Result` failure with `normalizeError` at the
return site, so every settled envelope is well-formed — but there is no
top-of-handler catch, so an unexpected throw is settled by the engine instead:
`CLI.INTERNAL_ERROR` at exit 1 for a plain error, and an off-protocol envelope
for a thrown prisma/prisma `CliStructuredError`, which the engine's duck test
accepts and then reads `nextActions` off. Every command ported later goes
through `defineOrmCommand` and settles the same throw as `CLI.UNEXPECTED` at
exit 2. The inconsistency is in the code, not in a rule; `format`,
`contract emit` and `contract infer` share it.

### Output

- **Zero bytes on stdout in human mode**, where the commander wrote its
  confirmation lines there. Two contract rules disagreed about this: R-S5-7
  named these three among the commands whose payload lines move to the
  `stdout` presentation, and R-S5-9 — written later and explicitly superseding
  the earlier stdout rule — says `stdout` carries only lines another program
  parses. `Set ref "x" → <hash>` is a rendering for a reader, so R-S5-9 wins
  and none of the three supplies a `stdout` presentation. Recorded as a
  finding so the rule that was applied is the one on record.
- **`ref list` renders a table the engine sizes**, one row per ref, instead of
  one `name → hash [invariants: …]` line per ref. The `Invariants` column
  appears only when some ref carries any, which is when the commander appended
  the suffix. The empty case keeps its wording (`No refs defined`) as an info
  summary.
- Ref names carry the `ref` tone and contract hashes the `identifier` tone; no
  handler writes an escape sequence, so `NO_COLOR` strips the paint without
  moving a column.
- No header card was added. The inventory records that none of the three
  prints one today, so none was invented — `ref list` is a bare table.
- `--json` is the engine's result frame. §4 predicted the documents would
  become pretty-printed; the engine frames compactly instead, which is
  engine-owned and identical for every ported command. The documents
  themselves are unchanged inside `envelope.result`.

### Behaviour preserved exactly

Ref names still permit forward slashes, `head` and `db` are still not
rejected, `set` still writes `invariants: []`, and `ref delete` still removes
a ref without asking (R-S5-16). All four are recorded hazards, unchanged here.

## `format`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next format` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-7, R-S5-8, R-S5-9, R-S5-10, R-S5-20, R-S5-21 |
| Ported in | #29980 (`s5-orm-ref-format`) |

### Flags

None. `--config` was the only one and is gone (R-S5-4).

### Settlement and exit codes

Unchanged. The command shares the missing error boundary described under
`ref set` above.

### Output

- **The styled header card is gone** — it carried only the `config` row, which
  the handler can no longer name.
- The success line keeps its wording and gains the engine's ✔; it was already
  on stderr. The "Nothing to format" line keeps its wording as an info
  summary.
- The command-level `--quiet` branch was deleted rather than replicated, which
  is where the preamble's log-level alias becomes visible: a successful
  `format --quiet` now prints its line.

### Behaviour preserved exactly

Only a PSL source is formatted; a TypeScript or unset source is left
untouched. Indent and newline still come from the optional `formatter` config
section. Both binaries produce an identical rewrite of the demo's
`contract.prisma`.

One fix rides along: `executeFormat` took a `cwd` and ignored it, so a
relative `contract.source.inputs[0]` resolved against the process directory.
It now resolves against the passed one. Production is unaffected — the config
loader hands over absolute paths — so this shows up only under a harness that
supplies a working directory per run.

## `contract emit`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next contract emit` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-7, R-S5-8, R-S5-10, R-S5-20, R-S5-21 |
| Ported in | #29981 (`s5-orm-contract`) |

### Flags

| Commander | Engine command | Note |
| --- | --- | --- |
| `--output-path <dir>` | `--output-path <dir>` | unchanged; resolved against the command's `cwd` rather than the process directory |

### Settlement and exit codes

Unchanged. A malformed `orm` section now fails as `CLI.CONFIG_SECTION_INVALID`
where the commander raised a per-section `CONFIG.VALIDATION_FAILED` — the
whole-section blocking the preamble records. The command shares the missing
error boundary described under `ref set`.

### Output

- **The two emitted paths are written to stdout**, where the commander wrote
  nothing there outside json mode. They are machine-consumable file paths,
  which is what the machine channel is for. They are absolute, matching the
  `files` entries in the `--json` document; the human `fields` rail still
  shows them relative to the invocation directory. §4 said "the file paths are
  the stdout payload lines" without saying which form, so this is a choice
  built to the contract's default and recorded as one.
- The header card keeps only its `contract` and `types` rows, and they are now
  a `fields` rail rendered with the result rather than a card printed before
  the work.
- The progress spans (`Resolving contract source`, `Emitting contract`) are
  now step events, visible in every human run and framed in json, where the
  commander only spun a spinner interactively.
- The `storageHash` / `executionHash` / `profileHash` lines are a `fields`
  block on stderr, and the verbose timing line is a `verbose` message. The
  commander wrote both through `ui.log`, which also targets stderr — the
  channel did not change, the severity did.
- The run is cancellable: the handler passes `ctx.signal` to the operation,
  where the commander passed none.

### Behaviour preserved exactly

The emitted bytes, the staged publication of the `contract.json` /
`contract.d.ts` pair, and `queueEmitByOutput` as the in-process mutex.
Verified by emitting the integration and e2e fixtures with both binaries and
diffing: clean.

Two changes that are not user-visible but explain the diff: config is loaded
exactly once (the engine's load), where the commander loaded it twice; and the
handler's duplicate output-path precondition is gone, because the operation
raises the same `CONFIG.CONTRACT_MISSING` for the same two cases.

**One defect fix that does change emitted bytes.** Which package name a
generated file may import was looked up from the config file's directory,
falling back to `process.cwd()`. The ported command never sees the config
path, so it would have emitted against whatever directory the user was
standing in — emitting the e2e fixtures from the repo root flipped every
specifier from the published facade to the internal packages, and one fixture
failed outright. The fallback is now the directory the file is written to,
which is the package that will import it and the same directory
`validateContractDeps` already checks against. Callers holding a config path
(the commander command, the Vite plugin) are unchanged.

## `contract infer`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next contract infer` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-5, R-S5-7, R-S5-8, R-S5-10, R-S5-16, R-S5-20, R-S5-21 |
| Ported in | #29981 (`s5-orm-contract`) |

### Flags

| Commander | Engine command | Note |
| --- | --- | --- |
| `--db <url>` | `--db <url>` | unchanged (R-S5-5) |
| `--output <path>` | `--output <path>` | unchanged, including the path-resolution priority |

### Settlement and exit codes

Unchanged. Shares the missing error boundary described under `ref set`; the
handler does convert every failure inside the introspect-and-print block.

### Output

- **The overwrite warning is now a `warn` message event**, so it appears in
  the json stream where the commander suppressed it under `--json` and
  `--quiet`. The wording is unchanged.
- **The `--json` document loses `meta.configPath`**, because the handler
  cannot know which config file was loaded. `meta.dbUrl` (masked) survives.
  Recorded as one finding covering this command and `db schema`.
- There is no `stdout` presentation: §4 grants payload lines to `emit` and
  says nothing for `infer`, and R-S5-9's default is that a command supplies
  `stdout` only where it has machine-consumable lines. The written path is in
  the human summary and in `psl.path` in the document.
- The header card is a `database` row only (masked), and only when the
  connection is a string.

### Behaviour preserved exactly

The silent overwrite of an existing contract file with a warning and no prompt
(R-S5-16), the output-path priority, and the inferred PSL itself.

One fix rides along: the PSL is written through the same staged rename
`contract emit` uses, replacing a bare `writeFileSync` that could leave a
truncated `contract.prisma` behind an interrupted run.

## `migration plan`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next migration plan` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-7, R-S5-8, R-S5-9, R-S5-10, R-S5-20, R-S5-21, R-S5-31 |
| Ported in | #29982 (`s5-orm-migration-write`) |

### Flags

| Commander | Engine command | Note |
| --- | --- | --- |
| `--name <slug>` | `--name <slug>` | same surface. The commander's flag carried a default of `migration`; the engine flag has none and the operation applies the same default internally, so directory names are unchanged |
| `--from <contract>` | `--from <contract>` | unchanged |
| `--to <contract>` | `--to <contract>` | unchanged |

### Settlement and exit codes

Unchanged. No code was added or changed.

### Output

- Human output stays on stderr and stdout stays empty: the commander printed
  the plan through `ui.log`, which writes to stderr, and this command has no
  machine payload, so it supplies no `stdout` presentation. (#29982's body says
  human output moves to stderr "for all three"; that is only true of
  `migration new` and `migration status`.)
- The header card loses the command title, and its `name` row now appears only
  when `--name` was passed — the commander's flag default made that row
  unconditional.
- **The seed-phase lines become step events.** The commander printed
  `Updated <space> to <hash>; N new migration package(s) materialised` as a
  `ui.step`; the port reports `step-started`/`step-finished` per seeded space
  and carries the new hash and the materialised directories as step data. The
  count is no longer spelled in prose.
- The planned operations are a `tree` rooted at the migration directory the
  run wrote, with destructive operations carrying `status: 'warn'` — a ⚠ glyph
  in place of the commander's `(destructive)` suffix, matching `migration
  show`.
- The `Next:` prose becomes typed next actions.
- The timings line is a `verbose` message.

### Behaviour preserved exactly

The seed phase running before the no-op check, the auto-baseline two-package
write with its 60 000 ms directory-name offset, placeholder handling, the
statement preview, and the destructive-operations warning. All recorded
hazards, unchanged here.

## `migration new`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next migration new` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-7, R-S5-8, R-S5-10, R-S5-20, R-S5-21, R-S5-31 |
| Ported in | #29982 (`s5-orm-migration-write`) |

### Flags

`--name <slug>` and `--from <hash>` are unchanged; `--config` is gone.

### Settlement and exit codes

Unchanged.

### Output

- **The payload lines move off stdout.** The commander wrote `Scaffolded
  migration at …`, `from:`, `to:` and the follow-up instruction through
  `ui.output`; the port renders them as a summary and a `fields` block on
  stderr, and writes nothing to stdout.
- **The header card gains content.** The commander built a header with an
  empty details list; the port's names the contract and the migrations
  directory.
- The two follow-up instructions become typed next actions: edit
  `migration.ts`, then run it with Node.

### Behaviour preserved exactly

Prefix matching against `metadata.to` with first-match-wins, the app-space
scope, and the scaffolded package's contents. Both recorded, not fixed.

## `migration status`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next migration status` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-5, R-S5-7, R-S5-8, R-S5-9, R-S5-10, R-S5-11, R-S5-12, R-S5-20, R-S5-21, R-S5-23, R-S5-31 |
| Ported in | #29982 (`s5-orm-migration-write`) |

### Flags

| Commander | Engine command | Note |
| --- | --- | --- |
| `--db <url>` | `--db <url>` | unchanged (R-S5-5) |
| `--space <id>` | `--space <id>` | unchanged |
| `--to <contract>` | `--to <contract>` | unchanged |
| `--from <contract>` | `--from <contract>` | unchanged; still switches to offline path computation |
| `--legend` | `--legend` | unchanged in human mode; see below for json and quiet |
| `--ascii` | `--ascii` | unchanged |

**The four retired status flags are now declared redirects.** `--graph`,
`--all`, `--limit` and `--ref` were unknown options to the commander, which
answered them with commander's own "unknown option" text at exit 1. The engine
answers each with `CLI.COMMAND_MOVED` and the replacement invocation
(`migration graph`, `migration log --db <url>` twice, and `migration status
--to <contract>`), settled errored at exit 2. The engine accepts a flag
redirect only when `from` names a mounted command, which is why they could not
be declared until this round; the debt is recorded as closed in the findings.

### Settlement and exit codes

| Outcome | Commander | Engine command |
| --- | --- | --- |
| clean | 0 | 0 |
| `CONTRACT.UNREADABLE`, `MIGRATION.MARKER_NOT_IN_HISTORY`, `MIGRATION.MISSING_INVARIANTS` | 0, findings inside the result document | 0, the same findings **also** as `warn` diagnostics on the completed envelope |
| unreachable path, unknown space, unresolvable reference | errored, 2 | errored, 2 |

The exit codes did not move. What is new is that the three findings ride the
envelope as engine `Diagnostic`s as well as staying in the `--json` document's
`diagnostics` array, whose shape is the published contract R-S5-8 pins
(`code`/`severity`/`message`/`hints`, with `MIGRATION.MISSING_INVARIANTS`
carrying `ref` and `invariants` and no `severity`). Recording them twice is
deliberate and recorded as such; dropping the in-document copy would be its
own divergence. `warn` is also what keeps exit 0 legal — `ctx.present` refuses
a severity-`error` diagnostic on a run that exits 0.

**`--legend` under `--json` or `--quiet` no longer errors.** The contract said
`MIGRATION.LEGEND_HUMAN_ONLY` at exit 2 would survive here; it is
unimplementable in engine 0.0.8, for the reason recorded under
`migration list`, and the flag is silently ignored instead.

### Output

- Human output moves to stderr; stdout is empty. The commander wrote the whole
  status rendering through `ui.output`, so this is a real channel change for
  anyone capturing it.
- The space trees are `drawing` blocks whose lines carry tones, so the engine
  paints them and `NO_COLOR` strips them. A space heading is a bare label
  inside that drawing rather than a summary, so it no longer picks up a status
  glyph.
- **Glyph auto-detection is gone**, as recorded under `migration list`.
- The missing-invariants line becomes an engine-rendered diagnostic rather
  than a block of prose.

### Behaviour preserved exactly

The offline/online split on `--from`, the ref-and-invariant resolution, the
refusal to plan a path that would skip a required invariant
(`MIGRATION.PATH_UNREACHABLE`), the pending counts, the summary wording and
the connection masking.

## `db schema`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next db schema` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-5, R-S5-7, R-S5-8, R-S5-9, R-S5-10, R-S5-20, R-S5-21, R-S5-31 |
| Ported in | #29983 (`s5-orm-db-read`) |

### Flags

`--db <url>` is unchanged; `--config` is gone.

### Settlement and exit codes

Unchanged.

### Output

- **The schema view ships as the engine's `tree` block**, not a hand-drawn
  one: the handler names each node and the engine draws the connectors and
  pads the levels. The result is glyph-identical to the commander's. (The
  contract predicted a `drawing`; a real tree earns the real block.)
- **Label colouring is positional rather than word-matched.** The commander's
  renderer matched family words to decide what to paint; the port reads shapes
  (`<keyword> <name>`, `<name>: <detail>`, `<name> <prose>`). The painted
  result is preserved and no family vocabulary is written down in the
  framework layer — but a label that fits none of those shapes is now
  unpainted where a word match might have caught it.
- **The `--json` document loses `meta.configPath`**; `meta.dbUrl` survives.
  One finding covers this and `contract infer`.
- The header card is a `database` row (masked), shown whether the connection
  came from `--db` or from `db.connection`.

### Behaviour preserved exactly

The introspection itself and the emitted `schema` document.

**Two calls the command no longer makes.** The commander ran
`inferPslContract` and `getPslBlockDescriptors` on every run and discarded
both results. The port calls neither, so a family whose inference or
descriptor assembly throws now succeeds where it previously failed. Recorded
as a finding naming both calls.

## `db init`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next db init` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-5, R-S5-7, R-S5-8, R-S5-9, R-S5-10, R-S5-20, R-S5-21, R-S5-31 |
| Ported in | #29983 (`s5-orm-db-read`) |

### Flags

`--db <url>`, `--dry-run` and `--advance-ref <name>` are unchanged; `--config`
is gone.

### Settlement and exit codes

Unchanged. `mapDbInitFailure` moved out of the commander command so both
shells map a control-API failure the same way, `assertNever` on the failure
code included.

### Output

- Progress is `ctx.report` step events fed from the control API's spans, so
  the handler prints nothing while it works and the engine decides whether a
  step is drawn, streamed as a frame, or dropped by log level. The commander
  printed its own progress.
- **The per-space breakdown is a `tree` the engine draws**: one root per
  contract space, the operations beneath it, the marker that space was signed
  with as the last child. Destructive operations carry `status: 'warn'`, so
  they show a ⚠ glyph instead of a `(destructive)` suffix.
- The two trailing "run this next" lines become typed next actions.
- **The header card names the configured connection**, where the commander
  showed a `database` row only when `--db` was passed. Deliberate, and
  recorded: a header that names the database only sometimes is worse than one
  that always does.
- The statement preview goes through the renderer `migration show` already
  uses rather than repeating its own SQL semicolon rule.
- Human output stays on stderr and stdout stays empty. The commander printed
  through `ui.log`, which also writes to stderr, so a piped run sees no change
  here — #29983's body reads as if this moved, and it did not.

### Behaviour preserved exactly

The additive-only planning, the conflict refusal, the signing, `--dry-run`'s
read-only path, and ref advancement. `db init --dry-run` produced the same 19
operations and a byte-identical DDL preview from both binaries.

Planner warnings are not rendered, because this command cannot produce any:
`MigrationCommandResult.warnings` is only ever set by `db update`. The port
leaves out a branch no test can reach rather than shipping it untested.

## `migrate`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next migrate` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-5, R-S5-7, R-S5-8, R-S5-9, R-S5-10, R-S5-20, R-S5-21, R-S5-31 |
| Ported in | #29983 (`s5-orm-db-read`) |

### Flags

`--db <url>`, `--to <contract>`, `--advance-ref <name>`, `--show` and
`--from <contract>` are unchanged; `--config` is gone.

### Settlement and exit codes

Unchanged. One repair: the typed next actions on `MIGRATION.PATH_UNREACHABLE`
had lost one of the three remedies the `fix` prose named during the earlier
`fix` → `nextActions` conversion. `migration show <bundle>` is back.

### Output

- **`migrate --show`'s topology moves off stdout.** The commander wrote it to
  stdout deliberately, bypassing its own `ui.log` to avoid clack's gutter; the
  port renders it as a `drawing` block on stderr, because a lane gutter is
  exactly the 2D structure the engine cannot derive. The layout moved into one
  module both shells call, so the commander paints it with ANSI and the ported
  command marks the same code with tones. After stripping ANSI the two are
  byte-identical.
- **The apply now reports progress.** `ControlClient.migrate` accepts an
  `onProgress` the commander never passed, so an apply ran silently; each span
  is now a step event. A gain rather than a port, listed as a divergence.
- The commander's hand-written `Loading contract spaces…` line does not port:
  the control API's own `Running migration plan across spaces` span covers the
  same stretch and would double it.
- The apply's per-space breakdown is the same tree `db init` draws.
- **The header names the migrations root on both paths.** The commander said
  `migrations` under `--show` and `migrations/app` under the apply, from the
  same run of the same command; `migrate` walks every space, so the root is
  the correct answer and the apply header changes.
- The header also gains the configured connection, as `db init`'s does.

### Behaviour preserved exactly

The route computation, the ordered run-list, ref advancement, and
`EMPTY_CONTRACT_HASH` kept distinct from the `'<empty>'` literal.

**A pre-existing misalignment is preserved on purpose.** `migrate --show`'s
run-list has never lined up with the graph for a single contract space: the
commander computes the list's name column from a gutter width it only knows in
the multi-space case. The arithmetic moved verbatim into the shared renderer
and the test asserts what the code delivers rather than pinning an alignment
that does not exist. Recorded, with the fix named.

## `db verify`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next db verify` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-5, R-S5-7, R-S5-8, R-S5-9, R-S5-10, R-S5-11, R-S5-12, R-S5-13, R-S5-20, R-S5-21, R-S5-31 |
| Ported in | #29984 (`s5-orm-diagnostics`) |

### Flags

`--db <url>`, `--marker-only`, `--schema-only` and `--strict` are unchanged;
`--config` is gone. The two mutually exclusive combinations
(`--marker-only --schema-only`, `--marker-only --strict`) stay handler-checked
and errored with `CLI.INVALID_VERIFY_MODE` at exit 2.

**`--quiet` no longer has a command-level override.** The commander forced
`{...flags, quiet: false}` on a failing verdict, because exiting non-zero with
no diagnostics is unhelpful. Findings now ride the envelope and the engine
renders them regardless of log level, so the override was deleted rather than
replicated.

### Settlement and exit codes

| Outcome | Commander | Engine command |
| --- | --- | --- |
| verified | 0 | 0 |
| schema drift (full or `--schema-only`) | 1, no envelope | **completed**, `exitCode: 4`, one `error` diagnostic per drifted contract space |
| strict run failed only by unclaimed elements | 1 | **completed**, 4, the synthesized `CONTRACT.MARKER_REQUIRED` |
| single-contract marker finding (`CONTRACT.MARKER_MISSING`, `MARKER_MISMATCH`, `TARGET_MISMATCH`) | errored, 2 | **completed**, 4, one diagnostic carrying the same code |
| **per-space** marker finding (`MIGRATION.CONTRACT_SPACE_VIOLATION`) | errored, 2 | errored, 2 — unchanged |
| mode-flag conflict, no emitted contract, no connection, no driver, driver throw | errored, 2 | errored, 2 |
| broken invariant inside the verifier | `CLI.UNEXPECTED`, 2 | `CLI.INTERNAL_ERROR`, 1 |

Exit 1 used to mean "a bug in Prisma Next" and was what this command returned
for drift. Reporting drift is the command doing its job, so drift is now a
finding on a completed run at a documented exit 4, and exit 1 goes back to
meaning what it says: `combine-verify-results.ts` throws an `InternalError`
when the aggregate verifier returns no per-space results, and both `db verify`
branches reach it. Severity is `error` on every finding, which is legal
precisely because the exit code is non-zero.

**Which number a marker finding gets depends on which contract space the
marker belongs to.** `MIGRATION.CONTRACT_SPACE_VIOLATION` is one code raised
both when the verifier cannot introspect at all (exit 2 is right) and for
per-space marker drift (a finding by every other measure). Nothing on the
value distinguishes them except whether `meta.violations` is populated, so the
port kept both at 2 rather than sniffing `meta`. The consequence to know
before shipping: **`db verify --marker-only` against a database whose
extension-space marker has drifted exits 2** — "could not do the job" — in the
one mode whose entire job is the marker check. The real fix is two codes at
the raise site; it is recorded as a finding and listed as undecided below.

`CONTRACT.MARKER_REQUIRED` has the mirror problem: it means both "this command
needs a signed database and found none" (exit 2) and "a strict run found
elements no contract declares" (exit 4). A consumer matching on the code alone
cannot tell which it got. Also recorded, also undecided.

### Output

- **A marker finding now produces a completed verify document** where it
  produced an error envelope, which is a new `--json` shape for that path.
  That document reports `meta.schemaVerification: 'skipped'` and omits
  `unclaimed` entirely, because the marker verdict returns before the
  aggregate verifier runs and neither the live schema nor the unclaimed list
  was looked at. The commander reported `'performed'` and `unclaimed: []` on
  that path, which read as "none found" rather than "not looked for".
- Findings move from stderr prose into envelope diagnostics, rendered by the
  engine with code, summary, `why` and next actions.
- **Warn-grade findings attach no diagnostic at all.** Schema warnings and
  lenient unclaimed elements live in the human tree and in the result
  document; only `error`-grade findings become diagnostics. `migration
  status`, ported earlier, does emit `warn` diagnostics. A `--json` consumer
  therefore reads warnings from two places depending on the command. Recorded
  as an open decision, listed below.
- Drift is one diagnostic per contract space, not one per element: a schema
  diff issue carries no dotted code of its own. The elements are still
  individually visible as the children of the drawn tree and as the `issues`
  array in the document.
- The header card always names the database (masked), whether it came from
  `--db` or from `db.connection`, and still shows the mode.
- The command spells its exit codes at the end of its `help.description`,
  because engine 0.0.8 reads the `exitCodes` map only to reject an undeclared
  code and renders it nowhere a user sees.

### Behaviour preserved exactly

Both verification pipelines still run in full mode, in the same order, with
the same verdicts. Every dotted code the command reported it still reports.

One fix rides along: a driver throw is sanitised on **both** paths before it
surfaces. The guard returned an unsanitised error whenever the value had a
`code` property, and a driver error carrying `ECONNREFUSED`, `ENOTFOUND` or a
SQLSTATE is exactly that shape — and exactly the message most likely to quote
the connection URL.

## `db sign`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next db sign` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-5, R-S5-7, R-S5-8, R-S5-10, R-S5-11, R-S5-12, R-S5-13, R-S5-20, R-S5-21, R-S5-31 |
| Ported in | #29984 (`s5-orm-diagnostics`) |

### Flags

The `[contract]` positional, `--db <url>` and `--contract <contract>` are
unchanged; `--config` is gone.

### Settlement and exit codes

| Outcome | Commander | Engine command |
| --- | --- | --- |
| signed | 0 | 0 |
| schema verification refused the signature | 1 | **completed**, `exitCode: 4`, the schema-verify report as the document and one `error` diagnostic |
| both the positional and `--contract` given | bare stderr line, no envelope, 2 | `CLI.CONTRACT_ARG_CONFLICT`, errored, 2 |
| unresolvable contract reference, no emitted contract, no connection, driver throw | errored, 2 | errored, 2 |
| the family returns a sign result that says it did not sign | **presented "Database signed" at 0** | `CLI.INTERNAL_ERROR`, 1 |

The last row is a behaviour change worth reading twice: the commander printed
success regardless of `SignDatabaseResult.ok`. The control contract says a
family either writes the marker or throws, so `ok: false` is a family breaking
that contract — it now throws an `InternalError`, which both this command and
`db verify` re-throw from their own catch so the local conversion cannot
flatten it.

`CLI.CONTRACT_ARG_CONFLICT` is the one new code in this round (R-S5-13
permits minting in `CLI.*` for invocation problems); it is in the error
reference.

### Output

- **`meta.configPath` in the result document is now the fixed string
  `prisma-next.config.ts`.** The commander passed the resolved `--config`
  path. Wrong only for a run whose `--config` names another file; recorded as
  the second command waiting on the config path reaching `CommandContext`.
  The value travels no further than the result document — it is not written
  into the database marker.
- The refusal renders the schema findings as blocks plus an `error` summary,
  and the diagnostic carries "bring the database up to the contract, then sign
  again" as a typed next action.
- The header card names the contract reference and the database (masked).
- The exit codes are spelled at the end of `help.description`, for the reason
  given under `db verify`.

### Behaviour preserved exactly

Idempotence, the marker's `from`/`to` reporting, the contract-reference
resolution, and the verify-then-sign order.

One fix rides along: the emitted contract is read through the family's
`deserializeContract` seam rather than a bare `JSON.parse`, matching
`db verify`. Driver throws are sanitised on the way out, as they are there.

## `migration check`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next migration check` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-7, R-S5-8, R-S5-10, R-S5-11, R-S5-12, R-S5-13, R-S5-20, R-S5-21, R-S5-31 |
| Ported in | #29984 (`s5-orm-diagnostics`) |

### Flags

The `[target]` positional and `--space <id>` are unchanged; `--config` is
gone.

### Settlement and exit codes

| Outcome | Commander | Engine command |
| --- | --- | --- |
| all checks passed | 0 | 0 |
| integrity failures | 4, result document with `ok: false` | 4, **completed** envelope, one `error` diagnostic per failure, same document |
| unresolved target | 2, result document with an empty `failures` list | 2, errored `MIGRATION.PACKAGE_NOT_FOUND` |
| unknown `--space`, unreadable aggregate | errored, 2 | errored, 2 |
| a failure whose code is not a dotted `NAMESPACE.SUBCODE` | `CLI.UNEXPECTED` fallback | `CLI.INTERNAL_ERROR`, 1 |

**This command's exit numbers did not move.** It already declared 0/2/4 and
already exited 4 on integrity failures. What changed is the envelope: the
findings now ride it as diagnostics with the family's docs URL, and the
command's own `exitOverride` and catch-all `try`/`catch` are gone because the
engine owns settlement. The last row was unreachable — every producer in the
catalogue emits a `MIGRATION.CHECK_*` code — and had it fired it would have
put a completed-envelope exit-4 `CLI.UNEXPECTED` into the world, which is a
shape nothing should produce.

### Output

- **The `--json` document's failure entries swap `fix` prose for typed
  `nextActions`** (`checkFailureSchema`). This is the CLI's own published
  result document, not an error envelope, so it is a shape change a consumer
  can see. It landed with #29973.
- **The human finding line leads with the migration package path**
  (`✘ [CODE] <path>: <why>`), matching the commander. The engine's diagnostic
  renderer prints `code`, `summary`, `why` and next actions and never prints
  `where`, and the most common finding — a hash mismatch, "Stored hash X does
  not match recomputed hash Y" — names no package in its own text. `where`
  still carries the path on its own for a `--json` consumer.
- The header card names the migrations directory, plus `target` and `space`
  when given; the resolved space is appended to the summary.
- The exit codes are spelled at the end of `help.description` — restoring what
  the commander's help printed, for the reason given under `db verify`.

### Behaviour preserved exactly

The reserved-name convention in `checkManifestFilesPresent` (entries starting
with `.` or `_`, and the literal `refs`), the most-informative parse-failure
ranking, the cross-space single-target search, and all nineteen
`MIGRATION.CHECK_*` codes.

**A pre-existing hazard is preserved, and the port makes it matter more.**
`loadAggregateIntegrityViolations` swallows every error and returns an empty
list, so an unreadable `contract.json` or a corrupt snapshot directory makes
the whole aggregate-integrity pass vanish and this command reports "All checks
passed" at exit 0. Faithfully ported, not new — but exit 0 is now the way this
command states its verdict, so a caller trusts a pass that may never have run.
Recorded as a finding with the fix named.

## `db update`

| Field | Value |
| --- | --- |
| Inventory entry | [`../s5/orm-cli-inventory.md`](../s5/orm-cli-inventory.md) § `prisma-next db update` |
| Applied rules | R-S5-1, R-S5-2, R-S5-4, R-S5-5, R-S5-7, R-S5-8, R-S5-9, R-S5-10, R-S5-14, R-S5-15, R-S5-20, R-S5-21, R-S5-31, STOP-5 |
| Ported in | #29986 (`s5-orm-db-update`), stacked on #29983 |

This is the only ORM command that can destroy data, and the port replaces the
flag that used to authorise that with a consent prompt.

### Flags

| Commander | Engine command | Note |
| --- | --- | --- |
| `--db <url>` | `--db <url>` | unchanged |
| `--dry-run` | `--dry-run` | unchanged; still never prompts |
| `--to <contract>` | `--to <contract>` | unchanged |
| `--advance-ref <name>` | `--advance-ref <name>` | unchanged |
| `-y` / `--yes` | `-y` / `--yes` | **stops granting data loss.** The engine's `--yes` accepts declared prompt defaults, and a consent prompt has none |
| — | `--confirm <token>` | the engine's own shared flag, now the non-interactive way to authorise destruction. The token is the database name |

**`--confirm` is read only when the run is already non-interactive.** The
engine consults it in the `--yes || !interactive` branch and nowhere else, so
`db update --confirm appdb` from a terminal applies nothing — it stops at the
prompt. The working form is `--no-interactive --confirm appdb` (or
`--yes --confirm appdb`). The command's help and the error-reference entry now
say so; the flag's name does not, and that is recorded as a footgun for every
consent command that follows.

### Prompts

One prompt, where the commander had one: a yes/no confirm becomes
`prompt.consent` with the database name as its token.

| Condition | Prompt? | Exit | Envelope |
| --- | --- | --- | --- |
| interactive, database name typed | yes | 0 | applied |
| interactive, any other answer | yes | 2 | `CLI.PROMPT_INVALID`, nothing applied |
| interactive, Ctrl-C or EOF | yes | **3** | `CLI.PROMPT_CANCELLED` (the commander treated a cancel as "no" and exited 2) |
| non-interactive, no `--confirm` | no | 2 | `CLI.CONSENT_REQUIRED`, `meta.consentToken` names the token |
| non-interactive, `--confirm <database>` | no | 0 | applied |
| non-interactive, wrong `--confirm` | no | 2 | `CLI.CONSENT_REQUIRED` |
| `--yes` alone, even on a TTY | no | 2 | `CLI.CONSENT_REQUIRED` — "`--yes` cannot grant consent" |
| `--yes --confirm <database>` | no | 0 | applied |
| non-destructive plan, or `--dry-run` | no prompt at all | 0 | one `dbUpdate` call |

R-S5-14's "declined consent exits 2 as an interim" turned out to be
unnecessary: `prompt.consent` never returns `false` — it returns `true` or
throws the engine's own error — and `normalizeError` passes an engine-built
error through unchanged, so a cancel already settles at 3. No decline code was
minted.

**The token is the database name, derived by a four-step rule** (STOP-5's
single fallback proved too weak): the `database` a driver connection object
names; else the database a connection URL names; else the host that URL points
at; else the target id. The last step matters, because the target id is a
target *kind* — the literal `postgres`, `mongo` or `sqlite` — so
`--confirm postgres` would otherwise have granted data loss in every project
forever. A libpq `host=… dbname=…` keyword string is neither a URL nor an
object and still falls back to the target id; recorded. Worth knowing before
any doc promises "type your database name": against the demo's `@prisma/dev`
server the token is literally `template1`, because that is what its URL ends
in.

Two refusals the command raises rather than asking an unanswerable question:
`CLI.CONSENT_TOKEN_UNRESOLVED` when the resolved token is empty or whitespace
(the engine validates a token only as "is a string", and against an empty one
a bare Enter or `--confirm ""` would grant), and `CLI.CONSENT_OPERATIONS_MISSING`
when a destructive refusal names no operations to list.

### Settlement and exit codes

Beyond the consent matrix above, unchanged. A `DESTRUCTIVE_CHANGES` refusal
that is not consented to still settles `MIGRATION.DESTRUCTIVE_CHANGES` at 2.

**A non-interactive refusal no longer names what would be destroyed.** The
commander's `MIGRATION.DESTRUCTIVE_CHANGES` carried `meta.destructiveOperations`,
so a CI run could read the list out of the error envelope.
`CLI.CONSENT_REQUIRED` is minted inside the engine and carries only the token;
a handler cannot enrich it. The operations are still in the question text on
stderr, and a granted run still lists them in its result document.

### Output

- Planner warnings now render: as a `warn` summary and a `list` on a completed
  run, and as `warn` message events when the apply fails — an errored envelope
  renders no `meta`, where the commander's error formatter printed
  `meta.plannerWarnings`. They are deduplicated. `--quiet` (log level `error`)
  drops the event form, where the commander printed them regardless.
- The refusal's own warnings are reported before the prompt, which is when
  they matter most. The commander's loop ran only for the final failure, so
  the warnings that arrive with `DESTRUCTIVE_CHANGES` were never shown.
- The per-space breakdown, the header card and the channels match `db init`,
  stderr included: the commander printed through `ui.log` too.

### Behaviour preserved exactly

The plan, the applied operations, ref advancement and the result document.

**The re-invocation is gone.** The commander re-ran the whole command with
`{...flags, yes: true}` after an accepted prompt — two full connect-and-plan
cycles, three plans. The port connects once: `dbUpdate` returns the destructive
verdict, consent is taken on that same open connection, and a second
`dbUpdate` applies. The plan still runs twice, because the control API's guard
pre-plans and the apply re-plans; that is the API's shape, not the command's.

**Consent still authorises a plan that is then recomputed.** The second call
re-reads markers and re-introspects, so the user consents to plan #1 and plan
#2 executes. Binding them means changing the control API, so the command does
the post-hoc half: it keeps the consented operation ids and reports a `warn`
event naming any destructive operation the apply performed that the consent
did not cover. Listed as undecided below.

**One engine defect blocks the interactive path today.** On engine 0.0.8, under
a real pty, the prompt renders and every keystroke re-renders it, but a typed
token never composes into a value, so Enter re-validates an empty answer and
the run never settles. It is not the handler: plain `clack.text` works under
the same harness, including when given the engine's own stream adapters. Every
non-interactive path was verified through the built binary (no consent → 2,
`--yes` → 2, wrong `--confirm` → 2, `--confirm <database>` → 0 with the column
really dropped). This affects any command with a prompt, in any consumer.

## Telemetry

Cutover round (#s5-orm-cutover). R-S5-18, R-S5-19, STOP-4, STOP-11.

- **Event timing moves from pre-run to settlement.** The commander reported
  from a `preAction` hook before the command body ran; the engine bin wires
  `onSettled`, which fires exactly once after the run settles. Consequences,
  all user-visible in the row stream:
  - **A killed run emits nothing.** The commander's detached sender survived
    a parent crash after `preAction` and still landed a row; with `onSettled`
    a run killed before settlement emits nothing by design. The
    "crash after preAction still produces a row" e2e scenario is replaced by
    its inverse: an erroring-but-settling run produces a row.
  - **Runs that never reach a mounted command emit nothing.** Unknown
    commands, usage errors, `--help` and `--version` never fire `onSettled`
    (`cli-engine/src/run-summary.ts`), where the commander's `preAction`
    reported some of these.
  - **The event now carries the exit code** (`exitCode` on the wire event),
    which a pre-run report could not know.
- **The `telemetry` command-group exemption is gone.** The commander
  suppressed reporting for its own `telemetry status|enable|disable`
  commands; those commands no longer exist in this binary (R-S5-19), so the
  exemption has nothing to attach to.
- **Between the cutover and the `prisma-next` name handoff, the prisma-next
  binary has no telemetry subcommands** (R-S5-19). `telemetry
  status|enable|disable` live in prisma-cli's unified binary, which takes
  over the package name at rollout step 3. Throughout the window, the
  documented opt-outs keep working: `PRISMA_NEXT_DISABLE_TELEMETRY`,
  `DO_NOT_TRACK`, and `"enableTelemetry": false` in the per-user config file.
  The first-run notice names `prisma-next telemetry disable`, which is
  wrong during the window — recorded in the findings.
- **Wire shape** is the ORM sender's (R-S5-18): `databaseTarget` and
  `extensions` are retained, where the prisma-cli copy dropped them. The
  sender (`@internal/cli-telemetry`) survives the cutover and retires with
  the bin at the name handoff (R-S5-30).
- `__telemetry-crash-test` and `PRISMA_NEXT_ENABLE_TEST_COMMANDS` are
  deleted with the commander shell (STOP-11).

## Packaging

R-S5-26, R-S5-27. Breaking changes to the published `@prisma/orm-toolchain`
surface on the 8.0.0-rc line, generated from
`packages/0-shared/publish-surface/src/shells.ts`:

- **Deleted subpaths**: `./cli` (the commander program) and the eighteen
  `./cli/commands/*` factory subpaths (`contract-emit`, `contract-infer`,
  `db-init`, `db-schema`, `db-sign`, `db-update`, `db-verify`, `migrate`,
  `migration-check`, `migration-graph`, `migration-list`, `migration-log`,
  `migration-new`, `migration-plan`, `migration-show`, `migration-status`,
  `ref`, `telemetry`).
- **Added subpath**: `./cli/family` — the `orm` `CommandFamily` plus the
  config section token, the only CLI subpath the unified shell imports.
- **Kept**: `./bin/prisma-next` (now the engine entry, `dist/bin.mjs`),
  `./cli/migration-cli`, `./cli/control-api`, `./cli/control-api/testing`,
  `./cli/config-types`, `./cli/init-output`, and every non-CLI subpath.
- The `prisma-next` bin now points at the engine entry (`src/bin.ts` on
  `createCli`); the commander entry `dist/cli.mjs` and its `dist/cli.js`
  shim no longer exist.

## Not yet decided

Each of these needs an operator ruling before the cutover. All but one are
recorded in [`../s5/execution-findings.md`](../s5/execution-findings.md); the
quoted phrase names the finding.

- **Exit 1 is unreachable from a ported command.** R-S5-31's boundary catch
  converts every throw and the engine maps every errored code except
  `CLI.PROMPT_CANCELLED` to 2, so a genuine bug still settles as
  `CLI.UNEXPECTED` at 2. The interim landed (`InternalError` is re-thrown);
  the full narrowing — catch only structured errors, re-throw the rest —
  changes every command's failure behaviour and is a conflict between two
  ruled rules. See § "The contract's `migration check` unexpected-throw moves
  2 → 1 divergence is wrong".
- **`init`'s `CLI.INIT_INVALID_OUTPUT_DOCUMENT` settles at 2 where R-S5-12
  says 1.** The same conversion is the cause, but this is the one code the
  contract pinned at exit 1 by name, so it wants its own answer. This is the
  only item here with no finding of its own — the evidence is `init`'s
  settlement table above plus the entry before this one.
- **Consent is not bound to the plan it was granted for.** `db update`
  re-plans after consent and applies under a blanket `acceptDataLoss`; the
  post-hoc warning is in, and binding it properly needs a control-API change.
  See § "Consent authorises a plan, and nothing binds it to the plan that gets
  applied".
- **`MIGRATION.CONTRACT_SPACE_VIOLATION` does two jobs**, which is why
  `db verify --marker-only` can still exit 2 on a marker finding. The fix is
  two codes at the raise site. See § "`db verify`'s
  `MIGRATION.CONTRACT_SPACE_VIOLATION` is a drift finding wearing a
  precondition's code".
- **`CONTRACT.MARKER_REQUIRED` does two jobs** — a precondition at exit 2 and
  a strict-mode finding at exit 4 — and only the exit code separates them. See
  § "`CONTRACT.MARKER_REQUIRED` is the third code in this round doing two
  unrelated jobs".
- **`--keep-previous-facade` is a new flag with no predecessor**, minted
  because the Style Guide requires a flag for every prompt and `init`'s
  facade-removal confirm had none. The name has not been ruled on. See §
  "`--keep-previous-facade` is a new flag with no predecessor".
- **The signal-exit-code translation contradicts the engine's deliberate
  pass-through for server commands.** `lsp` translates SIGTERM/SIGINT to
  143/130 itself, because the engine settles a server command's code verbatim
  on purpose, and R-S5-12 says the opposite. See § "NEEDS A RULING — a server
  command's exit code is taken verbatim on purpose".
- **Warn-grade findings ride the envelope for `migration status` and not for
  `db verify`**, so a `--json` consumer reads warnings from two places
  depending on the command. Both readings are defensible; nothing chose
  between them. See § "Warn-grade findings produce no diagnostics at all".
