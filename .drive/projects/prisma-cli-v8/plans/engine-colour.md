# Plan — the engine renders

Contract: `../specs/engine-colour.md` (ruled 2026-08-11, amended the same day —
read §8 first; it overrides the body wherever the two still read differently).

Branch `engine-colour`, off `main`, one PR. #140 and #143 also add a field to
`Runtime`; all three additions are independent, so this does not stack.

Two dispatches. The joint is the styling surface: D1 builds the thing that turns
a tone into bytes and tells a renderer how much room it has, without changing
what any block looks like. D2 rewrites the blocks against it. Splitting the other
way — blocks first, colour after — would mean writing every renderer twice.

## Dispatches

### D1 — the palette and the styling surface

Outcome: the engine can turn a `Tone` into bytes, decides colour from stderr with
the flag beating the environment, and tells a command how wide stderr is. No
block renders differently yet.

Builds on: nothing.

Hands to: `Ui` carrying `tone()` and `width`; a text-rendering helper that takes
`Text` and returns bytes; a display-width helper. D2 calls all three.

Surfaces in play:

| File | What changes |
| --- | --- |
| `src/presentation.ts` | `Text`, `Span`, `Tone`, `Status`; `Ui` gains `tone` and `width` |
| `src/execution/palette.ts` (new) | Tone → colorette verb, per contract §2.3; `Text` → bytes; display width |
| `src/execution/command-context.ts` | `makeUi` builds the full surface from the resolved colour decision and stderr's width |
| `src/execution/shared-flags.ts` | Colour resolution moves to stderr; flag beats `NO_COLOR` beats stream |
| `src/runtime.ts` | `OutputStream.columns?`, `HostProcess.stderr.columns?` |
| `src/testing.ts` | The harness can set stderr's columns |
| `packages/cli/src/v8/runtime.ts` | The bin passes `columns` through instead of dropping it |
| `package.json` | `colorette` and `string-width` as dependencies |
| `src/exports/index.ts` | Export `Text`, `Span`, `Tone`, `Status` |

Tests: every tone with colour on and off, exact bytes; `--color` on a
`NO_COLOR=1` environment; `--no-color` on a terminal; colour follows stderr, so
`cmd > file` with a terminal stderr keeps it; `ui.width` is stderr's columns and
`POSITIVE_INFINITY` when stderr is not a terminal.

### D2 — the blocks draw

Outcome: tables align, cards are aligned and toned with an opt-in rail, trees
draw connectors and status glyphs, drawings render verbatim, and every block text
field takes `Text`.

Builds on: D1's `Ui`, text renderer and width helper.

Hands to: the slice DoD.

Surfaces in play:

| File | What changes |
| --- | --- |
| `src/presentation.ts` | `Block` per contract §3: `table`/`fields`/`tree`/`list`/`summary` take `Text`; `fields.rail`; `TreeNode.status`/`.tone`; `drawing` added; `summary.tone` → `summary.status` |
| `src/execution/rendering.ts` | The four renderers per contract §3; `renderBlock` takes the `Ui` |
| `src/exports/index.ts` | Export `Span`-carrying block types and `drawing` |
| `packages/cli/src/v8/**` | The `summary.tone` → `summary.status` rename, ~57 sites, compiler-driven |
| `packages/cli/tests/v8-golden-rendering.test.ts` | Re-pin the card and table bytes |
| `packages/cli/tests/**` | Whatever else pins block bytes |

Tests: a ragged table aligns; the same table with span cells aligns identically
with colour on and off; a table with a CJK cell aligns; a card aligns values into
one column and tones its labels; `rail: true` reproduces the legacy rail bytes
from `packages/cli/src/shell/ui.ts:81-127`; a tree matches the style guide's
`├─ ✘ table user` example verbatim; a drawing round-trips its spans with no
reflow; a command that overruns `ui.width` prints unmodified.

## Validation gate

All green before every commit, judged by pnpm's own exit codes:

