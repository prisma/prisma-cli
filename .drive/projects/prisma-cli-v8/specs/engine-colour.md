# Engine spec — the palette, rendering, and terminal width

Status: ruled 2026-08-11 (operator). Deliverable: one PR to `packages/cli-engine`. Consumers: the ORM family and the platform family, both of which lose rendering today.

Supersedes two earlier revisions of this document. The first routed rich renderings through `Presentations.stdout` (wrong: that is the machine channel). The second proposed a separate `graphic` presenter and left tables, trees and width alone (wrong: the engine owns rendering, so the fix belongs in the block grammar).

## 1. What is broken

The engine ships a common renderer that does almost no rendering.

- **No colour at all.** `makeUi` (`execution/command-context.ts:24-37`) emits exactly two escape sequences — SGR bold and dim. There is no colour anywhere in the engine, and `colorette` is not a dependency. Every ported platform presenter is written `human: () => [...]`; not one binds `ui`. The entire v8 CLI is unstyled.
- **Tables do not align.** `renderBlock` (`execution/rendering.ts:86-91`) is `write(columns.join("  "))` then `write(row.join("  "))`. No sizing, no padding. The golden suite pins the result: `name  id  status` over `Acme Inc  ws_1  current`.
- **Trees have no connectors.** `writeTree` (`:103-124`) emits two-space indents. The style guide specifies `├─ ✘ table user` with dim connectors and coloured glyphs; the block cannot express it, and has zero users.
- **There is no way to draw.** A migration DAG with gutter lanes is not a tree and not a table. No block kind fits.
- **Width is unreachable.** `OutputStream` is `{ write(text: string): void }` (`runtime.ts:7-9`) — no `columns`, structurally, even from the bin. Nothing in the engine reads terminal size. Consequently every ORM picture already breaks on a narrow terminal today: they assume unlimited width and let the terminal hard-wrap, which destroys the gutter alignment that carries their meaning.

Both consumers have already lost rendering to this. The platform port flattened `auth workspace list`, `project list` and `agent status` from aligned rail-and-card renderings to ragged blocks, recorded as accepted divergences. The ORM port ships its renderers colourless, and two of them bypass `NO_COLOR` outright (`createColors({ useColor: true })`) to get colour at all.

## 2. Text and the palette

### 2.1 One text type, everywhere

Anywhere a block takes display text, it takes `Text`:

```ts
type Text = string | readonly Span[];

interface Span {
  readonly text: string;
  readonly tone?: Tone;
}
```

A bare string is untoned text. Spans carry meaning, never escape sequences: **a handler never emits ANSI**, so the engine can measure, re-theme, and strip by construction. Width is computed from `span.text`, so colour cannot break alignment — the pad-versus-colour trap that exists in shipped code today (`packages/cli/src/lib/app/deploy-output.ts:41`) becomes unrepresentable.

### 2.2 The palette

One `Tone` union, drawn on by `Span`, `Block.tone`, and `Ui` alike. Semantic names and indexed colours in the same union; a command asks for meaning where it has one, and for a distinguishable colour where it does not.

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
  | 'color-1' | 'color-2' | 'color-3' | 'color-4' | 'color-5' | 'color-6' | 'color-7' | 'color-8';
```

Consolidated from what both CLIs colour today. `heading` is the platform's cyan (40 sites: field keys and column headers); `identifier` is the ORM's cyan (18 sites: schema names, hashes, commands) — different meanings, both needed. `muted` and `structure` are both dim today but are not the same thing: one is de-emphasised text, the other is the drawing.

The indexed colours are for series — the migration graph assigns one per branch lane, `lane % N`, and tints the lane's gutter cells, node glyph and migration name alike so they read as one colour. The engine owns which colours these are and guarantees they are mutually distinguishable, that none collides with `error`, and that they are stable within a run. A command says `color-3`; it does not know or care what that is.

### 2.3 `Ui`

`Ui` gains a verb per tone, for styling inside text, and the available width (§4):

```ts
interface Ui {
  readonly width: number;              // §4
  readonly emphasize: (text: string) => string;   // kept: existing callers
  readonly dim: (text: string) => string;         // kept
  readonly code: (text: string) => string;        // kept
  readonly tone: (tone: Tone, text: string) => string;
}
```

Colour disabled ⇒ every verb is an identity function, so a renderer has one code path and no `if (colour)` branch.

### 2.4 Colour resolution

Engine-owned, unchanged in principle, corrected in one respect: it must key off **the stream the engine is printing to**. Today it keys off `isTty.stdout` (`execution/shared-flags.ts:156-158`) while blocks render to stderr, so `cmd > file` disables colour for output a human is watching and `cmd 2> file` leaves it on for output nobody sees.

`NO_COLOR` is honoured absolutely. The two ORM renderers that force colour past it stop doing so when the palette is engine-owned — there is no per-renderer colour switch left to bypass.

## 3. The block grammar

`Block` grows and two existing kinds are fixed. The rule is unchanged: **the engine renders; a command describes.** A command reaches for `drawing` only when its layout genuinely cannot be described structurally.

### 3.1 `table` — the engine aligns it

```ts
{ kind: 'table'; columns: readonly Text[]; rows: ReadonlyArray<readonly Text[]> }
```

The engine sizes each column to its widest cell (measured on text, not escapes), pads, and joins with two spaces. Column headers render as `heading` unless the cell carries its own tone. This alone restores `auth workspace list`, `project list` and every other flattened platform table.

### 3.2 `tree` — the engine draws the connectors

```ts
{ kind: 'tree'; roots: readonly TreeNode[] }

