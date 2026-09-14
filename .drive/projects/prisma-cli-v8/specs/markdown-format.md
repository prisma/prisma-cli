# Markdown output format — slice spec

Status: contract. Every rule below is decided (operator rulings 2026-09-12). Nothing is left to the implementer's taste; where a case is not covered, halt and ask rather than choose.

## At a glance

`@prisma/cli-engine` gets a third output format, `markdown`, selected by `--format markdown`. It renders the same blocks a command already describes for `human` as plain Markdown on stdout, for an agent that reads the output as text. No command changes and no command can detect the format. One PR, engine plus docs, this worktree's branch.

## Why

Agents read CLI output more than humans do. `json` costs tokens on envelope and repeated keys; `human` carries padding, rails, glyphs, and colour that a model cannot use. Markdown gives a model every value labelled, one entity per block, tables only for uniform rows, and no decoration. Because every command already describes its output as blocks, one renderer serves every CLI on the engine.

## Chosen design

### Selection

- `Format` becomes `"human" | "json" | "markdown"`. The `--format` enum gains `markdown`. The pre-parse scan (`pre-parse-argv.ts`, `formatFlagGiven`) recognises `--format markdown` and `--format=markdown`.
- No `--markdown` shorthand. Default selection is unchanged: a terminal stdout gets `human`, anything else gets `json`. Markdown is only ever explicit.
- An explicit `--format <v>` or `--format=<v>` wins over `--json` whatever the order, in the pre-parse scan as well as after parsing (PR review, 2026-09-12).

### Under markdown, the engine behaves like this

- **Everything goes to stdout.** Blocks, next actions, diagnostics, structured errors, help, `--version`, and live events all print on stdout. The engine writes nothing to stderr. The `stdout` presentation thunk is never called and its raw data lines are not printed; the Markdown table already carries them.
- **Colour is off**, even with `--color`. `state.colorEnabled` is false, the paint function is the identity, and the `Ui` given to the command has `width` of `Number.POSITIVE_INFINITY`. `Ui.code` keeps its backticks.
- **`materializePresentation`** calls the same `human(ui)` thunk the terminal uses, exactly once, and stores the blocks in `presentation.human`; `stdout` is `[]`, `json` is `undefined`, `next` is materialised.
- **Every `=== "human"` check in the engine is rewritten so markdown takes the human path**: help stream and help colour and stricli's stdout in `engine.ts`, and `settleVersion` in `settlement.ts`. Checks written as `!== "json"` already behave correctly.
- Server commands and command redirects force `state.format = "human"` today. Under markdown that downgrade stands, since the server command owns stdout.
- Delegated children (`spawn.ts`) inherit the terminal as under human. Event buffering while a child owns the terminal is unchanged.
- The `prisma` CLI's update notice and skills notice sniff `--json` from argv and stay unchanged. They print on stderr under markdown; that is accepted.

### Block rendering

Text that is spans renders as the spans' plain text joined (`plainText` in `palette.ts`); tones are dropped. Nothing is padded, wrapped, truncated, or aligned. Status and severity words are the engine's own strings verbatim: `ok`, `error`, `warn`, `info`.

| Block | Rendering |
| --- | --- |
| `summary` | One line: `[status] text`. Tone ignored. |
| `fields` | One line per row: `label: value`. An empty value renders `—`, as human does. A `sensitive` value renders `********`. `rail` is ignored. A multi-line value is printed verbatim. An empty block renders nothing. |
| `table` | A GFM pipe table: `\| Col \| Col \|`, then `\| --- \| --- \|`, then one row per entry. Headers are sentence-cased as human does. An empty cell renders `—`. In a cell, a backslash becomes `\\` first, then `\|` becomes `\\|`, then a newline becomes a space. No other escaping. A table with columns but no rows renders the header row, the separator row, then a line `(no rows)`. |
| `list` | One `- item` per entry. Multi-line items verbatim. |
| `tree` | Nested bullets, two spaces of indent per depth, roots at depth 0. A node with a status renders `- [status] label`; without, `- label`. |
| `drawing` | A fenced code block with no language, lines verbatim. The fence is one backtick longer than the longest backtick run in the content, and at least three. |

One blank line separates every block and every section. Output ends with exactly one newline.

### A completed run

In order, on stdout:

