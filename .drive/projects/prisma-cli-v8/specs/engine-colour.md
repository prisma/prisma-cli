# Engine spec — colour in command output

Status: ruled 2026-08-11 (operator, after QA of the first ported ORM command: output must be able to carry colour). Deliverable: one PR to `packages/cli-engine`. The first consumer is the ORM family, whose renderers are colourless today because the surface below does not exist.

## 1. The problem, concretely

The ORM's `migration list` renders a tree where colour carries meaning: the migration name in cyan, the operation count dimmed, a failed verification in red. Ported onto the engine it renders in one colour, because a handler has no way to ask for any other.

Two independent gaps cause that.

**A rich renderer receives no `Ui` at all.** The engine's presentation surface is:

```ts
interface Presentations {
  readonly human: (ui: Ui) => readonly Block[];
  readonly stdout?: () => readonly string[];   // ← no ui parameter
  readonly json?: () => unknown;
  readonly next?: () => readonly NextAction[];
}
```

The ORM's tree, table and graph renderers ship as pre-rendered strings through `stdout` (they are machine-consumable data lines, and their layout is theirs, not the engine's block grammar). `stdout` takes no arguments, so those renderers cannot style anything.

**`Ui` has no vocabulary for it.** It is `{ emphasize, dim, code }`. `Block` already carries a `tone` of `"ok" | "error" | "warn" | "info"` for summaries, so the engine has a tone vocabulary at block level and nothing at string level.

## 2. What the ORM actually colours

Counted across the ORM CLI's renderers, so the vocabulary is derived from real use rather than guessed:

| Colour | Count | What it means there |
| --- | --- | --- |
| red | 23 | a failure, drift, a destructive operation |
| dim | 19 | secondary detail — counts, timestamps, gutters |
| cyan | 17 | **an identifier**: table name, migration hash, ref name, node label |
| green | 15 | success, an additive operation |
| bold | 13 | emphasis within a line |
| yellow | 5 | a warning |
| magenta | 3 | **a placeholder slot** in a usage string (`<ref>`) |
| blue | 2 | a URL |

Two of these are not status tones and have no equivalent in `Block.tone`: **identifier** and **placeholder**. A palette of only ok/error/warn/info would force renderers to pick a status tone for a table name, which is why this spec proposes the wider set below.

(The help formatter's colours are excluded from the table above — help is engine-owned and its colouring is the engine's business, not a family's.)

## 3. The surface

### 3.1 `Ui` gains semantic verbs

```ts
interface Ui {
  // existing
  readonly emphasize: (text: string) => string;
  readonly dim: (text: string) => string;
  readonly code: (text: string) => string;
  // new — semantic, never colour names
  readonly ok: (text: string) => string;
  readonly error: (text: string) => string;
  readonly warn: (text: string) => string;
  readonly info: (text: string) => string;
  readonly identifier: (text: string) => string;   // a name the user typed or will type
  readonly placeholder: (text: string) => string;  // an argument slot: <ref>
  readonly link: (text: string) => string;         // a URL
}
```

**Semantic, not colour names, and that is the point.** A product asks for meaning; the engine owns the mapping to an actual colour. One palette across every command in the unified CLI, changeable in one place, and a consumer cannot invent a fifteenth shade of blue. The first four names deliberately match `Block.tone`'s vocabulary so a summary block and a rendered line agree.

### 3.2 `stdout` receives the same `Ui`

```ts
readonly stdout?: (ui: Ui) => readonly string[];
```

This is the change that unblocks the ORM's renderers. It is source-compatible: an existing `stdout` implementation that ignores the parameter keeps working.

### 3.3 When colour is off, the verbs are identity functions

The engine already resolves whether colour is enabled (`--color` / `--no-color`, `NO_COLOR`, TTY detection, format). That resolution stays entirely engine-owned and is not exposed on the context — a handler never branches on it, it just calls the verb. Colour off means every verb returns its input unchanged, so a renderer has exactly one code path and no `if (colour)` anywhere.

## 4. The alignment trap — the part most likely to ship broken

Colour codes have length but no width. A renderer that pads a column and then colours the padded text produces correct output; one that colours first and pads after computes the wrong width and produces a ragged table. The ORM's `migration list` aligns three columns, so this will bite immediately.

The spec requires **both**:

1. Documentation on `Ui` stating that tone verbs are applied *after* width computation, with the failure mode named.
2. A width helper the engine exports — `visibleWidth(text: string): number` — that ignores ANSI sequences, so a renderer that must measure already-styled text has a correct way to do it rather than reaching for a regex of its own.

A golden test that pads and colours in both orders, asserting the aligned one matches, is worth more here than prose.

## 5. What the engine owns

- The tone → colour mapping (one module, one table).
- The enabled/disabled resolution, unchanged from today.
- Stripping: any tone applied while colour is disabled produces no escape sequence at all — not an escape sequence the engine strips later. There is no post-hoc strip pass to get wrong.
- The json path never sees styled text: `json()` builds from data, not from rendered strings, so this surface cannot leak escapes into machine output.

## 6. Testing

- Every verb, colour on and colour off, asserting exact bytes.
- `stdout(ui)` receives a working `Ui`; an implementation ignoring the parameter still compiles and runs.
- `visibleWidth` against styled and unstyled text, including multibyte characters.
- The alignment golden described in §4.
- One golden per tone in the existing golden-rendering suite, so the palette is pinned centrally and a change to it is a visible diff.

## 7. Coordination

- Lands in `packages/cli-engine`, ships in a published `@prisma/cli-engine`; the ORM port picks it up by version and converts its renderers in the round after.
- Touches `presentation.ts`, `execution/rendering.ts`, and the exports barrel — a smaller footprint than the package-manager capability or telemetry, and it does not overlap the `cli.ts`/`context.ts`/`runtime.ts` cluster those two contend over.
- Until it publishes, ported ORM renderers stay colourless; that is a recorded divergence, not a defect to work around with raw ANSI in the family.

## 8. Acceptance

- [ ] `Ui` carries the eleven verbs in §3.1; the four status names match `Block.tone`'s vocabulary.
- [ ] `Presentations.stdout` receives `Ui`; existing implementations are source-compatible.
- [ ] Colour disabled ⇒ every verb is identity; no escape sequence is emitted anywhere on that path.
- [ ] `visibleWidth` is exported and correct for styled and multibyte text.
- [ ] The alignment golden passes, and the palette is pinned in the golden-rendering suite.
- [ ] No colour resolution is exposed on `CommandContext` — handlers cannot branch on it.
