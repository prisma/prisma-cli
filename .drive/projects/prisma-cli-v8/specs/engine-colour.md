# Engine spec — the palette, rendering, and terminal width

Status: ruled 2026-08-11 (operator); amended 2026-08-11 after surveying the
shipping implementations in prisma/prisma and prisma/composer (§8 records the
amendments and why). Deliverable: one PR to `packages/cli-engine`. Consumers:
the ORM family and the platform family, both of which lose rendering today.

Supersedes two earlier revisions of this document. The first routed rich
renderings through `Presentations.stdout` (wrong: that is the machine channel).
The second proposed a separate `graphic` presenter and left tables, trees and
width alone (wrong: the engine owns rendering, so the fix belongs in the block
grammar).

## 1. What is broken

The engine ships a common renderer that does almost no rendering.

- **No colour at all.** `makeUi` (`execution/command-context.ts:24-37`) emits
  exactly two escape sequences — SGR bold and dim. There is no colour anywhere
  in the engine, and `colorette` is not a dependency. Every ported platform
  presenter is written `human: () => [...]`; not one binds `ui`. The entire v8
  CLI is unstyled.
- **Tables do not align.** `renderBlock` (`execution/rendering.ts:86-91`) is
  `write(columns.join("  "))` then `write(row.join("  "))`. No sizing, no
  padding. The golden suite pins the result: `name  id  status` over
  `Acme Inc  ws_1  current`.
- **Key/value cards lost their alignment and their colour.** The legacy shell
  drew a card: keys padded to a common width, keys in the accent colour, an
  optional dim `│` rail down the left
  (`packages/cli/src/shell/ui.ts:81-159`). The v8 `fields` block prints
  `label: value` with none of it, across 36 sites. The S2b divergence list
  records the loss as accepted; it is not accepted.
- **Trees have no connectors.** `writeTree` (`:103-124`) emits two-space
  indents. The style guide specifies `├─ ✘ table user` with dim connectors and
  coloured glyphs; the block cannot express it, and has zero users.
- **There is no way to draw.** A migration DAG with gutter lanes is not a tree
  and not a table. No block kind fits.
- **Width is unreachable.** `OutputStream` is `{ write(text: string): void }`
  (`runtime.ts:7-9`) — no `columns`, structurally, even from the bin. Nothing in
  the engine reads terminal size. Consequently every ORM picture already breaks
  on a narrow terminal today: they assume unlimited width and let the terminal
  hard-wrap, which destroys the gutter alignment that carries their meaning.

Both consumers have already lost rendering to this. The platform port flattened
`auth workspace list`, `project list` and `agent status` from aligned
rail-and-card renderings to ragged blocks, recorded as accepted divergences. The
ORM port ships its renderers colourless, and two of them bypass `NO_COLOR`
outright (`createColors({ useColor: true })`) to get colour at all.

## 2. Text, status, and the palette

### 2.1 One text type, everywhere

Anywhere a block takes display text, it takes `Text`:

```ts
type Text = string | readonly Span[];

interface Span {
  readonly text: string;
  readonly tone?: Tone;
}
```

A bare string is untoned text. Spans carry meaning, never escape sequences:
**a handler never emits ANSI**, so the engine can measure, re-theme, and strip by
construction. Width is computed from `span.text`, so colour cannot break
alignment — the pad-versus-colour trap that exists in shipped code today
(`packages/cli/src/lib/app/deploy-output.ts:41`) becomes unrepresentable.

### 2.2 Status is not tone

`Status` says what happened and selects a glyph. `Tone` says what colour to
paint and selects nothing else. They are separate fields because they are
separate questions: a tree node can be a failure (`✘`) painted in its branch
lane's hue, and a heading can be cyan without being a status.

```ts
type Status = 'ok' | 'error' | 'warn' | 'info';   // ✔ ✘ ⚠ ℹ
```

Each `Status` carries a default `Tone` of the same name, so a block that states
a status is coloured without also stating a tone. An explicit `tone` overrides
that default; it never changes the glyph.

Today `summary.tone` does both jobs — it is typed `'ok' | 'error' | 'warn' |
'info'` and `TONE_SYMBOL` (`execution/rendering.ts:65-72`) reads it to pick the
symbol. That field becomes `summary.status`, and the 57 call sites in
`packages/cli` are renamed with it.