1. The blocks.
2. When there are next actions: `### Next`, then one bullet per action.
3. When there are diagnostics: `### Diagnostics`, then each diagnostic in the diagnostic shape, blank line between diagnostics.

### Next action bullet

- Action with a `command` whose label differs from it: `- label: \`command\``.
- Action with a `url` whose label differs from it: `- label: url` (URL verbatim, no angle brackets).
- Action whose label equals its target, or with no target: `- label`, in backticks when it is a command, mirroring the human renderer.
- Action with `commands` (plural): `- label`, then one nested bullet per command, each `  - \`command\``.
- `reason` is not rendered, mirroring human.

### Diagnostic and structured error shape

Used for the error of an errored run and for every diagnostic:

```
[severity] CODE: summary
why: the reason text
where: path:line
- next action bullet
- next action bullet
docs: https://…
```

`why`, `where`, and `docs` lines appear only when the field is present. `where` renders `path:line` when both exist, `path` alone, or `line N` alone. `docsUrl` is filled from the family's `docsBaseUrl` as today (`withDocsUrl`).

An errored run prints the error shape, then, when there are accompanying diagnostics, a blank line, `### Diagnostics`, and each in the same shape. The envelope's top-level `nextActions` duplicates the error's and is not printed again, matching human.

Exit codes are unchanged.

### Pinned during D1 (mirror the human renderer)

- A run with no blocks, no next actions, and no diagnostics prints nothing.
- `### Next` and `### Diagnostics` are followed directly by their content; the blank-line rule applies between blocks and sections only.
- The plural `commands` bullet form applies only when the action has no `command` and no `url`.

### Config-section warnings

`needs.ts` `writeSectionWarnings` prints config-validation warnings of an OK run as commentary on stderr in every format. Under markdown they print on stdout, in the diagnostic shape, one blank line between them, before the command's blocks, filtered by log level as today (D2). The warnings section ends with one blank line, so whatever the run prints next (blocks, an error, or nothing) is separated from it by exactly one blank line.

### Version, child status

- `--version` prints the version string alone on stdout.
- A child-status settlement with next actions prints them as next action bullets on stdout, mirroring the human path.

### Live events

Rendered one line each on stdout as they happen, subject to the same log-level filter as human:

| Event | Markdown |
| --- | --- |
| `step-started` | Not printed. |
| `progress` | Not printed. |
| `step-finished` | `[outcome] step`, outcome verbatim: `ok`, `failed`, `skipped`, `warning`. |
| `message` | The text, as human prints it. |
| `output` | The line verbatim, both channels, on stdout. |
| `endpoint`, `status`, `artifact` | Exactly the line the human renderer prints. |
| `remediation` | Not printed, as human. |

### Help

