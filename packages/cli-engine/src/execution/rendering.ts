import type { EngineEvent } from "../events";
import type {
  Block,
  PresentedResult,
  Status,
  Text,
  Tone,
  TreeNode,
} from "../presentation";
import type { Diagnostic, NextAction } from "../protocol";
import type { Invocation, RunState } from "./engine";
import { makePaint, type Paint, renderText, textWidth } from "./palette";

export function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return (newline === -1 ? text : text.slice(0, newline)).trim();
}

const STEP_OUTCOME_SYMBOL: Readonly<
  Record<Extract<EngineEvent, { kind: "step-finished" }>["outcome"], string>
> = {
  ok: "✔",
  failed: "✘",
  skipped: "↷",
  warning: "⚠",
};

/** Human rendering: `output` data lines are the command's data on OUR
 *  stdout; everything else is commentary on stderr. `remediation` is
 *  transcript-only: framed in json mode, never rendered in human mode,
 *  never aggregated into any envelope. */
export function renderEventHuman(
  invocation: Invocation,
  event: EngineEvent,
): void {
  const { stdout, stderr } = invocation.runtime;
  switch (event.kind) {
    case "message":
      stderr.write(`${event.text}\n`);
      return;
    case "output":
      (event.channel === "data" ? stdout : stderr).write(`${event.line}\n`);
      return;
    case "step-started":
      stderr.write(`▸ ${event.step}\n`);
      return;
    case "step-finished":
      stderr.write(`${STEP_OUTCOME_SYMBOL[event.outcome]} ${event.step}\n`);
      return;
    case "progress":
      stderr.write(
        `${event.step === undefined ? "progress" : event.step} ${event.completed}${event.total === undefined ? "" : `/${event.total}`}\n`,
      );
      return;
    case "remediation":
      return;
    case "endpoint":
      stderr.write(`${event.name}: ${event.url}\n`);
      return;
    case "status":
      stderr.write(
        `${event.subject}: ${event.from === undefined ? "" : `${event.from} → `}${event.status}\n`,
      );
      return;
    case "artifact":
      stderr.write(
        `${event.path}${event.description === undefined ? "" : ` — ${event.description}`}\n`,
      );
      return;
  }
}

/**
 * The four Status glyphs. The step-outcome map above and the
 * diagnostic-severity map below answer different questions, but the
 * three draw the same characters on purpose: one run must not report a
 * failure with one mark and explain it with another.
 */
const STATUS_SYMBOL: Readonly<Record<Status, string>> = {
  ok: "✔",
  error: "✘",
  warn: "⚠",
  info: "ℹ",
};

const MASK = "********";
const COLUMN_GAP = "  ";
const RAIL = "│";
const BRANCH = "├─";
const LAST_BRANCH = "└─";
const TRAILING_SPACES = / +$/;

/**
 * The engine draws; a command describes. Every escape sequence in the
 * output originates here, which is what makes width measurable and
 * alignment safe: a handler hands over spans, never bytes.
 */
export function renderBlock(
  block: Block,
  paint: Paint,
  write: (line: string) => void,
): void {
  switch (block.kind) {
    case "summary": {
      const glyph = paint(
        block.tone ?? block.status,
        STATUS_SYMBOL[block.status],
      );
      write(`${glyph} ${renderText(block.text, paint)}`);
      return;
    }
    case "fields":
      writeFields(block.rows, block.rail === true, paint, write);
      return;
    case "table":
      writeTable(block.columns, block.rows, paint, write);
      return;
    case "list":
      for (const item of block.items) {
        write(`- ${renderText(item, paint)}`);
      }
      return;
    case "tree":
      for (const root of block.roots) {
        write(treeLabel(root, paint));
        writeBranches(root.children ?? [], "", paint, write);
      }
      return;
    case "drawing":
      for (const line of block.lines) {
        write(renderText(line, paint));
      }
      return;
  }
}

/** Appends to the text's last span, so a pad or a colon inherits the
 *  tone of the run it extends — which is what makes a padded key one
 *  continuous coloured field, as the legacy card drew it. */
function extend(text: Text, suffix: string): Text {
  if (suffix === "") {
    return text;
  }
  if (typeof text === "string") {
    return `${text}${suffix}`;
  }
  const last = text.at(-1);
  if (last === undefined) {
    return suffix;
  }
  return [...text.slice(0, -1), { ...last, text: `${last.text}${suffix}` }];
}

function padTo(text: Text, width: number): Text {
  const gap = width - textWidth(text);
  return gap > 0 ? extend(text, " ".repeat(gap)) : text;
}

/** The tone a cell falls back to when it states none of its own. */
function toned(text: Text, tone: Tone): Text {
  if (typeof text === "string") {
    return [{ text, tone }];
  }
  return text.map((span) =>
    span.tone === undefined ? { ...span, tone } : span,
  );
}