### 2.3 The palette

One `Tone` union, drawn on by `Span`, the blocks, and `Ui` alike. Semantic names
and indexed colours in the same union; a command asks for meaning where it has
one, and for a distinguishable colour where it does not.

```ts
type Tone =
  // status
  | 'ok' | 'warn' | 'error' | 'info'
  // text roles
  | 'heading'      // a section label, a field key, a table column header
  | 'identifier'   // a name the user typed or will type: a table, a ref, a hash, a command
  | 'ref'          // a marker or ref name and its punctuation
  | 'placeholder'  // an argument slot: <ref>
  | 'link'         // a URL
  | 'emphasis'     // the primary value on a line
  | 'muted'        // secondary detail: counts, timestamps, empty states, off-path text
  | 'structure'    // the drawing itself: gutters, rails, connectors, separators
  | 'highlight'    // the selected route through a drawing
  // indexed, non-semantic — for telling adjacent things apart
  | 'color-1' | 'color-2' | 'color-3' | 'color-4' | 'color-5' | 'color-6';
```

Every rendering is taken from a shipping implementation rather than chosen
fresh. The platform column is `packages/cli/src/shell/ui.ts:63-78`; the ORM
column is the `prisma/prisma` CLI's formatters.

| Tone | Renders as | Taken from |
| --- | --- | --- |
| `ok` | `greenBright` | platform `success` |
| `warn` | `yellow` | platform `warning`, ORM `migration-graph-labels` |
| `error` | `redBright` | platform `error` |
| `info` | `blue` | platform `info` |
| `heading` | `cyan` | platform `accent` — field keys and column headers |
| `identifier` | `cyan` | ORM `styled.ts` — command names, schema names, hashes |
| `ref` | `green` | ORM `migration-list-styler.ts` `styleRefName` |
| `placeholder` | `dim` | style guide: "show placeholder values such as `<path>` in dim text" |
| `link` | `blue` | platform `link`, ORM `formatReadMoreLine` |
| `emphasis` | `bold` | platform `strong`, and the engine's existing `Ui.emphasize` |
| `muted` | `dim` | both |
| `structure` | `dim` | both — the rail and the tree connectors are dim in each |
| `highlight` | `greenBright` | ORM's on-path route colour |
| `color-1` … `color-6` | `white`, `cyan`, `yellow`, `blueBright`, `magenta`, `green` | ORM `migration-graph-occlusion-render.ts` `LANE_COLORIZERS`, in order |

`heading` and `identifier` both render `cyan` today, because both shipping CLIs
use cyan for both. They stay separately named so that a later re-theme can
separate them without touching a single command.

The indexed colours are for series — the migration graph assigns one per branch
lane, `lane % 6`, and tints the lane's gutter cells, node glyph and migration
name alike so they read as one colour. A command says `color-3`; it does not
know or care what that is.

Colour comes from `colorette`, which is already the colour dependency of this
repo's shell and of the ORM CLI. Basic 16-colour SGR only: no 256-colour, no
truecolor, and therefore no colour-depth detection to own. `LANE_COLORIZERS`
deliberately excludes red so that no lane can be mistaken for `error`, and the
indexed set inherits that.

### 2.4 `Ui`

`Ui` gains a verb per tone, for styling inside text, and the available width
(§4):

```ts
interface Ui {
  readonly width: number;              // §4
  readonly emphasize: (text: string) => string;   // kept: existing callers
  readonly dim: (text: string) => string;         // kept
  readonly code: (text: string) => string;        // kept
  readonly tone: (tone: Tone, text: string) => string;
}
```

Colour disabled ⇒ every verb is an identity function, so a renderer has one code
path and no `if (colour)` branch.

### 2.5 Colour resolution

Engine-owned, corrected in one respect: it must key off **the stream the engine
is printing to**. Today it keys off `isTty.stdout`
(`execution/shared-flags.ts:156-158`) while blocks render to stderr, so
`cmd > file` disables colour for output a human is watching and `cmd 2> file`
leaves it on for output nobody sees.

The precedence is explicit-flag, then environment, then the stream (operator
ruling, 2026-08-11):

1. `--color` / `--no-color` decides, whatever else is set. An explicit flag on
   the invocation beats anything in the environment.