interface TreeNode {
  readonly label: Text;
  readonly tone?: Tone;          // renders a status glyph before the label
  readonly children?: readonly TreeNode[];
}
```

The engine draws `├─`, `└─`, `│` in `structure` tone and the status glyph (`✔ ✖ ⚠ ℹ`) from `tone`, matching the style guide's `├─ ✘ table user`. This restores the ORM's schema tree and the operation trees, and gives `agent status` a way to express the nesting it lost.

### 3.3 `drawing` — the escape hatch

```ts
{ kind: 'drawing'; lines: readonly Text[] }
```

Lines of spans, rendered verbatim: the engine applies the palette and writes each line, and does nothing else — no layout, no reflow, no truncation. This is for output whose 2D structure the engine cannot derive: the migration DAG's lane gutter, where lane assignment comes from a BFS over the graph and the same hue must reach the gutter cell, the node glyph and the label text.

`summary`, `fields` and `list` keep their shapes, with `Text` in place of `string`.

## 4. Terminal width

The engine reads the terminal width **of the stream it is printing to** and hands it to the command as `ui.width`, because only the command knows what to sacrifice: the graph would shorten labels before dropping a lane; the list would shorten migration names before hashes.

- When that stream is not a terminal, `ui.width` is `Number.POSITIVE_INFINITY` — unbounded. It behaves correctly in the arithmetic a renderer already does (`Math.min(x, ui.width)`, `ui.width - gutter`), so no renderer needs a special case.
- **If a command overruns anyway, the engine prints it.** No truncation, no wrapping, no ellipsis. The engine stays dumb; a command that wants to fit was told how much room it had.
- Reaching `columns` requires widening the runtime seam: `OutputStream` (`runtime.ts:7-9`) and `HostProcess` (`:97-111`) gain an optional `columns?: number`, and the bin adapter (`packages/cli/src/v8/runtime.ts`) passes it through instead of dropping it. Keep the structural typing — no `NodeJS.*` in the public surface.
- Width is read per render, not cached, so a resized terminal is respected on the next command.

## 5. Testing

- Every tone, colour on and off, exact bytes; the palette pinned in the golden-rendering suite so a colour change is a visible diff.
- A table with ragged content aligns; a table whose cells carry spans aligns identically with colour on and off.
- A tree renders connectors and glyphs matching the style guide's example verbatim.
- A drawing round-trips its spans with no reflow.
- `ui.width` is the printing stream's columns; `POSITIVE_INFINITY` when not a terminal; a command that overruns is printed unmodified.
- `NO_COLOR` suppresses every tone, with no path that bypasses it.
- Colour resolution follows the printing stream: `cmd > file` on a terminal keeps colour on stderr.

## 6. Coordination

- Lands in `packages/cli-engine`, ships in a published `@prisma/cli-engine`; both families convert their renderers afterwards.
- Touches `presentation.ts`, `execution/rendering.ts`, `execution/command-context.ts`, `execution/shared-flags.ts`, `runtime.ts`, and the exports barrel. The runtime change overlaps the package-manager capability and telemetry specs — sequence with the operator.
- `Text` replacing `string` in block fields is source-compatible: every existing call site passes strings.

## 7. Acceptance

- [ ] One `Tone` union — semantic names plus indexed colours — drawn on by `Span`, `Block.tone`, and `Ui`.
- [ ] `Text = string | Span[]` accepted everywhere a block takes display text; handlers never emit escape sequences.
- [ ] `table` aligns; `tree` draws connectors and status glyphs; `drawing` renders spans verbatim.
- [ ] `ui.width` is the printing stream's width, unbounded off-terminal; overruns print unmodified.
- [ ] Colour resolution keys off the printing stream; `NO_COLOR` is absolute and unbypassable.
- [ ] The palette guarantees the indexed colours are mutually distinguishable and none collides with `error`.
- [ ] Goldens pin the palette, table alignment, and tree connectors.