- `pnpm --filter @prisma/cli-engine test` (its `test` script runs build +
  typecheck + vitest)
- `pnpm --filter @prisma/cli test`
- `pnpm typecheck`
- `pnpm lint`

## Halt and surface rather than improvise

- Any point where the contract and the shipped engine disagree about an existing
  mechanism.
- Any need to touch `packages/cli/src/auth/**`, `packages/cli/src/v8/auth/**`,
  publish machinery, or a file outside the tables above.
- Any block whose legacy rendering cannot be expressed in the grammar §3 gives —
  that is evidence the grammar is missing a kind, which is an operator question,
  not an implementer's escape hatch.

## Open items

- **The 36 `fields` sites do not get their rail back in this PR.** The engine
  gains `rail`, defaulted off; which cards want it is a per-command judgement the
  engine cannot make. Alignment and the accent colour return everywhere at once,
  which is the loss the S2b divergence list records. Adopting the rail is
  follow-on work for the family that owns each command.
- **Nothing binds `ui` yet.** All 54 platform presenters are written
  `human: () => [...]`, so after this PR the engine colours what it draws itself
  — headings, connectors, glyphs, rails — and nothing else. Commands reaching for
  `ui.tone`, spans and `drawing` is the conversion the contract §6 defers to each
  family.
- **A bare `vitest run` in `packages/cli-engine` tests `dist`, not source.**
  The package's `test` script is `build && typecheck && vitest run`, so the
  validation gate is honest — but anyone editing engine source and reaching
  straight for `vitest run` is testing the previous build. It surfaced here
  when a deliberate defect failed to fail. Worth a line in
  `docs/reference/testing-patterns.md`, which is outside this slice.
- **Half of stderr is coloured after this PR.** Blocks are; next actions and
  diagnostics still render as plain strings. That is correct for this slice —
  the contract's block grammar is what it governs — but it is the first thing a
  converting family will notice, and the natural next slice. Surfaced in review
  round 2.
- **The style guide's card example has no colon on the key**
  (`│  local repo  ~/code/apple`), while both legacy renderers and contract §3.2
  write `${label}:`. The engine follows the contract and therefore the shipped
  bytes; the guide's example is the outlier. Either the guide gets corrected or
  a later block option makes the colon optional — not this slice's call.
  Surfaced in review round 2.
- **A table whose last cell is an empty span carrying a tone keeps its
  separator spaces**, because the trailing-space strip sees zero-width escape
  sequences rather than spaces. Alignment is unaffected and no current caller
  can produce the shape. Reviewer recommends no change; recorded so the next
  person to touch the strip knows it was considered.
- **Diagnostics on the parse-failure path render before colour is resolved.**
  `applySharedFlags` has not run yet, so `state.colorEnabled` is still the
  `false` default from `engine.ts:289`. Harmless for this slice, which colours
  only the four block renderers — but a later slice that colours diagnostics or
  usage errors has to resolve colour pre-parse, the way `sniffFormat` already
  resolves format, and for the same reason: the decision must be in force before
  the parser can fail. Surfaced in review round 1.
- **Colour and width read two independent signals.** Colour keys off
  `runtime.isTty.stderr`, width off `runtime.stderr.columns`. Node keeps the two
  consistent, but the test harness lets a caller set a width on a non-terminal
  stderr or a terminal stderr with no width. Neither combination is wrong today —
  width already falls back to unbounded — but a future change that infers one
  from the other should know they are separate. Surfaced in review round 1.
- **Glyph mode is not adopted.** The ORM detects whether the terminal can render
  unicode box-drawing (`prisma/prisma`
  `packages/1-framework/3-tooling/cli/src/utils/glyph-mode.ts`: TTY plus a UTF-8
  locale, else ASCII). The engine already emits `✔ ✘ ⚠ ℹ` unconditionally, so
  connectors do not make it newly wrong, but a tree is more box-drawing than the
  engine has ever emitted. Recorded in `deferred.md`.