In scope. `help.ts` is split into a data model (the card's header, usage, description, and its sections as rows) and two renderers: the existing terminal one, byte-identical to today, and a Markdown one. Markdown help shape:

```
# prisma project

Tagline or group brief, as a paragraph. Omitted when none.

## Usage

```bash
prisma project link [options] [id-or-name]
```

Description paragraphs verbatim, not wrapped.

## Commands

| Command | Description |
| --- | --- |
| `link [id-or-name]` | Link this directory to a Project… |

## Workflow

| Run | Purpose |
| --- | --- |
| `prisma auth login` | Sign in… |

## Arguments

| Argument | Description |
| --- | --- |
| `id-or-name` | … (optional) |

## Options

| Flag | Description |
| --- | --- |
| `-q, --quiet` | Shorthand for --log-level error |
| `--format <value>` | Output format (human\|json\|markdown) |

## Global options

(root card only; same table shape as Options)

## Examples

```bash
prisma project link
prisma project link "Acme Dashboard"
```

Docs: https://…
```

Rules: `Usage` only on a leaf card. Flag labels are the same strings the terminal renderer builds, with the three-space alias placeholder trimmed. The suffix (allowed values, `required`, default) is appended to the description in parentheses as today; `|` inside it is escaped as in any cell. The leaf's "Global options also apply: …" line and the group's "Run '… --help' for details" line print as plain paragraphs. Sections with no rows are omitted. Help goes to stdout.

### Pinned from PR review (2026-09-12)

- Every inline code span the renderer emits (commands in next-action bullets, help tables, help usage) uses a delimiter one backtick longer than the longest backtick run in its content, and pads the content with one space on each side when it starts or ends with a backtick. Every fence (drawings, help usage and examples) follows the fence rule above. One shared pair of helpers, regression tests for content containing backticks.

### Pinned during D3

- A bare group invocation stays bare when the only extra tokens are format selection (`--json`, `--format <v>`, `--format=<v>`), for every format. Consequence: `prisma project --json` now prints group help on stderr and exits 0 instead of `CLI.UNKNOWN_COMMAND`. Operator may veto; one edit narrows it.
- The shared enum flags render with no placeholder, as the terminal builds them: `` `--format` | Output format (human\|json\|markdown) ``. The sample row above showing `--format <value>` is superseded.
- A leaf card's paragraph under `# name` is the command summary, as the terminal puts it in that slot.
- The leaf's "Global options also apply" paragraph sits between `## Options` and `## Examples`; the group's "Run '… --help'" paragraph is last.

### Documentation

- `docs/product/output-conventions.md`: a `## --format markdown` section, one paragraph naming the format, its purpose, and that everything lands on stdout.
- `docs/product/cli-style-guide.md`: the flag list entry becomes `--format <human|json|markdown>`.
- `packages/cli-engine/README.md`: one paragraph naming the three formats.

### Engine version

`pnpm bump-cli-engine-version minor` (0.3.0 → 0.4.0). The tarball conformance check `engine-pin-mismatch` will fail until `@prisma/composer-cli` and `@prisma/orm-toolchain` republish against 0.4.0. That is the known merge blocker for this PR; it is the operator's release-chain call, not this slice's.

## Coherence rationale

One reviewer can hold this: a new renderer beside the existing one, a widened enum, a handful of branch rewrites, a help refactor that preserves today's bytes, and docs. The tests pin every rule byte-for-byte, so review is comparison, not judgment.

## Scope

In: everything above.

Out: any change to a block type; any format a command can detect; any change to `json` output; `--json` versus `--format` precedence; auto-detecting agents; truncation or paging; `cli-conformance` (its four checks never exercise an output format, so it needs nothing).

## Pre-investigated edge cases

- `renderCompletedHuman` skips the raw stdout mirror only when both streams share a terminal. Under markdown the mirror is never printed, so that rule is not consulted.
- `engine.ts:542` and `:716` set `state.format = "human"` for a missing spawn adapter and for server commands. Leave them.
- `packages/cli/src/skills-check.ts:169` and `update-check.ts:188` sniff `--json` from argv. Leave them.

## Done when

- Every test below exists and passes, next to the engine's other tests under `packages/cli-engine/tests/`:
  - a renderer test per block kind with a fixture and the exact Markdown;
  - sections order, `### Next`, `### Diagnostics`, blank-line rule, trailing newline;
  - `sensitive` redacted under markdown;
  - a structured error under markdown carries code, summary, why, where, docs, and every next action, on stdout, with the documented exit code;
  - a run under `markdown` and under `human` yields deep-equal `presentation.human` blocks and calls the `human` thunk once per run;
  - stderr is empty for a completed run, an errored run, help, and version under markdown;
  - events under markdown: started and progress dropped, finished rendered with the outcome word, the rest as human;
  - help under markdown for a root card, a group card with a workflow, and a leaf card with positionals, flags, examples, and docs; terminal help output unchanged for the same fixtures.
- The whole repository's checks pass: `pnpm typecheck`, `pnpm lint`, `pnpm --filter @prisma/cli-engine test`, `pnpm --filter @prisma/cli test`, `pnpm --filter @repo/cli-conformance test`, `pnpm test:scripts`.
- Docs updated as listed. Engine version bumped.

## Open questions

None.

## References

- Brief as validated in the 2026-09-12 session; rulings: stdout for everything, colour off, no shorthand, drop started and progress events, help in scope.
- `packages/cli-engine/src/presentation.ts`, `execution/rendering.ts`, `execution/help.ts`, `execution/settlement.ts`, `execution/reporting.ts`, `execution/command-context.ts`, `execution/shared-flags.ts`, `execution/pre-parse-argv.ts`, `execution/palette.ts`.
- `packages/cli-engine/tests/blocks.test.ts` for the test harness pattern (`createTestCli`, `--format`, `--no-color`).