2. Otherwise `NO_COLOR` being set disables colour.
3. Otherwise colour is on iff stderr is a terminal.

With the palette engine-owned there is no per-renderer colour switch left, so
the ORM's two `createColors({ useColor: true })` bypasses have nothing to bypass
once those renderers convert.

## 3. The block grammar

`Block` grows and three existing kinds are fixed. The rule is unchanged: **the
engine renders; a command describes.** A command reaches for `drawing` only when
its layout genuinely cannot be described structurally.

### 3.1 `table` — the engine aligns it

```ts
{ kind: 'table'; columns: readonly Text[]; rows: ReadonlyArray<readonly Text[]> }
```

The engine sizes each column to its widest cell (measured on text, not escapes),
pads, and joins with two spaces. Column headers render as `heading` unless the
cell carries its own tone. This alone restores `auth workspace list`,
`project list` and every other flattened platform table.

### 3.2 `fields` — the engine draws the card

```ts
{
  kind: 'fields';
  rows: ReadonlyArray<{
    readonly label: Text;
    readonly value: Text;
    readonly sensitive?: boolean;
  }>;
  rail?: boolean;   // default false
}
```

The legacy card, restored: `${label}:` padded so every value starts in the same
column, the label rendered as `heading`, the value as given. With
`rail: true` the engine prefixes each row with a `structure`-toned `│` and two
spaces, matching `renderCommandHeader`.

The rail is a property of the block rather than a global setting because the
legacy shell had both shapes — `renderFieldRows` without the rail,
`renderCommandHeader` with it — and a command knows which one it is drawing. It
defaults to `false`, so restoring the rail on a given command is that command's
own edit; alignment and colour come back everywhere at once.

### 3.3 `tree` — the engine draws the connectors

```ts
{ kind: 'tree'; roots: readonly TreeNode[] }

interface TreeNode {
  readonly label: Text;
  readonly status?: Status;      // renders ✔ ✘ ⚠ ℹ before the label
  readonly tone?: Tone;          // colours the label; defaults from status
  readonly children?: readonly TreeNode[];
}
```

The engine draws `├─`, `└─`, `│` in `structure` tone and the status glyph from
`status`, matching the style guide's `├─ ✘ table user`. This restores the ORM's
schema tree and the operation trees, and gives `agent status` a way to express
the nesting it lost.

### 3.4 `drawing` — the escape hatch

```ts
{ kind: 'drawing'; lines: readonly Text[] }
```

Lines of spans, rendered verbatim: the engine applies the palette and writes each
line, and does nothing else — no layout, no reflow, no truncation. This is for
output whose 2D structure the engine cannot derive: the migration DAG's lane
gutter, where lane assignment comes from a BFS over the graph and the same hue
must reach the gutter cell, the node glyph and the label text.

`summary` and `list` keep their shapes, with `Text` in place of `string` and —
for `summary` — `status` in place of the overloaded `tone`.

## 4. Terminal width

The engine reads the terminal width **of the stream it is printing to** and hands
it to the command as `ui.width`, because only the command knows what to
sacrifice: the graph would shorten labels before dropping a lane; the list would
shorten migration names before hashes. Blocks print to stderr, so `ui.width` is
stderr's width.

- When that stream is not a terminal, `ui.width` is `Number.POSITIVE_INFINITY` —
  unbounded. It behaves correctly in the arithmetic a renderer already does
  (`Math.min(x, ui.width)`, `ui.width - gutter`), so no renderer needs a special
  case.
- **If a command overruns anyway, the engine prints it.** No truncation, no
  wrapping, no ellipsis. The engine stays dumb; a command that wants to fit was
  told how much room it had.
- Reaching `columns` requires widening the runtime seam: `OutputStream`
  (`runtime.ts:7-9`) and `HostProcess` (`:97-111`) gain an optional
  `columns?: number`, and the bin adapter (`packages/cli/src/v8/runtime.ts`)
  passes it through instead of dropping it. Keep the structural typing — no
  `NodeJS.*` in the public surface.
- Width is read per render, not cached, so a resized terminal is respected on the
  next command.

Display width is measured with `string-width`, which is already the measurement
dependency of this repo's shell and of the ORM CLI. Measuring by code unit would
misalign every column to the right of a CJK name, and shipping alignment that
works only for Latin text is worse than the ragged output it replaces, because
it looks deliberate.