/**
 * The legacy card, restored: `${label}:` padded to a common width so
 * every value starts in the same column, the label in the accent
 * colour, two spaces between the two.
 */
function writeFields(
  rows: ReadonlyArray<{
    readonly label: Text;
    readonly value: Text;
    readonly sensitive?: boolean;
  }>,
  rail: boolean,
  paint: Paint,
  write: (line: string) => void,
): void {
  const cells = rows.map((row) => ({
    label: toned(extend(row.label, ":"), "heading"),
    value: row.sensitive === true ? MASK : orPlaceholder(row.value),
  }));
  const width = Math.max(0, ...cells.map((cell) => textWidth(cell.label)));
  const prefix = rail ? `${paint("structure", RAIL)}${COLUMN_GAP}` : "";
  for (const cell of cells) {
    const label = renderText(padTo(cell.label, width), paint);
    write(`${prefix}${label}${COLUMN_GAP}${renderText(cell.value, paint)}`);
  }
}

/**
 * Every column as wide as its widest cell, measured on the text rather
 * than the bytes so colour cannot shift a column. The last column is
 * never padded, so no line carries trailing whitespace.
 */
/** One header convention for every table: plain-string headers are
 *  normalized to sentence case, so casing is not a per-command choice. */
function sentenceCase(text: Text): Text {
  if (typeof text !== "string" || text === "") {
    return text;
  }
  return `${text[0].toUpperCase()}${text.slice(1)}`;
}

const PLACEHOLDER = "—";

/** An absent value renders as a dim em dash rather than invented prose
 *  ("none", "n/a") in data tone. */
function orPlaceholder(cell: Text): Text {
  const empty =
    cell === "" || (typeof cell !== "string" && textWidth(cell) === 0);
  return empty ? [{ text: PLACEHOLDER, tone: "placeholder" }] : cell;
}

function writeTable(
  columns: readonly Text[],
  rows: ReadonlyArray<readonly Text[]>,
  paint: Paint,
  write: (line: string) => void,
): void {
  const all = [
    columns.map((column) => toned(sentenceCase(column), "heading")),
    ...rows.map((row) => row.map(orPlaceholder)),
  ];
  const widths: number[] = [];
  for (const row of all) {
    for (const [index, cell] of row.entries()) {
      widths[index] = Math.max(widths[index] ?? 0, textWidth(cell));
    }
  }
  for (const row of all) {
    const cells = row.map((cell, index) =>
      renderText(
        index === row.length - 1 ? cell : padTo(cell, widths[index]),
        paint,
      ),
    );
    write(cells.join(COLUMN_GAP).replace(TRAILING_SPACES, ""));
  }
}

/** Roots carry no connector; every level below is drawn from its
 *  parent's prefix, so a deep branch stays under its own lane. */
function writeBranches(
  nodes: readonly TreeNode[],
  prefix: string,
  paint: Paint,
  write: (line: string) => void,
): void {
  for (const [index, node] of nodes.entries()) {
    const last = index === nodes.length - 1;
    const connector = paint("structure", last ? LAST_BRANCH : BRANCH);
    write(`${prefix}${connector} ${treeLabel(node, paint)}`);
    const continuation = last
      ? "   "
      : `${paint("structure", RAIL)}${COLUMN_GAP}`;
    writeBranches(
      node.children ?? [],
      `${prefix}${continuation}`,
      paint,
      write,
    );
  }
}

function treeLabel(node: TreeNode, paint: Paint): string {
  const tone = node.tone ?? node.status;
  const label = renderText(
    tone === undefined ? node.label : toned(node.label, tone),
    paint,
  );
  if (node.status === undefined) {
    return label;
  }
  const glyph = paint(node.tone ?? node.status, STATUS_SYMBOL[node.status]);
  return `${glyph} ${label}`;
}

const DIAGNOSTIC_SYMBOL: Readonly<Record<Diagnostic["severity"], string>> = {
  error: "✘",
  warn: "⚠",
  info: "ℹ",
};

const PLAIN = makePaint(false);

export function writeDiagnostic(
  stream: { write(text: string): void },
  diagnostic: Diagnostic,
  paint: Paint = PLAIN,
): void {
  const glyph = paint(
    diagnostic.severity,
    DIAGNOSTIC_SYMBOL[diagnostic.severity],
  );
  const code = paint("muted", `[${diagnostic.code}]`);
  stream.write(`${glyph} ${code} ${diagnostic.summary}\n`);
  if (diagnostic.why !== undefined) {
    stream.write(`  ${paint("muted", `why: ${diagnostic.why}`)}\n`);
  }
  for (const action of diagnostic.nextActions) {
    stream.write(`${renderNextAction(action, paint)}\n`);
  }
  if (diagnostic.docsUrl !== undefined) {
    stream.write(
      `  ${paint("muted", "docs:")} ${paint("link", diagnostic.docsUrl)}\n`,
    );
  }
}