## 5. Testing

- Every tone, colour on and off, exact bytes; the palette pinned in the
  golden-rendering suite so a colour change is a visible diff.
- A table with ragged content aligns; a table whose cells carry spans aligns
  identically with colour on and off; a table containing a wide (CJK) cell
  aligns.
- A card aligns its values into one column and tones its labels; `rail: true`
  reproduces the legacy rail bytes.
- A tree renders connectors and glyphs matching the style guide's example
  verbatim.
- A drawing round-trips its spans with no reflow.
- `ui.width` is stderr's columns; `POSITIVE_INFINITY` when stderr is not a
  terminal; a command that overruns is printed unmodified.
- `NO_COLOR` suppresses every tone; `--color` overrides it; `--no-color`
  suppresses colour on a terminal.
- Colour resolution follows stderr: `cmd > file` on a terminal keeps colour.

## 6. Coordination

- Lands in `packages/cli-engine`, ships in a published `@prisma/cli-engine`;
  both families convert their renderers afterwards.
- Touches `presentation.ts`, `execution/rendering.ts`,
  `execution/command-context.ts`, `execution/shared-flags.ts`, `runtime.ts`, and
  the exports barrel, plus the `packages/cli` call sites the `status` rename
  reaches and the goldens the new rendering re-pins.
- Branches from `main`. The runtime change overlaps the package-manager
  capability (#140) and telemetry (#143) specs, but all three only add a field to
  `Runtime`, so the conflicts are additive and no stacking is warranted
  (operator: work it out, 2026-08-11).
- `Text` replacing `string` in block fields is source-compatible: every existing
  call site passes strings. `summary.tone` → `summary.status` is not, and is
  renamed in the same PR.

## 7. Acceptance

- [ ] One `Tone` union — semantic names plus indexed colours — drawn on by
      `Span`, the blocks, and `Ui`; `Status` is a separate field that selects the
      glyph and nothing else.
- [ ] `Text = string | Span[]` accepted everywhere a block takes display text;
      handlers never emit escape sequences.
- [ ] `table` aligns; `fields` restores the aligned, toned card with an opt-in
      rail; `tree` draws connectors and status glyphs; `drawing` renders spans
      verbatim.
- [ ] `ui.width` is stderr's width, unbounded off-terminal; overruns print
      unmodified.
- [ ] Colour resolution follows stderr; `--color`/`--no-color` beats `NO_COLOR`,
      which beats the stream.
- [ ] The indexed colours are the ORM's lane rotation, which excludes red.
- [ ] Goldens pin the palette, table alignment, card alignment, and tree
      connectors.

## 8. Amendments after the implementation survey

Four changes to the ruled spec, each made because the shipping code answered a
question the spec had left to taste. The operator's instruction was to find the
established solution rather than invent one.

1. **Six indexed colours, not eight.** The ORM's `LANE_COLORIZERS` is a
   six-entry rotation over basic ANSI — `white, cyan, yellow, blueBright,
   magenta, green` — chosen to exclude red so a lane cannot read as an error.
   Basic ANSI has no two further hues that stay distinguishable from those six;
   the remaining candidates are bright variants of colours already in the set.
   Reaching eight would mean moving to a 256-colour palette that neither
   shipping CLI uses. Six mutually distinguishable colours beat eight where two
   are indistinguishable.
2. **`Status` split out of `Tone`.** The ruled spec had `Block.tone` and
   `TreeNode.tone` selecting a status glyph, inheriting the conflation from
   today's `summary.tone`. A colour and a status symbol are different facts:
   fusing them means a tree node cannot be a failure painted in its lane's hue.
3. **`fields` restores the card.** The ruled spec left `fields` shape-only.
   It is the most-used block in the CLI (36 sites) and the one that lost the most
   — the legacy card's alignment and accent colour. Restoring it is the point of
   the slice, not an extension of it.
4. **`--color` beats `NO_COLOR`.** The ruled spec said `NO_COLOR` was absolute.
   An explicit flag on the invocation beats anything in the environment
   (operator, 2026-08-11); "absolute" governs renderers reaching around the
   engine, which the engine-owned palette makes impossible anyway.