/** `label` is required, so a mapper building an action out of a bare
 *  command string — a legacy error's follow-up step, with no prose
 *  beside it — has nothing to put in the label but the command itself.
 *  Only the renderer sees both fields, so only it can tell they are the
 *  same string and print it once. */
export function renderNextAction(
  action: NextAction,
  paint: Paint = PLAIN,
): string {
  const target = action.command ?? action.url;
  const repeatsTheLabel = target === undefined || target === action.label;
  const arrow = paint("heading", "→");
  if (repeatsTheLabel) {
    const label =
      action.command !== undefined
        ? paint("identifier", action.label)
        : action.label;
    return `${arrow} ${label}`;
  }
  const painted =
    action.command !== undefined
      ? paint("identifier", target as string)
      : paint("link", target as string);
  return `${arrow} ${action.label}: ${painted}`;
}

/** Populates docsUrl from the owning family's docsBaseUrl (base + code)
 *  when the diagnostic does not carry its own — a per-raise docsUrl wins. */
export function withDocsUrl(
  state: RunState,
  diagnostic: Diagnostic,
): Diagnostic {
  if (diagnostic.docsUrl !== undefined || state.docsBaseUrl === undefined) {
    return diagnostic;
  }
  const base = state.docsBaseUrl.endsWith("/")
    ? state.docsBaseUrl
    : `${state.docsBaseUrl}/`;
  return { ...diagnostic, docsUrl: `${base}${diagnostic.code}` };
}

/** One rendered paragraph of human output. `compact` marks a run of
 *  one-liners — summaries, next-action arrows, single-line diagnostics —
 *  that reads as a glyph-aligned list. */
export interface RenderedSection {
  readonly lines: string[];
  readonly compact: boolean;
}

const TRAILING_NEWLINE = /\n$/;

export function diagnosticSection(
  diagnostic: Diagnostic,
  paint: Paint,
): RenderedSection {
  const lines: string[] = [];
  writeDiagnostic(
    {
      write: (text) =>
        lines.push(...text.replace(TRAILING_NEWLINE, "").split("\n")),
    },
    diagnostic,
    paint,
  );
  return { lines, compact: lines.length === 1 };
}

/** A blank line between sections wherever a multi-line one is involved,
 *  so a card, a table and the next actions each read as their own
 *  paragraph; adjacent compact sections keep hugging. */
export function writeSections(
  sections: readonly RenderedSection[],
  stream: { write(text: string): void },
): void {
  let previous: RenderedSection | undefined;
  for (const section of sections) {
    if (section.lines.length === 0) {
      continue;
    }
    if (previous !== undefined && !(previous.compact && section.compact)) {
      stream.write("\n");
    }
    for (const line of section.lines) {
      stream.write(`${line}\n`);
    }
    previous = section;
  }
}

/** Channel discipline (operator ruling, 2026-08-09): human Blocks,
 *  next-action lines, and diagnostics are presentation prose on stderr;
 *  the materialized `stdout` presentation lines are the machine-usable
 *  payload on stdout, always — human mode stays pipe-clean. */
export function renderCompletedHuman(
  invocation: Invocation,
  presented: PresentedResult<unknown>,
): void {
  const { runtime, state } = invocation;
  const paint = makePaint(state.colorEnabled);
  const sections: RenderedSection[] = presented.presentation.human.map(
    (block) => {
      const lines: string[] = [];
      renderBlock(block, paint, (line) => lines.push(line));
      return { lines, compact: block.kind === "summary" };
    },
  );
  if (presented.presentation.next.length > 0) {
    sections.push({
      lines: presented.presentation.next.map((action) =>
        renderNextAction(action, paint),
      ),
      compact: true,
    });
  }
  for (const diagnostic of presented.diagnostics) {
    sections.push(diagnosticSection(withDocsUrl(state, diagnostic), paint));
  }
  writeSections(sections, runtime.stderr);
  /** The machine lines exist for a consumer on the other end of
   *  stdout. Only when stdout and stderr both render to the SAME
   *  terminal do the blocks and the mirror land on one screen as
   *  visible duplication, so that is the one case that skips them
   *  (amends the 2026-08-09 "always" ruling; any redirection of either
   *  stream keeps the mirror, so pipes still receive exactly the data
   *  lines). A harness that allocates two separate PTYs reports
   *  outputStreamsShareDevice false and keeps its mirror; a host that
   *  cannot tell is treated as one terminal. */
  const oneScreen =
    runtime.isTty.stdout &&
    runtime.isTty.stderr &&
    runtime.outputStreamsShareDevice !== false;
  if (!oneScreen) {
    for (const line of presented.presentation.stdout) {
      runtime.stdout.write(`${line}\n`);
    }
  }
}
